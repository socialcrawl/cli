// reddit-marketing, the runner, against a fake API that answers from the recorded
// "headless CMS" run: no network, no credits. The flow, the one budget, max_pages on every
// list call, the topic filter only on searches, errors kept, and what was not read.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../../../src/kit/kit.ts";
import { runReddit } from "../../../src/workflows/reddit-marketing/run.ts";
import { IN, fakeApi, session } from "./fake.ts";

describe("reddit-marketing runner", () => {
  it("runs the default plan: 2 searches, 4 communities' rules and baselines, 3 comment trees", async () => {
    const api = fakeApi();
    const s = session(api);
    const out = await runReddit(s, IN);
    const count = (p: string) => api.calls.filter((c) => c.path === p).length;
    assert.equal(count("reddit/search"), 2);
    assert.equal(count("reddit/subreddit/details"), 4);
    assert.equal(count("reddit/subreddit"), 4);
    assert.equal(count("reddit/post/comments"), 3);
    assert.equal(s.errors.length, 0);
    assert.equal(out.threads.length, 29);
    assert.equal(out.communities.length, 4);
    assert.deepEqual(out.commentThreads.map((t) => t.id), ["t050", "t029", "t015"]);
    assert.ok(s.ledger.credits <= 40, `spent ${s.ledger.credits}`);
  });

  it("sends max_pages with every list call and max_credits inside the run's budget", async () => {
    const api = fakeApi();
    await runReddit(session(api), IN);
    for (const c of api.calls.filter((x) => x.path !== "reddit/subreddit/details")) {
      assert.equal(c.params.max_pages, 1, c.path);
      assert.ok(Number(c.params.max_credits) >= 1 && Number(c.params.max_credits) <= 10, `${c.path} max_credits ${c.params.max_credits}`);
    }
  });

  it("puts the topic filter on the searches and never on a community's baseline", async () => {
    const api = fakeApi();
    await runReddit(session(api), IN);
    for (const c of api.calls.filter((x) => x.path === "reddit/search")) assert.equal(c.params.relevance, "filter");
    for (const c of api.calls.filter((x) => x.path === "reddit/subreddit")) {
      assert.equal(c.params.relevant_to, undefined);
      assert.equal(c.params.judgments, "off");
    }
    for (const c of api.calls.filter((x) => x.path === "reddit/post/comments")) assert.equal(c.params.label, "sentiment,question,purchase_intent,complaint");
  });

  it("stops at a small budget and says what it did not read", async () => {
    const api = fakeApi();
    const s = session(api, 12);
    const out = await runReddit(s, IN);
    assert.ok(s.ledger.credits <= 12);
    assert.ok(s.notRead.length > 0);
    assert.ok(s.notRead.every((n) => n.reason === "budget"));
    assert.ok(out.threads.length > 0, "what was read is still reported");
  });

  it("keeps an API error, spends nothing on it, and carries on", async () => {
    const api = fakeApi();
    const real = api.call;
    api.call = async (p, params = {}) => {
      if (p === "reddit/subreddit/details" && params.subreddit === "nextjs") {
        api.calls.push({ path: p, params });
        throw new ApiError(503, { success: false, error: { type: "UPSTREAM", message: "unavailable" }, request_id: "req-fake503" });
      }
      return real(p, params);
    };
    const s = session(api);
    const out = await runReddit(s, IN);
    assert.equal(s.errors.length, 1);
    assert.equal(s.ledger.lines.find((l) => l.status === 503)?.credits, 0);
    assert.equal(out.communities.length, 3);
    assert.ok(out.commentThreads.length === 3);
  });

  it("reads 8 communities and 8 threads on a deep run, a year back", async () => {
    const api = fakeApi();
    await runReddit(session(api, 400), { ...IN, deep: true });
    const top = api.calls.find((c) => c.path === "reddit/search")!;
    assert.equal(top.params.timeframe, "year");
    assert.equal(top.params.max_credits, Number(top.params.max_pages) * 5, "every planned page can be paid for");
    assert.ok(api.calls.filter((c) => c.path === "reddit/subreddit/details").length <= 8);
  });
});
