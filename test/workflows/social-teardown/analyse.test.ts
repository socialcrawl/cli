// The analysis every platform shares, on recorded @notionhq answers and synthetic rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { breakouts } from "../../../src/engine/breakout.ts";
import type { Row } from "../../../src/engine/rows.ts";
import { rowsOf } from "../../../src/engine/rows.ts";
import type { CallRecord } from "../../../src/kit/record.ts";
import { analyseAccount, commentReads, durationBand, firstLineType, linkDomains, postingHours, transcriptReads } from "../../../src/workflows/social-teardown/analyse.ts";
import { ADAPTERS } from "../../../src/workflows/social-teardown/platforms.ts";
import { parseTarget } from "../../../src/workflows/social-teardown/targets.ts";
import type { TaggedRecord } from "../../../src/workflows/social-teardown/tracker.ts";
import { fixturePath } from "../../fixture-path.ts";

const recs: CallRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "notion-records.json"), "utf8"));
const tagged = (endpoint: string, stage: string, meta: Record<string, string> = {}): TaggedRecord => ({ ...recs.find((r) => r.endpoint === endpoint)!, stage, meta: { account: "x", ...meta } });
const NOW = new Date("2026-11-27T00:00:00Z");

function row(i: number, over: Partial<Row> = {}): Row {
  return {
    platform: "tiktok", id: String(i), url: `https://www.tiktok.com/@a/video/${i}`, author: "a", authorFollowers: 50_000, authorUrl: null, channelId: null, community: null,
    text: "a post", publishedAt: new Date(Date.UTC(2026, 6, 1 + i, 11)).toISOString(), views: 1000, likes: 50, comments: 5, shares: 1, saves: 2, durationSeconds: 20,
    video: true, pinned: false, kind: "original", requestId: `req-${i}`, ...over,
  };
}

describe("features of a post", () => {
  it("bands a video by length", () => {
    assert.equal(durationBand(row(1, { durationSeconds: 12 })), "under 15 s");
    assert.equal(durationBand(row(1, { durationSeconds: 45 })), "15 to 60 s");
    assert.equal(durationBand(row(1, { durationSeconds: 300 })), "over 3 min");
    assert.equal(durationBand(row(1, { video: false, durationSeconds: null })), "not a video");
  });
  it("reads the first line's type with the codebook's hooks", () => {
    assert.equal(firstLineType(row(1, { text: "Introducing Notion Agents\nmore" })), "introducing");
    assert.equal(firstLineType(row(1, { text: "how do you plan your week?" })), "question");
  });
});

describe("posting hours", () => {
  it("counts posts by UTC hour and weekday, the busiest first", () => {
    const h = postingHours([row(1), row(2), row(3, { publishedAt: "2026-07-04T18:00:00.000Z" })]);
    assert.equal(h.hours[0].key, "11");
    assert.equal(h.hours[0].n, 2);
    assert.equal(h.weekdays.length, 3);
  });
});

describe("where it sends people", () => {
  it("counts the domains linked from the bio and the posts, leaving out the platforms' own", () => {
    const d = linkDomains(["https://www.notion.com/", "https://linktr.ee/notion"], [row(1, { text: "try it https://notion.com/agents and https://www.tiktok.com/@x" })]);
    assert.deepEqual(d[0], { domain: "notion.com", bio: 1, posts: 1 });
    assert.ok(d.some((x) => x.domain === "linktr.ee"));
    assert.ok(!d.some((x) => x.domain === "tiktok.com"));
  });
});

describe("comments", () => {
  it("reads the API's free label shares and keeps no commenter's name", () => {
    const [c] = commentReads([tagged("youtube/video/comments", "comments", { post_id: "vG_LQo0wOGg" })], "notion");
    assert.equal(c.postId, "vG_LQo0wOGg");
    assert.equal(c.read, 7);
    assert.ok("question" in c.shares);
    assert.ok(c.receipts.every((r) => !/person\d+/.test(r.text)));
  });
  it("counts the accounts that commented under two or more top posts, and names none", () => {
    const a = tagged("tiktok/post/comments", "comments", { post_id: "1" });
    const b = { ...a, meta: { account: "x", post_id: "2" } };
    const reads = commentReads([a, b], "notionhq");
    assert.ok(reads.repeat >= 1);
    assert.equal(typeof reads.repeat, "number");
  });
});

describe("words", () => {
  it("reads a transcript's opening and keeps a missing one as unknown, with the reason", () => {
    const ok = tagged("youtube/video/transcript", "words", { post_id: "v1" });
    const gone = tagged("tiktok/post/transcript", "words", { post_id: "t1" });
    const [a, b] = transcriptReads([ok, gone]);
    assert.match(a.opening ?? "", /most meaningful things/);
    assert.ok((a.words ?? 0) > 10);
    assert.equal(b.opening, null);
    assert.match(b.reason ?? "", /unavailable|404/);
  });
});

describe("one account, analysed", () => {
  it("names the outliers by the engine's multiple and says when too few posts stand behind one", () => {
    const rows = [...Array(30)].map((_, i) => row(i, { views: i === 25 ? 40_000 : 1000 + i }));
    const recsT: TaggedRecord[] = [];
    const a = analyseAccount({ target: parseTarget("tiktok:a"), adapter: ADAPTERS.tiktok, records: recsT, own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    assert.equal(a.outliers[0].row.id, "25");
    assert.ok((a.outliers[0].breakout.multiple ?? 0) > 30);
    assert.equal(a.tooFew, 8, "the first 8 posts have too few earlier posts");
  });

  it("calls no top-against-bottom pattern under 24 settled posts", () => {
    const rows = rowsOf(recs.find((r) => r.endpoint === "tiktok/profile/videos")!);
    const a = analyseAccount({ target: parseTarget("tiktok:notionhq"), adapter: ADAPTERS.tiktok, records: [], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    assert.equal(a.contrast.called, false);
  });
});
