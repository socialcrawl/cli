// The /social-viral runner against a fake API that answers from the recorded run of study
// file 18: no network, no credits. It checks the flow, the one budget and the honesty of
// what the run says it could not read. Every call goes through a Session, as in the CLI.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget } from "../../../src/engine/rates.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { Session } from "../../../src/kit/record.ts";
import { runViral } from "../../../src/workflows/social-viral/runner.ts";
import { RUN_AT, records } from "../../engine/helpers.ts";

const W = { topic: "AI coding tools", about: "AI coding tools and AI coding assistants for software developers", since: "2026-11-19", until: "2026-11-26" };

/** Answers a call with the recorded response whose endpoint matches and whose identifying params agree; otherwise a 404. */
function fakeApi() {
  const calls: { path: string; params: Params }[] = [];
  const ID_KEYS = ["handle", "channelId", "subreddit", "url", "query", "date_posted", "uploadDate"];
  return {
    calls,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      calls.push({ path: p, params });
      const hit = records.find(
        (r) => r.endpoint === p && ID_KEYS.every((k) => params[k] === undefined || r.params[k] === undefined || String(r.params[k]) === String(params[k])),
      );
      if (!hit) throw new ApiError(404, { success: false, error: { type: "NOT_FOUND", message: `no recorded response for ${p}` }, request_id: `req-404-${calls.length}` });
      return { ...(hit.body as ApiBody), request_id: hit.requestId ?? hit.study_req };
    },
  };
}

function session(api: ReturnType<typeof fakeApi>, budget = 100) {
  return new Session({ dir: mkdtempSync(path.join(tmpdir(), "sc-viral-")), kit: api, budget: new Budget(budget), skill: "social-viral", version: "0.1.0", now: () => RUN_AT });
}

describe("/social-viral runner", () => {
  it("runs the plan inside one 100-credit budget and books every call", async () => {
    const api = fakeApi();
    const out = await runViral(session(api), W, { now: () => RUN_AT });
    assert.ok(out.ledger.credits <= 100, `spent ${out.ledger.credits}`);
    assert.equal(out.ledger.lines.length, api.calls.length);
    assert.ok(out.records.length > 0);
    for (const c of api.calls) if (["twitter/search/tweets", "twitter/user/tweets", "tiktok/profile/videos"].includes(c.path)) assert.ok(Number(c.params.max_credits) >= 1, c.path);
  });

  it("never lets a call walk past its planned pages or its own ceiling", async () => {
    const api = fakeApi();
    await runViral(session(api), W, { now: () => RUN_AT });
    for (const c of api.calls) {
      if (c.params.max_credits === undefined) continue;
      assert.ok(c.params.max_pages !== undefined, `${c.path} sent max_credits without max_pages`);
    }
    for (const c of api.calls.filter((x) => /search/.test(x.path))) assert.ok(Number(c.params.max_credits) <= 15, `${c.path} max_credits ${c.params.max_credits}`);
    const reddit = api.calls.find((x) => x.path === "reddit/search");
    assert.ok(reddit, "the Reddit search is sent, not refused by its own cap");
    assert.equal(Number(reddit.params.max_credits), 10);
  });

  it("sends the topic filter on every topic search, and never on a baseline", async () => {
    const api = fakeApi();
    await runViral(session(api), W, { now: () => RUN_AT });
    const isBaseline = (c: { params: Params }) => String(c.params.query ?? "").startsWith("from:");
    for (const c of api.calls.filter((x) => /search/.test(x.path) && !isBaseline(x))) assert.equal(c.params.relevance, "filter", c.path);
    const baselines = api.calls.filter((x) => isBaseline(x) || x.path === "tiktok/profile/videos");
    assert.ok(baselines.length > 0);
    for (const c of baselines) {
      assert.equal(c.params.relevant_to, undefined, c.path);
      assert.equal(c.params.judgments, "off", c.path);
    }
    for (const c of api.calls.filter(isBaseline)) assert.match(String(c.params.until), /^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/);
  });

  it("stops at a small budget and says what it did not read", async () => {
    const out = await runViral(session(fakeApi(), 15), W, { now: () => RUN_AT });
    assert.ok(out.ledger.credits <= 15);
    assert.ok(out.notRead.length > 0);
    assert.ok(out.notRead.every((n) => n.reason === "budget"));
    assert.match(out.card, /^# \/social-viral "AI coding tools"/);
  });

  it("records an upstream error without spending, and carries on", async () => {
    const out = await runViral(session(fakeApi()), W, { now: () => RUN_AT });
    for (const e of out.errors) assert.equal(out.ledger.lines.find((l) => l.status === e.status && l.endpoint === e.endpoint)?.credits, 0);
    assert.ok(out.result.items.length > 0);
  });

  it("ends with a card titled with the command and a meta block", async () => {
    const out = await runViral(session(fakeApi()), W, { now: () => RUN_AT });
    assert.equal(out.meta.skill, "social-viral");
    assert.equal(out.meta.credits, out.ledger.credits);
    assert.ok(out.card.includes(`Read with SocialCrawl /social-viral · ${out.ledger.credits} credits`));
  });
});
