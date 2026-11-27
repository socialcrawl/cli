import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { readConfig, saveConfig } from "../../src/config.ts";
import { runInit } from "../../src/init.ts";
import type { InitDeps } from "../../src/init.ts";
import { EXIT } from "../../src/run.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function skillsDir() {
  const d = temp("sc-skills-");
  mkdirSync(path.join(d, "social-viral"));
  writeFileSync(path.join(d, "social-viral", "SKILL.md"), "---\nname: social-viral\n---\n");
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
    assert.ok(existsSync(path.join(home, ".claude", "skills", "social-viral", "SKILL.md")));
    assert.ok(existsSync(path.join(home, ".agents", "skills", "social-viral", "SKILL.md")));
    assert.deepEqual(readConfig(home).installed, ["claude-code", "codex"]);
    assert.ok(out.some((l) => l.includes("Claude Code")));
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
    assert.ok(out.some((l) => l.includes('socialcrawl social-viral "')));
  });
});
