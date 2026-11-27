// REA-Socials unit tests: the coding, the outlier maths, launch clustering and
// the report, on recorded API responses. No key, no network, no credits.
// Run: node --test "examples/open-source/rea-socials/test/*.test.ts" (Node 22.18 or later).
//
// The fixture is the @reatools profile and timeline as the API returned them on
// 26/11/2026, trimmed to the fields the tool reads. Its replies and retweeters
// records are real responses re-labelled onto @reatools post ids so that the
// joins can be tested; their counts are not @reatools' own.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fixturePath } from "../../fixture-path.ts";

import { analyseX, clusterLaunches, depthSet } from "../../../src/workflows/social-teardown/x/analyse.ts";
import { artefactOf, codePosts, ctaOf, hookOf, median, outlierX, repoOf, toCsv, toXPost } from "../../../src/workflows/social-teardown/x/codebook.ts";
import type { CodedPost, XPost } from "../../../src/workflows/social-teardown/x/codebook.ts";
import { missingRoots, monthWindows, postsFromRecords, shortName } from "../../../src/workflows/social-teardown/x/x.ts";
import type { TaggedRecord as CallRecord } from "../../../src/workflows/social-teardown/tracker.ts";


const records: CallRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "reatools-records.json"), "utf8"));

function post(over: Partial<XPost>): XPost {
  return {
    id: "1", url: "https://x.com/a/status/1", createdUtc: "2026-10-01T11:00:00.000Z", text: "", author: "acme",
    authorFollowers: 1000, views: 100, likes: 10, reposts: 1, replies: 1, quotes: 0, bookmarks: 5, mediaTypes: [],
    videoSeconds: null, inReplyToUser: null, inReplyToId: null, conversationId: null, retweetOf: null, articleUrl: null,
    requestId: "req-test", ...over,
  };
}

describe("hooks, artefacts and calls to action", () => {
  it("reads the launch first lines", () => {
    assert.equal(hookOf("Introducing /REA-marketing skill.\nReverse-engineer any brand"), "introducing");
    assert.equal(hookOf("rea v6.8 is now live"), "just_shipped");
    assert.equal(hookOf("I built a CLI that reads every reply"), "i_built");
    assert.equal(hookOf("We just crossed 10k stars"), "milestone");
    assert.equal(hookOf("what will you build?"), "question");
    assert.equal(hookOf("Everything is binary"), "other");
  });
  it("names the artefact from a repository link or a /slug skill", () => {
    assert.deepEqual(artefactOf("Here's the skill: https://github.com/morluto/rea", ["https://github.com/morluto/rea"]), { artefact: "agent_skill", name: "morluto/rea" });
    assert.deepEqual(artefactOf("Introducing /rea-brand skill. Try it at treg.to/rea-brand", []), { artefact: "agent_skill", name: "/rea-brand" });
    assert.equal(artefactOf("open source repo https://github.com/a/b", ["https://github.com/a/b"]).artefact, "oss_repo");
    assert.equal(artefactOf("nice day", []).artefact, "none");
  });
  it("sees gated give-aways and the link-below pattern", () => {
    assert.equal(ctaOf("Comment SKILL and I'll send it to you", []), "comment_to_get");
    assert.equal(ctaOf("Repo link below 👇", []), "link_below");
    assert.equal(ctaOf("Try it at https://treg.to/x", ["https://treg.to/x"]), "try_url");
  });
});

describe("kinds", () => {
  it("tells retweets, self-reply links, thread parts and replies apart", () => {
    const rows = codePosts([
      post({ id: "10", text: "Introducing the toolkit. A long first post that opens a thread about what we built and why it matters to everyone who ships." }),
      post({ id: "11", text: "https://github.com/acme/toolkit", inReplyToUser: "acme", conversationId: "10", createdUtc: "2026-10-01T11:00:01.000Z" }),
      post({ id: "12", text: "Second part of the thread, which explains in words and at length how the toolkit reads every post, codes it and ranks it.", inReplyToUser: "acme", conversationId: "10", createdUtc: "2026-10-01T11:01:00.000Z" }),
      post({ id: "13", text: "@someone thanks!", inReplyToUser: "someone" }),
      post({ id: "14", text: "RT @x: hi", retweetOf: { id: "9", author: "x", text: "hi" } }),
      post({ id: "15", author: "other", text: "not ours" }),
    ], "acme");
    const kind = Object.fromEntries(rows.map((r) => [r.post_id, r.kind]));
    assert.deepEqual(kind, { "10": "thread_head", "11": "self_reply_link", "12": "thread_part", "13": "reply_other", "14": "retweet" });
  });
  it("reads a search row with in_reply_to_id but no username as the reply it is", () => {
    const rows = codePosts([
      post({ id: "20", text: "Launch post with words enough to be an original" }),
      post({ id: "21", text: "Try it here for free : https://acme.ai", inReplyToId: "20", conversationId: "20" }),
      post({ id: "22", text: "@someone Here is the team : https://github.com/acme/kit", inReplyToId: "999", conversationId: "998" }),
      // Under the account's own post, answering someone whose reply we never read: the leading @ wins,
      // so the conversation root (the account itself) is not taken as the parent.
      post({ id: "23", text: "@pal 🫶", inReplyToId: "777", conversationId: "20" }),
      // The parent is a known post of the account's own: the parent's author decides.
      post({ id: "24", text: "@pal and one more thing about how the launch post works, in a long enough reply to count as a thread part", inReplyToId: "20", conversationId: "20" }),
    ], "acme");
    const kind = Object.fromEntries(rows.map((r) => [r.post_id, r.kind]));
    assert.deepEqual(kind, { "20": "thread_head", "21": "self_reply_link", "22": "reply_other", "23": "reply_other", "24": "thread_part" });
  });
  it("flags text-only originals as possible unseen quotes, and never codes a quote it cannot see", () => {
    const [r] = codePosts([post({ text: "this is incredible!" })], "acme");
    assert.equal(r.kind, "original");
    assert.equal(r.quote_unseen, true);
    const [v] = codePosts([post({ text: "watch", mediaTypes: ["video"], videoSeconds: 43 })], "acme");
    assert.equal(v.quote_unseen, false);
    assert.equal(v.format, "video");
    assert.equal(v.video_seconds, 43);
  });
});

describe("launches", () => {
  const at = (d: string) => `2026-${d}T11:00:00.000Z`;
  const rows = codePosts([
    post({ id: "100", createdUtc: at("10-01"), text: "Introducing /people-search skill. Try it at https://treg.to/people-search", views: 9000 }),
    post({ id: "101", createdUtc: "2026-10-01T11:00:01.000Z", text: "Repo link below https://github.com/acme/kit", inReplyToUser: "acme", conversationId: "100", views: 300 }),
    post({ id: "102", createdUtc: at("10-20"), text: "Introducing people-search 2.0. Try it at https://treg.to/people-search", views: 20000 }),
    post({ id: "103", createdUtc: at("10-05"), text: "Today, we’re launching Waze for sales.", mediaTypes: ["video"], videoSeconds: 40, views: 50000 }),
    post({ id: "104", createdUtc: at("10-06"), text: "Book a call https://calendly.com/acme/demo?utm_source=x", views: 30 }),
  ], "acme");
  const launches = clusterLaunches(rows, "acme");
  it("merges a relaunch, joins the link reply, names a link-free product launch and skips a booking link", () => {
    assert.equal(launches.length, 2);
    const ps = launches.find((l) => l.artefactName.toLowerCase().includes("people-search"))!;
    assert.equal(ps.mainPost, "102");
    assert.ok(ps.posts.includes("101"), "the repo-link self-reply joins the launch");
    assert.deepEqual(ps.announceDays, ["2026-10-01", "2026-10-20"]);
    const waze = launches.find((l) => l.artefactName === "Waze for sales")!;
    assert.equal(waze.artefact, "paid_product");
    assert.equal(waze.videoSeconds, 40);
    assert.ok(!launches.some((l) => l.artefactName.includes("calendly")));
  });
});

describe("gates, repeat quoters, recycled templates and the team", () => {
  const t0 = "2026-11-01T11:00:00.000Z";
  const mins = (m: number) => new Date(Date.parse(t0) + m * 60000).toISOString();
  const posts = [
    post({ id: "500", createdUtc: t0, text: "Free lead list. Comment 'bot' and I'll send it", views: 90000 }),
    post({ id: "501", createdUtc: "2026-11-02T11:00:00.000Z", text: "I'm 30. I built an AI startup called Acme to $3M ARR. Here is how", views: 1000 }),
    post({ id: "502", createdUtc: "2026-11-05T11:00:00.000Z", text: "I'm 30. I built an AI startup called Acme to $5M ARR. Here is how", views: 1200 }),
    post({ id: "503", createdUtc: "2026-11-06T11:00:00.000Z", text: "RT @founder: we shipped", retweetOf: { id: "9", author: "founder", text: "we shipped" } }),
    post({ id: "504", createdUtc: "2026-11-07T11:00:00.000Z", text: "RT @founder: more", retweetOf: { id: "8", author: "founder", text: "more" } }),
    post({ id: "505", createdUtc: "2026-11-08T11:00:00.000Z", text: "RT @founder: again", retweetOf: { id: "7", author: "founder", text: "again" } }),
  ];
  const timeline: CallRecord = { seq: 1, stage: "timeline", meta: {}, endpoint: "twitter/user/tweets", params: {}, status: 200, requestId: "req-tl", walkRequestIds: [], creditsUsed: 1, at: t0, body: { success: true, data: { items: [] } } };
  const replies: CallRecord = {
    ...timeline, seq: 2, stage: "replies", meta: { post_id: "500" }, requestId: "req-rp",
    body: { success: true, data: { items: [
      ...Array.from({ length: 8 }, (_, i) => ({ comment: { text: "@acme bot", author: { username: `u${i}` } } })),
      { comment: { text: "@acme how much is it?", author: { username: "q1" } } },
      { comment: { text: "@acme looks great, will try it this week", author: { username: "q2" } } },
      { comment: { text: "@u0 sent! https://acme.io/list", author: { username: "acme" } } },
    ] } },
  };
  const quoteRows = (ids: string[], m: number) => ids.map((h) => ({ post: { author: { username: h }, published_at: mins(m), engagement: { views: 1000 }, ext: { author_followers: 40000 } } }));
  const quotes1: CallRecord = { ...timeline, seq: 3, stage: "quotes", meta: { post_id: "500" }, requestId: "req-q1", body: { success: true, data: { items: quoteRows(["bigpal", "pal2"], 5) } } };
  const quotes2: CallRecord = { ...timeline, seq: 4, stage: "quotes", meta: { post_id: "502" }, requestId: "req-q2", body: { success: true, data: { items: quoteRows(["bigpal"], -5000) } } };
  const coded = codePosts(posts, "acme");
  const a = analyseX([timeline, replies, quotes1, quotes2], coded, "acme");
  it("does not take replies that only tag accounts for a gate word", () => {
    const tags: CallRecord = { ...replies, requestId: "req-tags", body: { success: true, data: { items: Array.from({ length: 12 }, (_, i) => ({ comment: { text: i % 2 ? "@acme @founder" : "@acme @founder 🔥", author: { username: `t${i}` } } })) } } };
    const b = analyseX([timeline, tags], codePosts(posts, "acme"), "acme");
    assert.equal(b.replies[0].gate, null);
  });
  it("finds the comment-a-word gate from the replies and marks the post gated", () => {
    assert.deepEqual(a.replies[0].gate, { word: "bot", share: 0.8 });
    assert.equal(coded.find((c) => c.post_id === "500")!.gated, "yes");
  });
  it("counts early quotes and the repeat quoters", () => {
    const q = a.quotes.find((x) => x.postId === "500")!;
    assert.equal(q.within3h, 2);
    assert.equal(q.firstMinutes, 5);
    assert.deepEqual(a.repeatQuoters.map((r) => r.handle), ["bigpal"]);
  });
  it("sees a template recycled with the number changed, and the account it retweets most", () => {
    assert.equal(a.recycled.length, 1);
    assert.deepEqual(a.recycled[0].posts.sort(), ["501", "502"]);
    assert.deepEqual(a.teamCandidates, [{ handle: "founder", retweets: 3 }]);
  });
});

describe("posts the search left out", () => {
  const replies = ["a", "b", "c", "d", "e", "f"].map((h, i) =>
    post({ id: `7${i}`, text: `@${h} Here is the team : https://github.com/acme/kit`, inReplyToId: `6${i}`, conversationId: "600" }),
  );
  it("names a conversation root the account replied under 3 or more times but no read returned", () => {
    assert.deepEqual(missingRoots(replies, "@acme"), ["600"]);
    assert.deepEqual(missingRoots([...replies, post({ id: "600", text: "the root" })], "acme"), []);
  });
  it("marks the root gated when the account sends the same link 5 or more times under it", () => {
    const coded = codePosts([...replies, post({ id: "600", text: "We open-sourced our outbound team", views: 38000 })], "acme");
    const timeline: CallRecord = { seq: 1, stage: "timeline", meta: {}, endpoint: "twitter/user/tweets", params: {}, status: 200, requestId: "req-tl", walkRequestIds: [], creditsUsed: 1, at: "", body: { success: true, data: { items: [] } } };
    const a = analyseX([timeline], coded, "acme");
    assert.equal(coded.find((c) => c.post_id === "600")!.gated, "yes");
    assert.ok(a.ledger.items.some((e) => /replied 6 times with the same link/.test(e.claim)));
  });
});

describe("outlier maths", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 86_400_000).toISOString();
  it("is views over the median of the previous 20 comparable originals, blank under 8", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      post_id: String(i), account: "acme", kind: "original", format: "text", created_utc: day(i), views: i === 24 ? 5000 : 100 + i,
    })) as unknown as CodedPost[];
    const ox = outlierX(rows);
    assert.equal(ox.has("7"), false);
    assert.equal(ox.get("8"), Math.round((108 / median([100, 101, 102, 103, 104, 105, 106, 107])!) * 100) / 100);
    const prev20 = Array.from({ length: 20 }, (_, i) => 104 + i);
    assert.equal(ox.get("24"), Math.round((5000 / median(prev20)!) * 100) / 100);
    assert.equal(ox.has("29"), true);
  });
  it("leaves replies and retweets out of the baseline, and compares videos only with videos", () => {
    const base = Array.from({ length: 12 }, (_, i) => ({ post_id: `o${i}`, account: "acme", kind: "original", format: "text", created_utc: day(i), views: 100 }));
    const videos = Array.from({ length: 9 }, (_, i) => ({ post_id: `v${i}`, account: "acme", kind: "original", format: "video", created_utc: day(i), views: 10_000 }));
    const noise = [{ post_id: "r", account: "acme", kind: "reply_other", format: "text", created_utc: day(5), views: 1_000_000 }];
    const late = { post_id: "late", account: "acme", kind: "original", format: "text", created_utc: day(20), views: 100 };
    const ox = outlierX([...base, ...videos, ...noise, late] as unknown as CodedPost[]);
    assert.equal(ox.get("o11"), 1);
    assert.equal(ox.has("r"), false);
    assert.equal(ox.get("v8"), 1);
  });
});

describe("on the recorded @reatools timeline", () => {
  const coded = codePosts(postsFromRecords(records), "reatools");
  it("codes every post of the account", () => {
    assert.equal(coded.length, 69);
    assert.ok(coded.every((c) => c.account === "reatools" && c.request_no.startsWith("req-")));
    const top = coded.slice().sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
    assert.equal(top.post_id, "2112574822584918075");
    assert.equal(top.format, "video");
    assert.ok(coded.some((c) => c.kind === "self_reply_link"));
  });
  it("gives the RL-environments video no ratio (3 earlier videos, 8 needed), the text posts theirs, and writes a CSV row per post", () => {
    const top = coded.find((c) => c.post_id === "2112574822584918075")!;
    assert.equal(top.format, "video");
    assert.equal(top.outlier_x, null);
    assert.equal(coded.find((c) => c.post_id === "2120966934623867366")!.outlier_x, 2.4);
    const csv = toCsv(coded, "2026-11-26T03:00:00Z");
    assert.equal(csv.trim().split("\n").length, 70);
    assert.ok(csv.split("\n")[0].startsWith("account,post_id,url,created_utc"));
  });
  it("finds no launch where the account announces nothing, and still picks its top posts for depth", () => {
    // @reatools links its site and a topic page but never posts "Introducing ..." or a repository.
    const launches = clusterLaunches(coded, "reatools");
    assert.equal(launches.length, 0);
    const ids = depthSet(coded, launches, 3);
    assert.ok(ids.includes("2112574822584918075"));
  });
  it("builds an evidence ledger in which every observation cites a request id", () => {
    const a = analyseX(records, coded, "reatools");
    const obs = a.ledger.items.filter((e) => e.type === "observed");
    assert.ok(obs.length >= 4);
    assert.ok(obs.every((e) => e.requests.length > 0 && e.requests.every((r) => r.startsWith("req-"))));
    assert.ok(a.ledger.items.some((e) => e.type === "unknown" && /quote/.test(e.claim)));
    assert.equal(a.transcripts[0].text?.startsWith("Introducing REA"), true);
    assert.ok(a.repeatAmplifiers.length >= 1);
  });
});

describe("helpers", () => {
  it("walks month windows newest first, ending tomorrow", () => {
    const w = monthWindows(new Date("2026-09-15T00:00:00Z"), new Date("2026-11-26T10:00:00Z"));
    assert.deepEqual(w, [
      { since: "2026-11-01", until: "2026-11-27" },
      { since: "2026-10-01", until: "2026-11-01" },
      { since: "2026-09-15", until: "2026-10-01" },
    ]);
  });
  it("shortens launch names for a Reddit search", () => {
    assert.equal(shortName("superdesigndev/treg"), "treg");
    assert.equal(shortName("treg.to/rea-marketing"), "rea-marketing");
    assert.equal(shortName("/rea-brand"), "rea-brand");
  });
  it("takes a GitHub repository from a link, and not a topic or organisation page", () => {
    assert.equal(repoOf("https://github.com/superdesigndev/treg"), "superdesigndev/treg");
    assert.equal(repoOf("https://github.com/a/b.git"), "a/b");
    assert.equal(repoOf("https://github.com/topics/rea"), "");
    assert.equal(repoOf("https://github.com/orgs/acme"), "");
  });
  it("writes one CSV line per post whatever newlines the text holds", () => {
    const rows = codePosts([post({ id: "30", text: "a\rb\u2028c\r\nd, \"e\"" })], "acme");
    const lines = toCsv(rows, "2026-11-26T00:00:00Z").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /"a\\nb\\nc\\nd, ""e"""/);
  });
  it("reads an API row", () => {
    const p = toXPost({ id: 5, url: "u", published_at: "2026-10-01T00:00:00Z", content: { text: "t" }, author: { username: "a" }, engagement: { views: 9, shares: 2, saves: 3 }, ext: { quote_count: 1, media: [{ type: "video" }] } }, "req-x");
    assert.equal(p.id, "5");
    assert.equal(p.reposts, 2);
    assert.equal(p.bookmarks, 3);
    assert.deepEqual(p.mediaTypes, ["video"]);
  });
});
