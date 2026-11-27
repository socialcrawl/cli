// What every stage sends (topic filter, labels) and the boosted-post flags.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { engagementFlags, FLAG_LABEL, isViral, likesPerThousand, retweeterRead } from "../../src/engine/boosted.ts";
import { breakoutOf } from "../../src/engine/breakout.ts";
import { rowsOf } from "../../src/engine/rows.ts";
import { COMMENT_LABELS, labelGaps, stageParams, topicRead, topicSentence } from "../../src/engine/stages.ts";
import { RUN_AT, rec, row } from "./helpers.ts";

describe("stage params", () => {
  it("puts the topic filter on every search stage and refuses a search with no topic", () => {
    assert.deepEqual(stageParams("tiktok/search", { query: "AI coding tools" }, { topic: "AI coding tools and AI coding assistants for software developers" }), {
      query: "AI coding tools",
      relevance: "filter",
      relevant_to: "AI coding tools and AI coding assistants for software developers",
      label: "sponsored,intent,niche",
    });
    assert.throws(() => stageParams("twitter/search/tweets", { query: "x" }), /pass the topic sentence/);
  });

  it("sends the four free comment labels explicitly on labelled comment lanes", () => {
    for (const lane of ["twitter/tweet/replies", "tiktok/post/comments", "reddit/post/comments", "youtube/video/comments"]) {
      assert.equal(stageParams(lane, { url: "u" }).label, "sentiment,question,purchase_intent,complaint", lane);
    }
    assert.deepEqual([...COMMENT_LABELS], ["sentiment", "question", "purchase_intent", "complaint"]);
  });

  it("sends nothing the API would drop: no label= on reddit/profile/comments, Threads or LinkedIn comments", () => {
    for (const lane of ["reddit/profile/comments", "threads/post/comments", "linkedin/post/comments", "youtube/channel/videos"]) {
      assert.deepEqual(stageParams(lane, { url: "u" }), { url: "u" }, lane);
    }
  });

  it("has one switch: explicit (default), default (send nothing) or off", () => {
    assert.equal(stageParams("twitter/user/tweets", { handle: "a" }).label, "sponsored,intent,niche");
    assert.deepEqual(stageParams("twitter/user/tweets", { handle: "a" }, { labels: "default" }), { handle: "a" });
    assert.deepEqual(stageParams("twitter/user/tweets", { handle: "a" }, { labels: "off" }), { handle: "a", judgments: "off" });
    // judgments=off would switch the topic filter off too, so a search lane never gets it.
    assert.equal(stageParams("reddit/search", { query: "q" }, { topic: "q", labels: "off" }).judgments, undefined);
  });

  it("keeps the topic sentence within 200 characters", () => {
    assert.equal(topicSentence("  scraping   tools "), "scraping tools");
    assert.ok(topicSentence("x", "word ".repeat(60)).length <= 200);
    assert.throws(() => topicSentence(" "), /needs a topic/);
  });

  it("counts the comments that came back unlabelled and why (req 18-31: 9 of 9, the per-minute budget)", () => {
    const g = labelGaps(rec("18-31"));
    assert.deepEqual({ rows: g.rows, unlabelled: g.unlabelled, status: g.status, skip: g.skipReason }, { rows: 9, unlabelled: 9, status: "skipped", skip: "budget" });
    assert.equal(labelGaps({ ...rec("18-31"), endpoint: "reddit/profile/comments" }).unavailable, true);
  });

  it("reads what the topic filter kept and dropped (req 18-162: 44 of 60)", () => {
    const t = topicRead(rec("18-162"));
    assert.deepEqual({ rows: t.rows, kept: t.kept, dropped: t.dropped, mode: t.mode }, { rows: 60, kept: 44, dropped: 16, mode: "filter" });
    assert.equal(t.sentence, "AI coding tools and AI coding assistants for software developers");
  });
});

describe("boosted and unusual posts", () => {
  const big = (n: number, of: number) => ({ read: of, big: n });

  it("on X needs both numbers: under 1.5 likes per 1,000 views and more than 12% of retweeters above 10,000 followers", () => {
    const p = row({ id: "p", views: 100_000, likes: 100 }); // 1 like per 1,000 views
    const both = engagementFlags([p], { retweeters: new Map([["p", big(3, 20)]]) })[0]; // 15%
    assert.equal(both.flag, "likely_boosted");
    assert.equal(FLAG_LABEL[both.flag!], "likely boosted (inferred)");
    const lowOnly = engagementFlags([p], { retweeters: new Map([["p", big(2, 20)]]) })[0]; // 10%
    assert.equal(lowOnly.flag, "unusual_engagement");
    const notRead = engagementFlags([p])[0];
    assert.equal(notRead.flag, "unusual_engagement");
    assert.ok(notRead.reasons.includes("retweeters not read"));
  });

  it("elsewhere low likes per view alone is only unusual engagement, never boosted", () => {
    const p = row({ id: "p", platform: "tiktok", views: 100_000, likes: 100 });
    assert.equal(engagementFlags([p], { retweeters: new Map([["p", big(10, 10)]]) })[0].flag, "unusual_engagement");
  });

  it("raises no flag on small posts, where a like rate says nothing", () => {
    assert.equal(engagementFlags([row({ views: 900, likes: 0 })])[0].flag, null);
  });

  it("a likely boosted post is never called viral; an unusual one still can be", () => {
    const b = { band: "beat" } as any;
    assert.equal(isViral(b, { flag: "likely_boosted" } as any), false);
    assert.equal(isViral(b, { flag: "unusual_engagement" } as any), true);
    assert.equal(isViral({ band: "above" } as any, undefined), false);
  });

  it("file 18's top X break-outs read as organic: 1.71 and 6.4 likes per 1,000 views, no retweeter above 10,000 (req 18-212, 18-213)", () => {
    const search = [...rowsOf(rec("18-162")), ...rowsOf(rec("18-163"))];
    const rts = new Map<string, { read: number; big: number }>();
    const posts = [];
    for (const q of ["18-212", "18-213"]) {
      const id = String(rec(q).params.url).split("/").pop()!;
      rts.set(id, retweeterRead(rec(q).body));
      posts.push(search.find((r) => r.id === id)!);
    }
    assert.deepEqual([...rts.values()], [{ read: 19, big: 0 }, { read: 20, big: 0 }]);
    assert.deepEqual(posts.map(likesPerThousand), [1.71, 6.4]);
    assert.deepEqual(engagementFlags(posts, { retweeters: rts }).map((f) => f.flag), [null, null]);
  });

  it("marks the brand post that holds 75% of a 202-post timeline's views as unusual (req 18-77)", () => {
    const tl = rowsOf(rec("18-77"));
    const top = [...tl].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
    const f = engagementFlags([top], { timelines: new Map([[top.author.toLowerCase(), tl]]) })[0];
    assert.equal(f.timelineShare, 0.75);
    assert.equal(f.flag, "unusual_engagement");
    assert.match(f.reasons.at(-1)!, /holds 75% of the views of 202 timeline posts/);
    // Shown beside the post, never used to exclude it: it keeps its band.
    assert.equal(isViral({ ...breakoutOf(top, tl, { now: RUN_AT }), band: "beat" }, f), true);
  });
});
