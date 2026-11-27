// tiktok-marketing against a fake API (test layer 2): the flow, the one budget, max_pages on
// every list call, the topic filter on searches only, explicit comment labels, the baseline
// read from each creator's earlier videos, errors kept, and the honest "not read" list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runVideo } from "../../../src/workflows/_video/run.ts";
import { TIKTOK } from "../../../src/workflows/tiktok-marketing/spec.ts";
import { fakeSession } from "../_video/fake-kit.ts";
import { A1, ARGS, B1, E1, TIKTOK_WORLD_NOW, world } from "./world.ts";

describe("tiktok-marketing: the run", () => {
  it("sends max_pages and max_credits on every list call, inside the default budget", async () => {
    const { kit, session } = fakeSession(world());
    await runVideo(session, TIKTOK, ARGS);
    for (const s of kit.sent.filter((x) => /search|profile\/videos|comments/.test(x.endpoint))) {
      assert.ok(Number(s.params.max_pages) >= 1, `${s.endpoint} without max_pages`);
      assert.ok(Number(s.params.max_credits) >= 1, `${s.endpoint} without max_credits`);
    }
    assert.ok(session.ledger.credits <= TIKTOK.defaultBudget, `spent ${session.ledger.credits}`);
  });

  it("filters searches by topic and never a baseline; labels the comments explicitly", async () => {
    const { kit, session } = fakeSession(world());
    await runVideo(session, TIKTOK, ARGS);
    for (const s of kit.sent.filter((x) => x.endpoint === "tiktok/search")) {
      assert.equal(s.params.relevance, "filter");
      assert.equal(s.params.relevant_to, "AI coding tools");
    }
    const baselines = kit.sent.filter((x) => x.endpoint === "tiktok/profile/videos");
    assert.ok(baselines.length >= 3);
    for (const s of baselines) {
      assert.equal(s.params.relevant_to, undefined);
      assert.equal(s.params.judgments, "off");
    }
    for (const s of kit.sent.filter((x) => x.endpoint === "tiktok/post/comments")) assert.equal(s.params.label, "sentiment,question,purchase_intent,complaint");
  });

  it("measures each candidate against the creator's videos before it, and walks one more page for a thin baseline", async () => {
    const { kit, session } = fakeSession(world());
    const run = await runVideo(session, TIKTOK, ARGS);
    const by = new Map(run.items.map((i) => [i.row.id, i]));
    assert.equal(by.get("A1")?.breakout.multiple, 40, "400,000 over a median of 10,000; the later videos are left out");
    assert.equal(by.get("A1")?.viral, true);
    assert.equal(by.get("B1")?.breakout.multiple, 30);
    assert.equal(by.get("E1")?.breakout.multiple, 12);
    assert.equal(by.get("C1")?.breakout.band, "normal");
    assert.equal(by.get("C1")?.breakout.peers, 10, "the second page was read");
    const second = kit.sent.find((x) => x.params.cursor === "k2");
    assert.ok(second);
    assert.equal(Number(second.params.max_pages), 1);
    assert.equal(run.candidates.belowFloor, 1, "the 500-view video is under the floor");
    assert.equal(kit.sent.filter((x) => x.endpoint === "tiktok/profile/videos" && x.params.handle === "bigco").length, 1, "one read per creator");
  });

  it("reads the comments of the top break-outs and the words of the top video", async () => {
    const { kit, session } = fakeSession(world());
    const run = await runVideo(session, TIKTOK, ARGS);
    const urls = kit.sent.filter((x) => x.endpoint === "tiktok/post/comments").map((x) => String(x.params.url));
    assert.deepEqual(urls, [A1.post.url, B1.post.url, E1.post.url]);
    assert.equal(run.asks.classes.question.count, 3);
    assert.equal(run.transcripts.length, 1);
    assert.equal(run.transcripts[0].rowId, "A1");
    assert.equal(run.transcripts[0].text, "Ship it in a day. Here is how.");
  });

  it("stops at a small budget and says what it did not read", async () => {
    const { session } = fakeSession(world(), 6);
    const run = await runVideo(session, TIKTOK, ARGS);
    assert.ok(session.ledger.credits <= 6);
    assert.ok(session.notRead.length > 0);
    assert.ok(run.unread.length > 0, "candidates without a baseline are listed");
    assert.ok(run.unread.every((u) => ["budget", "below_top_n", "error", "no_id"].includes(u.reason)), JSON.stringify(run.unread.map((u) => u.reason)));
  });

  it("keeps an upstream error, spends nothing on it, and carries on", async () => {
    const { session } = fakeSession(world([{ endpoint: "tiktok/profile/videos", when: (p) => p.handle === "smallone", data: 502 }]));
    const run = await runVideo(session, TIKTOK, ARGS);
    assert.equal(session.errors.length, 1);
    assert.equal(session.errors[0].status, 502);
    assert.ok(run.unread.some((u) => u.row.id === "B1" && u.reason === "error"));
    assert.equal(run.items.find((i) => i.row.id === "A1")?.viral, true);
  });
});
