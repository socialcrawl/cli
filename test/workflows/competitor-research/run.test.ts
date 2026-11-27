// competitor-research against a fake API: the mention searches per brand and platform, rows cut
// to the window, each brand's most-reached post per platform measured against its author's (or,
// on Reddit, its community's) earlier posts, labelled comments per brand, subscriber counts
// before a YouTube channel is named, and ads counted only when the advertiser is the brand.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderCard, renderReport, validateReport, ENGINE_SECTIONS } from "../../../src/engine/index.ts";
import { matchesAdvertiser, runCompetitors } from "../../../src/workflows/competitor-research/run.ts";
import { REPORT_SECTIONS, workflow } from "../../../src/workflows/competitor-research/index.ts";
import { fakeSession, history, post } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const ARGS = { input: "Acme, Bolt", flags: { about: "project management software" }, deep: false, now: NOW };
const about = (brand: string) => (p: Record<string, unknown>) => String(p.relevant_to ?? "").startsWith(brand);

const xA = post({ id: "xa1", author: "acmehq", followers: 50_000, views: 200_000, at: "2026-11-20T12:00:00Z", text: "Acme 3.0 is here", url: "https://x.com/acmehq/status/xa1" });
const xA2 = post({ id: "xa2", author: "fan1", followers: 900, views: 5_000, at: "2026-11-21T12:00:00Z", text: "loving acme", url: "https://x.com/fan1/status/xa2" });
const xB = post({ id: "xb1", author: "boltapp", followers: 30_000, views: 20_000, at: "2026-11-19T12:00:00Z", text: "Bolt update", url: "https://x.com/boltapp/status/xb1" });
const xOld = post({ id: "xold", author: "acmehq", followers: 50_000, views: 900_000, at: "2026-08-01T12:00:00Z", text: "old Acme post", url: "https://x.com/acmehq/status/xold" });
const ttA = post({ id: "ta1", author: "pmcreator", followers: 4_000, views: 80_000, at: "2026-11-22T12:00:00Z", text: "Acme tips" });
const ytB = { post: { id: "YTbolt00001", url: "https://www.youtube.com/watch?v=YTbolt00001", content: { text: "Bolt review", duration_seconds: 600 }, author: { username: "@toolreviews" }, engagement: { views: 60_000, likes: 900, comments: 40 }, published_at: "2026-11-18T12:00:00Z", ext: { content_type: "video", channel_id: "UCbolt" } } };
const rdA = { post: { id: "rd1", url: "https://www.reddit.com/r/projectmanagement/comments/rd1/x/", content: { text: "Switched from Bolt to Acme" }, author: { username: "someone" }, engagement: { likes: 450, comments: 80 }, published_at: "2026-11-15T12:00:00Z", ext: { subreddit: "projectmanagement" } } };
const comment = (id: string, text: string, labels: Record<string, number>) => ({ comment: { id, post_id: "p", text, author: { username: `c${id}` }, engagement: { likes: 3 } }, computed: { labels: { question: { p: labels.q ?? 0 }, purchase_intent: { p: 0 }, complaint: { p: labels.c ?? 0 }, sentiment: { level: 3 } } } });

function world(): Route[] {
  return [
    { endpoint: "twitter/search/tweets", when: (p) => String(p.query).startsWith("from:acmehq"), data: { items: history("acmehq", 20, 10_000, "2026-11-20T00:00:00Z", { followers: 50_000 }) } },
    { endpoint: "twitter/search/tweets", when: (p) => String(p.query).startsWith("from:boltapp"), data: { items: history("boltapp", 20, 10_000, "2026-11-19T00:00:00Z", { followers: 30_000 }) } },
    { endpoint: "twitter/search/tweets", when: about("Acme"), data: { items: [xA, xA2, xOld], relevance: { mode: "filter", rows: 20, kept: 3, dropped: 17 } } },
    { endpoint: "twitter/search/tweets", when: about("Bolt"), data: { items: [xB], relevance: { mode: "filter", rows: 20, kept: 1, dropped: 19 } } },
    { endpoint: "tiktok/search", when: about("Acme"), data: { items: [ttA] } },
    { endpoint: "tiktok/search", when: about("Bolt"), data: { items: [] } },
    { endpoint: "tiktok/profile/videos", when: (p) => p.handle === "pmcreator", data: { items: history("pmcreator", 12, 2_000, "2026-11-22T00:00:00Z") } },
    { endpoint: "youtube/search", when: about("Acme"), data: { items: [] } },
    { endpoint: "youtube/search", when: about("Bolt"), data: { items: [ytB] } },
    { endpoint: "youtube/channels", data: { items: [{ author: { id: "UCbolt", username: "@toolreviews", followers: 120_000 } }] } },
    { endpoint: "youtube/channel/videos", when: (p) => p.channelId === "UCbolt", data: { items: Array.from({ length: 12 }, (_, i) => ({ post: { id: `ytb${i}`, url: `https://www.youtube.com/watch?v=ytb${i}`, content: { text: "", duration_seconds: 500 }, author: { username: "@toolreviews" }, engagement: { views: 20_000 }, published_at: new Date(Date.parse("2026-11-17T00:00:00Z") - i * 86_400_000).toISOString(), ext: { content_type: "video", channel_id: "UCbolt" } } })) } },
    { endpoint: "reddit/search", when: about("Acme"), data: { items: [rdA] } },
    { endpoint: "reddit/search", when: about("Bolt"), data: { items: [] } },
    { endpoint: "reddit/subreddit", data: { items: Array.from({ length: 12 }, (_, i) => ({ post: { id: `s${i}`, url: null, content: { text: "" }, author: { username: `m${i}` }, engagement: { likes: 50 }, published_at: new Date(Date.parse("2026-11-14T00:00:00Z") - i * 86_400_000).toISOString(), ext: { subreddit: "projectmanagement" } } })) } },
    { endpoint: "twitter/tweet/replies", data: { items: [comment("1", "Does Acme work offline?", { q: 0.9 }), comment("2", "Acme keeps crashing", { c: 0.8 })], labels: { status: "complete", labelled: 2 } } },
    { endpoint: "youtube/video/comments", data: { items: [comment("3", "Is Bolt free?", { q: 0.95 })], labels: { status: "complete", labelled: 1 } } },
    { endpoint: "tiktok/post/comments", data: { items: [comment("4", "how do I export?", { q: 0.7 })], labels: { status: "complete", labelled: 1 } } },
    { endpoint: "reddit/post/comments", data: { items: [comment("5", "Bolt pricing is too high", { c: 0.9 })], labels: { status: "complete", labelled: 1 } } },
  ];
}

describe("competitor-research: the run", () => {
  it("searches every brand on every default platform with the brand's own filter sentence, inside the budget", async () => {
    const { kit, session } = fakeSession(world(), 100);
    await runCompetitors(session, ARGS);
    const searches = kit.sent.filter((s) => s.params.relevance === "filter");
    assert.equal(searches.length, 8);
    for (const s of searches) assert.ok(Number(s.params.max_pages) >= 1 && Number(s.params.max_credits) >= 1, s.endpoint);
    assert.ok(session.ledger.credits <= workflow.defaultBudget);
  });

  it("cuts rows to the window and counts the share per platform", async () => {
    const { session } = fakeSession(world(), 100);
    const run = await runCompetitors(session, ARGS);
    const x = run.share.find((p) => p.platform === "x")!;
    assert.deepEqual(x.brands.map((b) => [b.brand, b.posts, b.reach]), [["Acme", 2, 205_000], ["Bolt", 1, 20_000]], "the August post is outside the window");
    assert.equal(run.outsideWindow, 1);
  });

  it("measures each brand's most-reached post per platform against its author's or community's earlier posts", async () => {
    const { session } = fakeSession(world(), 100);
    const run = await runCompetitors(session, ARGS);
    const best = (brand: string, platform: string) => run.best.find((b) => b.brand === brand && b.row.platform === platform);
    assert.equal(best("Acme", "x")?.breakout?.multiple, 20, "200,000 over a median of 10,000");
    assert.equal(best("Acme", "tiktok")?.breakout?.multiple, 40);
    assert.equal(best("Bolt", "youtube")?.breakout?.multiple, 3);
    assert.equal(best("Acme", "reddit")?.breakout?.multiple, 9, "450 over the community's median score of 50");
    assert.equal(best("Bolt", "tiktok"), undefined, "no post, no best post");
  });

  it("labels what each brand's audience asks and complains about", async () => {
    const { kit, session } = fakeSession(world(), 100);
    const run = await runCompetitors(session, ARGS);
    for (const s of kit.sent.filter((x) => /replies|comments/.test(x.endpoint) && x.endpoint !== "reddit/post/comments")) assert.equal(s.params.label, "sentiment,question,purchase_intent,complaint", s.endpoint);
    const acme = run.asks.get("Acme")!;
    assert.ok(acme.classes.question.count >= 1 && acme.classes.complaint.count >= 1);
    assert.ok(run.asks.get("Bolt")!.classes.question.count >= 1);
  });

  it("reads the subscriber count before naming a YouTube channel", async () => {
    const { kit, session } = fakeSession(world(), 100);
    const out = await workflow.run(session, ARGS);
    assert.equal(kit.sent.filter((s) => s.endpoint === "youtube/channels").length, 1);
    const md = renderReport(out.report) + renderCard(out.card);
    assert.match(md, /@toolreviews/);
    assert.doesNotMatch(md, /fan1|someone|pmcreator/, "small accounts and Reddit members are described");
  });
});

describe("competitor-research: ads on --deep", () => {
  it("reads the TikTok ad library per brand and keeps only the brand's own ads", async () => {
    const ad = (id: string, advertiser: string) => ({ post: { id, url: null, content: { text: "ad" }, author: { username: advertiser }, engagement: { views: 1_000 }, published_at: "2026-11-20T00:00:00Z", ext: {} } });
    const routes: Route[] = [
      { endpoint: "tiktok/adlibrary/search", when: (p) => p.advertiser_name === "Acme", data: { items: [ad("a1", "Acme Inc."), ad("a2", "Acme Atlas Ltd")] } },
      { endpoint: "tiktok/adlibrary/search", when: (p) => p.advertiser_name === "Bolt", data: { items: [ad("b1", "someone else")] } },
      { endpoint: "instagram/search/reels", data: { items: [] } },
      ...world(),
    ];
    const { kit, session } = fakeSession(routes, 300);
    const run = await runCompetitors(session, { ...ARGS, deep: true });
    for (const s of kit.sent.filter((x) => x.endpoint === "tiktok/adlibrary/search")) assert.equal(Number(s.params.max_pages), 1);
    assert.deepEqual(run.ads.map((a) => [a.brand, a.own.length, a.others]), [["Acme", 1, 1], ["Bolt", 0, 1]]);
  });
});

describe("competitor-research: ads", () => {
  it("counts an ad only when the advertiser is the brand, legal suffix allowed", () => {
    assert.equal(matchesAdvertiser("Supabase Inc.", "Supabase"), true);
    assert.equal(matchesAdvertiser("NEON ATLAS LTD", "Neon"), false);
    assert.equal(matchesAdvertiser("mapples_org", "Supabase"), false);
    assert.equal(matchesAdvertiser("neon", "Neon"), true);
  });
});

describe("competitor-research: the report", () => {
  it("passes the report gate, states the window, and says share is among the posts read", async () => {
    const { session } = fakeSession(world(), 100);
    const out = await workflow.run(session, ARGS);
    const md = renderReport(out.report);
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), { requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS });
    assert.deepEqual(v.problems, []);
    assert.match(md.split("\n")[2], /29\/10\/2026 to 27\/11\/2026/);
    assert.match(md, /among the posts each search returned/);
    assert.equal(out.card.command, '/competitor-research "Acme, Bolt"');
  });

  it("refuses one brand or six", async () => {
    const { session } = fakeSession(world(), 100);
    await assert.rejects(() => workflow.run(session, { ...ARGS, input: "Acme" }), /two to five brands/);
  });
});
