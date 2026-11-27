import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { readConfig, saveConfig } from "../../src/config.ts";
import { FINISH_TRIES, runInit } from "../../src/init.ts";
import type { InitDeps } from "../../src/init.ts";
import { EXIT } from "../../src/run.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function skillsDir() {
  const d = temp("sc-skills-");
  mkdirSync(path.join(d, "socialcrawl-viral"));
  writeFileSync(path.join(d, "socialcrawl-viral", "SKILL.md"), "---\nname: socialcrawl-viral\n---\n");
  return d;
}

function deps(over: Partial<InitDeps> & { answers?: string[]; balanceStatus?: number } = {}) {
  const out: string[] = [];
  const asked: string[] = [];
  const answers = [...(over.answers ?? [])];
  const home = over.home ?? temp("sc-home-");
  const fetchFake: typeof fetch = async (u, init) => {
    const url = String(u);
    if (url.endsWith("/api/auth/agent/identity")) return json(200, { claim_token: "clm_1", claim: { user_code: "123456", verification_uri: "https://example.test/claim", interval: 0 } });
    if (url.endsWith("/api/auth/oauth2/token")) return json(200, { access_token: "at1", refresh_token: "rt1", client_id: "cid" });
    if (url.includes("credits/balance")) {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const ok = h["x-api-key"] === "sc_Good_notarealkey1234" || h.Authorization === "Bearer at1";
      return ok ? json(200, { success: true, data: { balance: 100 }, credits_used: 0 }) : json(over.balanceStatus ?? 401, { success: false, error: { type: "UNAUTHORIZED", message: "Invalid API key" } });
    }
    return json(404, {});
  };
  const d: InitDeps = {
    env: {},
    home,
    cwd: temp("sc-cwd-"),
    fetch: fetchFake,
    out: (l) => out.push(l),
    interactive: true,
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? "";
    },
    sleep: async () => {},
    skillsFrom: skillsDir(),
    ...over,
  };
  return { d, out, asked, home };
}

describe("init: the key", () => {
  it("asks for a key or an email sign-in in one line", async () => {
    const { d, asked } = deps({ answers: ["sc_Good_notarealkey1234"] });
    await runInit(d, { yes: false, install: false, project: false });
    assert.equal(asked[0], "Paste your SocialCrawl API key, or press Enter to sign in by email (free key, 100 credits, no card): ");
  });

  it("checks a pasted key with the free balance call, then saves it outside the project", async () => {
    const { d, out, home } = deps({ answers: ["  sc_Good_notarealkey1234  "] });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.ok);
    assert.equal(readConfig(home).apiKey, "sc_Good_notarealkey1234");
    assert.ok(out.some((l) => l.includes("100 credits")));
    assert.ok(!existsSync(path.join(d.cwd, ".socialcrawl")));
  });

  it("does not save a key the API refuses", async () => {
    const { d, out, home } = deps({ answers: ["sc_Bad_notarealkey0000"] });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.error);
    assert.equal(readConfig(home).apiKey, undefined);
    assert.ok(out.some((l) => /refused/.test(l)));
  });

  it("on Enter, signs in by email with the link and the 6-digit code, and saves the tokens", async () => {
    const { d, out, home, asked } = deps({ answers: ["", "me@example.test"] });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.ok);
    assert.equal(asked[1], "Your email: ");
    assert.ok(out.some((l) => l.includes("https://example.test/claim") && l.includes("123456")));
    const c = readConfig(home);
    assert.deepEqual([c.accessToken, c.refreshToken, c.clientId], ["at1", "rt1", "cid"]);
  });

  it("keeps a key it already has and asks nothing", async () => {
    const { d, asked, out } = deps();
    saveConfig(d.home, { apiKey: "sc_Good_notarealkey1234" });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.ok);
    assert.equal(asked.length, 0);
    assert.ok(out.some((l) => l.includes("sc_Good_…1234")));
  });

  it("without a terminal to ask in, says how to set the key and exits 1", async () => {
    const { d, out } = deps({ interactive: false });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.error);
    assert.ok(out.some((l) => l.includes("SOCIALCRAWL_API_KEY")));
    assert.ok(out.some((l) => l.includes("npx -y socialcrawl@latest init --email")), out.join("\n"));
  });
});

/** A fetch that answers the token endpoint from a list, and counts its calls. */
function tokenAnswers(answers: { status: number; body: unknown }[]) {
  const seen = { token: 0, identity: 0 };
  const base = deps().d.fetch;
  const f: typeof fetch = async (u, init) => {
    const url = String(u);
    if (url.endsWith("/api/auth/oauth2/token")) {
      const a = answers[Math.min(seen.token++, answers.length - 1)];
      return json(a.status, a.body);
    }
    if (url.endsWith("/api/auth/agent/identity")) seen.identity++;
    return base(u, init);
  };
  return { f, seen };
}

const PENDING = { claimToken: "clm_1", verificationUri: "https://example.test/claim", userCode: "123456", interval: 0, email: "you@example.test", startedAt: "2026-11-27T10:00:00.000Z" };

describe("init: signing in by email without a terminal (an agent's shell)", () => {
  it("init --email starts the sign-in: prints the link, the code and how to finish, saves the claim and waits for nothing", async () => {
    const t = tokenAnswers([{ status: 400, body: { error: "authorization_pending" } }]);
    const { d, out, home, asked } = deps({ interactive: false, fetch: t.f });
    assert.equal(await runInit(d, { yes: false, install: false, project: false, email: "you@example.test" }), EXIT.ok);
    assert.equal(asked.length, 0);
    assert.equal(t.seen.identity, 1);
    assert.equal(t.seen.token, 0);
    const text = out.join("\n");
    assert.match(text, /https:\/\/example\.test\/claim/);
    assert.match(text, /123456/);
    assert.match(text, /npx -y socialcrawl@latest init/);
    assert.equal(readConfig(home).pendingSignIn?.claimToken, "clm_1");
  });

  it("a later init finishes the sign-in: saves the tokens, clears the claim and goes on", async () => {
    const t = tokenAnswers([{ status: 400, body: { error: "authorization_pending" } }, { status: 200, body: { access_token: "at1", refresh_token: "rt1", client_id: "cid" } }]);
    const { d, out, home } = deps({ interactive: false, fetch: t.f });
    saveConfig(home, { pendingSignIn: PENDING });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.ok);
    const c = readConfig(home);
    assert.equal(c.accessToken, "at1");
    assert.equal(c.pendingSignIn, undefined);
    assert.ok(out.some((l) => /Signed in/.test(l)), out.join("\n"));
  });

  it("before the person has signed in, says so with the same link and code, keeps the claim and exits 1", async () => {
    const t = tokenAnswers([{ status: 400, body: { error: "authorization_pending" } }]);
    const { d, out, home } = deps({ interactive: false, fetch: t.f });
    saveConfig(home, { pendingSignIn: PENDING });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.error);
    const text = out.join("\n");
    assert.match(text, /not signed in yet/i);
    assert.match(text, /https:\/\/example\.test\/claim/);
    assert.match(text, /123456/);
    assert.equal(readConfig(home).pendingSignIn?.claimToken, "clm_1");
    assert.ok(t.seen.token >= 1 && t.seen.token <= 30, String(t.seen.token));
  });

  it("when the 10-minute code expired, gets a new code for the same claim and shows it", async () => {
    const t = tokenAnswers([{ status: 400, body: { error: "expired_token" } }]);
    const renewed: unknown[] = [];
    const f: typeof fetch = async (u, init) => {
      if (String(u).endsWith("/api/auth/agent/identity/claim")) {
        renewed.push(JSON.parse(String(init?.body)));
        return json(200, { claim: { user_code: "654321", verification_uri: "https://example.test/claim2", interval: 0 } });
      }
      return t.f(u, init);
    };
    const { d, out, home } = deps({ interactive: false, fetch: f });
    saveConfig(home, { pendingSignIn: PENDING });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.error);
    assert.deepEqual(renewed, [{ claim_token: "clm_1", email: "you@example.test" }]);
    assert.match(out.join("\n"), /654321/);
    assert.match(out.join("\n"), /https:\/\/example\.test\/claim2/);
    assert.equal(readConfig(home).pendingSignIn?.userCode, "654321");
  });

  it("finishes inside an agent shell's 2-minute limit at the usual 5-second interval", () => {
    assert.ok(FINISH_TRIES * 5 <= 90, String(FINISH_TRIES));
  });

  it("clears a claim that expired and says to start again", async () => {
    const t = tokenAnswers([{ status: 400, body: { error: "expired_token" } }]);
    const { d, out, home } = deps({ interactive: false, fetch: t.f });
    saveConfig(home, { pendingSignIn: PENDING });
    assert.equal(await runInit(d, { yes: false, install: false, project: false }), EXIT.error);
    assert.equal(readConfig(home).pendingSignIn, undefined);
    assert.match(out.join("\n"), /init --email/);
  });
});

describe("init: the agents", () => {
  it("installs the workflows into every agent it finds, without asking, and records them", async () => {
    const { d, out, home, asked } = deps();
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude"));
    mkdirSync(path.join(home, ".codex"));
    assert.equal(await runInit(d, { yes: false, install: true, project: false }), EXIT.ok);
    assert.equal(asked.length, 0);
    assert.ok(existsSync(path.join(home, ".claude", "skills", "socialcrawl-viral", "SKILL.md")));
    assert.ok(existsSync(path.join(home, ".agents", "skills", "socialcrawl-viral", "SKILL.md")));
    assert.deepEqual(readConfig(home).installed, ["claude-code", "codex"]);
    assert.ok(out.some((l) => l.includes("Claude Code")));
  });

  it("keeps someone else's skill of the same name, and says so", async () => {
    const { d, out, home } = deps();
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude", "skills", "socialcrawl-viral"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "socialcrawl-viral", "SKILL.md"), "mine");
    await runInit(d, { yes: false, install: true, project: false });
    assert.equal(readFileSync(path.join(home, ".claude", "skills", "socialcrawl-viral", "SKILL.md"), "utf8"), "mine");
    assert.ok(out.some((l) => /socialcrawl-viral as it was/.test(l)), out.join("\n"));
  });

  it("removes the router 0.1.0 installed as socialcrawl, and says how to get the API skill back", async () => {
    const { d, out, home } = deps();
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude", "skills", "socialcrawl"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "socialcrawl", "SKILL.md"), "---\nname: socialcrawl\nmetadata:\n  source: https://github.com/socialcrawl/workflows\n---\n");
    await runInit(d, { yes: false, install: true, project: false });
    assert.ok(!existsSync(path.join(home, ".claude", "skills", "socialcrawl")));
    assert.ok(out.some((l) => l.includes("npx skills add socialcrawl/skills -g")), out.join("\n"));
  });

  it("names the old workflow skills it removed, and leaves the API skill out of it when it was not touched", async () => {
    const { d, out, home } = deps();
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude", "skills", "social-viral"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "social-viral", "SKILL.md"), "---\nname: social-viral\nmetadata:\n  source: https://github.com/socialcrawl/workflows\n---\n");
    await runInit(d, { yes: false, install: true, project: false });
    assert.ok(!existsSync(path.join(home, ".claude", "skills", "social-viral")));
    assert.ok(out.some((l) => l.includes("social-viral") && l.includes("socialcrawl-<task>")), out.join("\n"));
    assert.ok(!out.some((l) => l.includes("socialcrawl/skills")), out.join("\n"));
  });

  it("installs through npx skills add socialcrawl/workflows, so each install counts on skills.sh", async () => {
    const calls: { args: string[]; env: Record<string, string | undefined>; cwd: string }[] = [];
    const fetched: string[] = [];
    const { d, out, home } = deps({ skillsFrom: undefined, env: { npm_command: "exec", INIT_CWD: "/x", PATH: "/bin" } });
    const realFetch = d.fetch;
    d.fetch = async (u, init) => {
      fetched.push(String(u));
      return realFetch(u, init);
    };
    d.skillsAdd = async (args, o) => {
      calls.push({ args, ...o });
      return { code: 0, stdout: JSON.stringify([{ name: "socialcrawl-viral", status: "installed" }, { name: "socialcrawl-pulse", status: "installed" }]) };
    };
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude"));
    mkdirSync(path.join(home, ".codex"));
    assert.equal(await runInit(d, { yes: false, install: true, project: false }), EXIT.ok);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.args, ["-y", "skills", "add", "socialcrawl/workflows", "--skill", "*", "--agent", "claude-code", "codex", "--global", "--yes", "--json"]);
    assert.deepEqual(calls[0]!.env, { PATH: "/bin" });
    assert.equal(calls[0]!.cwd, home);
    assert.ok(!fetched.some((u) => u.includes("codeload.github.com")), "no archive download");
    assert.ok(out.some((l) => l === "Installed 2 workflows for Claude Code, Codex with npx skills add socialcrawl/workflows."), out.join("\n"));
    assert.deepEqual(readConfig(home).installed, ["claude-code", "codex"]);
  });

  it("runs npx skills add in the project, without --global, for init --project", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const { d, home } = deps({ skillsFrom: undefined });
    d.skillsAdd = async (args, o) => {
      calls.push({ args, cwd: o.cwd });
      return { code: 0, stdout: '[{"name":"socialcrawl-viral","status":"installed"}]' };
    };
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude"));
    await runInit(d, { yes: false, install: true, project: true });
    assert.ok(!calls[0]!.args.includes("--global"));
    assert.equal(calls[0]!.cwd, d.cwd);
  });

  /** Records every URL; GitHub's archive answers 404, the API answers as usual. */
  function noArchive(d: InitDeps): string[] {
    const fetched: string[] = [];
    const api = d.fetch;
    d.fetch = async (u, init) => {
      fetched.push(String(u));
      return String(u).includes("codeload.github.com") ? new Response("", { status: 404 }) : api(u, init);
    };
    return fetched;
  }

  it("when npx skills add fails, downloads the workflows and copies them itself", async () => {
    const { d, out, home } = deps({ skillsFrom: undefined });
    const fetched = noArchive(d);
    d.skillsAdd = async () => ({ code: 1, stdout: "" });
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude"));
    await runInit(d, { yes: false, install: true, project: false });
    assert.ok(fetched.some((u) => u.includes("codeload.github.com/socialcrawl/workflows")), fetched.join("\n"));
    assert.ok(out.some((l) => /Could not download the workflows/.test(l)), out.join("\n"));
  });

  it("treats output that installed nothing as a failure and copies the workflows itself", async () => {
    const { d, home } = deps({ skillsFrom: undefined });
    const fetched = noArchive(d);
    d.skillsAdd = async () => ({ code: 0, stdout: "[]" });
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude"));
    await runInit(d, { yes: false, install: true, project: false });
    assert.ok(fetched.some((u) => u.includes("codeload.github.com")));
  });

  it("does not run npx skills add when a socialcrawl- skill from somewhere else is in the way, and keeps that skill", async () => {
    let called = false;
    const { d, home } = deps({ skillsFrom: undefined });
    const fetched = noArchive(d);
    d.skillsAdd = async () => {
      called = true;
      return { code: 0, stdout: "[]" };
    };
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude", "skills", "socialcrawl-viral"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "socialcrawl-viral", "SKILL.md"), "mine");
    await runInit(d, { yes: false, install: true, project: false });
    assert.equal(called, false);
    assert.equal(readFileSync(path.join(home, ".claude", "skills", "socialcrawl-viral", "SKILL.md"), "utf8"), "mine");
    assert.ok(fetched.some((u) => u.includes("codeload.github.com")), "copies the workflows itself instead");
  });

  it("uses a local --skills-from copy as it is, without npx skills add", async () => {
    let called = false;
    const { d, home } = deps();
    d.skillsAdd = async () => {
      called = true;
      return { code: 0, stdout: "[]" };
    };
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude"));
    await runInit(d, { yes: false, install: true, project: false });
    assert.equal(called, false);
    assert.ok(existsSync(path.join(home, ".claude", "skills", "socialcrawl-viral", "SKILL.md")));
  });

  it("still removes the 0.1.0 folders after installing through npx skills add", async () => {
    const { d, out, home } = deps({ skillsFrom: undefined });
    d.skillsAdd = async () => ({ code: 0, stdout: '[{"name":"socialcrawl-viral","status":"installed"}]' });
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    mkdirSync(path.join(home, ".claude", "skills", "socialcrawl"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "socialcrawl", "SKILL.md"), "---\nname: socialcrawl\nmetadata:\n  source: https://github.com/socialcrawl/workflows\n---\n");
    await runInit(d, { yes: false, install: true, project: false });
    assert.ok(!existsSync(path.join(home, ".claude", "skills", "socialcrawl")));
    assert.ok(out.some((l) => l.includes("npx skills add socialcrawl/skills -g")), out.join("\n"));
  });

  it("says so when it finds no agent, and points at the terminal commands", async () => {
    const { d, out, home } = deps();
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    assert.equal(await runInit(d, { yes: false, install: true, project: false }), EXIT.ok);
    assert.ok(out.some((l) => /No coding agent found/.test(l)));
  });

  it("ends with the first command to try", async () => {
    const { d, out, home } = deps();
    saveConfig(home, { apiKey: "sc_Good_notarealkey1234" });
    await runInit(d, { yes: false, install: false, project: false });
    assert.ok(out.some((l) => l.includes('npx -y socialcrawl@latest social-viral "')), out.join("\n"));
  });
});
