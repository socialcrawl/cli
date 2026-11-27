// competitor-research's plan: two to five brands, a filter sentence per brand that names its
// category (so a brand whose name is a common word counts only posts about the brand: file 18,
// N3), one windowed, topic-filtered search per brand per platform, and every list call with
// max_pages.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brandSentence, clashesOf, parseBrands, planMentions, shareOfVoice, usualOf } from "../../../src/workflows/competitor-research/plan.ts";
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
    assert.equal(brandSentence("Neon", "serverless Postgres databases for developers", ["Supabase", "Firebase"]), "Neon, in serverless Postgres databases for developers: posts about this brand or its product", "with --about, the category alone");
  });

  it("marks a brand whose reach share far outruns its post share, as a word clash to check", () => {
    const b = (brand: string, postShare: number, reachShare: number) => ({ brand, posts: 1, reach: 1, postShare, reachShare, topPostShare: 0.3 });
    const shares = [
      // QA 27/11/2026, Reddit: Neon's 3 kept posts ("Neon", "AGI achieved", "Neon girl") held 79% of the score.
      { platform: "reddit" as const, metric: "score" as const, sharedPosts: 0, brands: [b("Supabase", 0.5, 0.18), b("Firebase", 0.29, 0.04), b("Neon", 0.21, 0.79)] },
      // A normal leader: more posts and more reach, in step.
      { platform: "tiktok" as const, metric: "views" as const, sharedPosts: 0, brands: [b("Supabase", 0.49, 0.36), b("Firebase", 0.51, 0.64), b("Neon", 0, 0)] },
    ];
    assert.deepEqual(clashesOf(shares), [{ brand: "Neon", platform: "reddit", postShare: 0.21, reachShare: 0.79 }]);
  });

  it("without --about, judges each brand as a product of one category with the brands it is compared with", () => {
    // QA 27/11/2026: with "Neon: posts about this brand or its product", other meanings of the word
    // (a meme, a 4.4M-view video) took 90 to 99% of Neon's reach on every platform.
    assert.equal(
      brandSentence("Neon", undefined, ["Supabase", "Firebase"]),
      "Neon, the product or company compared here with Supabase and Firebase, as one category: posts about it, not other things called Neon",
    );
    assert.equal(brandSentence("Linear", undefined, ["Jira"]), "Linear, the product or company compared here with Jira, as one category: posts about it, not other things called Linear");
    const calls = planMentions(["Supabase", "Firebase", "Neon"], { window: { since: "2026-10-29", until: "2026-11-27", allTime: false } as never, deep: false });
    for (const c of calls.filter((x) => x.brand === "Neon")) assert.match(JSON.stringify(c.params), /compared here with Supabase and Firebase/);
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
