import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeOf, discoverParams, rowOf, weekSummary, weeksOf } from "../../../src/workflows/social-pulse/pulse.ts";
import { discoverBody, item, summary } from "./fake.ts";

describe("weeksOf", () => {
  it("reads the 7 days to today and the 7 days before them", () => {
    assert.deepEqual(weeksOf({ now: new Date("2026-11-27T10:00:00Z") }), {
      thisWeek: { since: "2026-11-21", until: "2026-11-27" },
      before: { since: "2026-11-14", until: "2026-11-20" },
    });
  });
  it("ends on --until when it is given", () => {
    assert.deepEqual(weeksOf({ now: new Date("2026-11-27T10:00:00Z"), until: "2026-11-20" }).before, { since: "2026-11-07", until: "2026-11-13" });
  });
});

describe("discoverParams", () => {
  const w = { since: "2026-11-21", until: "2026-11-27" };
  it("searches the six platforms for the window, labelling stance and intent", () => {
    assert.deepEqual(discoverParams({ topic: "Acme Notes" }, w, false), {
      query: "Acme Notes",
      platforms: "twitter,reddit,tiktok,instagram,youtube,linkedin",
      label: "stance,intent",
      limit: 100,
      since: "2026-11-21",
      until: "2026-11-27",
    });
  });
  it("judges against --about only when it is given, and reads two pages a platform when deep", () => {
    const p = discoverParams({ topic: "Acme", about: "Acme Notes, the notes app" }, w, true);
    assert.equal(p.context, "Acme Notes, the notes app");
    assert.equal(p.pages_per_platform, 2);
  });
});

describe("rowOf", () => {
  it("turns a discover item into an engine row", () => {
    const r = rowOf(item({ platform: "twitter", id: "9", author: "@bigco", followers: 25_000, views: 40_000, likes: 300, publishedAt: "2026-11-25T08:00:00.000Z" }), "req-week")!;
    assert.equal(r.platform, "x");
    assert.equal(r.id, "9");
    assert.equal(r.author, "bigco");
    assert.equal(r.authorFollowers, 25_000);
    assert.equal(r.views, 40_000);
    assert.equal(r.likes, 300);
    assert.equal(r.kind, "original");
    assert.equal(r.video, false);
    assert.equal(r.requestId, "req-week");
    assert.equal(rowOf(item({ platform: "tiktok", id: "1", author: "a", publishedAt: "2026-11-25T08:00:00.000Z" }), "r")!.video, true);
  });
  it("skips a platform the engine does not measure", () => {
    assert.equal(rowOf({ ...item({ platform: "news", id: "1", author: "a", publishedAt: "2026-11-25T08:00:00.000Z" }) }, "r"), null);
  });
});

describe("weekSummary", () => {
  it("reads the counts over every kept row, not only the delivered ones", () => {
    const s = weekSummary(discoverBody([], summary({ collected: 230, kept: 72, positive: 35, negative: 9, neutral: 12, uncertain: 15, question: 3, complaint: 2, recommendation: 6, switching: 2, byPlatform: { tiktok: 16, youtube: 16 } }), 31, "req-1"));
    assert.deepEqual(s, { collected: 230, kept: 72, overflow: 0, positive: 35, negative: 9, stanceN: 71, question: 3, complaint: 2, recommendation: 6, switching: 2, selling: 0, byPlatform: { tiktok: 16, youtube: 16 } });
  });
  it("is null for an answer without a summary", () => {
    assert.equal(weekSummary({ success: true, data: {} }), null);
  });
});

describe("changeOf", () => {
  it("gives the change as a share of the week before", () => {
    assert.deepEqual(changeOf(72, 50), { now: 72, before: 50, share: 0.44 });
    assert.deepEqual(changeOf(40, 50), { now: 40, before: 50, share: -0.2 });
  });
  it("has no share when the week before had none", () => {
    assert.deepEqual(changeOf(5, 0), { now: 5, before: 0, share: null });
  });
});
