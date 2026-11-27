// What the API fixed on 27/11/2026 (file 26: SR-01 quoted posts on X rows, SR-14 X transcripts
// listened to twice, SR-55 TikTok "no captions" no longer called a deleted video), and what the
// teardown now reads from it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { renderReport } from "../../../src/engine/outputs.ts";
import type { ApiBody } from "../../../src/kit/kit.ts";
import { analyseAccount } from "../../../src/workflows/social-teardown/analyse.ts";
import { ADAPTERS } from "../../../src/workflows/social-teardown/platforms.ts";
import { buildResult } from "../../../src/workflows/social-teardown/report.ts";
import { parseTarget } from "../../../src/workflows/social-teardown/targets.ts";
import type { TaggedRecord } from "../../../src/workflows/social-teardown/tracker.ts";
import { analyseXAccount } from "../../../src/workflows/social-teardown/x-account.ts";
import { codePosts, toXPost } from "../../../src/workflows/social-teardown/x/codebook.ts";
import { fixturePath } from "../../fixture-path.ts";

const NOW = new Date("2026-11-27T00:00:00Z");
const meta = { skill: "social-teardown", version: "0.1.0", credits: 80, calls: 30, seconds: 100, date: "27/11/2026", generated_at: NOW.toISOString() };
const base: TaggedRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "reatools-records.json"), "utf8")).map((r: TaggedRecord) => ({ ...r, meta: { ...r.meta, account: "x:reatools" } }));

const xRow = (id: string, text: string, quoted: unknown, at = "2026-11-20T11:00:00.000Z") => ({
  id, url: `https://x.com/reatools/status/${id}`, published_at: at, content: { text }, author: { username: "reatools" },
  engagement: { views: 1000, likes: 10, comments: 1, shares: 1, saves: 1 }, ext: { quoted_post: quoted, conversation_id: id },
});

describe("SR-01: the quoted post on X rows", () => {
  it("reads the quoted post's id and author", () => {
    const p = toXPost(xRow("1", "so good", { id: "9", author: { username: "someone" }, text: "a demo" }), "req-q");
    assert.deepEqual(p.quoted, { id: "9", author: "someone" });
    assert.equal(p.quotedRead, true);
  });

  it("codes a row with a quoted post as a quote, and a plain text row as no possible quote once the field is read", () => {
    const coded = codePosts([
      toXPost(xRow("1", "so good", { id: "9", author: { username: "someone" }, text: "a demo" }), "req-q"),
      toXPost(xRow("2", "just text, nothing quoted", null), "req-q"),
    ], "reatools");
    assert.equal(coded.find((c) => c.post_id === "1")!.kind, "quote");
    assert.equal(coded.find((c) => c.post_id === "2")!.kind, "original");
    assert.ok(coded.every((c) => !c.quote_unseen));
  });

  it("still flags a text post as a possible quote when the row carries no quoted-post field", () => {
    const row = xRow("3", "older row", null);
    delete (row.ext as Record<string, unknown>).quoted_post;
    assert.equal(codePosts([toXPost(row, "req-o")], "reatools")[0].quote_unseen, true);
  });

  it("reports how many of its posts quote another post and how many quote its own, naming no quoted account", () => {
    const quotes: TaggedRecord = {
      seq: 99, stage: "timeline", endpoint: "twitter/user/tweets", params: {}, status: 200, requestId: "req-quotes", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "x:reatools", window: "newest" },
      body: { success: true, request_id: "req-quotes", data: { items: [
        { post: xRow("901", "nice build", { id: "8", author: { username: "smallbuilder" } }, "2026-11-21T11:00:00.000Z") },
        { post: xRow("902", "great demo", { id: "7", author: { username: "smallbuilder" } }, "2026-11-22T11:00:00.000Z") },
        { post: xRow("903", "we shipped this", { id: "6", author: { username: "reatools" } }, "2026-11-23T11:00:00.000Z") },
      ] } } as ApiBody,
    };
    const recs = [...base, quotes];
    const xa = analyseXAccount(recs, "reatools", NOW);
    const md = renderReport(buildResult({ command: "/social-teardown @reatools", inputs: ["@reatools"], accounts: [xa.account], x: [xa], records: recs, limits: [], errors: [], meta, deep: false, now: NOW }).result.report);
    assert.match(md, /3 of its own posts quote another post, 1 of them its own/);
    assert.match(md, /the rest quote posts, replies and reposts/);
    assert.doesNotMatch(md, /@smallbuilder/);
  });
});

describe("SR-14 and SR-55: transcripts", () => {
  const prof: TaggedRecord = { seq: 1, stage: "profile", endpoint: "tiktok/profile", params: {}, status: 200, requestId: "req-tp", walkRequestIds: [], creditsUsed: 1, at: NOW.toISOString(), meta: { account: "tiktok:brand" }, body: { success: true, request_id: "req-tp", data: { author: { username: "brand", followers: 50_000 } } } };
  const noCaptions: TaggedRecord = { ...prof, seq: 2, stage: "words", endpoint: "tiktok/post/transcript", status: 404, requestId: "req-nc", meta: { account: "tiktok:brand", post_id: "77" }, body: { success: false, request_id: "req-nc", error: { type: "RESOURCE_NOT_FOUND", message: "This TikTok video has no captions. You were not charged for this request.", details: { reason: "no_captions" } } } as ApiBody };

  it("say a TikTok video has no captions, and leave it out of what could not be verified", () => {
    const a = analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [prof, noCaptions], own: [], others: [], breakouts: [], depth: [] }, NOW);
    const md = renderReport(buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [a], x: [], records: [prof, noCaptions], limits: [], errors: [{ stage: "words", endpoint: "tiktok/post/transcript", status: 404, message: "This TikTok video has no captions. You were not charged for this request.", requestId: "req-nc" }], meta, deep: false, now: NOW }).result.report);
    assert.match(md.split("## Words")[1].split("## ")[0], /no captions/);
    assert.doesNotMatch(md.split("## What we could not verify")[1].split("## ")[0], /transcript/);
  });

  it("drop the music-only caveat from X transcripts, and keep it elsewhere", () => {
    const xa = analyseXAccount(base, "reatools", NOW);
    const xmd = renderReport(buildResult({ command: "/social-teardown @reatools", inputs: ["@reatools"], accounts: [xa.account], x: [xa], records: base, limits: [], errors: [], meta, deep: false, now: NOW }).result.report);
    assert.doesNotMatch(xmd, /music-only/);
    const said: TaggedRecord = { ...noCaptions, status: 200, requestId: "req-tt", body: { success: true, request_id: "req-tt", data: { transcript: "hello everyone this is our new feature" } } };
    const a = analyseAccount({ target: parseTarget("tiktok:brand"), adapter: ADAPTERS.tiktok, records: [prof, said], own: [], others: [], breakouts: [], depth: [] }, NOW);
    const tmd = renderReport(buildResult({ command: "/social-teardown tiktok:brand", inputs: ["tiktok:brand"], accounts: [a], x: [], records: [prof, said], limits: [], errors: [], meta, deep: false, now: NOW }).result.report);
    assert.match(tmd, /music-only/);
  });
});
