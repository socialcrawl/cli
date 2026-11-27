// Video rows: hashtags, the sound a post uses, and YouTube's two formats. Shapes as the API
// returned them on 27/11/2026 (tiktok/search req-pDuFDn2Qc6MCeA0H, instagram/profile/reels
// req-lXvU9xsaiqQjfvyh, youtube/search req-m8B6R6g3yc00Oyve, youtube/channel/shorts
// req-yOV95oQfsoX6B37y), handles aliased. The new Row fields are optional: a row whose
// response carries none of them is unchanged.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { breakoutWithPage } from "../../src/engine/baseline.ts";
import { baselineKey, comparable } from "../../src/engine/breakout.ts";
import { rowOf } from "../../src/engine/rows.ts";
import { row, series } from "./helpers.ts";

const RUN = new Date("2026-11-27T12:00:00Z");

describe("rows: hashtags and sound", () => {
  it("reads a TikTok row's hashtags and its sound, with whether the sound is the creator's own", () => {
    const r = rowOf(
      {
        id: "1",
        author: { username: "u001" },
        content: { text: "tips #ai" },
        engagement: { views: 69_582 },
        ext: { music_id: "7274023553422772278", music_title: "Million Dolla Hip Hop", music_artist: "Brentin Davis", music_is_original: false, hashtags: ["ai", "webdevelopment"] },
      },
      "tiktok",
      "req-pDuFDn2Qc6MCeA0H",
    );
    assert.deepEqual(r.hashtags, ["ai", "webdevelopment"]);
    assert.deepEqual(r.sound, { id: "7274023553422772278", title: "Million Dolla Hip Hop", original: false });
  });

  it("reads an Instagram reel's licensed music from ext.music", () => {
    const r = rowOf({ id: "2", author: { username: "u002" }, content: { text: "" }, ext: { music_id: "123", music: { id: "123", track_title: "Song" } } }, "instagram", null);
    assert.deepEqual(r.sound, { id: "123", title: "Song", original: null });
  });

  it("leaves the fields out when the response carries none of them", () => {
    const r = rowOf({ id: "3", author: { username: "u003" }, content: { text: "" }, ext: { channel_id: "c1" } }, "youtube", null);
    assert.equal("hashtags" in r, false);
    assert.equal("sound" in r, false);
  });
});

describe("rows: YouTube formats", () => {
  it("marks a YouTube Short as short and a regular upload as long, from content_type", () => {
    assert.equal(rowOf({ id: "a", author: {}, content: {}, ext: { content_type: "short", channel_id: "c1" } }, "youtube", null).format, "short");
    assert.equal(rowOf({ id: "b", author: {}, content: {}, ext: { content_type: "video", channel_id: "c1" } }, "youtube", null).format, "long");
    assert.equal("format" in rowOf({ id: "c", author: {}, content: {}, ext: {} }, "youtube", null), false, "no content_type, no format");
    assert.equal("format" in rowOf({ id: "d", author: { username: "u" }, content: {}, ext: {} }, "tiktok", null), false);
  });

  it("compares Shorts only with Shorts, and long videos only with long videos", () => {
    const short = row({ platform: "youtube", id: "s", author: "c1", channelId: "c1", video: true, format: "short" });
    const otherShort = row({ platform: "youtube", id: "s2", author: "c1", channelId: "c1", video: true, format: "short" });
    const long = row({ platform: "youtube", id: "l", author: "c1", channelId: "c1", video: true, format: "long" });
    assert.equal(comparable(short, otherShort), true);
    assert.equal(comparable(short, long), false);
    assert.equal(comparable(long, short), false);
  });

  it("keeps the old rule for rows with no format", () => {
    const a = row({ platform: "youtube", id: "a", author: "c1", channelId: "c1", video: true });
    const b = row({ platform: "youtube", id: "b", author: "c1", channelId: "c1", video: true });
    assert.equal(comparable(a, b), true);
  });

  it("keys a YouTube baseline on the channel id, whatever name each lane prints", () => {
    // youtube/search prints "@handle"; channel/shorts prints the channel id as the username.
    const a = row({ platform: "youtube", author: "@SomeChannel", channelId: "UCabc" });
    const b = row({ platform: "youtube", author: "UCabc", channelId: "UCabc" });
    assert.equal(baselineKey(a), baselineKey(b));
    assert.equal(baselineKey(row({ platform: "tiktok", author: "Acme" })), "acme", "other platforms keep the author");
  });

  it("baselines a search Short against its channel's Shorts shelf", () => {
    const target = row({ platform: "youtube", id: "t", author: "", channelId: "UCabc", format: "short", video: true, views: 90_000, publishedAt: "2026-11-01T12:00:00.000Z" });
    const shelf = series(12, () => 3_000, { platform: "youtube", author: "UCabc", channelId: "UCabc", format: "short", video: true });
    const longs = series(12, () => 300, { platform: "youtube", author: "UCabc", channelId: "UCabc", format: "long", video: true }).map((r, i) => ({ ...r, id: `l${i}` }));
    const b = breakoutWithPage(target, [...shelf, ...longs], { now: RUN });
    assert.equal(b.peers, 12, "the long videos are left out");
    assert.equal(b.base, 3_000);
    assert.equal(b.multiple, 30);
  });
});
