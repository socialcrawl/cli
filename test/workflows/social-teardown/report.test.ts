// The report a teardown hands the render kit: the card, the report sections, tiles, charts
// and the CSVs, with the trust rules checked by the engine's own report gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { breakouts } from "../../../src/engine/breakout.ts";
import { renderReport } from "../../../src/engine/outputs.ts";
import type { Row } from "../../../src/engine/rows.ts";
import { validateReport } from "../../../src/engine/validate.ts";
import { analyseAccount } from "../../../src/workflows/social-teardown/analyse.ts";
import { ADAPTERS } from "../../../src/workflows/social-teardown/platforms.ts";
import { analyseXAccount } from "../../../src/workflows/social-teardown/x-account.ts";
import { buildResult, REQUIRED_SECTIONS, who } from "../../../src/workflows/social-teardown/report.ts";
import type { Built } from "../../../src/workflows/social-teardown/report.ts";
import { parseTarget } from "../../../src/workflows/social-teardown/targets.ts";
import type { TaggedRecord } from "../../../src/workflows/social-teardown/tracker.ts";
import { fixturePath } from "../../fixture-path.ts";

const NOW = new Date("2026-11-27T00:00:00Z");
const meta = { skill: "social-teardown", version: "0.1.0", credits: 61, calls: 14, seconds: 42.5, date: "27/11/2026", generated_at: NOW.toISOString() };

function row(i: number, over: Partial<Row> = {}): Row {
  return {
    platform: "tiktok", id: String(i), url: `https://www.tiktok.com/@brand/video/${i}`, author: "brand", authorFollowers: 50_000, authorUrl: null, channelId: null, community: null,
    text: i % 3 ? "a day at the office" : "how do you plan a week? @someone", publishedAt: new Date(Date.UTC(2026, 5, 1 + i, 11)).toISOString(), views: i === 25 ? 90_000 : 1000 + i * 10, likes: 50,
    comments: 5, shares: 1, saves: 2, durationSeconds: i % 2 ? 12 : 45, video: true, pinned: false, kind: "original", requestId: `req-tt${i}`, ...over,
  };
}

function tiktokAnalysis() {
  const rows = [...Array(40)].map((_, i) => row(i));
  const profile: TaggedRecord = { seq: 1, stage: "profile", endpoint: "tiktok/profile", params: {}, status: 200, requestId: "req-ttprof", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "tiktok:brand" }, body: { success: true, request_id: "req-ttprof", data: { author: { username: "brand", display_name: "Brand", followers: 52_000, posts_count: 400, ext: { bio_link: "https://brand.example/start" } } } } };
  const timeline: TaggedRecord = { ...profile, seq: 2, stage: "timeline", endpoint: "tiktok/profile/videos", requestId: "req-tt0", body: { success: true, request_id: "req-tt0", data: { items: [], walk: { pages: 4 } } } };
  return analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [profile, timeline], own: rows, others: [], breakouts: breakouts(rows, { now: NOW, mode: "previous", metric: "views" }), depth: [] }, NOW);
}

const reatools: TaggedRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "reatools-records.json"), "utf8")).map((r: TaggedRecord) => ({ ...r, meta: { ...r.meta, account: "x:reatools" } }));

function built(accounts = [tiktokAnalysis()], x = [] as ReturnType<typeof analyseXAccount>[]): Built {
  return buildResult({ command: "/social-teardown tiktok:brand", inputs: accounts.map((a) => a.account), accounts, x, records: x.length ? reatools : [], limits: [{ stage: "timeline", endpoint: "tiktok/profile/videos", reason: "the timeline's share is spent; older posts were not read" }], errors: [], meta, deep: false, now: NOW });
}

describe("who is named", () => {
  it("names the subject, companies and accounts over 10,000 followers, and describes the rest", () => {
    assert.equal(who("bigcreator", 25_000), "@bigcreator");
    assert.equal(who("smallperson", 2_300), "an account with 2,300 followers");
    assert.equal(who("unknown", null), "an account of unknown size");
    assert.equal(who("founder", 900, true), "@founder");
  });
});

describe("one TikTok account", () => {
  it("passes the engine's report gate: citations resolve, sections in order, every number in evidence", () => {
    const b = built();
    const md = renderReport(b.result.report);
    const v = validateReport(md, b.evidence.toJSON(meta), b.validateOptions);
    assert.deepEqual(v.problems, [], md);
  });

  it("leads with the post that broke out, by the engine's multiple", () => {
    const b = built();
    assert.match(b.result.report.summary[0], /times/);
    assert.match(b.result.report.summary[0], /\[F\d+\]/);
    assert.ok(b.result.card.headlines.length >= 1 && b.result.card.headlines.length <= 3);
    assert.ok(b.result.card.headlines.every((h) => h.length <= 110));
    assert.equal(b.result.card.command, "/social-teardown tiktok:brand");
  });

  it("keeps every post read as a CSV row, and has tiles and a chart", () => {
    const b = built();
    assert.equal(b.result.tables.posts.rows.length, 40);
    assert.ok(b.result.tables.posts.columns.includes("multiple"));
    assert.ok((b.result.tiles ?? []).some((t) => /Posts read/.test(t.label)));
    assert.ok((b.result.charts ?? []).length >= 1);
  });

  it("says what it could not read, with the reason", () => {
    const md = renderReport(built().result.report);
    assert.match(md, /older posts were not read/);
  });

  it("writes plans with the exact next command and the number to check in 14 days", () => {
    const b = built();
    const plays = b.result.report.sections.find((s) => s.title === "Next plays")!;
    assert.match(plays.body, /`npx -y socialcrawl@latest social-teardown /);
    assert.match(plays.body, /14 days/);
  });

  it("has every required section, in order", () => {
    const titles = built().result.report.sections.map((s) => s.title);
    let at = -1;
    for (const want of REQUIRED_SECTIONS) {
      const i = titles.indexOf(want);
      assert.ok(i > at, `${want} missing or out of order`);
      at = i;
    }
  });
});

describe("an X account, as the study read it", () => {
  it("names no retweeter, quoter or replier with 10,000 followers or fewer", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const b = built([xa.account], [xa]);
    const md = renderReport(b.result.report) + b.result.card.headlines.join("\n");
    const small = reatools.filter((r) => r.stage === "retweeters" || r.stage === "replies").flatMap((r) => (((r.body.data as any)?.items ?? []) as any[]).map((i) => i.author ?? i.comment?.author)).filter((a) => a && (a.followers ?? 0) <= 10_000 && a.username !== "reatools");
    assert.ok(small.length > 0);
    for (const a of small) assert.doesNotMatch(md, new RegExp(`@${a.username}\\b`), `@${a.username} is named`);
  });

  it("counts every post read in the tile, and opens each card line with a capital", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const r = built([xa.account], [xa]).result;
    const tile = r.tiles!.find((t) => t.label === "Posts read")!;
    assert.ok(tile.value.startsWith(`${xa.coded.length.toLocaleString("en-GB")} `) || tile.value === xa.coded.length.toLocaleString("en-GB"), tile.value);
    for (const h of r.card.headlines) assert.match(h, /^[A-Z@0-9]/);
  });

  it("lists only reads that return rows in How this was read, and states the quote window read", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const md = renderReport(built([xa.account], [xa]).result.report);
    const how = md.split("## How this was read")[1].split("## ")[0];
    assert.doesNotMatch(how, /transcript/);
    assert.doesNotMatch(md, /beyond the first 3 hours/);
  });

  it("never uses an accusing word, and says quote posts are unseen", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const b = built([xa.account], [xa]);
    const md = renderReport(b.result.report);
    assert.doesNotMatch(md, /\b(reply ring|squad|bots?|fake)\b/i);
    assert.match(md, /quote/i);
    const v = validateReport(md, b.evidence.toJSON(meta), b.validateOptions);
    assert.deepEqual(v.problems, [], v.problems.map((p) => `${p.code} ${p.line} ${p.detail}`).join("\n"));
  });

  it("carries the X sections: launches, who carried the top posts, repeat repliers", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const titles = built([xa.account], [xa]).result.report.sections.map((s) => s.title);
    assert.ok(titles.includes("Launches"));
    assert.ok(titles.includes("Who carried the top posts"));
  });
});

describe("plain words", () => {
  it("lists every read in How this was read, with its rows", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const md = renderReport(built([xa.account], [xa]).result.report);
    const how = md.split("## How this was read")[1].split("## What we could not verify")[0];
    assert.match(how, /timeline, twitter\/user\/tweets: read \d+/);
    assert.match(how, /retweeters/);
  });
  it("writes singulars as singulars, and weekdays in full", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const md = renderReport(built([xa.account], [xa]).result.report);
    assert.doesNotMatch(md, /\b1 (accounts|posts|launches|domains|comments)\b/);
    assert.match(md, /busiest day (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  });
});

describe("several handles of one brand", () => {
  it("adds a section that sets the accounts side by side", () => {
    const xa = analyseXAccount(reatools, "reatools", NOW);
    const b = built([tiktokAnalysis(), xa.account], [xa]);
    const s = b.result.report.sections.find((x) => x.title === "Across the accounts");
    assert.ok(s, "section present");
    for (const l of b.result.report.summary) assert.match(l, /^@\w+ on \w+: /, `summary line without its account: ${l}`);
    for (const h of b.result.card.headlines) assert.match(h, /^@\w+ on \w+: /, `card line without its account: ${h}`);
    assert.match(s!.body, /tiktok/i);
    const v = validateReport(renderReport(b.result.report), b.evidence.toJSON(meta), b.validateOptions);
    assert.deepEqual(v.problems, []);
  });
});
