// socialcrawl init: the key once, then the workflows into every coding agent found.
// The key is checked with the free balance call before it is saved to
// ~/.socialcrawl/config.json, outside any project. No step asks for approval.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AGENT_NAMES, detectAgents, installSkills, installTargets } from "./agents.ts";
import { tokenFetch } from "./auth.ts";
import { CONFIG_LABEL, credentialsFrom, maskKey, readConfig, saveConfig } from "./config.ts";
import type { Credentials } from "./config.ts";
import { ApiError, createKit, login } from "./kit/kit.ts";
import { EXIT } from "./run.ts";
import { WORKFLOWS_ARCHIVE, extractSkills } from "./tarball.ts";
import { VERSION } from "./version.ts";

export interface InitDeps {
  env: Record<string, string | undefined>;
  home: string;
  cwd: string;
  fetch: typeof fetch;
  out: (line: string) => void;
  /** False when there is no terminal to ask in (a script, an agent's shell). */
  interactive: boolean;
  /** Ask one question and return the answer; `hidden` keeps a pasted key off the screen. */
  ask: (question: string, opts?: { hidden?: boolean }) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  /** A local copy of the workflows (the repository, or its skills/ folder) instead of GitHub. */
  skillsFrom?: string;
}

export interface InitOptions {
  yes: boolean;
  install: boolean;
  /** Install into the current project's skills folders instead of the global ones. */
  project: boolean;
}

export const KEY_QUESTION = "Paste your SocialCrawl API key, or press Enter to sign in by email (free key, 100 credits, no card): ";

const n = (x: number) => x.toLocaleString("en-GB");

/** The balance, or null when the API refused these credentials. */
async function balanceWith(creds: Credentials, deps: InitDeps): Promise<number | null> {
  const doFetch =
    creds.kind === "token"
      ? tokenFetch(creds, { fetch: deps.fetch, onRefresh: (t) => saveConfig(deps.home, { accessToken: t.accessToken, refreshToken: t.refreshToken }) })
      : deps.fetch;
  const kit = createKit({ app: "cli", version: VERSION, ...(creds.kind === "key" ? { apiKey: creds.apiKey } : { accessToken: creds.accessToken }), fetch: doFetch, log: () => {} });
  try {
    const body = await kit.balance();
    return Number((body.data as { balance?: number } | undefined)?.balance ?? body.credits_remaining ?? 0);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}

async function setUpKey(deps: InitDeps): Promise<boolean> {
  const existing = credentialsFrom(deps.env, readConfig(deps.home));
  if (existing) {
    const balance = await balanceWith(existing, deps);
    const who = existing.kind === "key" ? `the key ${maskKey(existing.apiKey)} from ${existing.source}` : `your email sign-in from ${existing.source}`;
    if (balance === null) {
      deps.out(`The API refused ${who}. Set a new key with SOCIALCRAWL_API_KEY, or delete ${CONFIG_LABEL} and run socialcrawl init again.`);
      return false;
    }
    deps.out(`Using ${who}: ${n(balance)} credits.`);
    return true;
  }
  if (!deps.interactive) {
    deps.out("No SocialCrawl key is set, and there is no terminal to ask in.");
    deps.out("Set SOCIALCRAWL_API_KEY, or run socialcrawl init in a terminal. Get a free key (100 credits, no card): https://www.socialcrawl.dev/auth/register");
    return false;
  }
  const pasted = (await deps.ask(KEY_QUESTION, { hidden: true })).trim();
  if (pasted) {
    const balance = await balanceWith({ kind: "key", apiKey: pasted, source: "pasted" }, deps);
    if (balance === null) {
      deps.out("The API refused that key. Check it in your dashboard (https://www.socialcrawl.dev/dashboard/api) and run socialcrawl init again.");
      return false;
    }
    saveConfig(deps.home, { apiKey: pasted });
    deps.out(`Key saved to ${CONFIG_LABEL}: ${n(balance)} credits.`);
    return true;
  }
  const email = (await deps.ask("Your email: ")).trim();
  if (!email) {
    deps.out("No email given, so nothing was set up.");
    return false;
  }
  const tokens = await login({
    app: "cli",
    email,
    fetch: deps.fetch,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    show: (uri, code) => deps.out(`Open ${uri} and enter the code ${code}. Waiting for you to sign in.`),
  });
  saveConfig(deps.home, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? undefined, clientId: tokens.clientId ?? undefined });
  const balance = await balanceWith({ kind: "token", accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, clientId: tokens.clientId, source: CONFIG_LABEL }, deps);
  deps.out(`Signed in. Saved to ${CONFIG_LABEL}${balance === null ? "." : `: ${n(balance)} credits.`}`);
  return true;
}

async function skillsSource(deps: InitDeps): Promise<string | null> {
  if (deps.skillsFrom) {
    const inner = path.join(deps.skillsFrom, "skills");
    return existsSync(inner) ? inner : deps.skillsFrom;
  }
  try {
    const res = await deps.fetch(WORKFLOWS_ARCHIVE);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const dir = mkdtempSync(path.join(tmpdir(), "socialcrawl-workflows-"));
    const files = extractSkills(Buffer.from(await res.arrayBuffer()), dir);
    if (!files.length) throw new Error("the archive held no skills");
    return dir;
  } catch (e) {
    deps.out(`Could not download the workflows (${(e as Error).message}). Install them later with: npx skills add socialcrawl/workflows`);
    return null;
  }
}

export async function runInit(deps: InitDeps, opts: InitOptions): Promise<number> {
  if (!(await setUpKey(deps))) return EXIT.error;
  let installedFor = 0;
  if (opts.install) {
    const agents = detectAgents(deps.home, deps.env);
    if (!agents.length) {
      deps.out(`No coding agent found (${AGENT_NAMES.join(", ")}). The workflows run from this terminal too.`);
    } else {
      const source = await skillsSource(deps);
      if (source) {
        for (const t of installTargets(agents, { home: deps.home, project: opts.project ? deps.cwd : null })) {
          const names = installSkills(source, t.dir);
          deps.out(`Installed ${names.length} workflow${names.length === 1 ? "" : "s"} for ${t.agents.join(", ")} in ${t.dir}.`);
        }
        saveConfig(deps.home, { installed: agents.map((a) => a.id) });
        installedFor = agents.length;
      }
    }
  }
  deps.out('Try it: socialcrawl social-viral "AI coding tools"');
  if (installedFor) deps.out("Or ask your agent: what went viral about AI coding tools this week?");
  return EXIT.ok;
}
