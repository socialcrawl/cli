// x-marketing against a fake API: topic-filtered searches over the window, baselines through
// social-viral's readBaselines (the X originals search that ends at the post), who carried the top
// break-outs (retweeters, quotes through quoted_tweet_id:), the boosted flag on both conditions,
// and labelled replies.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_SECTIONS, renderCard, renderReport, validateReport } from "../../../src/workflows/../engine/index.ts";
import { runX } from "../../../src/workflows/x-marketing/run.ts";
import { REPORT_SECTIONS, workflow } from "../../../src/workflows/x-marketing/index.ts";
import { fakeSession, history, post } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const ARGS = { input: "AI coding tools", flags: {}, deep: false, now: NOW };
const tw = (o: Parameters<typeof post>[0]) => post({ ...o, url: `https://x.com/${o.author}/status/${o.id}` });

const A = tw({ id: "1001", author: "bigdev", followers: 80_000, views: 400_000, likes: 8_000, at: "2026-11-20T13:46:00Z", text: "Before AI / After AI: a list of task times" });
const B = tw({ id: "1002", author: "smalldev", followers: 2_000, views: 60_000, likes: 3_000, at: "2026-11-21T10:00:00Z", text: "I built an agent in a day https://t.co/abc" });
const P = tw({ id: "1003", author: "promo", followers: 50_000, views: 900_000, likes: 500, at: "2026-11-22T10:00:00Z", text: "Top 10 AI tools" });
const C = tw({ id: "1004", author: "steady", followers: 40_000, views: 20_000, likes: 900, at: "2026-11-19T10:00:00Z", text: "Thoughts on Claude" });
const OLD = tw({ id: "0999", author: "bigdev", followers: 80_000, views: 2_000_000, likes: 60_000, at: "2026-09-01T10:00:00Z", text: "old" });

const retweeter = (followers: number) => ({ author: { username: `r${followers}`, followers } });
const reply = (id: string, text: string, q: number) => ({ comment: { id, post_id: "x", text, author: { username: `u${id}` }, engagement: { likes: 4 } }, computed: { labels: { question: { p: q }, purchase_intent: { p: 0 }, complaint: { p: 0 }, sentiment: { level: 3 } } } });

function world(): Route[] {
  const from = (h: string) => (p: Record<string, unknown>) => String(p.query ?? "").startsWith(`from:${h} `);
  return [
    { endpoint: "twitter/search/tweets", when: from("bigdev"), data: { items: history("bigdev", 20, 10_000, "2026-11-20T00:00:00Z", { followers: 80_000 }) } },
    { endpoint: "twitter/search/tweets", when: from("smalldev"), data: { items: history("smalldev", 12, 2_000, "2026-11-21T00:00:00Z", { followers: 2_000 }) } },
    { endpoint: "twitter/search/tweets", when: from("promo"), data: { items: history("promo", 12, 30_000, "2026-11-22T00:00:00Z", { followers: 50_000 }) } },
    { endpoint: "twitter/search/tweets", when: from("steady"), data: { items: history("steady", 12, 18_000, "2026-11-19T00:00:00Z", { followers: 40_000 }) } },
    { endpoint: "twitter/search/tweets", when: (p) => String(p.query).startsWith("quoted_tweet_id:1001"), data: { items: [tw({ id: "q1", author: "quoter", followers: 15_000, views: 5_000, at: "2026-11-20T14:10:00Z", text: "this" }), tw({ id: "q2", author: "q2", followers: 300, views: 400, at: "2026-11-20T15:00:00Z", text: "lol" })] } },
    { endpoint: "twitter/search/tweets", when: (p) => String(p.query).startsWith("quoted_tweet_id:"), data: { items: [] } },
    { endpoint: "twitter/search/tweets", when: (p) => p.sort === "latest", data: { items: [B, C] } },
    { endpoint: "twitter/search/tweets", data: { items: [A, B, P, C, OLD], relevance: { mode: "filter", rows: 30, kept: 5, dropped: 25 } } },
    // promo's retweeters are mostly large accounts: with its 0.56 likes per 1,000 views, likely boosted.
    { endpoint: "twitter/tweet/retweeters", when: (p) => String(p.url).includes("/1003"), data: { items: [retweeter(50_000), retweeter(40_000), retweeter(300), retweeter(200)] } },
    { endpoint: "twitter/tweet/retweeters", data: { items: [retweeter(120), retweeter(80), retweeter(25_000)] } },
    { endpoint: "twitter/tweet/replies", data: { items: [reply("1", "Which model is this?", 0.9), reply("2", "nice", 0.1)], labels: { status: "complete", labelled: 2 } } },
  ];
}

describe("x-marketing: the run", () => {
  it("searches top and latest over the window, topic-filtered, with max_pages, inside the budget", async () => {
    const { kit, session } = fakeSession(world(), 60);
    const run = await runX(session, ARGS);
    const searches = kit.sent.filter((s) => s.endpoint === "twitter/search/tweets" && s.params.relevance === "filter");
    assert.deepEqual(searches.map((s) => s.params.sort).sort(), ["latest", "top"]);
    for (const s of searches) {
      assert.equal(s.params.since, "2026-10-29");
      assert.ok(Number(s.params.max_pages) >= 1 && Number(s.params.max_credits) >= 1);
    }
    assert.equal(run.candidates.outsideWindow, 1);
    assert.ok(session.ledger.credits <= workflow.defaultBudget);
  });

  it("measures each candidate against the author's originals before it, never topic-filtered", async () => {
    const { kit, session } = fakeSession(world(), 60);
    const run = await runX(session, ARGS);
    for (const s of kit.sent.filter((x) => String(x.params.query ?? "").startsWith("from:"))) {
      assert.equal(s.params.relevant_to, undefined);
      assert.equal(s.params.judgments, "off");
      assert.match(String(s.params.until), /^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/);
    }
    const by = new Map(run.items.map((i) => [i.row.id, i]));
    assert.equal(by.get("1001")?.breakout.multiple, 40);
    assert.equal(by.get("1002")?.breakout.multiple, 30);
    assert.equal(by.get("1004")?.viral, false);
  });

  it("reads who carried the top break-outs, and flags a likely boosted post on both conditions", async () => {
    const { kit, session } = fakeSession(world(), 60);
    const run = await runX(session, ARGS);
    assert.ok(kit.sent.some((s) => s.endpoint === "twitter/tweet/retweeters" && String(s.params.url).includes("/1001")));
    const promo = run.items.find((i) => i.row.id === "1003")!;
    assert.equal(promo.flag?.flag, "likely_boosted");
    assert.equal(promo.viral, false, "a likely boosted post is never called a break-out");
    const quotes = run.quotes.find((q) => q.postId === "1001")!;
    assert.equal(quotes.found, 2);
    for (const s of kit.sent.filter((x) => String(x.params.query ?? "").startsWith("quoted_tweet_id:"))) assert.equal(s.params.judgments, "off");
  });

  it("labels the replies of the top break-outs explicitly", async () => {
    const { kit, session } = fakeSession(world(), 60);
    const run = await runX(session, ARGS);
    for (const s of kit.sent.filter((x) => x.endpoint === "twitter/tweet/replies")) assert.equal(s.params.label, "sentiment,question,purchase_intent,complaint");
    assert.ok(run.asks.classes.question.count >= 1);
  });
});

describe("x-marketing: who carried a post, without its author", () => {
  it("never names a post's own author among its retweeters or quoters", async () => {
    const self = world().map((r) =>
      r.endpoint === "twitter/tweet/retweeters" && !r.when
        ? { ...r, data: { items: [{ author: { username: "bigdev", followers: 80_000 } }, retweeter(25_000)] } }
        : String(r.when ?? "").length && r.endpoint === "twitter/search/tweets" && r.when?.({ query: "quoted_tweet_id:1001" }, undefined)
          ? { ...r, data: { items: [tw({ id: "q9", author: "bigdev", followers: 80_000, views: 900, at: "2026-11-20T14:00:00Z" })] } }
          : r,
    );
    const { session } = fakeSession(self, 60);
    const run = await runX(session, ARGS);
    const a = run.amplifiers.find((x) => x.postId === "1001")!;
    assert.ok(!a.bigAccounts.some((x) => x.handle === "bigdev"));
    const q = run.quotes.find((x) => x.postId === "1001")!;
    assert.ok(!q.bigQuoters.some((x) => x.handle === "bigdev"));
  });

  it("says '1 complaint', not '1 complaints'", async () => {
    const complaint = { comment: { id: "c", post_id: "x", text: "it broke", author: { username: "uc" }, engagement: { likes: 1 } }, computed: { labels: { question: { p: 0 }, purchase_intent: { p: 0 }, complaint: { p: 0.9 }, sentiment: { level: 2 } } } };
    const one: Route[] = [{ endpoint: "twitter/tweet/replies", when: (p) => String(p.url).includes("/1001"), data: { items: [reply("1", "Which model?", 0.9), complaint], labels: { status: "complete", labelled: 2 } } }, ...world()];
    const { session } = fakeSession(one, 60);
    const out = await workflow.run(session, ARGS);
    assert.ok(out.report.summary.some((l) => / 1 complaint in /.test(l)), JSON.stringify(out.report.summary));
  });
});

describe("x-marketing: the trait line", () => {
  it("names a trait only when break-outs have it more often than the rest, and says how often the rest do", async () => {
    const { session } = fakeSession(world(), 60);
    const out = await workflow.run(session, ARGS);
    // In the world every post is a video under 100 characters: no trait sets the break-outs apart.
    assert.ok(!out.report.summary.some((l) => /share format `video`|share length/.test(l)), JSON.stringify(out.report.summary));
    for (const l of out.report.summary.filter((s) => / break-outs share /.test(s))) assert.match(l, /, against \d+ of \d+ of the other posts measured/);
  });
});

describe("x-marketing: the report, when the budget runs short", () => {
  it("says in words why a candidate had no baseline", async () => {
    const { session } = fakeSession(world(), 9);
    const md = renderReport((await workflow.run(session, ARGS)).report);
    assert.match(md, /with no baseline: the stage's share of the budget ran out|with no baseline: past the 12 authors/);
    assert.doesNotMatch(md, /past the 12 authors[^\n]*--deep/, "--deep reads the same 12 authors, so it is not offered as the check");
    assert.doesNotMatch(md, /more authors/, "--deep does not read more authors");
    assert.doesNotMatch(md, /with no baseline: (budget|planned_not_read|no_id)\b/);
  });

  it("quotes a default run inside its budget", async () => {
    const q = await workflow.quote(ARGS);
    assert.ok(q.max <= workflow.defaultBudget, `max ${q.max}`);
  });
});

describe("x-marketing: the report", () => {
  it("passes the report gate, states the window, names only large accounts, and marks the boosted post", async () => {
    const { session } = fakeSession(world(), 60);
    const out = await workflow.run(session, ARGS);
    const md = renderReport(out.report);
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), { requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS });
    assert.deepEqual(v.problems, []);
    assert.match(md.split("\n")[2], /^X · 29\/10\/2026 to 27\/11\/2026 · /);
    assert.match(md, /@bigdev/);
    assert.doesNotMatch(md + renderCard(out.card), /smalldev|@r120|@q2\b/);
    assert.match(md, /likely boosted \(inferred\)/);
    for (const line of md.split("\n").filter((l) => /@\w/.test(l))) assert.doesNotMatch(line, /\bpaid\b|\bbots?\b|\bbought\b/i, line);
    assert.doesNotMatch(md, /\b1 posts\b|first: unknown/);
    assert.match(md, /about two thirds/, "quote coverage is stated");
    assert.match(out.card.headlines[0], /, of \d+ measured$/, "the card counts break-outs out of the posts measured, as the report does");
    assert.match(md, /not filtered for the topic/, "replies can wander off the keyword, and the report says so");
    assert.match(md, /\| \[open on X\]\(https:\/\/x\.com\/bigdev\/status\/1001\) \|/, "a short link keeps the table readable");
    assert.match(md, /post-tracker https:\/\/x\.com\/bigdev\/status\/1001`/, "the command keeps the full URL");
    const carried = md.slice(md.indexOf("## Who carried them"), md.indexOf("## What the break-outs did")).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Post"));
    assert.ok(carried.length >= 1);
    for (const l of carried) assert.match(l.split("|")[1], /\d\d\/\d\d\/\d{4}/, "a post is told apart by its date, since one account can carry two");
  });
});
