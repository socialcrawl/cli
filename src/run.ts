// One workflow run: the free quote, the budget (never more than the balance), the run
// through a Session, the run folder, and the short answer in the terminal.
//
// No question is asked when the balance covers the run. When it does not, the run reads
// what the balance covers, says what it did not read, and ends with the link to top up.
import path from "node:path";

import { Budget } from "./engine/rates.ts";
import { OutOfCredits, offerLines } from "./kit/kit.ts";
import type { ApiBody } from "./kit/kit.ts";
import type { Caller } from "./kit/record.ts";
import { Session } from "./kit/record.ts";
import { runFolderName, terminalSummary, writeRunFolder } from "./render/index.ts";
import type { RunInfo, RunOutput } from "./render/types.ts";
import { VERSION } from "./version.ts";
import type { Workflow, WorkflowArgs } from "./workflows/types.ts";

export const EXIT = { ok: 0, error: 1, usage: 2, outOfCredits: 3 } as const;

export interface RunOptions {
  budget?: number;
  out?: string;
  plan: boolean;
  /** Accepted for scripts; the CLI asks nothing a --yes would skip. */
  yes: boolean;
  open: boolean;
  json: boolean;
  noCache: boolean;
}

export interface RunKit extends Caller {
  balance(): Promise<ApiBody>;
}

export interface RunContext {
  workflow: Workflow;
  args: WorkflowArgs;
  opts: RunOptions;
  kit: RunKit;
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  openFile?: (file: string) => void;
}

const credits = (n: number) => `${n.toLocaleString("en-GB")} credit${n === 1 ? "" : "s"}`;

function topUpUrl(balanceBody: ApiBody): string {
  const d = (balanceBody.data ?? {}) as { checkout_url?: string; top_up_url?: string };
  return d.checkout_url ?? d.top_up_url ?? "https://www.socialcrawl.dev/dashboard/billing";
}

function runInfo(ctx: RunContext, session: Session, budget: number): RunInfo {
  const meta = session.meta();
  return {
    workflow: ctx.workflow.name,
    version: VERSION,
    inputs: { input: ctx.args.input, deep: ctx.args.deep, since: ctx.args.since ?? null, until: ctx.args.until ?? null, flags: ctx.args.flags, budget },
    stages: Object.entries(session.ledger.byStage()).map(([name, s]) => ({ name, calls: s.calls, credits: s.credits })),
    credits: meta.credits,
    calls: meta.calls,
    seconds: meta.seconds,
    startedAt: session.startedAt.toISOString(),
    notRead: session.notRead,
    errors: session.errors.map(({ stage, endpoint, status, message, requestId }) => ({ stage, endpoint, status, message, requestId })),
  };
}

export async function runWorkflow(ctx: RunContext): Promise<number> {
  const { workflow, opts } = ctx;
  const args: WorkflowArgs = { ...ctx.args, noCache: opts.noCache };
  const quote = await workflow.quote(args);
  const balanceBody = await ctx.kit.balance();
  const balance = Number((balanceBody.data as { balance?: number } | undefined)?.balance ?? balanceBody.credits_remaining ?? 0);
  ctx.err(`This run reads about ${credits(quote.expected)} (at most ${quote.max}). You have ${balance.toLocaleString("en-GB")}.`);
  if (opts.plan) {
    for (const l of quote.lines) ctx.err(l);
    ctx.err("Plan only: nothing was spent.");
    return EXIT.ok;
  }
  const asked = opts.budget ?? (args.deep ? workflow.deepBudget : workflow.defaultBudget);
  const budget = Math.min(asked, balance);
  if (budget < 1) {
    ctx.err("Your balance is 0 credits, so the run did not start.");
    ctx.err(`Top up: ${topUpUrl(balanceBody)}`);
    return EXIT.outOfCredits;
  }
  const dir = path.resolve(ctx.cwd, opts.out ?? path.join("socialcrawl-runs", runFolderName(workflow.name, workflow.slug?.(args) ?? args.input, args.now)));
  const session = new Session({ dir, kit: ctx.kit, budget: new Budget(budget), skill: workflow.name, version: VERSION, progress: ctx.err });
  let result;
  try {
    result = await workflow.run(session, args);
  } catch (e) {
    session.flush();
    const read = `${session.records.length} call${session.records.length === 1 ? "" : "s"}, ${credits(session.ledger.credits)}`;
    if (e instanceof OutOfCredits) {
      for (const l of offerLines(e.offer)) ctx.err(l);
      ctx.err(`Read before it stopped: ${read}. The responses are in ${path.join(dir, "responses.jsonl")}.`);
      return EXIT.outOfCredits;
    }
    ctx.err(`The run stopped: ${(e as Error).message}`);
    ctx.err(`Read before it stopped: ${read}. The responses are in ${path.join(dir, "responses.jsonl")}.`);
    return EXIT.error;
  }
  session.flush();
  const run: RunOutput = { ...result, records: session.records, run: runInfo(ctx, session, budget) };
  writeRunFolder(dir, run);
  if (opts.json) {
    ctx.out(JSON.stringify(run.run, null, 2));
  } else {
    for (const l of terminalSummary(run, dir)) ctx.out(l);
    if (asked > balance && quote.max > balance) {
      ctx.out(`Your balance covered ${credits(balance)} of the ${quote.max} this run can read. Top up: ${topUpUrl(balanceBody)}`);
    }
  }
  if (opts.open) ctx.openFile?.(path.join(dir, "report.html"));
  return EXIT.ok;
}
