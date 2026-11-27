// post-tracker: a post link in; its numbers read now and kept, so each run adds a reading to the
// post's history, against its author's usual reach (read once, then kept), with a chart.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget, ENGINE_SECTIONS, renderReport, validateReport } from "../../../src/engine/index.ts";
import { Session } from "../../../src/kit/record.ts";
import { postOf, trackPost } from "../../../src/workflows/post-tracker/track.ts";
import { REPORT_SECTIONS, workflow } from "../../../src/workflows/post-tracker/index.ts";
import { fakeKit, history, post } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

const URL = "https://www.tiktok.com/@bigco/video/7712346103240248606";

function world(views: () => number): Route[] {
  return [
    { endpoint: "tiktok/post", data: () => ({ post: post({ id: "7712346103240248606", author: "bigco", followers: 50_000, views: views(), likes: 4_000, at: "2026-11-20T15:00:00Z", url: URL }).post }) },
    { endpoint: "tiktok/profile/videos", data: { items: history("bigco", 20, 10_000, "2026-11-20T00:00:00Z") } },
  ];
}

/** A session whose run folder sits in `root`, as the CLI's socialcrawl-runs/<run> does. */
function sessionIn(root: string, routes: Route[], at: string) {
  const kit = fakeKit(routes);
  const dir = path.join(root, `post-tracker-${at.slice(0, 13)}`);
  return { kit, session: new Session({ dir, kit, budget: new Budget(20), skill: "post-tracker", version: "0.0.0", now: () => new Date(at) }) };
}

describe("post-tracker: links", () => {
  it("knows the platform and post id from a link", () => {
    assert.deepEqual(postOf("https://x.com/acme/status/2125224416359620835"), { platform: "x", id: "2125224416359620835", endpoint: "twitter/tweet" });
    assert.deepEqual(postOf("https://twitter.com/acme/status/21252?s=20"), { platform: "x", id: "21252", endpoint: "twitter/tweet" });
    assert.deepEqual(postOf(URL), { platform: "tiktok", id: "7712346103240248606", endpoint: "tiktok/post" });
    assert.deepEqual(postOf("https://www.instagram.com/reel/DgJncKIBPpN/"), { platform: "instagram", id: "DgJncKIBPpN", endpoint: "instagram/post" });
    assert.deepEqual(postOf("https://www.youtube.com/watch?v=MGnMmHcIEZE"), { platform: "youtube", id: "MGnMmHcIEZE", endpoint: "youtube/video" });
    assert.deepEqual(postOf("https://youtube.com/shorts/qEkC_oE_SoQ"), { platform: "youtube", id: "qEkC_oE_SoQ", endpoint: "youtube/video", short: true });
    assert.deepEqual(postOf("https://www.reddit.com/r/linux/comments/1y4prjg/linus_torvalds/"), { platform: "reddit", id: "1y4prjg", endpoint: "reddit/post" });
    assert.throws(() => postOf("https://example.com/post/1"), /a post link from X, TikTok, Instagram, YouTube or Reddit/);
  });
});

describe("post-tracker: readings over time", () => {
  it("reads the post and its author's baseline on the first run, and only the post after that", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    let v = 200_000;
    const first = sessionIn(root, world(() => v), "2026-11-27T10:00:00Z");
    const a = await trackPost(first.session, { input: URL, flags: {}, deep: false, now: new Date("2026-11-27T10:00:00Z") });
    assert.deepEqual(first.kit.sent.map((s) => s.endpoint), ["tiktok/post", "tiktok/profile/videos"]);
    assert.equal(a.readings.length, 1);
    assert.equal(a.baseline?.median, 10_000);
    assert.equal(a.multiple, 20);

    v = 260_000;
    const second = sessionIn(root, world(() => v), "2026-11-27T16:00:00Z");
    const b = await trackPost(second.session, { input: URL, flags: {}, deep: false, now: new Date("2026-11-27T16:00:00Z") });
    assert.deepEqual(second.kit.sent.map((s) => s.endpoint), ["tiktok/post"], "the baseline is kept, not read again");
    assert.deepEqual(b.readings.map((r) => r.views), [200_000, 260_000]);
    assert.equal(b.multiple, 26);
    assert.equal(b.gainPerHour, 10_000, "60,000 more views in 6 hours");
    const saved = JSON.parse(readFileSync(b.historyFile, "utf8"));
    assert.equal(saved.readings.length, 2);
    assert.ok(b.historyFile.startsWith(root), "history sits beside the run folders, not inside one");
  });

  it("keeps an X post's quote count with each reading", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    const XURL = "https://x.com/acme/status/2125224416359620835";
    const routes: Route[] = [
      { endpoint: "twitter/tweet", data: { post: post({ id: "2125224416359620835", author: "acme", followers: 20_000, views: 50_000, at: "2026-11-25T10:00:00Z", url: XURL, ext: { quote_count: 37 } }).post } },
      { endpoint: "twitter/search/tweets", data: { items: history("acme", 20, 5_000, "2026-11-25T00:00:00Z", { followers: 20_000 }) } },
    ];
    const { session, kit } = sessionIn(root, routes, "2026-11-27T10:00:00Z");
    const out = await trackPost(session, { input: XURL, flags: {}, deep: false, now: new Date("2026-11-27T10:00:00Z") });
    assert.equal(out.readings[0].quotes, 37);
    const base = kit.sent.find((s) => s.endpoint === "twitter/search/tweets");
    assert.equal(base?.params.judgments, "off", "a baseline is never topic-filtered");
    assert.equal(out.multiple, 10);
  });

  it("reads a YouTube channel's size once when the video read carries none, and keeps it", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    const YURL = "https://www.youtube.com/watch?v=h4tHDFCPmQE";
    const routes: Route[] = [
      { endpoint: "youtube/video", data: { post: { id: "h4tHDFCPmQE", url: YURL, content: { text: "Vibe Coding vs. Agentic Coding", duration_seconds: 540 }, author: { username: null }, engagement: { views: 498_066, likes: 9_000, comments: 300 }, published_at: "2026-11-23T12:00:00Z", ext: { channel_id: "UCKW" } } } },
      { endpoint: "youtube/channel", data: { author: { id: "UCKW", username: "@IBMTechnology", followers: 1_850_000 } } },
      { endpoint: "youtube/channel/videos", data: { items: Array.from({ length: 20 }, (_, i) => ({ post: { id: `v${i}`, url: null, content: { text: "", duration_seconds: 600 }, author: { username: "@IBMTechnology" }, engagement: { views: 26_000 }, published_at: new Date(Date.parse("2026-11-22T00:00:00Z") - i * 86_400_000).toISOString(), ext: { content_type: "video", channel_id: "UCKW" } } })) } },
    ];
    const one = sessionIn(root, routes, "2026-11-27T10:00:00Z");
    const a = await trackPost(one.session, { input: YURL, flags: {}, deep: false, now: new Date("2026-11-27T10:00:00Z") });
    assert.equal(one.kit.sent.filter((s) => s.endpoint === "youtube/channel").length, 1);
    assert.equal(a.history.authorFollowers, 1_850_000);
    assert.equal(a.history.author, "IBMTechnology");
    const two = sessionIn(root, routes, "2026-11-27T12:00:00Z");
    await trackPost(two.session, { input: YURL, flags: {}, deep: false, now: new Date("2026-11-27T12:00:00Z") });
    assert.deepEqual(two.kit.sent.map((s) => s.endpoint), ["youtube/video"], "size and baseline are kept");
  });

  it("takes several readings in one run with --every and --times, waiting between them", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    let v = 100_000;
    const waits: number[] = [];
    const { session, kit } = sessionIn(root, world(() => (v += 5_000)), "2026-11-27T10:00:00Z");
    const out = await trackPost(session, { input: URL, flags: { every: "30", times: "3" }, deep: false, now: new Date("2026-11-27T10:00:00Z") }, { sleep: async (ms) => void waits.push(ms) });
    assert.equal(kit.sent.filter((s) => s.endpoint === "tiktok/post").length, 3);
    assert.deepEqual(waits, [1_800_000, 1_800_000]);
    assert.equal(out.readings.length, 3);
    const { trackerResult } = await import("../../../src/workflows/post-tracker/index.ts");
    const result = trackerResult(out, session, { input: URL, flags: {}, deep: false, now: new Date() });
    const summary = result.report.summary;
    assert.match(result.report.sections.find((x) => x.title === "Over time")!.body, /^It gained 10,000 views in 1 hour across 3 readings, about 10,000 an hour/);
    assert.ok(summary.some((l) => l.startsWith("It gained 10,000 views in 1 hour across 3 readings, about 10,000 an hour")), JSON.stringify(summary));
  });

  it("stops taking readings when the budget runs out, and says so", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    const kit = fakeKit(world(() => 1_000));
    const session = new Session({ dir: path.join(root, "run"), kit, budget: new Budget(4), skill: "post-tracker", version: "0.0.0", now: () => new Date("2026-11-27T10:00:00Z") });
    const out = await trackPost(session, { input: URL, flags: { every: "1", times: "5" }, deep: false, now: new Date("2026-11-27T10:00:00Z") }, { sleep: async () => {} });
    assert.ok(out.readings.length < 5);
    assert.ok(session.notRead.length > 0);
  });
});

describe("post-tracker: the report", () => {
  it("passes the report gate, charts the readings, and names the author only at 10,000 followers or more", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    const { session } = sessionIn(root, world(() => 200_000), "2026-11-27T10:00:00Z");
    const out = await workflow.run(session, { input: URL, flags: {}, deep: false, now: new Date("2026-11-27T10:00:00Z") });
    const md = renderReport(out.report);
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), { requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS });
    assert.deepEqual(v.problems, []);
    assert.match(md, /@bigco/);
    assert.match(md, /20x/);
    assert.equal(out.charts?.[0].bars.length, 1);
    assert.ok(out.tables.readings.rows.length === 1);
    assert.match(out.card.headlines[0], /20x its author's usual views/);
  });

  it("describes a small author and never names them", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sc-track-"));
    const small = world(() => 30_000).map((r) => (r.endpoint === "tiktok/post" ? { ...r, data: () => ({ post: post({ id: "7712346103240248606", author: "tinyone", followers: 800, views: 30_000, at: "2026-11-20T15:00:00Z", url: URL }).post }) } : r));
    const { session } = sessionIn(root, small, "2026-11-27T10:00:00Z");
    const out = await workflow.run(session, { input: URL, flags: {}, deep: false, now: new Date("2026-11-27T10:00:00Z") });
    const md = renderReport(out.report) + JSON.stringify(out.card);
    assert.doesNotMatch(md, /tinyone/);
    assert.match(md, /a creator with 800 followers/);
  });
});
