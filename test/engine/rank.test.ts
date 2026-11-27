// Discovery ranking, the platform scorecard and launch lift.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { breakoutWithPage } from "../../src/engine/baseline.ts";
import { clusterMoves, leadingChannel, windowLift } from "../../src/engine/lift.ts";
import { engagementScore, headWords, onEntity, rankDiscovery, rrf } from "../../src/engine/rank.ts";
import { rowsOf } from "../../src/engine/rows.ts";
import { scorecard, scorecardTable } from "../../src/engine/scorecard.ts";
import { rec, records25, row } from "./helpers.ts";

const READ_25 = new Date("2026-11-26T19:40:00Z");

/** One platform's candidates of file 18's run, each against reader 25's before-only baseline read of its author. */
function candidates(searches: string[], endpoint: string) {
  const cand = searches.flatMap((q) => rowsOf(rec(q))).filter((r) => (r.publishedAt ?? "") >= "2026-11-19");
  const pageRows = new Map<string, ReturnType<typeof rowsOf>>();
  for (const r of records25.filter((x) => x.endpoint === endpoint)) {
    const key = String(r.params.handle ?? String(r.params.query ?? "").match(/from:(\w+)/)?.[1] ?? "");
    if (key) pageRows.set(key, [...(pageRows.get(key) ?? []), ...rowsOf(r)]);
  }
  return cand.map((row) => {
    const p = pageRows.get(row.author);
    return { row, breakout: p ? breakoutWithPage(row, p, { now: READ_25 }) : null };
  });
}

describe("discovery ranking", () => {
  it("leads TikTok with the posts file 25 found against the videos before them (69x, 72x and 18.5x there)", () => {
    const r = rankDiscovery(candidates(["18-164", "18-165"], "tiktok/profile/videos"), "AI coding tools", { filtered: true });
    assert.equal(r.nothingSolid, false);
    const leads = new Map(r.ranked.filter((x) => x.leads).map((x) => [x.row.views, x.breakout!.multiple]));
    // File 18's views at 12:08 over file 25's earlier videos: the same three posts file 18 put at 285x, 313x and 240x.
    assert.equal(leads.get(224_178), 70.61);
    assert.equal(leads.get(159_810), 68.15);
    assert.equal(leads.get(297_672), 18.38);
    // A post found by both searches is one candidate.
    assert.equal(new Set(r.ranked.map((x) => x.row.id)).size, r.ranked.length);
    // Every leader comes before every non-leader.
    const firstNon = r.ranked.findIndex((x) => !x.leads);
    assert.ok(r.ranked.slice(firstNon).every((x) => !x.leads));
  });

  it("leads X with file 25's break-outs on the originals search ending at each post, and never with a thin base", () => {
    const r = rankDiscovery(candidates(["18-162", "18-163"], "twitter/search/tweets"), "AI coding tools", { filtered: true });
    const leads = new Map(r.ranked.filter((x) => x.leads).map((x) => [x.row.views, x.breakout!.multiple]));
    // File 25: 1,016x, 168x, 51.4x and 24.3x (it used every original; the engine compares text with text, 20 at most).
    assert.equal(leads.get(2_154_622), 1015.85);
    assert.equal(leads.get(563_807), 188.25);
    assert.equal(leads.get(219_187), 51.4);
    assert.equal(leads.get(1_914_631), 25.46);
    // A text post whose author's page holds 9 videos and 6 earlier text posts: too few, never a leader.
    const thin = r.ranked.find((x) => x.row.views === 197_321)!;
    assert.equal(thin.breakout!.band, "too_few");
    assert.equal(thin.leads, false);
  });

  it("says \"Nothing solid this window\" when nothing is on topic, strong and above its author's reach", () => {
    const r = rankDiscovery([{ row: row({ id: "a", views: 100, likes: 1 }), breakout: null }], "AI coding tools");
    assert.equal(r.nothingSolid, true);
  });

  it("demotes rows that do not name the topic on a stream the filter did not judge", () => {
    const strongOff = { row: row({ id: "off", text: "hand scraping tools for wood", views: 5_000_000, likes: 90_000 }), breakout: { band: "beat", multiple: 50 } as any };
    const weakOn = { row: row({ id: "on", text: "the best AI coding tools this week", views: 20_000, likes: 900 }), breakout: { band: "beat", multiple: 4 } as any };
    const r = rankDiscovery([strongOff, weakOn], "AI coding tools");
    assert.deepEqual(r.ranked.map((x) => x.row.id), ["on", "off"]);
    assert.deepEqual(headWords("best AI coding tools"), ["ai", "coding"]);
    assert.equal(onEntity("Vibe-coding with AI", "AI coding tools"), true); // "coding" starts a word in "Vibe-coding"
    assert.equal(onEntity("scraping wood and paint", "scraping tools"), true);
    assert.equal(onEntity("web crawlers", "scraping tools"), false);
  });

  it("scores engagement on each platform's own absolute scale", () => {
    assert.equal(engagementScore(row({ platform: "reddit", views: null, likes: 1999, comments: 0 })) !== null, true);
    const big = engagementScore(row({ views: 10_000_000, likes: 100_000, comments: 5_000 }))!;
    const small = engagementScore(row({ views: 500, likes: 5, comments: 0 }))!;
    assert.ok(big > 80 && big <= 100, `${big}`);
    assert.ok(small < 40, `${small}`);
    assert.equal(engagementScore(row({ views: null, likes: null, comments: null })), null);
  });

  it("fuses ranks with k = 60", () => {
    const f = rrf([{ ids: ["a", "b"] }, { ids: ["b", "a"] }]);
    assert.equal(f.get("a"), 1 / 61 + 1 / 62);
    assert.equal(f.get("a"), f.get("b"));
  });
});

describe("the platform scorecard", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  it("gives a status and a 0 to 3 strength from fixed thresholds, each cell with its evidence", () => {
    const cells = scorecard(
      [
        { platform: "x", read: true, account: true, followers: 150_000, lastPostAt: "2026-11-25T00:00:00Z", postsInWindow: 40, medianReach: 3000, requests: ["req-a"] },
        { platform: "tiktok", read: true, account: true, followers: 12_000, lastPostAt: "2026-11-20T00:00:00Z", postsInWindow: 9, medianReach: 800, requests: ["req-b"] },
        { platform: "instagram", read: true, account: true, followers: 900, lastPostAt: "2026-08-01T00:00:00Z", postsInWindow: 0, medianReach: null, requests: ["req-c"] },
        { platform: "youtube", read: true, account: false, followers: null, lastPostAt: null, postsInWindow: null, medianReach: null, requests: ["req-d"] },
        { platform: "linkedin", read: true, account: null, handle: "acme", followers: null, lastPostAt: null, postsInWindow: null, medianReach: null, requests: ["req-e"] },
        { platform: "reddit", read: false, account: null, followers: null, lastPostAt: null, postsInWindow: null, medianReach: null, requests: [] },
      ],
      now,
    );
    assert.deepEqual(cells.map((c) => [c.platform, c.status, c.strength]), [
      ["x", "active", 3],
      ["tiktok", "active", 2],
      ["instagram", "dormant", 1],
      ["youtube", "none", 0],
      ["linkedin", "likely", 1],
      ["reddit", "unknown", 0],
    ]);
    assert.match(cells[0].seen, /150,000 followers, 40 posts in the window, median reach 3,000, last post 1 day ago/);
    assert.deepEqual(cells[0].evidence, ["req-a"]);
    assert.match(scorecardTable(cells), /\| reddit \| unknown \| 0 \| not read \|/);
  });
});

describe("launch lift", () => {
  it("joins moves within 42 days into one cluster", () => {
    const c = clusterMoves(["2026-01-01", "2026-02-10", "2026-05-10", "2026-03-20"]); // 20/03 to 10/05 is 51 days
    assert.deepEqual(c.map((x) => x.moves.length), [3, 1]);
    assert.equal(c[0].end, "2026-03-20");
  });

  it("is views per post in the 3 months after minus the 3 before", () => {
    const posts = [
      { publishedAt: "2026-02-15T00:00:00Z", views: 100 },
      { publishedAt: "2026-03-15T00:00:00Z", views: 300 },
      { publishedAt: "2026-04-15T00:00:00Z", views: 1000 },
      { publishedAt: "2026-06-15T00:00:00Z", views: 2000 },
    ];
    const l = windowLift(posts, "2026-04-01T00:00:00Z", "2025-12-01T00:00:00Z", new Date("2026-08-01T00:00:00Z"));
    assert.deepEqual({ before: l.before, after: l.after, lift: l.lift, reason: l.reason }, { before: 200, after: 1500, lift: 1300, reason: null });
  });

  it("refuses a partial window instead of printing a misleading number", () => {
    const posts = [{ publishedAt: "2026-04-15T00:00:00Z", views: 1000 }];
    const short = windowLift(posts, "2026-04-01T00:00:00Z", "2026-03-01T00:00:00Z", new Date("2026-08-01T00:00:00Z"));
    assert.equal(short.lift, null);
    assert.match(short.reason!, /reaches back only to 2026-03-01/);
    const young = windowLift(posts, "2026-04-01T00:00:00Z", "2025-12-01T00:00:00Z", new Date("2026-05-01T00:00:00Z"));
    assert.match(young.reason!, /have not passed/);
  });

  it("names no leading channel under 18 months or 6 moves", () => {
    const growth = Array.from({ length: 12 }, (_, i) => i);
    assert.deepEqual(leadingChannel([{ channel: "x", monthlyMoves: growth.map(() => 1) }], growth), { called: false, reason: "too few to call: 12 months of history, 18 needed" });
    const g18 = Array.from({ length: 18 }, (_, i) => i);
    assert.equal(leadingChannel([{ channel: "x", monthlyMoves: g18.map((_, i) => (i === 3 ? 1 : 0)) }], g18).called, false);
    const called = leadingChannel([{ channel: "x", monthlyMoves: g18.map((_, i) => i % 3) }, { channel: "video", monthlyMoves: g18.map((_, i) => Math.floor(i / 2)) }], g18);
    assert.equal(called.called, true);
    assert.equal(called.called && called.channel, "video");
  });
});
