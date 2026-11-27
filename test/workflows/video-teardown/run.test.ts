// video-teardown against a fake API: one video link in; the post, its creator's usual reach, what
// is on screen, the words, the labelled comments, each through its platform's own endpoint.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_SECTIONS, renderCard, renderReport, validateReport } from "../../../src/engine/index.ts";
import { runTeardown } from "../../../src/workflows/video-teardown/run.ts";
import { REPORT_SECTIONS, workflow } from "../../../src/workflows/video-teardown/index.ts";
import { fakeSession, history, post } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const TT = "https://www.tiktok.com/@bigco/video/7700000000000000001";
const ARGS = { input: TT, flags: {}, deep: false, now: NOW };
const LABELS = "sentiment,question,purchase_intent,complaint";

const comment = (id: string, text: string, q: number, c = 0) => ({ comment: { id, post_id: "p", text, author: { username: `u${id}` }, engagement: { likes: 5 } }, computed: { labels: { question: { p: q }, purchase_intent: { p: 0 }, complaint: { p: c }, sentiment: { level: 3 } } } });
const comments = { items: [comment("1", "Which tool is this?", 0.9), comment("2", "It crashed on me", 0, 0.9), comment("3", "nice", 0)], labels: { status: "complete", labelled: 3 } };

function tiktok(duration = 45, over: Partial<Route>[] = []): Route[] {
  return [
    ...(over as Route[]),
    { endpoint: "tiktok/post", data: post({ id: "7700000000000000001", author: "bigco", followers: 120_000, views: 900_000, at: "2026-11-20T10:00:00Z", text: "Stop paying for these 9 apps", duration, url: TT, ext: { music_title: "original sound - bigco", music_is_original: true } }) },
    { endpoint: "tiktok/profile/videos", data: { items: history("bigco", 20, 30_000, "2026-11-20T00:00:00Z", { followers: 120_000 }) } },
    { endpoint: "tiktok/video/screen-text", data: { frame: "all", source: "ocr", media_type: "video", texts: ["PAID", "Stop paying for these 9", "ALL FREE"], timeline: [{ at_seconds: 0, kind: "text", text: "PAID" }, { at_seconds: 1, kind: "text", text: "Stop paying for these 9" }, { at_seconds: 4, kind: "text", text: "ALL FREE" }] } },
    { endpoint: "tiktok/post/transcript", data: { transcript_format: "webvtt", transcript: "x", transcript_with_timestamp: [{ start: 0.1, end: 2.5, text: "Stop paying for these nine apps." }, { start: 3.2, end: 6, text: "GitHub has a free version of each." }] } },
    { endpoint: "tiktok/post/comments", data: comments },
  ];
}

describe("video-teardown: the run", () => {
  it("reads the post, its creator's usual views, the screen over the whole video, the words and labelled comments", async () => {
    const { kit, session } = fakeSession(tiktok(), workflow.defaultBudget, NOW);
    const t = await runTeardown(session, ARGS);
    assert.deepEqual(kit.sent.map((s) => s.endpoint), ["tiktok/post", "tiktok/profile/videos", "tiktok/video/screen-text", "tiktok/post/transcript", "tiktok/post/comments"]);
    assert.equal(kit.sent[2].params.frames, "all", "a video of 180 s or less is read over its whole length");
    assert.equal(kit.sent[4].params.label, LABELS);
    assert.equal(kit.sent[1].params.relevant_to, undefined, "a baseline is never topic-filtered");
    assert.equal(t.multiple, 30);
    assert.equal(t.screen.state, "timed");
    assert.equal(t.words.timed, true);
    assert.equal(t.asks.classes.question.count, 1);
    assert.equal(t.sound?.title, "original sound - bigco");
    assert.ok(session.ledger.credits <= workflow.defaultBudget);
  });

  it("walks the creator's feed back a page when its first pages hold too few earlier videos", async () => {
    // QA 27/11/2026: a prolific creator's first 3 pages were all newer than the video, so no multiple.
    const newer = history("bigco", 30, 30_000, "2026-11-27T00:00:00Z", { followers: 120_000 }).slice(0, 6);
    const routes = tiktok(45, [
      { endpoint: "tiktok/profile/videos", when: (p) => p.cursor === "c2", data: { items: history("bigco", 20, 30_000, "2026-11-20T00:00:00Z", { followers: 120_000 }) } },
      { endpoint: "tiktok/profile/videos", data: { items: newer, next_cursor: "c2", has_more: true } },
    ]);
    const { kit, session } = fakeSession(routes, workflow.defaultBudget, NOW);
    const t = await runTeardown(session, ARGS);
    assert.deepEqual(kit.sent.filter((s) => s.endpoint === "tiktok/profile/videos").map((s) => s.params.cursor ?? null), [null, "c2"]);
    assert.equal(t.multiple, 30);
    assert.equal(t.baseline?.peers, 20);
  });

  it("reads only the cover of a video longer than 180 s, since frames=all stops there", async () => {
    const { kit, session } = fakeSession(tiktok(291), workflow.defaultBudget, NOW);
    await runTeardown(session, ARGS);
    const screen = kit.sent.find((s) => s.endpoint === "tiktok/video/screen-text")!;
    assert.equal(screen.params.frames, undefined);
  });

  it("reads no frames on YouTube, and reads the channel's size before naming it", async () => {
    const url = "https://www.youtube.com/watch?v=h4tHDFCPmQE";
    const routes: Route[] = [
      { endpoint: "youtube/video", data: { post: { id: "h4tHDFCPmQE", url, content: { text: "What is vibe coding?", duration_seconds: 517 }, author: { username: "@ibmtech" }, engagement: { views: 500_000, likes: 9_000, comments: 300 }, published_at: "2026-11-10T10:00:00Z", ext: { channel_id: "UCibm", content_type: "video" } } } },
      { endpoint: "youtube/channel", data: { author: { username: "@ibmtech", followers: 1_500_000 } } },
      { endpoint: "youtube/channel/videos", data: { items: Array.from({ length: 12 }, (_, i) => ({ post: { id: `v${i}`, url: `https://www.youtube.com/watch?v=v${i}`, content: { text: "", duration_seconds: 500 }, author: { username: "@ibmtech" }, engagement: { views: 25_000 }, published_at: new Date(Date.parse("2026-11-09T00:00:00Z") - i * 86_400_000).toISOString(), ext: { channel_id: "UCibm", content_type: "video" } } })) } },
      { endpoint: "youtube/video/transcript", data: { transcript: [{ text: "I'm sure you've heard the term vibe coding.", offset: 0, duration: 3.4 }] } },
      { endpoint: "youtube/video/comments", data: comments },
    ];
    const { kit, session } = fakeSession(routes, workflow.defaultBudget, NOW);
    const t = await runTeardown(session, { ...ARGS, input: url });
    assert.ok(!kit.sent.some((s) => /screen-text/.test(s.endpoint)));
    assert.equal(t.screen.state, "no_frames");
    assert.equal(t.followers, 1_500_000);
    assert.equal(t.multiple, 20);
  });

  it("measures an X video against its author's originals to the post's minute", async () => {
    const url = "https://x.com/bigco/status/2118040581574213691";
    const routes: Route[] = [
      { endpoint: "twitter/tweet", data: post({ id: "2118040581574213691", author: "bigco", followers: 1_600_000, views: 33_000, at: "2026-11-15T17:30:00Z", text: "Founders of Weave", duration: 1716, url }) },
      { endpoint: "twitter/search/tweets", data: { items: history("bigco", 20, 40_000, "2026-11-15T00:00:00Z", { followers: 1_600_000 }) } },
      { endpoint: "twitter/tweet/transcript", data: { transcript: "I'm excited to welcome the founders of Weave here." } },
      { endpoint: "twitter/tweet/replies", data: comments },
    ];
    const { kit, session } = fakeSession(routes, workflow.defaultBudget, NOW);
    const t = await runTeardown(session, { ...ARGS, input: url });
    const base = kit.sent.find((s) => s.endpoint === "twitter/search/tweets")!;
    assert.match(String(base.params.query), /^from:bigco -filter:replies -filter:retweets/);
    assert.equal(base.params.judgments, "off");
    assert.equal(t.screen.state, "no_frames");
    assert.equal(t.words.timed, false);
  });

  it("keeps going when the transcript is refused, and says why", async () => {
    const { session } = fakeSession(tiktok(45, [{ endpoint: "tiktok/post/transcript", data: 404 }]), workflow.defaultBudget, NOW);
    const t = await runTeardown(session, ARGS);
    assert.equal(t.words.state, "not_read");
    assert.match(t.transcriptError ?? "", /404/);
    assert.equal(t.asks.classes.question.count, 1, "the comments are still read");
  });

  it("refuses a link that is not a video, before reading more than the post", async () => {
    await assert.rejects(runTeardown(fakeSession([], 60, NOW).session, { ...ARGS, input: "https://www.reddit.com/r/linux/comments/1y4prjg/x/" }), /a video link from TikTok, YouTube, Instagram or X/);
    const text: Route[] = [{ endpoint: "twitter/tweet", data: post({ id: "1", author: "bigco", views: 100, at: "2026-11-15T17:30:00Z", text: "just text", duration: 0, url: "https://x.com/bigco/status/1" }) }];
    const { kit, session } = fakeSession(text, 60, NOW);
    await assert.rejects(runTeardown(session, { ...ARGS, input: "https://x.com/bigco/status/1" }), /has no video/);
    assert.equal(kit.sent.length, 1);
  });
});

describe("video-teardown: the report", () => {
  it("passes the report gate, with the storyboard, the words, the sound and the comments", async () => {
    const { session } = fakeSession(tiktok(), workflow.defaultBudget, NOW);
    const out = await workflow.run(session, ARGS);
    const md = renderReport(out.report);
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), { requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS });
    assert.deepEqual(v.problems, []);
    assert.match(md, /30x its creator's usual views/);
    assert.match(md, /\| Time \| On screen \| Said \|/);
    assert.match(md, /\| 0:00 \| PAID · Stop paying for these 9 \| Stop paying for these nine apps\. \|/);
    assert.match(md, /\| 0:03 \| ALL FREE \| GitHub has a free version of each\. \|/);
    assert.match(md, /original sound - bigco/);
    assert.match(md, /Which tool is this\?/);
    assert.doesNotMatch(md + renderCard(out.card), /u1|u2|u3/, "commenters are never named");
  });

  it("says plainly what a platform does not give, and when there is no speech", async () => {
    const url = "https://x.com/bigco/status/2118040581574213691";
    const routes: Route[] = [
      { endpoint: "twitter/tweet", data: post({ id: "2118040581574213691", author: "bigco", followers: 1_600_000, views: 33_000, at: "2026-11-15T17:30:00Z", duration: 40, url }) },
      { endpoint: "twitter/search/tweets", data: { items: history("bigco", 20, 40_000, "2026-11-15T00:00:00Z", { followers: 1_600_000 }) } },
      { endpoint: "twitter/tweet/transcript", data: { transcript: "" } },
      { endpoint: "twitter/tweet/replies", data: comments },
    ];
    const md = renderReport((await workflow.run(fakeSession(routes, workflow.defaultBudget, NOW).session, { ...ARGS, input: url })).report);
    assert.match(md, /X gives no frames/);
    assert.match(md, /no speech/i);
    assert.doesNotMatch(md, /\| 0:00 \|/, "no storyboard without timed text");
  });

  it("lists the cover's text beside a storyboard of words, on a video read from its cover", async () => {
    const routes = tiktok(291, [{ endpoint: "tiktok/video/screen-text", data: { frame: "cover", source: "ocr", media_type: "video", texts: ["How Modders Used AI", "last month"], timeline: [] } }]);
    const md = renderReport((await workflow.run(fakeSession(routes, workflow.defaultBudget, NOW).session, ARGS)).report);
    assert.match(md, /\| Time \| Said \|/);
    assert.match(md, /On the cover: `How Modders Used AI`, `last month`/);
  });

  it("says when the frames were read and hold no text, and shows the creator's followers beside the name", async () => {
    // Skill run 27/11/2026: a screen read of 0 rows (10 credits) went unmentioned.
    const blank = tiktok(34, [{ endpoint: "tiktok/video/screen-text", data: { frame: "all", source: "none", media_type: "video", texts: [], timeline: [] } }]);
    const md = renderReport((await workflow.run(fakeSession(blank, workflow.defaultBudget, NOW).session, ARGS)).report);
    assert.match(md, /The frames were read and show no text\./);
    assert.match(md, /\| Time \| Said \|/);
    assert.match(md, /@bigco \(120,000 followers\)/);
  });

  it("drops a storyboard column whose source has no times", async () => {
    // Instagram's and X's words come untimed: a Said column would be all dashes.
    const untimed = tiktok(45, [{ endpoint: "tiktok/post/transcript", data: { transcript_format: "text", transcript: "Stop paying for these nine apps.", transcript_with_timestamp: [] } }]);
    const md = renderReport((await workflow.run(fakeSession(untimed, workflow.defaultBudget, NOW).session, ARGS)).report);
    assert.match(md, /\| Time \| On screen \|\n/);
    assert.match(md, /\| 0:00 \| PAID · Stop paying for these 9 \|\n/);
  });

  it("keeps the storyboard a table: long cells clipped, a crowded opening counted", async () => {
    const long = "word ".repeat(80).trim() + ".";
    const crowded = ["0/9", "PAID", "Eleven Labs", "SEMRUSH", "Notion", "Flow"].map((text) => ({ at_seconds: 0, kind: "text", text }));
    const routes = tiktok(45, [
      { endpoint: "tiktok/post/transcript", data: { transcript_format: "webvtt", transcript: "x", transcript_with_timestamp: [{ start: 0.1, end: 2.5, text: long }] } },
      { endpoint: "tiktok/video/screen-text", data: { frame: "all", source: "ocr", media_type: "video", texts: [], timeline: crowded } },
    ]);
    const out = await workflow.run(fakeSession(routes, workflow.defaultBudget, NOW).session, ARGS);
    const md = renderReport(out.report);
    const row = md.split("\n").find((l) => l.startsWith("| 0:00 |"))!;
    assert.ok(row.length < 420, `${row.length}`);
    assert.match(row, / …/);
    assert.match(md, /It opens with `0\/9`, `PAID`, `Eleven Labs`, `SEMRUSH` and 2 more on screen, and the words `word word/);
    assert.doesNotMatch(md, /said `/, "plain words, not \"said `…`\"");
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), { requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS });
    assert.deepEqual(v.problems, []);
  });

  it("names a creator under 10,000 followers by description only", async () => {
    const small = tiktok().map((r) => (r.endpoint === "tiktok/post" ? { ...r, data: post({ id: "7700000000000000001", author: "tinyone", followers: 3_000, views: 90_000, at: "2026-11-20T10:00:00Z", url: "https://www.tiktok.com/@tinyone/video/7700000000000000001" }) } : r));
    const out = await workflow.run(fakeSession(small, workflow.defaultBudget, NOW).session, { ...ARGS, input: "https://www.tiktok.com/@tinyone/video/7700000000000000001" });
    const shown = renderReport(out.report) + renderCard(out.card);
    assert.doesNotMatch(shown, /tinyone/);
    assert.match(shown, /a creator with 3,000 followers/);
  });

  it("quotes a default run inside its budget on every platform", async () => {
    for (const input of [TT, "https://www.instagram.com/reel/DfU2nIgt8XK/", "https://www.youtube.com/watch?v=h4tHDFCPmQE", "https://x.com/a/status/1"]) {
      const q = await workflow.quote({ ...ARGS, input });
      assert.ok(q.max <= workflow.defaultBudget, `${input}: ${q.max}`);
    }
  });
});
