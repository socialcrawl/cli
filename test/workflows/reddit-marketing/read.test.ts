// reddit-marketing, reading the responses: threads, comments, communities, break-outs and
// the threads worth a disclosed reply. On the recorded "headless CMS" run of 27/11/2026
// (anonymised: every member, post and comment id is an alias).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ResponseRecord } from "../../../src/engine/rows.ts";
import { askSummary, commentsOf, communityOf, opportunities, parseRules, threadBreakouts, threadsOf } from "../../../src/workflows/reddit-marketing/read.ts";
import { fixturePath } from "../../fixture-path.ts";

interface Fixture extends ResponseRecord {
  name: string;
}
const R: Fixture[] = JSON.parse(readFileSync(fixturePath("reddit-marketing", "headless-cms.json"), "utf8"));
const by = (name: string) => {
  const r = R.find((x) => x.name === name);
  if (!r) throw new Error(`no fixture ${name}`);
  return r;
};
const NOW = new Date("2026-11-27T12:00:00Z");
const searches = [by("search-top"), by("search-new")];

describe("threads", () => {
  it("reads both searches once each, the first copy winning, with the intent the API labelled", () => {
    const t = threadsOf(searches);
    assert.equal(t.length, 29, "27 top threads and 2 that only the new search found");
    assert.equal(new Set(t.map((x) => x.row.id)).size, 29);
    const nx = t.find((x) => x.row.id === "t050")!;
    assert.equal(nx.row.community, "nextjs");
    assert.equal(nx.row.likes, 28);
    assert.equal(nx.intent, "asking_for_recommendation");
    assert.equal(nx.title.startsWith("What is the best headless CMS"), true);
    assert.equal(t.filter((x) => x.intent === "asking_for_recommendation").length, 8);
  });
});

describe("comments", () => {
  it("flattens the nested tree and keeps each comment's depth, never its author", () => {
    const c = commentsOf(by("comments-1"));
    assert.equal(c.length, 33, "17 top-level comments and 16 replies");
    assert.equal(c.filter((x) => x.depth === 0).length, 17);
    assert.ok(c.every((x) => !("author" in x)));
    assert.ok(c.every((x) => x.threadId === by("comments-1").body.data.post.id));
  });

  it("counts the replies the API did not label as unlabelled, never as 'no question'", () => {
    const s = askSummary(commentsOf(by("comments-1")));
    assert.equal(s.comments, 33);
    assert.equal(s.labelled, 17);
    assert.equal(s.unlabelled, 16);
  });

  it("counts questions, complaints and buying intent at p 0.5 or more, and sentiment by level", () => {
    const s = askSummary(["comments-1", "comments-2", "comments-3"].flatMap((n) => commentsOf(by(n))));
    assert.equal(s.questions, 11, "2 + 2 + 7, the API's own counts");
    assert.equal(s.positive + s.neutral + s.negative, s.labelled);
    assert.ok(s.quotes.question.length > 0 && s.quotes.question.length <= 3);
    assert.ok(s.quotes.question.every((q) => q.url && q.requestId));
  });
});

describe("communities and their rules", () => {
  it("reads members, weekly activity and the rules that limit promotion", () => {
    const c = communityOf(by("details-webdev"))!;
    assert.equal(c.name, "webdev");
    assert.equal(c.members, 3_334_989);
    assert.equal(c.weeklyActive, 306_201);
    assert.equal(c.rulesStatus, "listed");
    assert.deepEqual(c.promotionRules.map((r) => r.number), [3, 4, 5]);
    assert.equal(c.promotionRules[0].title, "No self-promotion");
  });

  it("says a community's rules were not reported, never that it has none", () => {
    const c = communityOf(by("details-cms"))!;
    assert.equal(c.rulesStatus, "not_reported");
    assert.deepEqual(c.rules, []);
    assert.equal(c.promotionRules.length, 0);
  });

  it("splits numbered rule text into rules", () => {
    const r = parseRules("1 Be kind Treat others well.\n\n2 No spam Do not advertise your product.\n\n10 No memes Memes go elsewhere.");
    assert.deepEqual(r.map((x) => x.number), [1, 2, 10]);
    assert.equal(r[1].title, "No spam");
  });
});

describe("break-outs against the community", () => {
  const threads = threadsOf(searches);
  const pages = new Map(["webdev", "nextjs", "astrojs", "cms"].map((c) => [c, by(`base-${c}`)] as const));
  const b = threadBreakouts(threads, pages, NOW);
  const of = (id: string) => b.find((x) => x.thread.row.id === id)!;

  it("measures a thread against the community's earlier top posts of the month, the thread left out", () => {
    const nx = of("t050");
    assert.equal(nx.breakout!.peers, 21);
    assert.equal(nx.breakout!.base, 10);
    assert.equal(nx.breakout!.multiple, 2.8);
    assert.equal(nx.breakout!.band, "above");
    assert.equal(nx.monthRank, 3, "it is the community's third post of the month");
    assert.equal(of("t029").breakout!.multiple, 2);
  });

  it("gives no number under 8 earlier posts", () => {
    assert.equal(of("t096").breakout!.band, "too_few");
    assert.equal(of("t096").breakout!.multiple, null);
  });

  it("marks a thread whose community was not read, and does not guess", () => {
    const jobs = b.filter((x) => x.thread.row.community === "jobboardsearch");
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((x) => x.breakout === null && x.reason === "community_not_read"));
  });
});

describe("where a disclosed reply would help", () => {
  const threads = threadsOf(searches);
  const communities = new Map(["webdev", "nextjs", "astrojs", "cms"].map((c) => [c, communityOf(by(`details-${c}`))!] as const));
  const o = opportunities(threads, communities, NOW);

  it("lists recent threads asking for a recommendation, never promotional ones", () => {
    assert.ok(o.length > 0);
    assert.ok(o.every((x) => x.thread.intent !== "promoting"));
    assert.ok(o.some((x) => x.thread.row.id === "t050"));
    for (const x of o) assert.ok(NOW.getTime() - Date.parse(x.thread.row.publishedAt!) <= 30 * 86_400_000, x.thread.row.id);
  });

  it("puts the community's promotion rule beside each thread, or says the rules were not read", () => {
    const nx = o.find((x) => x.thread.row.id === "t050")!;
    assert.match(nx.rule, /^r\/nextjs rule 4: No posts shilling your product/);
    const elsewhere = o.find((x) => !communities.has(x.thread.row.community!));
    if (elsewhere) assert.match(elsewhere.rule, /rules not read/);
  });

  it("ranks the fewest replies first among threads of the same week, so an answer is still seen", () => {
    for (let i = 1; i < o.length; i++) assert.ok(o[i - 1].score >= o[i].score);
  });
});
