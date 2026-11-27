// competitor-research's plan: two to five brands, a filter sentence per brand that names its
// category (so a brand whose name is a common word counts only posts about the brand: file 18,
// N3), one windowed, topic-filtered search per brand per platform, and every list call with
// max_pages.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brandSentence, parseBrands, planMentions, shareOfVoice, usualOf } from "../../../src/workflows/competitor-research/plan.ts";
import { windowOf } from "../../../src/workflows/_video/window.ts";
import { row } from "../../engine/helpers.ts";

const W = windowOf({ now: new Date("2026-11-27T12:00:00Z") });

describe("competitor-research: the brands", () => {
  it("reads two to five brands from a comma or 'vs' list", () => {
    assert.deepEqual(parseBrands("Supabase, Firebase, Neon"), ["Supabase", "Firebase", "Neon"]);
    assert.deepEqual(parseBrands("Notion vs Obsidian"), ["Notion", "Obsidian"]);
    assert.deepEqual(parseBrands("Linear, linear , Jira"), ["Linear", "Jira"], "one copy each, case ignored");
    assert.throws(() => parseBrands("Notion"), /two to five brands/);
    assert.throws(() => parseBrands("a, b, c, d, e, f"), /two to five brands/);
  });

  it("writes a filter sentence that names the brand and, when given, its category", () => {
    assert.equal(brandSentence("Neon", "serverless Postgres databases for developers"), "Neon, in serverless Postgres databases for developers: posts about this brand or its product");
    assert.equal(brandSentence("Supabase"), "Supabase: posts about this brand or its product");
  });
});

describe("competitor-research: the plan", () => {
  it("searches each brand on X, TikTok, YouTube and Reddit by default, windowed and topic-filtered, with max_pages", () => {
    const calls = planMentions(["Supabase", "Neon"], { about: "Postgres databases", window: W, deep: false });
    assert.equal(calls.length, 8);
    for (const c of calls) {
      assert.equal(c.params.relevance, "filter", c.endpoint);
      assert.match(String(c.params.relevant_to), /^(Supabase|Neon), in Postgres databases/);
      assert.equal(Number(c.params.max_pages), 1);
    }
    const x = calls.find((c) => c.endpoint === "twitter/search/tweets" && c.brand === "Neon");
    assert.equal(x?.params.query, '"Neon"', "an exact phrase on X and Reddit");
    assert.equal(x?.params.since, "2026-10-29");
    assert.equal(calls.find((c) => c.endpoint === "tiktok/search")?.params.date_posted, "this-month");
    assert.equal(calls.find((c) => c.endpoint === "youtube/search")?.params.uploadDate, "this_month");
    assert.equal(calls.find((c) => c.endpoint === "reddit/search")?.params.timeframe, "month");
  });

  it("adds Instagram and a second page on --deep", () => {
    const calls = planMentions(["Supabase", "Neon"], { window: W, deep: true });
    assert.ok(calls.some((c) => c.endpoint === "instagram/search/reels"));
    assert.ok(calls.every((c) => Number(c.params.max_pages) === 2));
  });
});

describe("competitor-research: wording", () => {
  it("says a Reddit multiple is against the community, others against the author", () => {
    assert.equal(usualOf("reddit"), "its community's usual score");
    assert.equal(usualOf("x"), "its author's usual reach");
  });
});

describe("competitor-research: share of voice", () => {
  it("shares posts and reach per platform among the posts read, never summed across platforms", () => {
    const rows = [
      { brand: "Supabase", row: row({ platform: "x", id: "1", views: 9_000 }) },
      { brand: "Supabase", row: row({ platform: "x", id: "2", views: 1_000 }) },
      { brand: "Neon", row: row({ platform: "x", id: "3", views: 10_000 }) },
      { brand: "Neon", row: row({ platform: "reddit", id: "4", views: null, likes: 300 }) },
    ];
    const s = shareOfVoice(rows, ["Supabase", "Neon"]);
    const x = s.find((p) => p.platform === "x")!;
    assert.deepEqual(x.brands.map((b) => [b.brand, b.posts, b.reach]), [["Supabase", 2, 10_000], ["Neon", 1, 10_000]]);
    assert.deepEqual(x.brands.map((b) => b.postShare), [0.67, 0.33]);
    assert.deepEqual(x.brands.map((b) => b.reachShare), [0.5, 0.5]);
    assert.deepEqual(x.brands.map((b) => b.topPostShare), [0.9, 1], "how much of a brand's reach its largest post holds");
    assert.equal(x.metric, "views");
    const reddit = s.find((p) => p.platform === "reddit")!;
    assert.equal(reddit.metric, "score");
    assert.deepEqual(reddit.brands.map((b) => [b.brand, b.posts, b.reach]), [["Supabase", 0, 0], ["Neon", 1, 300]]);
  });

  it("counts a post found under two brands once for each, since it is about both", () => {
    const shared = row({ platform: "x", id: "9", views: 5_000 });
    const s = shareOfVoice([{ brand: "Supabase", row: shared }, { brand: "Neon", row: shared }], ["Supabase", "Neon"]);
    assert.deepEqual(s[0].brands.map((b) => b.posts), [1, 1]);
    assert.equal(s[0].sharedPosts, 1);
  });
});
