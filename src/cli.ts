#!/usr/bin/env node
// socialcrawl: init | whoami | <workflow> "<input>" [options]
// Exit codes: 0 done, 1 error, 2 bad input, 3 out of credits (after printing the offer).
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { UsageError, parseCli } from "./args.ts";
import { credentialsFrom, maskKey, readConfig } from "./config.ts";
import type { Credentials } from "./config.ts";
import { createKit, getAKeyUrl, OutOfCredits, offerLines } from "./kit/kit.ts";
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
}

const NO_KEY = [
  "No SocialCrawl key is set.",
  "Run socialcrawl init (or npx -y socialcrawl@latest init) to paste a key, or to sign in by email: 100 free credits, no card.",
  "Or set SOCIALCRAWL_API_KEY.",
];

function helpLines(workflows: Workflow[]): string[] {
  const width = Math.max(8, ...workflows.map((w) => w.name.length));
  return [
    `socialcrawl ${VERSION}: social media research workflows on the SocialCrawl API`,
    "",
    "Usage:",
    "  socialcrawl init                  set up your key and install the workflows into your agents",
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
  const doFetch: typeof fetch = noCache
    ? (input, init) => deps.fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "Cache-Control": "no-cache" } })
    : deps.fetch;
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
      case "version":
        deps.out(VERSION);
        return EXIT.ok;
      case "whoami":
        return await whoami(deps);
      case "init":
        deps.err("init is not built yet in this version. Set SOCIALCRAWL_API_KEY, or get a key: " + getAKeyUrl(APP));
        return EXIT.error;
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
  });
  process.exitCode = code;
}
