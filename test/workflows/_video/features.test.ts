// What a video did: its length band, its hook, its sound, whether it gates a reward behind a
// comment, and the hour it went out. Pure functions on rows; no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commentGated, hookOf, hookType, hourUtc, lengthBand, soundKind, traitsOf } from "../../../src/workflows/_video/features.ts";
import { row } from "../../engine/helpers.ts";

describe("features", () => {
  it("puts short videos and long YouTube uploads in their own length bands", () => {
    assert.equal(lengthBand(row({ platform: "tiktok", durationSeconds: 12 })), "under 15 s");
    assert.equal(lengthBand(row({ platform: "tiktok", durationSeconds: 49.1 })), "30 to 60 s");
    assert.equal(lengthBand(row({ platform: "instagram", durationSeconds: 61 })), "1 to 3 min");
    assert.equal(lengthBand(row({ platform: "youtube", format: "long", durationSeconds: 517 })), "5 to 10 min");
    assert.equal(lengthBand(row({ platform: "youtube", format: "long", durationSeconds: 1541 })), "20 min or more");
    assert.equal(lengthBand(row({ platform: "youtube", format: "short", durationSeconds: 44 })), "30 to 60 s");
    assert.equal(lengthBand(row({ durationSeconds: null })), null);
  });

  it("takes the hook from the first line or sentence, at most 100 characters", () => {
    assert.equal(hookOf("For writing, this is bad. This is good."), "For writing, this is bad.");
    assert.equal(hookOf("Line one\nline two"), "Line one");
    assert.equal(hookOf("#ai #coding"), null, "hashtags alone are no hook");
    assert.ok((hookOf("word ".repeat(60)) ?? "").length <= 100);
  });

  it("names the kind of hook", () => {
    assert.equal(hookType("Which AI tool should you learn first?"), "question");
    assert.equal(hookType("7 FREE Claude Code Skills You NEED"), "number");
    assert.equal(hookType("Top 10 AI Tools for Developers"), "number");
    assert.equal(hookType("How to vibe code an app in a day"), "how-to");
    assert.equal(hookType("I tested 9 ways to use Claude Code for free"), "first-person");
    assert.equal(hookType("Stop using ChatGPT for code"), "warning");
    assert.equal(hookType("POV: your agent wrote the tests"), "pov");
    assert.equal(hookType("Anthropic just dropped the Claude engineer path: 11 courses"), "news");
    assert.equal(hookType("Google just made Gemini free to use"), "news");
    assert.equal(hookType("A solo developer just shipped a Python scraping tool"), "news");
    assert.equal(hookType("Claude can now turn a chat into an app"), "statement");
    assert.equal(hookType(""), null);
  });

  it("spots a reward gated behind a comment", () => {
    assert.equal(commentGated('Comment "SKILLS" and I will send you the list'), true);
    assert.equal(commentGated("comment AGENT to get the guide"), true);
    assert.equal(commentGated("Comment how you check your agents' code"), false, "a question to viewers is not a gate");
    assert.equal(commentGated("great tool"), false);
  });

  it("reads the sound as the creator's own, licensed, or unknown", () => {
    assert.equal(soundKind(row({ sound: { id: "1", title: "original sound", original: true } })), "original");
    assert.equal(soundKind(row({ sound: { id: "2", title: "Million Dolla Hip Hop", original: false } })), "licensed");
    assert.equal(soundKind(row({ sound: { id: "3", title: "Song", original: null } })), "licensed", "Instagram music is licensed music");
    assert.equal(soundKind(row({})), null);
  });

  it("gives the posting hour in UTC", () => {
    assert.equal(hourUtc(row({ publishedAt: "2026-11-21T21:20:07.000Z" })), 21);
    assert.equal(hourUtc(row({ publishedAt: null })), null);
  });

  it("collects the traits a report counts, null where a row cannot say", () => {
    const t = traitsOf(row({ platform: "tiktok", durationSeconds: 20, text: "Top 5 tools #ai", sound: { id: "1", title: "x", original: true }, hashtags: ["ai"] }));
    assert.deepEqual(t, { length: "15 to 30 s", hook: "number", sound: "original", gated: "no" });
  });
});
