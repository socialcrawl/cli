// What the live @treg_ai run taught: X search reads newest first, so a read that stops on its
// page cap holds the end of its window, not the start. The report must say where a read
// stopped and never count "within 30 minutes" from a read that did not reach minute 0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { breakouts } from "../../../src/engine/breakout.ts";
import { renderReport } from "../../../src/engine/outputs.ts";
import type { Row } from "../../../src/engine/rows.ts";
import { analyseAccount } from "../../../src/workflows/social-teardown/analyse.ts";
import { ADAPTERS } from "../../../src/workflows/social-teardown/platforms.ts";
import { buildResult, singular, traitWords } from "../../../src/workflows/social-teardown/report.ts";
import { parseTarget } from "../../../src/workflows/social-teardown/targets.ts";
import type { TaggedRecord } from "../../../src/workflows/social-teardown/tracker.ts";
import { analyseXAccount } from "../../../src/workflows/social-teardown/x-account.ts";
import { fixturePath } from "../../fixture-path.ts";

const NOW = new Date("2026-11-27T00:00:00Z");
const meta = { skill: "social-teardown", version: "0.1.0", credits: 80, calls: 30, seconds: 100, date: "27/11/2026", generated_at: NOW.toISOString() };
const base: TaggedRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "reatools-records.json"), "utf8")).map((r: TaggedRecord) => ({ ...r, meta: { ...r.meta, account: "x:reatools" } }));
const POST = "2108805784276738550";

function read(stage: "squad" | "quotes", minutes: number[], stopped: string, t0: number, seq: number): TaggedRecord {
  const items = minutes.map((m, i) => ({ post: { id: `${seq}${i}`, author: { username: `acct${seq}_${i}` }, published_at: new Date(t0 + m * 60_000).toISOString(), content: { text: "@reatools nice" }, engagement: { views: 100 }, ext: { author_followers: 2000 } } }));
  return { seq, stage, endpoint: "twitter/search/tweets", params: {}, status: 200, requestId: `req-${stage}${seq}`, walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "x:reatools", post_id: POST, launch: "rea", window: "3h" }, body: { success: true, request_id: `req-${stage}${seq}`, data: { items, walk: { pages: 1, stopped } }, pagination: { has_more: stopped !== "end" } } };
}

function report(extra: (t0: number) => TaggedRecord[]) {
  const first = analyseXAccount(base, "reatools", NOW);
  const t0 = Date.parse(first.coded.find((c) => c.post_id === POST)!.created_utc);
  const recs = [...base, ...extra(t0)];
  const xa = analyseXAccount(recs, "reatools", NOW);
  const b = buildResult({ command: "/social-teardown @reatools", inputs: ["@reatools"], accounts: [xa.account], x: [xa], records: recs, limits: [], errors: [], meta, deep: false, now: NOW });
  return renderReport(b.result.report);
}

describe("reads that stopped before the start of their window", () => {
  it("do not count quotes in the first minutes, and say where the read reached", () => {
    const md = report((t0) => [read("quotes", [120, 100, 80, 61], "max_credits", t0, 1)]);
    assert.doesNotMatch(md, /the first after 61 minutes/);
    assert.match(md, /not read|did not reach/);
  });

  it("do not count accounts within 30 minutes of a launch from a read that began at minute 100", () => {
    const md = report((t0) => [read("squad", [118, 110, 100], "max_credits", t0, 2)]);
    assert.doesNotMatch(md, /0 other accounts posted about it within 30 minutes/);
    assert.match(md, /reached back to 100 minutes/);
  });

  it("say one minute in the singular", () => {
    const md = report((t0) => [read("squad", [30, 1], "max_credits", t0, 4)]);
    assert.match(md, /the first minute was not read/);
  });

  it("describe repeat accounts by the windows read, not by a fixed 2 hours", () => {
    const md = report((t0) => [read("squad", [10, 5], "end", t0, 5), { ...read("squad", [12, 6], "end", t0, 6), meta: { account: "x:reatools", post_id: POST, launch: "rea2", minutes: "60" } }]);
    assert.doesNotMatch(md, /within 2 hours of two or more/);
  });

  it("keep the counts of a read that reached the start of its window", () => {
    const md = report((t0) => [read("squad", [90, 20, 5, -10], "end", t0, 3)]);
    assert.match(md, /2 other accounts posted about it within 30 minutes/);
  });
});

function row(i: number, over: Partial<Row> = {}): Row {
  return {
    platform: "tiktok", id: String(i), url: `https://www.tiktok.com/@brand/video/${i}`, author: "brand", authorFollowers: null, authorUrl: null, channelId: null, community: null,
    text: "post", publishedAt: new Date(Date.UTC(2026, 5, 1 + i, i % 2 ? 9 : 19)).toISOString(), views: 1000 + i, likes: 10, comments: 1, shares: 0, saves: 0,
    durationSeconds: i % 4 === 0 ? 70 : null, video: i % 4 === 0, pinned: false, kind: "original", requestId: `req-${i}`, ...over,
  };
}

describe("plain findings", () => {
  const rows = [...Array(40)].map((_, i) => row(i, { views: i % 4 === 0 ? 50_000 + i : 1000 + i }));
  const profile: TaggedRecord = { seq: 1, stage: "profile", endpoint: "tiktok/profile", params: {}, status: 200, requestId: "req-p", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "tiktok:brand" }, body: { success: true, request_id: "req-p", data: { author: { username: "brand", followers: 52_000 } } } };
  const a = analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [profile], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
  const md = renderReport(buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [a], x: [], records: [profile], limits: [], errors: [{ stage: "words", endpoint: "tiktok/post/transcript", status: 404, message: "No transcript is available. Either its video has no speech, or the post has no video. Retrying will return the same result.", requestId: "req-e" }], meta, deep: false, now: NOW }).result.report);

  it("says how much of the reach the videos carry when videos and other posts both exist", () => {
    assert.match(md, /10 videos carry \d+% of the views/);
  });

  it("calls no trait with less than 15 points between the top third and the bottom third", () => {
    for (const m of md.matchAll(/\((\d+)% against (\d+)%\)/g)) assert.ok(Number(m[1]) - Number(m[2]) >= 15, m[0]);
  });

  it("never leads the card with a weekday or an hour", () => {
    const res = buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [a], x: [], records: [profile], limits: [], errors: [], meta, deep: false, now: NOW }).result;
    for (const h of res.card.headlines) assert.doesNotMatch(h, /weekday|hour band/);
  });

  it("points video-teardown at a video that broke out, never at a text post", () => {
    const rows = [...Array(30)].map((_, i) => row(i, { video: i === 20, durationSeconds: i === 20 ? 40 : null, views: i === 25 ? 90_000 : i === 20 ? 30_000 : 1000 + i }));
    const b = analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [profile], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    const plays = renderReport(buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [b], x: [], records: [profile], limits: [], errors: [], meta, deep: false, now: NOW }).result.report).split("## Next plays")[1];
    assert.doesNotMatch(plays, /video-teardown https:\/\/www\.tiktok\.com\/@brand\/video\/25\b/);
    // The one video has no earlier videos to compare with, so no video broke out: no play.
    assert.doesNotMatch(plays, /video-teardown/);
  });

  it("never suggests a weekday or an hour as a play", () => {
    const plays = md.split("## Next plays")[1].split("## ")[0];
    assert.doesNotMatch(plays, /weekday|hour band/);
  });

  it("keeps an error to its first sentence", () => {
    assert.match(md, /No transcript is available\./);
    assert.doesNotMatch(md, /Retrying will return the same result/);
  });
});

describe("singulars", () => {
  it("agrees the verb with one", () => {
    assert.equal(singular("1 of them have more"), "1 of them has more");
    assert.equal(singular("3 of them have more"), "3 of them have more");
    assert.equal(singular("2 accounts quoted it; 1 have more than 10,000 followers"), "2 accounts quoted it; 1 has more than 10,000 followers");
  });

  it("says nothing of the videos' share when the other posts carry no view count", () => {
    const photos = [...Array(30)].map((_, i) => row(i, i % 2 ? { video: false, views: null, durationSeconds: null } : { platform: "instagram", views: 5000 + i }));
    const prof: TaggedRecord = { seq: 1, stage: "profile", endpoint: "instagram/profile", params: {}, status: 200, requestId: "req-ip", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "instagram:brand" }, body: { success: true, request_id: "req-ip", data: { author: { username: "brand", followers: 52_000 } } } };
    const ia = analyseAccount({ target: parseTarget("ig:brand"), adapter: ADAPTERS.instagram, records: [prof], own: photos.map((r) => ({ ...r, platform: "instagram" })), others: [], breakouts: breakouts(photos, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    const out = renderReport(buildResult({ command: "/social-teardown ig:brand", inputs: ["ig:brand"], accounts: [ia], x: [], records: [prof], limits: [], errors: [], meta, deep: false, now: NOW }).result.report);
    assert.doesNotMatch(out, /videos carry 100%/);
    assert.doesNotMatch(out, /against unknown/);
  });

  it("flags a break-out whose views run far ahead of its likes, as promoted posts look, and says it is inferred", () => {
    const rows = [...Array(30)].map((_, i) => row(i, { platform: "youtube", video: true, durationSeconds: 60, views: i === 28 ? 19_000_000 : 3000 + i, likes: i === 28 ? 900 : 60 }));
    const prof: TaggedRecord = { seq: 1, stage: "profile", endpoint: "youtube/channel", params: {}, status: 200, requestId: "req-yp", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "youtube:brand" }, body: { success: true, request_id: "req-yp", data: { author: { username: "@brand", followers: 350_000 } } } };
    const ya = analyseAccount({ target: parseTarget("yt:brand"), adapter: ADAPTERS.youtube, records: [prof], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    assert.equal(ya.unusual.length, 1);
    const res = buildResult({ command: "/social-teardown yt:brand", inputs: ["yt:brand"], accounts: [ya], x: [], records: [prof], limits: [], errors: [], meta, deep: false, now: NOW }).result;
    assert.match(res.card.headlines[0], /likes/);
    assert.match(res.report.summary[0], /few likes for its views/);
    const out = renderReport(res.report);
    assert.match(out, /likes per 1,000 views/);
    assert.match(out, /promoted/);
  });

  it("words a trait as a plain phrase", () => {
    assert.equal(traitWords("links out", "yes"), "link out");
    assert.equal(traitWords("tags an account", "no"), "tag no account");
    assert.equal(traitWords("length", "under 15 s"), "run under 15 s");
    assert.equal(traitWords("first line", "question"), "open with a question");
  });

  it("offers only commands that exist, in the npx form the card uses", () => {
    const yp: TaggedRecord = { seq: 1, stage: "profile", endpoint: "tiktok/profile", params: {}, status: 200, requestId: "req-p2", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "tiktok:brand" }, body: { success: true, request_id: "req-p2", data: { author: { username: "brand", followers: 52_000 } } } };
    const vids = [...Array(30)].map((_, i) => row(i, { video: true, durationSeconds: 40, views: i === 28 ? 90_000 : 1000 + i }));
    const a = analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [yp], own: vids, others: [], breakouts: breakouts(vids, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    const res = buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [a], x: [], records: [yp], limits: [], errors: [], meta, deep: false, now: NOW }).result;
    const plays = res.report.sections.find((s2) => s2.title === "Next plays")!.body;
    // video-teardown ships in v0.1.0: the play points at the biggest video that broke out (post 28 here).
    assert.match(plays, /`npx -y socialcrawl@latest video-teardown https:\/\/www\.tiktok\.com\/@brand\/video\/28`/);
    for (const m of plays.matchAll(/`([^`]+)`/g)) assert.match(m[1], /^npx -y socialcrawl@latest (social|video)-teardown /);
  });

  it("says a post may have been promoted", () => {
    const rows = [...Array(30)].map((_, i) => row(i, { platform: "youtube", video: true, durationSeconds: 60, views: i === 28 ? 19_000_000 : 3000 + i, likes: i === 28 ? 900 : 60 }));
    const yp: TaggedRecord = { seq: 1, stage: "profile", endpoint: "tiktok/profile", params: {}, status: 200, requestId: "req-p2", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "tiktok:brand" }, body: { success: true, request_id: "req-p2", data: { author: { username: "brand", followers: 52_000 } } } };
    const ya = analyseAccount({ target: parseTarget("yt:brand"), adapter: ADAPTERS.youtube, records: [yp], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    const out = renderReport(buildResult({ command: "/social-teardown yt:brand", inputs: ["yt:brand"], accounts: [ya], x: [], records: [yp], limits: [], errors: [], meta, deep: false, now: NOW }).result.report);
    assert.match(out, /may have been promoted/);
  });

  it("lists the posts whose earlier posts' median is too small to compare", () => {
    const rows = [...Array(20)].map((_, i) => row(i, { video: true, durationSeconds: 30, views: i < 12 ? 20 + i : 5000 }));
    const yp: TaggedRecord = { seq: 1, stage: "profile", endpoint: "tiktok/profile", params: {}, status: 200, requestId: "req-p3", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "tiktok:brand" }, body: { success: true, request_id: "req-p3", data: { author: { username: "brand", followers: 900 } } } };
    const a = analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [yp], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
    assert.ok(a.baseTooSmall >= 1);
    const out = renderReport(buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [a], x: [], records: [yp], limits: [], errors: [], meta, deep: false, now: NOW }).result.report);
    assert.match(out, /too few views to compare/);
  });
});
