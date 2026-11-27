// /social-viral on the recorded run of study file 18 ("AI coding tools", 19/11 to
// 26/11/2026, req 18-162 to 18-214): no network, no credits.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rowsOf } from "../../../src/engine/rows.ts";
import type { ResponseRecord } from "../../../src/engine/rows.ts";
import {
  BASELINE_SHARE,
  DATA_VENDOR_SUBJECT,
  DEFAULT_TARGET,
  VIRAL_PLATFORMS,
  candidatesOf,
  cardMarkdown,
  defaultPlanCredits,
  planSearch,
  planViralBaselines,
  rankViral,
} from "../../../src/workflows/social-viral/viral.ts";
import type { BaselinePage } from "../../../src/workflows/social-viral/viral.ts";
import { RUN_AT, rec, records, records25, row } from "../../engine/helpers.ts";
import type { FixtureRecord } from "../../engine/helpers.ts";

const W = { since: "2026-11-19", until: "2026-11-26" };
const SEARCH = ["18-162", "18-163", "18-164", "18-165", "18-166", "18-167", "18-168", "18-169", "18-170", "18-171", "18-172", "18-173"].map(rec);

/**
 * The recorded run with each plan step answered from a stored page: reader 25's reads
 * (study file 25: X originals ending at the post, TikTok walks of 2 to 3 pages) where
 * they exist, file 18's one-page reads otherwise. Under before-the-post baselines, a
 * newest-first single page of a busy creator is mostly posts made after the break-out,
 * so file 18's one-page TikTok reads alone leave every TikTok author "too few".
 */
function replay() {
  const cands = candidatesOf(SEARCH, W);
  const plans = planViralBaselines(cands.rows);
  const ID = ["query", "handle", "channelId", "subreddit", "url"];
  const pool18 = records.filter((r) => /^18-(1(7[5-9]|8\d|9\d)|20\d|21[01])$/.test(r.study_req));
  const pages: BaselinePage[] = [];
  for (const p of plans)
    for (const s of p.steps) {
      const match = (x: FixtureRecord) => x.endpoint === s.endpoint && ID.every((k) => s.params[k] === undefined || String(x.params[k]) === String(s.params[k]));
      const hits25 = records25.filter(match);
      const hits = hits25.length ? hits25 : pool18.filter(match);
      if (hits.length) pages.push({ step: s, rows: hits.flatMap((h) => rowsOf(h)) });
    }
  const result = rankViral(cands.rows, plans, pages, { now: RUN_AT });
  return { cands, plans, pages, result };
}

describe("/social-viral: the plan", () => {
  it("sends the topic filter on every search, and the X window", () => {
    const calls = planSearch({ topic: "AI coding tools", about: "AI coding tools and AI coding assistants for software developers", ...W });
    assert.equal(calls.length, VIRAL_PLATFORMS.length);
    for (const c of calls) {
      assert.equal(c.params.relevance, "filter", c.endpoint);
      assert.equal(c.params.relevant_to, "AI coding tools and AI coding assistants for software developers");
      assert.equal(c.params.query, "AI coding tools");
      assert.equal(c.params.label, undefined, "no explicit post labels on a skill that reads none");
    }
    assert.equal(calls.find((c) => c.platform === "x")?.params.since, "2026-11-19");
    // With max_credits and no max_pages the API walks up to 50 pages: every search names its pages.
    for (const c of calls) assert.equal(Number(c.params.max_pages), c.pages, c.endpoint);
  });

  it("expects the default to land at or under the 80-credit target, inside the 100 cap at the most", () => {
    const d = defaultPlanCredits({ topic: "AI coding tools", ...W });
    assert.ok(d.expected <= DEFAULT_TARGET, `expected ${d.expected}`);
    // At most: every search at its ceiling (the server's one-page floor included) plus every baseline share.
    assert.ok(d.ceiling + d.baselines <= d.cap, `at most ${d.ceiling + d.baselines}`);
  });

  it("keeps every platform's baselines inside its share", () => {
    const { plans } = replay();
    for (const p of plans) assert.ok(p.credits <= BASELINE_SHARE[p.platform as keyof typeof BASELINE_SHARE], p.platform);
  });
});

describe("/social-viral: candidates", () => {
  it("cuts the recorded searches to the window and the floors", () => {
    const { cands } = replay();
    assert.equal(cands.read, 196);
    assert.equal(cands.outsideWindow, 15);
    assert.equal(cands.rows.length, 83);
    const by = (p: string) => cands.rows.filter((r) => r.platform === p).length;
    assert.deepEqual(
      VIRAL_PLATFORMS.map((p) => [p, by(p)]),
      [["x", 24], ["tiktok", 18], ["instagram", 7], ["youtube", 9], ["reddit", 22], ["linkedin", 3]],
    );
  });

  it("leaves out posts whose subject is a data API or scraping service, and counts them", () => {
    const rec: ResponseRecord = {
      endpoint: "twitter/search/tweets",
      requestId: "req-test",
      body: {
        data: {
          items: [
            { post: { id: "a", author: { username: "x1" }, content: { text: "The best web scraping API for agents" }, published_at: "2026-11-20T10:00:00Z", engagement: { views: 50_000, likes: 900 } } },
            { post: { id: "b", author: { username: "x2" }, content: { text: "I shipped a coding agent in a weekend" }, published_at: "2026-11-20T10:00:00Z", engagement: { views: 50_000, likes: 900 } } },
          ],
        },
      },
    };
    const c = candidatesOf([rec], W);
    assert.equal(c.excludedSubject, 1);
    assert.deepEqual(c.rows.map((r) => r.id), ["b"]);
    assert.ok(DATA_VENDOR_SUBJECT.test("residential proxies for scraping"));
    assert.ok(!DATA_VENDOR_SUBJECT.test("AI coding tools for developers"));
  });
});

describe("/social-viral: the ranking", () => {
  it("calls a post viral only at 3x or more over 8 or more earlier comparable posts", () => {
    const { result } = replay();
    for (const i of result.items) {
      if (i.viral) {
        assert.equal(i.breakout.band, "beat");
        assert.ok(i.breakout.peers >= 8);
        assert.ok((i.breakout.multiple as number) >= 3);
      }
      if (i.breakout.band === "too_few") assert.equal(i.breakout.multiple, null);
    }
  });

  it("measures against the posts before the break-out, as reader 25 did by hand (study file 25)", () => {
    const { result } = replay();
    const m = (platform: string, author: string) => result.items.find((i) => i.row.platform === platform && i.row.author === author)?.breakout.multiple;
    // X: originals ending at the post. Reader 25: 1,016x, 168x (media split here), 24.3x.
    assert.equal(m("x", "u047"), 1015.85);
    assert.equal(m("x", "u044"), 188.25);
    assert.equal(m("x", "u048"), 25.46);
    // TikTok: file 18 had 313x and 285x against posts around the break-out; reader 25: 69x and 72x.
    // The numerator is the skill's own search row (read before reader 25's walk), so these
    // match the engine's discovery ranking (68.15x, 70.61x), not its walk goldens (68.65x, 71.56x).
    assert.equal(m("tiktok", "u080"), 68.15);
    assert.equal(m("tiktok", "u078"), 70.61);
    // Reddit: the earlier posts of the community's listing (file 18's whole listing gave 35.91x).
    assert.equal(m("reddit", "u128"), 40.51);
  });

  it("lets the card lead with each of those, and says when a base is still settling", () => {
    const { result } = replay();
    const x = result.items.find((i) => i.row.platform === "x" && i.row.author === "u047");
    assert.ok(x?.cardWorthy);
    assert.match(x.line, /still rising/);
    for (const i of result.items.filter((v) => v.breakout.inflatedByYoung && v.viral)) {
      assert.equal(i.cardWorthy, (i.breakout.settledMultiple ?? 0) >= 3 || (i.breakout.overBestPeer ?? 0) >= 3);
    }
  });

  it("reports every candidate whose baseline it did not read, with the reason", () => {
    const { result, cands } = replay();
    assert.equal(result.items.length + result.unread.length, cands.rows.length);
    assert.ok(result.unread.every((u) => ["below_top_n", "budget", "no_id", "planned_not_read"].includes(u.reason)));
  });
});

describe("/social-viral: the card", () => {
  const { cands, result } = replay();
  const card = cardMarkdown({ topic: "AI coding tools", ...W, credits: 94, candidates: cands, result });

  it("is titled with the command and footed with the cost and the line to run it", () => {
    const lines = card.split("\n");
    assert.equal(lines[0], '# /social-viral "AI coding tools" · 19/11/2026 to 26/11/2026');
    assert.ok(lines.includes("Read with SocialCrawl /social-viral · 94 credits · 26/11/2026"));
    assert.ok(lines.at(-1)?.startsWith('Run it yourself: /social-viral "AI coding tools"'));
  });

  it("leads only with card-worthy posts, and says what it could not call", () => {
    const listed = card.split("\n").filter((l) => /^\d+\. /.test(l));
    const worthy = result.items.filter((i) => i.cardWorthy);
    assert.equal(listed.length, Math.min(5, worthy.length));
    for (const [k, i] of worthy.slice(0, 5).entries()) assert.ok(listed[k].includes(`${i.breakout.multiple}x`));
    assert.match(card, /Not called: \d+ posts whose authors had fewer than 8 comparable posts/);
  });

  it("never accuses an account", () => {
    assert.doesNotMatch(card, /\b(paid|bot|bots|ring|undisclosed|fake)\b/i);
  });

  it("states no number the run did not compute", () => {
    const nums = card.match(/\d[\d,.]*x/g) ?? [];
    const known = new Set(result.items.map((i) => `${i.breakout.multiple}x`));
    for (const x of nums) assert.ok(known.has(x), x);
  });
});

describe("/social-viral: a synthetic author", () => {
  it("abstains below 8 comparable posts", () => {
    const target = row({ id: "t", author: "a", views: 90_000, publishedAt: "2026-11-24T10:00:00Z" });
    const page = Array.from({ length: 5 }, (_, k) => row({ id: `p${k}`, author: "a", views: 1_000, publishedAt: `2026-11-0${k + 1}T10:00:00Z` }));
    const plans = planViralBaselines([target]);
    const step = plans.find((p) => p.platform === "x")!.steps[0];
    const res = rankViral([target], plans, [{ step, rows: page }], { now: RUN_AT });
    assert.equal(res.items[0].breakout.band, "too_few");
    assert.equal(res.items[0].viral, false);
  });
});
