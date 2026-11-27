// youtube-marketing against a fake API: one batch lookup fills likes, durations and the channel
// id search Shorts lack; one batch gives subscriber counts; Shorts are baselined on the channel's
// Shorts shelf and long videos on its Videos tab, never mixed; the naming rule on subscribers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderCard, renderReport } from "../../../src/engine/index.ts";
import { runVideo } from "../../../src/workflows/_video/run.ts";
import { workflow } from "../../../src/workflows/youtube-marketing/index.ts";
import { YOUTUBE } from "../../../src/workflows/youtube-marketing/spec.ts";
import { fakeSession } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const ARGS = { input: "AI coding tools", flags: {}, deep: false, now: NOW };

const yt = (o: { id: string; author: string | null; channel: string | null; views: number; at: string; type: "video" | "short" | null; likes?: number | null; duration?: number | null; title?: string }) => ({
  post: {
    id: o.id,
    url: o.type === "short" ? `https://www.youtube.com/shorts/${o.id}` : `https://www.youtube.com/watch?v=${o.id}`,
    content: { text: o.title ?? `Video ${o.id}`, duration_seconds: o.duration ?? null },
    author: { username: o.author },
    engagement: { views: o.views, likes: o.likes ?? null, comments: null },
    published_at: o.at,
    ext: { content_type: o.type, channel_id: o.channel },
  },
});
const shelf = (channel: string, n: number, views: number, type: "video" | "short", end: string) =>
  Array.from({ length: n }, (_, i) => yt({ id: `${channel}-${type}-${i}`, author: channel, channel, views, type, duration: type === "short" ? 40 : 600, likes: views / 20, at: new Date(Date.parse(end) - (i + 1) * 86_400_000).toISOString() }));

const V1 = yt({ id: "V1aaaaaaaaa", author: "@bigchan", channel: "UCa", views: 300_000, at: "2026-11-20T12:00:00Z", type: "video", duration: 900, title: "I tested every AI coding tool" });
const S1 = yt({ id: "S1aaaaaaaaa", author: null, channel: null, views: 90_000, at: "2026-11-21T12:00:00Z", type: "short", title: "Claude Code in 40 seconds" });
const S2 = yt({ id: "S2aaaaaaaaa", author: null, channel: "UCa", views: 50_000, at: "2026-11-22T12:00:00Z", type: "short" });

function world(): Route[] {
  return [
    { endpoint: "youtube/search", when: (p) => p.type === undefined, data: { items: [V1, S1] } },
    { endpoint: "youtube/search", when: (p) => p.type === "shorts", data: { items: [S1, S2] } },
    {
      endpoint: "youtube/videos",
      data: (_p: unknown, json: { ids: string[] }) => ({
        items: json.ids.filter((id) => [V1, S1, S2].some((x) => x.post.id === id)).map((id) => {
          const base = [V1, S1, S2].find((x) => x.post.id === id)!;
          const channel = id === "S1aaaaaaaaa" ? "UCb" : "UCa";
          return { post: { ...base.post, author: { username: null }, engagement: { ...base.post.engagement, likes: 5_000, comments: 300 }, content: { ...base.post.content, duration_seconds: id === "V1aaaaaaaaa" ? 900 : 40 }, ext: { channel_id: channel } } };
        }),
      }),
    },
    { endpoint: "youtube/channels", data: { items: [{ author: { id: "UCa", username: "@bigchan", display_name: "Big Channel", followers: 2_000_000 } }, { author: { id: "UCb", username: "@smallchan", display_name: "Small Channel", followers: 4_000 } }] } },
    { endpoint: "youtube/channel/videos", when: (p) => p.channelId === "UCa", data: { items: shelf("UCa", 20, 10_000, "video", "2026-11-20T00:00:00Z") } },
    { endpoint: "youtube/channel/shorts", when: (p) => p.channelId === "UCa", data: { items: shelf("UCa", 20, 5_000, "short", "2026-11-22T00:00:00Z") } },
    { endpoint: "youtube/channel/shorts", when: (p) => p.channelId === "UCb", data: { items: shelf("UCb", 12, 3_000, "short", "2026-11-21T00:00:00Z") } },
    { endpoint: "youtube/video/comments", data: { items: [{ comment: { id: "c1", text: "Which one is free?", author: { username: "x" }, engagement: { likes: 9 } }, computed: { labels: { question: { p: 0.95 }, purchase_intent: { p: 0.2 }, complaint: { p: 0 }, sentiment: { level: 3 } } } }], labels: { status: "complete", labelled: 1 } } },
    { endpoint: "youtube/transcripts", data: (_p: unknown, json: { ids: string[] }) => ({ results: json.ids.map((id) => ({ target: id, status: "ok", data: { video_id: id, transcript: `Words of ${id}.` } })) }) },
  ];
}

describe("youtube-marketing: the run", () => {
  it("fills every search row with one batch lookup and one subscriber lookup", async () => {
    const { kit, session } = fakeSession(world());
    const run = await runVideo(session, YOUTUBE, ARGS);
    const videos = kit.sent.filter((s) => s.endpoint === "youtube/videos");
    assert.equal(videos.length, 1);
    assert.deepEqual((videos[0].json as { ids: string[] }).ids.sort(), ["S1aaaaaaaaa", "S2aaaaaaaaa", "V1aaaaaaaaa"]);
    const channels = kit.sent.filter((s) => s.endpoint === "youtube/channels");
    assert.equal(channels.length, 1);
    assert.deepEqual((channels[0].json as { ids: string[] }).ids.sort(), ["UCa", "UCb"]);
    const s1 = run.allRows.find((r) => r.id === "S1aaaaaaaaa");
    assert.equal(s1?.channelId, "UCb", "the Short's channel id comes from the batch");
    assert.equal(s1?.format, "short", "the search row's format is kept");
    assert.equal(s1?.likes, 5_000);
  });

  it("reads subscriber counts before a second batch of ids, and batches the most viewed ids first", async () => {
    // 55 search rows need two 50-id chunks (10 credits); the subscriber batch must not lose to the second.
    const many = Array.from({ length: 55 }, (_, i) => yt({ id: `M${String(i).padStart(10, "0")}`, author: "@bigchan", channel: "UCa", views: 2_000 + i, at: "2026-11-20T12:00:00Z", type: "video", duration: 600 }));
    const routes = world().map((r) => (r.endpoint === "youtube/search" && r.when?.({}, undefined) ? { ...r, data: { items: [V1, S1, ...many] } } : r));
    const { kit, session } = fakeSession(routes);
    await runVideo(session, YOUTUBE, ARGS);
    const order = kit.sent.filter((s) => s.endpoint === "youtube/videos" || s.endpoint === "youtube/channels").map((s) => s.endpoint);
    assert.deepEqual(order.slice(0, 2), ["youtube/videos", "youtube/channels"]);
    const first = (kit.sent.find((s) => s.endpoint === "youtube/videos")!.json as { ids: string[] }).ids;
    assert.equal(first.length, 50);
    assert.ok(first.includes("V1aaaaaaaaa") && first.includes("S1aaaaaaaaa"), "the most viewed are in the first batch");
  });

  it("windows the video search to this month, cuts Shorts by date, and leaves an old Short out", async () => {
    const OLDS = yt({ id: "OLDshort001", author: null, channel: "UCa", views: 900_000, at: "2023-09-26T02:52:48Z", type: "short" });
    const routes = world().map((r) => (r.endpoint === "youtube/search" && r.when?.({ type: "shorts" }, undefined) ? { ...r, data: { items: [S1, S2, OLDS] } } : r));
    const { kit, session } = fakeSession(routes);
    const run = await runVideo(session, YOUTUBE, ARGS);
    const videos = kit.sent.find((s) => s.endpoint === "youtube/search" && s.params.type === undefined);
    const shorts = kit.sent.find((s) => s.endpoint === "youtube/search" && s.params.type === "shorts");
    assert.equal(videos?.params.uploadDate, "this_month");
    assert.equal(shorts?.params.uploadDate, undefined, "YouTube refuses a window narrower than a year on Shorts");
    assert.equal(run.candidates.outsideWindow, 1);
    assert.ok(!run.items.some((i) => i.row.id === "OLDshort001"));
  });

  it("baselines Shorts on the Shorts shelf and long videos on the Videos tab", async () => {
    const { kit, session } = fakeSession(world());
    const run = await runVideo(session, YOUTUBE, ARGS);
    const shelves = kit.sent.filter((s) => /channel\/(videos|shorts)/.test(s.endpoint)).map((s) => `${s.endpoint} ${s.params.channelId}`).sort();
    assert.deepEqual(shelves, ["youtube/channel/shorts UCa", "youtube/channel/shorts UCb", "youtube/channel/videos UCa"]);
    const by = new Map(run.items.map((i) => [i.row.id, i]));
    assert.equal(by.get("V1aaaaaaaaa")?.breakout.multiple, 30);
    assert.equal(by.get("S2aaaaaaaaa")?.breakout.multiple, 10, "50,000 over the Shorts median of 5,000, not the long videos'");
    assert.equal(by.get("S1aaaaaaaaa")?.breakout.multiple, 30);
  });

  it("names a channel by subscribers, sends the transcripts in one batch, and stays inside the budget", async () => {
    const { kit, session } = fakeSession(world());
    const out = await workflow.run(session, ARGS);
    const md = renderReport(out.report) + renderCard(out.card);
    assert.match(md, /@bigchan/);
    assert.doesNotMatch(md, /smallchan|Small Channel/);
    assert.match(md, /a channel with 4,000 subscribers/);
    assert.equal(kit.sent.filter((s) => s.endpoint === "youtube/transcripts").length, 1);
    assert.match(md, /Words of/);
    assert.ok(session.ledger.credits <= workflow.defaultBudget, `spent ${session.ledger.credits}`);
    const q = await workflow.quote(ARGS);
    assert.ok(q.max <= workflow.defaultBudget, `quote max ${q.max}`);
  });
});
