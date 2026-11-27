// The baseline plan and the rate table, on the /social-viral run of study file 18
// ("AI coding tools", 19/11 to 26/11/2026, req 18-162 to 18-214).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASELINE_METHOD, breakoutWithPage, communityBaselines, morePage, planBaselines, spearman, timelineCall, untilOf, viewsPerFollower, xBaselineCall } from "../../src/engine/baseline.ts";
import { median } from "../../src/engine/breakout.ts";
import { Budget, BudgetSpent, CostLedger, metaBlock, quote, quoteLines, RATES, rateOf, walkOutcome, walkParams } from "../../src/engine/rates.ts";
import { rowsOf } from "../../src/engine/rows.ts";
import { RUN_AT, rec, row } from "./helpers.ts";

const inWindow = (studyReqs: string[]) => studyReqs.flatMap((s) => rowsOf(rec(s))).filter((r) => (r.publishedAt ?? "") >= "2026-11-19");

describe("the baseline plan", () => {
  it("uses each platform's measured method", () => {
    assert.equal(BASELINE_METHOD.x, "pre_rank_then_confirm");
    assert.equal(BASELINE_METHOD.tiktok, "pre_rank_then_confirm");
    assert.equal(BASELINE_METHOD.youtube, "pay_page");
    assert.equal(BASELINE_METHOD.instagram, "pay_page");
    assert.equal(BASELINE_METHOD.reddit, "community_median");
  });

  it("pre-ranks X authors free by views over followers and reads each one's originals up to the post", () => {
    const cand = inWindow(["18-162", "18-163"]);
    const plan = planBaselines(cand, "x", { confirm: 10 });
    assert.equal(plan.steps.length, 10);
    // max_items=20 & max_pages=2: at most 2 credits each, 1.1 on average in file 25.
    assert.equal(plan.credits, 20);
    assert.ok(plan.steps.every((s) => s.endpoint === "twitter/search/tweets" && s.credits === 2 && String(s.params.query).startsWith(`from:${s.key} -filter:replies -filter:retweets`)));
    // The search ends at the author's newest candidate.
    for (const s of plan.steps) {
      const newest = cand.filter((r) => r.author.toLowerCase() === s.key).map((r) => r.publishedAt!).sort().at(-1)!;
      assert.equal(s.params.until, untilOf(newest));
    }
    const ranks = plan.steps.map((s) => s.preRank as number);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
    // Each author once, however many of its posts are candidates.
    assert.equal(new Set(plan.steps.map((s) => s.key)).size, 10);
    assert.equal(plan.skipped.filter((s) => s.reason === "below_top_n").length, new Set(cand.map((r) => r.author)).size - 10);
  });

  it("reproduces file 18's agreement between the free pre-rank and the timeline median on X (0.76 there)", () => {
    const cand = inWindow(["18-162", "18-163"]);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 175; i <= 184; i++) {
      const page = rec(`18-${i}`);
      const t = cand.filter((r) => r.author === page.params.handle).sort((x, y) => (y.views ?? 0) - (x.views ?? 0))[0];
      const m = median(rowsOf(page).filter((r) => r.kind === "original" && !r.pinned && r.id !== t.id && r.views !== null).map((r) => r.views as number));
      if (!t || !m) continue;
      a.push(viewsPerFollower(t) as number);
      b.push((t.views as number) / m);
    }
    assert.equal(a.length, 10);
    assert.equal(spearman(a, b), 0.77);
  });

  it("picks file 18's two LinkedIn authors inside 10 credits (5 a page) and skips the rest as budget", () => {
    const plan = planBaselines(rowsOf(rec("18-171")), "linkedin", { budget: 10 });
    assert.deepEqual(plan.steps.map((s) => s.params.url), [rec("18-210").params.url, rec("18-211").params.url]);
    assert.equal(plan.credits, 10);
    assert.ok(plan.skipped.every((s) => s.reason === "budget"));
  });

  it("picks file 18's four Reddit communities and reads each one's listing", () => {
    const plan = planBaselines(rowsOf(rec("18-170")), "reddit", { confirm: 4 });
    assert.deepEqual(
      plan.steps.map((s) => s.params.subreddit),
      ["206", "207", "208", "209"].map((n) => rec(`18-${n}`).params.subreddit),
    );
    assert.deepEqual(plan.steps[0].params, { subreddit: plan.steps[0].params.subreddit, sort: "top", timeframe: "month" });
  });

  it("measures a Reddit post against its community's earlier posts: 187 over 16, 40.51x (file 18's 36x used the whole listing)", () => {
    const post = rowsOf(rec("18-170")).find((r) => r.likes === 7576)!;
    const b = breakoutWithPage(post, rowsOf(rec("18-207")), { now: RUN_AT });
    assert.equal(b.base, 187);
    assert.equal(b.peers, 16);
    assert.equal(b.multiple, 40.51);
    assert.equal(b.band, "beat");
    assert.equal(b.mode, "previous");
    const summary = communityBaselines(rowsOf(rec("18-207")));
    assert.equal([...summary.values()][0].posts, 25);
  });

  it("skips a row that lacks the id its baseline needs, instead of guessing", () => {
    assert.equal(timelineCall(row({ platform: "youtube", channelId: null })), null);
    const plan = planBaselines([row({ platform: "youtube", id: "s1", author: "@chan", channelId: null })], "youtube");
    assert.deepEqual(plan.skipped, [{ key: "@chan", reason: "no_id", rowIds: ["s1"] }]);
    assert.equal(viewsPerFollower(row({ authorFollowers: null })), null);
  });

  it("reads X baselines from the originals search ending at the post by default; the timeline page stays behind one switch", () => {
    assert.deepEqual(xBaselineCall("acme", "2026-11-24T13:46:21.000Z"), {
      endpoint: "twitter/search/tweets",
      params: { query: "from:acme -filter:replies -filter:retweets", max_items: 20, max_pages: 2, until: "2026-11-24T13:46:00Z" },
    });
    // Reader 25's own call (req 25-12) sent the same query and until.
    assert.equal(rec("25-12").params.until, "2026-11-24T13:46:00Z");
    assert.match(String(rec("25-12").params.query), /^from:\w+ -filter:replies -filter:retweets$/);
    assert.deepEqual(xBaselineCall("acme", null, "timeline_page"), { endpoint: "twitter/user/tweets", params: { handle: "acme" } });
    const plan = planBaselines(inWindow(["18-162"]), "x", { confirm: 2, xRead: "timeline_page" });
    assert.ok(plan.steps.every((s) => s.endpoint === "twitter/user/tweets"));
  });

  it("asks for one more page only when the baseline is too few, the page says more exists and the share has room", () => {
    const step = planBaselines(inWindow(["18-162"]), "x", { confirm: 1 }).steps[0];
    const thin = { band: "too_few" } as any;
    const body = { pagination: { has_more: true, next_cursor: "sc.abc" } };
    assert.deepEqual(morePage(thin, step, body, 5)?.params, { ...step.params, cursor: "sc.abc", max_pages: 1 });
    assert.equal(morePage({ band: "beat" } as any, step, body, 5), null);
    assert.equal(morePage(thin, step, { pagination: { has_more: false } }, 5), null);
    assert.equal(morePage(thin, step, body, 0), null);
  });

  it("spearman handles ties and refuses under 3 pairs", () => {
    assert.equal(spearman([1, 2, 3], [1, 2, 3]), 1);
    assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
    assert.equal(spearman([1, 1, 2, 3], [1, 2, 3, 4]), 0.95);
    assert.equal(spearman([1, 2], [1, 2]), null);
  });
});

describe("the rate table", () => {
  it("prices the dry run from the table, with the topic filter's hold and its settled cost", () => {
    const q = quote([
      { stage: "search", endpoint: "twitter/search/tweets", pages: 3, topic: true },
      { stage: "baselines", endpoint: "twitter/user/tweets", count: 10 },
      { stage: "baselines", endpoint: "linkedin/profile/posts", count: 2 },
    ]);
    assert.deepEqual(q.lines.map((l) => [l.expected, l.max]), [[6, 15], [10, 10], [10, 10]]);
    assert.equal(q.expected, 26);
    assert.equal(q.max, 35);
    assert.deepEqual(q.confirm, []);
    assert.match(quoteLines(q).at(-1)!, /about 26 credits, at most 35/);
  });

  it("asks first above 25 credits a stage", () => {
    const q = quote([{ stage: "transcripts", endpoint: "tiktok/post/transcript", count: 3 }]);
    assert.deepEqual(q.confirm, ["transcripts"]);
  });

  it("refuses an endpoint with no rate rather than guessing a price", () => {
    assert.throws(() => rateOf("twitter/does/not/exist"), /No rate/);
  });

  it("sends max_pages (default 1) with max_credits on every walk, capped at what those pages can cost", () => {
    assert.deepEqual(walkParams("twitter/user/tweets", { handle: "a" }, 40), { handle: "a", max_pages: 1, max_credits: 1 });
    assert.deepEqual(walkParams("twitter/user/tweets", { handle: "a", max_pages: 15 }, 40), { handle: "a", max_pages: 15, max_credits: 15 });
    assert.deepEqual(walkParams("twitter/user/tweets", { handle: "a", max_pages: 60 }, 40), { handle: "a", max_pages: 60, max_credits: 40 });
    // The topic filter's hold counts: 1 page of LinkedIn search with relevant_to holds 5 + 8.
    assert.deepEqual(walkParams("linkedin/search/posts", { query: "q", relevant_to: "q" }, 66), { query: "q", relevant_to: "q", max_pages: 1, max_credits: 13 });
    assert.deepEqual(walkParams("twitter/profile", { handle: "a" }, 40), { handle: "a" });
    assert.throws(() => walkParams("instagram/post/comments", { url: "u" }, 4), /at least 5 for a page/);
  });

  it("never sends reddit/search a max_credits under the 10 its server asks for one page", () => {
    assert.deepEqual(walkParams("reddit/search", { query: "q", relevant_to: "q" }, 100), { query: "q", relevant_to: "q", max_pages: 1, max_credits: 10 });
    assert.deepEqual(walkParams("reddit/search", { query: "q" }, 100), { query: "q", max_pages: 1, max_credits: 10 });
    assert.throws(() => walkParams("reddit/search", { query: "q" }, 6), /at least 10/);
    const b = new Budget();
    b.spend(91);
    assert.throws(() => b.allow("reddit/search", { query: "q" }), BudgetSpent);
  });

  it("never lets a walking lane out without max_pages, whatever the cap (the 66-credit LinkedIn walk of 26/11/2026)", () => {
    for (const [id, rate] of Object.entries(RATES)) {
      if (!rate.walks) continue;
      for (const cap of [Math.max(rate.page, rate.minMaxCredits ?? 0), 13, 100]) {
        const p = walkParams(id, { relevant_to: rate.topicHold ? "t" : undefined }, cap);
        assert.equal(typeof p.max_pages, "number", `${id} at cap ${cap}`);
        assert.ok((p.max_credits as number) <= Math.max((p.max_pages as number) * (rate.page + (rate.topicHold ?? 0)), rate.minMaxCredits ?? 0), `${id} at cap ${cap}`);
      }
      const b = new Budget();
      const q = b.allow(id, {}, 100);
      assert.equal(q.max_pages, 1, id);
      assert.equal(q.max_credits, Math.max(rate.page, rate.minMaxCredits ?? 0), id);
    }
  });

  it("reads where a walk stopped and the date it reached (req 18-77, 15 pages)", () => {
    const w = walkOutcome(rec("18-77").body);
    assert.equal(w.pages, 15);
    assert.equal(w.stopped, "max_pages");
    assert.equal(w.credits, 15);
    assert.match(w.reached!, /^\d{2}\/\d{2}\/2026$/);
  });

  it("keeps the ledger and the meta block", () => {
    const l = new CostLedger();
    l.add({ stage: "search", endpoint: "twitter/search/tweets", requestId: "req-a", credits: 6, status: 200 });
    l.add({ stage: "baselines", endpoint: "twitter/user/tweets", requestId: "req-b", credits: 1, status: 200 });
    assert.equal(l.credits, 7);
    assert.deepEqual(l.byStage(), { search: { calls: 1, credits: 6 }, baselines: { calls: 1, credits: 1 } });
    const m = metaBlock({ skill: "social-viral", version: "0.1.0", ledger: l, startedAt: new Date("2026-11-26T12:00:00Z"), now: new Date("2026-11-26T12:01:30Z") });
    assert.deepEqual({ credits: m.credits, calls: m.calls, seconds: m.seconds, date: m.date }, { credits: 7, calls: 2, seconds: 90, date: "26/11/2026" });
    const b = new Budget(100);
    b.spend(94);
    assert.equal(b.canAfford(6), true);
    assert.equal(b.canAfford(7), false);
  });

  it("caps the whole run at 100 credits: each walk's max_credits is the smaller of its share and what is left", () => {
    const b = new Budget();
    assert.equal(b.total, 100);
    assert.deepEqual(b.allow("twitter/user/tweets", { handle: "a", max_pages: 50 }, 40), { handle: "a", max_pages: 50, max_credits: 40 });
    b.spend(85);
    assert.deepEqual(b.allow("twitter/user/tweets", { handle: "a", max_pages: 50 }, 40), { handle: "a", max_pages: 50, max_credits: 15 });
    assert.deepEqual(b.allow("twitter/profile", { handle: "a" }), { handle: "a" });
    b.spend(13);
    assert.throws(() => b.allow("instagram/post/comments", { url: "u" }), BudgetSpent);
    assert.throws(() => b.allow("tiktok/post/transcript", { url: "u" }), /2 credits left/);
  });
});
