// video-teardown's measured blocks, from the shapes the API returned on 27/11/2026 (probes
// req-k4ZkYg1NaASsLt7y TikTok transcript, req-PvvjlziJXYf6PlJH Instagram screen text,
// req-uHFK2M7Rl3QXZWqk YouTube transcript, req-zGaiZxPKZ1niHx5M X transcript).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { beatStep, clip, hookOf, screenOf, storyboardOf, wordsOf, wordsPerMinute } from "../../../src/workflows/video-teardown/storyboard.ts";

const ttTranscript = { transcript: "WEBVTT\n\n00:00.020 --> 00:03.760\nTwo weeks ago...", transcript_format: "webvtt", transcript_with_timestamp: [{ start: 0.02, end: 3.76, text: "Two weeks ago, a free repository called REA," }, { start: 3.78, end: 6.12, text: "short for Reverse Engineer anything," }, { start: 6.3, end: 8.74, text: "quietly went nuclear on Github," }] };
const ytTranscript = { transcript: [{ text: "I'm sure you've heard the term vibe coding all the time.", duration: 3.388, offset: 0 }, { text: "Ever since Andre Karpathy coined the term.", duration: 6.94, offset: 3.388 }] };
const igTranscript = { transcripts: [{ id: "1", shortcode: "Dx", text: "Stop paying for these nine apps. GitHub has a free version of every single one." }], duration_seconds: 52.5 };
const xTranscript = { transcript: "I'm excited to welcome the founders of Weave here." };
const igScreen = { media_type: "video", frame: "all", source: "ocr", duration_seconds: 52.501, texts: ["PAID", "Stop paying for these 9", "ALL FREE ON GITHUB"], timeline: [{ at_seconds: 0, kind: "text", text: "PAID" }, { at_seconds: 1, kind: "text", text: "Stop paying for these 9" }, { at_seconds: 4, kind: "text", text: "ALL FREE ON GITHUB" }, { at_seconds: 4, kind: "text", text: "ALL FREE ON GITHUB" }] };

describe("video-teardown: the words", () => {
  it("reads timed segments from TikTok and YouTube", () => {
    const tt = wordsOf("tiktok", ttTranscript);
    assert.equal(tt.state, "words");
    assert.equal(tt.timed, true);
    assert.deepEqual(tt.segments[1], { start: 3.78, end: 6.12, text: "short for Reverse Engineer anything," });
    const yt = wordsOf("youtube", ytTranscript);
    assert.equal(yt.timed, true);
    assert.deepEqual(yt.segments[1], { start: 3.388, end: 10.328, text: "Ever since Andre Karpathy coined the term." });
  });

  it("reads untimed text from Instagram and X, and says it is untimed", () => {
    const ig = wordsOf("instagram", igTranscript);
    assert.equal(ig.state, "words");
    assert.equal(ig.timed, false);
    assert.equal(ig.wordCount, 15);
    assert.equal(wordsOf("x", xTranscript).text, "I'm excited to welcome the founders of Weave here.");
  });

  it("tells no speech apart from a transcript that was not read (SOC-02)", () => {
    assert.equal(wordsOf("tiktok", { transcript: "", transcript_with_timestamp: [] }).state, "no_speech");
    assert.equal(wordsOf("x", { transcript: "   " }).state, "no_speech");
    assert.equal(wordsOf("tiktok", null).state, "not_read");
  });
});

describe("video-teardown: the screen", () => {
  it("reads the timeline of on-screen text, once per text and second", () => {
    const s = screenOf("instagram", igScreen);
    assert.equal(s.state, "timed");
    assert.equal(s.frame, "all");
    assert.deepEqual(s.items, [{ at: 0, text: "PAID" }, { at: 1, text: "Stop paying for these 9" }, { at: 4, text: "ALL FREE ON GITHUB" }]);
  });

  it("says plainly when a platform gives no frames, when the video shows no text, and when only the cover was read", () => {
    assert.equal(screenOf("youtube", null).state, "no_frames");
    assert.equal(screenOf("x", null).state, "no_frames");
    assert.equal(screenOf("tiktok", null).state, "not_read");
    assert.equal(screenOf("tiktok", { frame: "all", source: "none", texts: [], timeline: [] }).state, "none");
    const cover = screenOf("tiktok", { frame: "cover", source: "ocr", texts: ["REA went nuclear"], timeline: [] });
    assert.equal(cover.state, "cover");
    assert.deepEqual(cover.items, [{ at: null, text: "REA went nuclear" }]);
  });
});

describe("video-teardown: the storyboard", () => {
  it("steps every 3 seconds on a short video, and widens the step to keep at most 20 beats", () => {
    assert.equal(beatStep(52.5), 3);
    assert.equal(beatStep(291), 15);
    assert.equal(beatStep(null), 3);
  });

  it("puts what is on screen and what is said into the same time windows", () => {
    const beats = storyboardOf(screenOf("instagram", igScreen), wordsOf("tiktok", ttTranscript), 9);
    assert.deepEqual(beats.map((b) => [b.from, b.to]), [[0, 3], [3, 6], [6, 9]]);
    assert.deepEqual(beats[0].onScreen, ["PAID", "Stop paying for these 9"]);
    assert.deepEqual(beats[0].said, ["Two weeks ago, a free repository called REA,"]);
    assert.deepEqual(beats[1].onScreen, ["ALL FREE ON GITHUB"]);
    assert.deepEqual(beats[1].said, ["short for Reverse Engineer anything,"]);
  });

  it("merges a run of empty beats into one row", () => {
    const beats = storyboardOf(screenOf("instagram", igScreen), wordsOf("tiktok", ttTranscript), 30);
    assert.deepEqual(beats.map((b) => [b.from, b.to]), [[0, 3], [3, 6], [6, 9], [9, 30]]);
    assert.deepEqual(beats[3], { from: 9, to: 30, onScreen: [], said: [] });
  });

  it("builds no storyboard when neither the screen nor the words are timed", () => {
    assert.deepEqual(storyboardOf(screenOf("x", null), wordsOf("x", xTranscript), 1716), []);
  });

  it("finds the hook: what is on screen and said in the first 3 seconds", () => {
    const h = hookOf(screenOf("instagram", igScreen), wordsOf("tiktok", ttTranscript));
    assert.deepEqual(h.onScreen, ["PAID", "Stop paying for these 9"]);
    assert.equal(h.said, "Two weeks ago, a free repository called REA,");
    const untimed = hookOf(screenOf("x", null), wordsOf("x", xTranscript));
    assert.equal(untimed.said, "I'm excited to welcome the founders of Weave here.", "untimed words: the first sentence");
  });

  it("keeps the hook short: at most 4 on-screen texts and 25 words said", () => {
    const crowded = screenOf("instagram", { frame: "all", source: "ocr", texts: [], timeline: ["0/9", "PAID", "Eleven Labs", "SEMRUSH", "Notion", "Flow"].map((text) => ({ at_seconds: 0, kind: "text", text })) });
    const long = wordsOf("x", { transcript: "I'm excited to welcome the founders of Weave here and to congratulate them on their recent Series A from our friends at Standard Capital and also the launch of their new product Weave Router, that they're going to talk about welcome guys." });
    const h = hookOf(crowded, long);
    assert.deepEqual(h.onScreen, ["0/9", "PAID", "Eleven Labs", "SEMRUSH"]);
    assert.equal(h.moreOnScreen, 2);
    assert.equal(h.said, "I'm excited to welcome the founders of Weave here and to congratulate them on their recent Series A from our friends at Standard Capital and …");
  });

  it("clips a storyboard cell at a word boundary", () => {
    assert.equal(clip("short text", 160), "short text");
    const c = clip("word ".repeat(60).trim(), 40);
    assert.ok(c.length <= 41 && c.endsWith(" …"), c);
  });

  it("counts words per minute over the video's length", () => {
    assert.equal(wordsPerMinute(wordsOf("instagram", igTranscript), 52.5), 17);
    assert.equal(wordsPerMinute(wordsOf("tiktok", null), 52.5), null);
  });
});
