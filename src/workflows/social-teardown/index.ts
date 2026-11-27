// social-teardown: one account on any platform, or several handles of one brand, read and
// taken apart: what carried it, what its top posts share, when it posts, its launches, who
// carried them, what people ask, the words of its videos, and where it sends people.
//
// A default run reads the recent history inside 100 credits. --deep reads the whole account
// and every top post's reposters, quotes, replies and words, as the study read Treg, inside
// 600. The harness prints the price and runs (no approval step, owner ruling of 27/11/2026);
// --plan prints the free quote and spends nothing.
import { RATES } from "../../engine/rates.ts";
import { renderReport } from "../../engine/outputs.ts";
import { validateReport } from "../../engine/validate.ts";
import type { ValidateOptions, Validation } from "../../engine/validate.ts";
import type { Session } from "../../kit/record.ts";
import type { WorkflowResult } from "../../render/types.ts";
import type { Workflow, WorkflowArgs, WorkflowQuote } from "../types.ts";
import { ACCOUNT_DEEP, ACCOUNT_DEFAULTS, ACCOUNT_SHARES, runAccount } from "./account.ts";
import { analyseAccount } from "./analyse.ts";
import type { AccountAnalysis } from "./analyse.ts";
import { ADAPTERS } from "./platforms.ts";
import { buildResult, WORKFLOW } from "./report.ts";
import { parseTargets } from "./targets.ts";
import type { Target } from "./targets.ts";
import { Tracker } from "./tracker.ts";
import { analyseXAccount } from "./x-account.ts";
import type { XAccount } from "./x-account.ts";
import { runX, xShares, X_DEEP, X_DEFAULTS } from "./x/x.ts";

export const VERSION = "0.1.0";
const DEFAULT_BUDGET = 100;
const DEEP_BUDGET = 600;

let validation: { problems: Validation["problems"]; options: ValidateOptions } | null = null;
/** The report gate's verdict on the last run (for the tests and the harness's log). */
export const lastValidation = () => validation;

const accountName = (t: Target) => (t.platform === "x" ? `@${t.handle}` : t.platform === "linkedin" ? t.url : `${t.platform}:${t.handle}`);

/** The free quote: each account's share of the budget and the stages it pays for. No call is made. */
function quote(args: WorkflowArgs): WorkflowQuote {
  const targets = parseTargets([args.input]);
  if (!targets.length) throw new Error("Name an account: @handle for X, platform:handle, or a profile link.");
  const total = args.deep ? DEEP_BUDGET : DEFAULT_BUDGET;
  const each = Math.floor(total / targets.length);
  const lines: string[] = [];
  let expected = 0;
  for (const t of targets) {
    if (t.platform === "x") {
      const s = xShares(each);
      // The stages that run on every account with posts spend their shares: the timeline reads
      // until its share is spent, and each top post fills the reposter, reply, quote and
      // first-hours shares. Transcripts, GitHub and Reddit depend on what the account posts.
      expected += s.profile + s.timeline + s.retweeters + s.replies + s.quotes + s.squad;
      const parts: [string, number][] = [["profile", s.profile], ["timeline", s.timeline], ["reposters", s.retweeters], ["replies", s.replies], ["transcripts", s.transcript], ["quotes", s.quotes], ["first hours", s.squad], ["GitHub", s.github], ["Reddit", s.reddit]];
      lines.push(`${accountName(t)} on X: up to ${each} credits (${parts.filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")})`);
    } else {
      const a = ADAPTERS[t.platform];
      const profile = RATES[a.profile(t).endpoint].page;
      const tl = Math.floor((each * ACCOUNT_SHARES.timeline) / 100);
      const cm = Math.floor((each * ACCOUNT_SHARES.comments) / 100);
      const wd = Math.floor((each * ACCOUNT_SHARES.words) / 100);
      expected += profile + tl + cm;
      lines.push(`${accountName(t)} on ${t.platform}: up to ${each} credits (profile ${profile}, timeline ${tl}, comments ${cm}, transcripts ${wd})`);
    }
  }
  lines.push(`Each stage stops at its share; the report says what it did not read.`);
  return { expected: Math.min(expected, total), max: each * targets.length, lines };
}

async function run(session: Session, args: WorkflowArgs): Promise<WorkflowResult> {
  const targets = parseTargets([args.input]);
  const now = args.now;
  const t = new Tracker(session);
  const accounts: AccountAnalysis[] = [];
  const xs: XAccount[] = [];
  for (const [i, target] of targets.entries()) {
    // Each account gets an even part of what is left, so what one leaves unspent goes to the next.
    const each = Math.floor(session.budget.left / (targets.length - i));
    if (target.platform === "x") {
      const opts = { ...(args.deep ? X_DEEP : X_DEFAULTS), since: args.since, now };
      const recs = await runX(t, target.handle, opts, each, `x:${target.handle}`);
      const xa = analyseXAccount(recs, target.handle, now);
      xs.push(xa);
      accounts.push(xa.account);
    } else {
      const opts = { ...(args.deep ? ACCOUNT_DEEP : ACCOUNT_DEFAULTS), since: args.since, until: args.until, now };
      const r = await runAccount(t, target, opts, each);
      accounts.push(analyseAccount(r, now));
    }
  }
  session.flush();
  const meta = session.meta();
  const command = `/${WORKFLOW} ${targets.map(accountName).join(" ")}${args.deep ? " --deep" : ""}`;
  const limits = [...t.limits, ...session.notRead.filter((nr) => !t.limits.some((l) => l.stage === nr.stage && l.endpoint === nr.endpoint)).map((nr) => ({ ...nr, reason: nr.reason === "budget" ? "not read: the run's budget could not pay for it" : nr.reason }))];
  const built = buildResult({ command, inputs: targets.map(accountName), accounts, x: xs, records: t.records, limits, errors: session.errors, meta, deep: args.deep, now });
  const v = validateReport(renderReport(built.result.report), built.evidence.toJSON(meta), built.validateOptions);
  validation = { problems: v.problems, options: built.validateOptions };
  if (!v.ok) built.result.report.methodNotes.push(`This report failed ${v.problems.length} of its own checks (${v.problems.slice(0, 3).map((p) => p.code).join(", ")}); read the lines it names with care.`);
  return built.result;
}

export const workflow: Workflow = {
  name: WORKFLOW,
  summary: "Take one account apart (or several handles of one brand): what carried it, its launches, who carried them, what people ask.",
  usage: `socialcrawl ${WORKFLOW} "<@handle | platform:handle | profile link> [more handles]" [--deep]`,
  examples: [`socialcrawl ${WORKFLOW} @treg_ai`, `socialcrawl ${WORKFLOW} "tiktok:notionhq ig:notionhq yt:@Notion"`, `socialcrawl ${WORKFLOW} "@treg_ai @jasonzhou1993" --deep`],
  defaultBudget: DEFAULT_BUDGET,
  deepBudget: DEEP_BUDGET,
  takesWindow: true,
  slug: (args) => parseTargets([args.input]).map((t) => `${t.platform}-${t.handle}`).join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60),
  quote,
  run,
};
