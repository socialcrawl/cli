// /social-presence against a fake API: the free quote, the find, recent posts only for linked
// or judged accounts, the "nothing confirmed" case, and a whole run checked by the validator.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { EvidenceJson } from "../../../src/engine/evidence.ts";
import { ENGINE_SECTIONS } from "../../../src/engine/outputs.ts";
import { validateReport } from "../../../src/engine/validate.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { EXIT, runWorkflow } from "../../../src/run.ts";
import { workflow } from "../../../src/workflows/social-presence/index.ts";
import { ACME, findBody, platform, postsPage } from "./fake.ts";

const NOW = new Date("2026-11-27T10:00:00Z");

function presenceApi(find: ApiBody = ACME, quoteHold = 21) {
  const calls: { path: string; params: Params }[] = [];
  return {
    calls,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      calls.push({ path: p, params });
      if (p === "utility/estimate") return { success: true, data: { hold: quoteHold, expected_max: 33, valid: true }, credits_used: 0, request_id: "req-quote" };
      if (p === "prism/find-accounts") return find;
      if (p === "twitter/user/tweets") return postsPage("acmenotes", [1, 3, 8, 20, 40, 70]);
      if (p === "youtube/channel/videos") return postsPage("@acmenotes", [2, 9, 15, 33, 60, 90], 5_000);
      throw new ApiError(404, { success: false, error: { type: "NOT_FOUND", message: `no answer for ${p}` }, request_id: `req-nf${calls.length}` });
    },
    async balance(): Promise<ApiBody> {
      return { success: true, data: { balance: 500 }, credits_used: 0, request_id: "req-balance" };
    },
  };
}

async function runOnce(api = presenceApi(), flags: Record<string, string> = { website: "acmenotes.example" }) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sc-presence-"));
  const out: string[] = [];
  const err: string[] = [];
  const code = await runWorkflow({ workflow, args: { input: "Acme Notes", flags, deep: false, now: NOW }, opts: { plan: false, yes: false, open: false, json: false, noCache: false }, kit: api, cwd, out: (l) => out.push(l), err: (l) => err.push(l) });
  const dir = path.join(cwd, "socialcrawl-runs", "social-presence-acme-notes-2026-11-27");
  return { code, out, err, api, read: (f: string) => readFileSync(path.join(dir, f), "utf8") };
}

describe("social-presence: the calls", () => {
  it("prices the search for free, then searches six platforms for the name and its website", async () => {
    const r = await runOnce();
    assert.equal(r.code, EXIT.ok, r.err.join("\n"));
    assert.deepEqual(r.api.calls.slice(0, 2).map((c) => c.path), ["utility/estimate", "prism/find-accounts"]);
    const find = r.api.calls[1].params;
    assert.equal(find.name, "Acme Notes");
    assert.equal(find.type, "company");
    assert.equal(find.website, "acmenotes.example");
    assert.equal(find.platforms, "linkedin,instagram,tiktok,twitter,threads,youtube");
  });

  it("searches for a person with --type person", async () => {
    const r = await runOnce(presenceApi(), { type: "person" });
    assert.equal(r.api.calls[1].params.type, "person");
  });

  it("reads recent posts only for linked or judged accounts", async () => {
    const r = await runOnce();
    assert.deepEqual(r.api.calls.slice(2).map((c) => c.path).sort(), ["twitter/user/tweets", "youtube/channel/videos"]);
  });
});

describe("social-presence: a whole run", () => {
  it("writes a report the engine's validator passes", async () => {
    const r = await runOnce();
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    const v = validateReport(r.read("report.md"), ev, {
      requiredSections: ["In short", "The accounts", "Activity", "What won't copy", "Next", ...ENGINE_SECTIONS],
      summarySection: "In short",
      engineSections: ENGINE_SECTIONS,
      allowNumbers: [30, 10_000],
    });
    assert.deepEqual(v.problems, []);
  });

  it("says which accounts a link confirms and which only a judgment of name and bio supports", async () => {
    const md = (await runOnce()).read("report.md");
    assert.match(md, /Acme Notes: 2 accounts confirmed by a link, 1 judged the same without a link/);
    assert.match(md, /name and bio judged the same; no link confirms it/);
    assert.match(md, /links to acmenotes\.example in its website field/);
  });

  it("gives each read account's last post and posts in 30 days, and says why LinkedIn's were not read", async () => {
    const r = await runOnce();
    const md = r.read("report.md");
    assert.match(md, /26\/11\/2026/);
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    assert.ok(ev.unverified.some((u) => /LinkedIn/.test(u.what) && /numeric id/.test(u.why)), JSON.stringify(ev.unverified));
  });

  it("never names an unconfirmed account under 10,000 followers", async () => {
    const r = await runOnce();
    const shown = r.read("report.md") + r.read("card.svg");
    assert.ok(!/acme______/.test(shown));
    assert.ok(!/acme_notes\b/.test(shown));
    assert.ok(shown.includes("@acmenotes"));
  });

  it("names an account judged without a link only from 10,000 followers or a verified badge", async () => {
    const find = findBody([
      platform("twitter", "acmenotes", "same", 0.97, { website_match: true, cross_link: true }, 120_000, true),
      platform("instagram", "acme_namesake", "same", 0.8, { bio_consistent: true }, 900, true),
    ]);
    const md = (await runOnce(presenceApi(find))).read("report.md");
    assert.ok(!md.includes("acme_namesake"));
    assert.match(md, /an account with 900 followers/);
  });

  it("says plainly when nothing is confirmed", async () => {
    const weak = findBody([platform("twitter", "acmenotes", "same", 0.9, { bio_consistent: true }, 120_000, true), platform("instagram", "acmeig", "possible", 0.6, {}, 300, false)]);
    const md = (await runOnce(presenceApi(weak))).read("report.md");
    assert.match(md, /No account is confirmed by a link/);
  });

  it("does not search when the quote no longer fits, and says so", async () => {
    const r = await runOnce(presenceApi(ACME, 900));
    assert.equal(r.api.calls.filter((c) => c.path === "prism/find-accounts").length, 0);
    assert.match(r.read("report.md"), /not searched/);
  });

  it("stays inside 100 credits and answers in 12 lines or fewer", async () => {
    const r = await runOnce();
    assert.ok(JSON.parse(r.read("run.json")).credits <= 100);
    assert.ok(r.out.length <= 12, r.out.join("\n"));
  });
});
