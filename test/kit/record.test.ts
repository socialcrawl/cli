// The Session every workflow calls through: the budget on every call, max_pages on every
// walk, each response kept in responses.jsonl, errors kept, a 402 never swallowed.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget } from "../../src/engine/rates.ts";
import { ApiError, OutOfCredits } from "../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../src/kit/kit.ts";
import { Session, loadRecords } from "../../src/kit/record.ts";
import { fixturePath } from "../fixture-path.ts";

const dir = () => mkdtempSync(path.join(tmpdir(), "sc-session-"));
const ok = (credits: number, id: string, data: unknown = { items: [] }): ApiBody => ({ success: true, data, credits_used: credits, request_id: id });

function fakeKit(answers: (ApiBody | Error)[]) {
  const sent: { path: string; params: Params }[] = [];
  return {
    sent,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      sent.push({ path: p, params });
      const a = answers.shift();
      if (!a) throw new Error("no answer left");
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

describe("Session.call", () => {
  it("sends max_pages and max_credits on a walk, books the credits and returns the record", async () => {
    const kit = fakeKit([ok(2, "req-1")]);
    const s = new Session({ dir: dir(), kit, budget: new Budget(50), skill: "test-skill", version: "0.0.0" });
    const rec = await s.call("search:x", "twitter/search/tweets", { query: "acme" }, 3);
    assert.ok(rec);
    assert.equal(rec.requestId, "req-1");
    assert.equal(rec.creditsUsed, 2);
    assert.deepEqual(kit.sent[0].params, { query: "acme", max_pages: 1, max_credits: 1 });
    assert.equal(s.budget.spent, 2);
    assert.equal(s.ledger.credits, 2);
    assert.equal(s.records.length, 1);
  });

  it("writes each response to responses.jsonl, one per line, and reads them back", async () => {
    const d = dir();
    const kit = fakeKit([ok(1, "req-a"), ok(1, "req-b")]);
    const s = new Session({ dir: d, kit, budget: new Budget(10), skill: "test-skill", version: "0.0.0" });
    await s.call("baseline:x", "twitter/user/tweets", { handle: "acme" });
    await s.call("baseline:x", "twitter/user/tweets", { handle: "globex" });
    const lines = readFileSync(path.join(d, "responses.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).requestId, "req-b");
    assert.equal(JSON.parse(lines[1]).body.request_id, "req-b");
    assert.deepEqual(loadRecords(d).map((r) => r.requestId), ["req-a", "req-b"]);
  });

  it("does not send a call the budget cannot pay for, and says so in notRead", async () => {
    const kit = fakeKit([]);
    const s = new Session({ dir: dir(), kit, budget: new Budget(0), skill: "test-skill", version: "0.0.0" });
    const rec = await s.call("baseline:tiktok", "tiktok/profile/videos", { handle: "acme" });
    assert.equal(rec, null);
    assert.equal(kit.sent.length, 0);
    assert.deepEqual(s.notRead, [{ stage: "baseline:tiktok", endpoint: "tiktok/profile/videos", reason: "budget" }]);
  });

  it("keeps an API error with its body, books 0 credits and carries on", async () => {
    const d = dir();
    const refusal = JSON.parse(readFileSync(fixturePath("kit", "400.json"), "utf8"));
    const kit = fakeKit([new ApiError(400, refusal)]);
    const s = new Session({ dir: d, kit, budget: new Budget(10), skill: "test-skill", version: "0.0.0" });
    const rec = await s.call("search:reddit", "reddit/search", { query: "acme" }, 10);
    assert.equal(rec, null);
    assert.equal(s.errors.length, 1);
    assert.equal(s.errors[0].status, 400);
    assert.deepEqual(s.errors[0].body, refusal);
    assert.equal(s.ledger.credits, 0);
    assert.equal(s.ledger.lines.length, 1);
    assert.equal(loadRecords(d)[0].status, 400);
  });

  it("rethrows out of credits, so the harness shows the offer and never retries", async () => {
    const offer = JSON.parse(readFileSync(fixturePath("kit", "402.json"), "utf8"));
    const kit = fakeKit([new OutOfCredits(offer)]);
    const s = new Session({ dir: dir(), kit, budget: new Budget(10), skill: "test-skill", version: "0.0.0" });
    await assert.rejects(s.call("search:x", "twitter/search/tweets", { query: "acme" }, 3), OutOfCredits);
  });
});

describe("Session progress", () => {
  it("prints one line per stage with its calls and credits", async () => {
    const lines: string[] = [];
    const kit = fakeKit([ok(1, "r1"), ok(2, "r2"), ok(3, "r3")]);
    const s = new Session({ dir: dir(), kit, budget: new Budget(50), skill: "test-skill", version: "0.0.0", progress: (l) => lines.push(l) });
    await s.call("search:x", "twitter/search/tweets", { query: "a" }, 5);
    await s.call("search:tiktok", "tiktok/search", { query: "a" }, 5);
    assert.deepEqual(lines, []);
    await s.call("baseline:x", "twitter/user/tweets", { handle: "acme" }, 5);
    assert.deepEqual(lines, ["search: 2 calls, 3 credits"]);
    s.flush();
    assert.deepEqual(lines, ["search: 2 calls, 3 credits", "baseline: 1 call, 3 credits"]);
  });

  it("meta() carries the skill, the credits and the calls", async () => {
    const kit = fakeKit([ok(4, "r1")]);
    const s = new Session({ dir: dir(), kit, budget: new Budget(50), skill: "test-skill", version: "1.2.3" });
    await s.call("search:x", "twitter/search/tweets", { query: "a" }, 5);
    const m = s.meta();
    assert.equal(m.skill, "test-skill");
    assert.equal(m.version, "1.2.3");
    assert.equal(m.credits, 4);
    assert.equal(m.calls, 1);
  });
});
