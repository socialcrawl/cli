#!/usr/bin/env node
// socialcrawl: init | whoami | <workflow> "<input>" [options]
// Exit codes: 0 done, 1 error, 2 bad input, 3 out of credits (after printing the offer).
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { UsageError, parseCli } from "./args.ts";
import { tokenFetch } from "./auth.ts";
import { credentialsFrom, maskKey, readConfig, saveConfig } from "./config.ts";
import type { Credentials } from "./config.ts";
import { runInit } from "./init.ts";
import { createKit, OutOfCredits, offerLines } from "./kit/kit.ts";
import { EXIT, runWorkflow } from "./run.ts";
import { VERSION } from "./version.ts";
import { WORKFLOWS } from "./workflows/index.ts";
import type { Workflow } from "./workflows/types.ts";

export const APP = "cli";

export interface MainDeps {
  env: Record<string, string | undefined>;
  home: string;
  cwd: string;
  fetch: typeof fetch;
  out: (line: string) => void;
  err: (line: string) => void;
  now: () => Date;
  workflows: Workflow[];
  openFile?: (file: string) => void;
  /** False when there is no terminal to ask in. */
  interactive?: boolean;
  ask?: (question: string, opts?: { hidden?: boolean }) => Promise<string>;
}

const NO_KEY = [
  "No SocialCrawl key is set.",
  "Run socialcrawl init (or npx -y socialcrawl@latest init) to paste a key, or to sign in by email: 100 free credits, no card.",
  "In an agent's shell, with no terminal to type in: npx -y socialcrawl@latest init --email <your email>, then open the link it prints.",
  "Or set SOCIALCRAWL_API_KEY.",
];

/** One workflow's help: what it does, how to call it, its own options and what a run costs. */
function workflowHelpLines(w: Workflow): string[] {
  const own = Object.entries(w.options ?? {}).map(([k, o]) => `  --${k}${o.type === "string" ? " <value>" : ""}`);
  return [
    `${w.name}: ${w.summary}`,
    "",
    `Usage: ${w.usage}`,
    "",
    "Examples:",
    ...w.examples.map((e) => `  ${e}`),
    ...(own.length ? ["", "Its own options:", ...own] : []),
    "",
    `A default run spends at most ${w.defaultBudget} credits, --deep at most ${w.deepBudget}. --plan prints the quote for free and spends nothing.`,
    "socialcrawl --help lists the options every workflow takes.",
  ];
}

function helpLines(workflows: Workflow[]): string[] {
  const width = Math.max(8, ...workflows.map((w) => w.name.length));
  return [
    `socialcrawl ${VERSION}: social media research workflows on the SocialCrawl API`,
    "",
    "Usage:",
    "  socialcrawl init                  set up your key and install the workflows into your agents",
    "                                    (--project: into this project only; --no-install: the key only;",
    "                                    --email <address>: sign in by email where there is no terminal)",
    "  socialcrawl whoami                the key in use and its credits",
    '  socialcrawl <workflow> "<input>"  run a workflow',
    "",
    "Workflows:",
    ...(workflows.length ? workflows.map((w) => `  ${w.name.padEnd(width)}  ${w.summary}`) : ["  (none yet)"]),
    "",
    "Options for a workflow run:",
    "  --deep            the research-grade run (reads more, costs more)",
    "  --budget <n>      the most credits this run may spend",
    "  --since <date>    start of the window, YYYY-MM-DD, where the workflow takes one",
    "  --until <date>    end of the window",
    "  --out <dir>       the run folder (default ./socialcrawl-runs/<workflow>-<input>-<date>/)",
    "  --plan            print the free quote and spend nothing",
    "  --open            open report.html when done",
    "  --json            print run.json instead of the summary",
    "  --no-cache        read everything fresh",
    "",
    "Every run quotes its cost first, for free. Help: socialcrawl@ridio.io",
  ];
}

function kitFor(creds: Credentials, deps: MainDeps, noCache: boolean) {
  // A saved email sign-in refreshes its token on a 401 and saves the new pair.
  const base: typeof fetch =
    creds.kind === "token"
      ? tokenFetch(creds, { fetch: deps.fetch, onRefresh: (t) => saveConfig(deps.home, { accessToken: t.accessToken, refreshToken: t.refreshToken }) })
      : deps.fetch;
  const doFetch: typeof fetch = noCache
    ? (input, init) => base(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "Cache-Control": "no-cache" } })
    : base;
  return createKit({
    app: APP,
    version: VERSION,
    ...(creds.kind === "key" ? { apiKey: creds.apiKey } : { accessToken: creds.accessToken }),
    ...(deps.env.SOCIALCRAWL_API_URL ? { baseUrl: deps.env.SOCIALCRAWL_API_URL } : {}),
    fetch: doFetch,
    log: () => {},
  });
}

async function whoami(deps: MainDeps): Promise<number> {
  const creds = credentialsFrom(deps.env, readConfig(deps.home));
  if (!creds) {
    for (const l of NO_KEY) deps.err(l);
    return EXIT.error;
  }
  const body = await kitFor(creds, deps, false).balance();
  const balance = Number((body.data as { balance?: number } | undefined)?.balance ?? body.credits_remaining ?? 0);
  deps.out(creds.kind === "key" ? `Key ${maskKey(creds.apiKey)}, from ${creds.source}.` : `Signed in by email, saved in ${creds.source}.`);
  deps.out(`${balance.toLocaleString("en-GB")} credits.`);
  return EXIT.ok;
}

export async function main(argv: string[], deps: MainDeps): Promise<number> {
  try {
    const parsed = parseCli(argv, deps.workflows, deps.now());
    switch (parsed.cmd) {
      case "help":
        for (const l of helpLines(deps.workflows)) deps.out(l);
        return EXIT.ok;
      case "workflow-help":
        for (const l of workflowHelpLines(parsed.workflow)) deps.out(l);
        return EXIT.ok;
      case "version":
        deps.out(VERSION);
        return EXIT.ok;
      case "whoami":
        return await whoami(deps);
      case "init":
        return await runInit(
          {
            env: deps.env,
            home: deps.home,
            cwd: deps.cwd,
            fetch: deps.fetch,
            out: deps.out,
            interactive: deps.interactive ?? false,
            ask: deps.ask ?? (async () => ""),
            ...(parsed.skillsFrom ? { skillsFrom: parsed.skillsFrom } : {}),
          },
          { yes: parsed.yes, install: parsed.install, project: parsed.project, ...(parsed.email ? { email: parsed.email } : {}) },
        );
      case "run": {
        const creds = credentialsFrom(deps.env, readConfig(deps.home));
        if (!creds) {
          for (const l of NO_KEY) deps.err(l);
          return EXIT.error;
        }
        return await runWorkflow({
          workflow: parsed.workflow,
          args: parsed.args,
          opts: parsed.opts,
          kit: kitFor(creds, deps, parsed.opts.noCache),
          cwd: deps.cwd,
          out: deps.out,
          err: deps.err,
          openFile: deps.openFile,
        });
      }
    }
  } catch (e) {
    if (e instanceof UsageError) {
      deps.err(e.message);
      return EXIT.usage;
    }
    if (e instanceof OutOfCredits) {
      for (const l of offerLines(e.offer)) deps.err(l);
      return EXIT.outOfCredits;
    }
    deps.err(`socialcrawl: ${(e as Error).message}`);
    return EXIT.error;
  }
}

/** One line from the terminal; a hidden answer (a pasted key) is not echoed. */
export function askLine(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (opts.hidden) {
      const write = (rl as unknown as { _writeToOutput?: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.startsWith(question)) write?.call(rl, question);
        else if (s.includes("\n") || s.includes("\r")) write?.call(rl, "\n");
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Open a file in the person's default app. */
export function openFile(file: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

function isEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  const code = await main(process.argv.slice(2), {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    fetch,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    now: () => new Date(),
    workflows: WORKFLOWS,
    openFile,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: askLine,
  });
  process.exitCode = code;
}
