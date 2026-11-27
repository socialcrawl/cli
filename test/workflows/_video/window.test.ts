// The window a marketing run reads: the last 30 days by default, or --since and --until; the
// platforms' own date words that cover it; and the exact cut applied to every row afterwards.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inWindow, instagramDatePosted, tiktokDatePosted, windowOf, youtubeUploadDate } from "../../../src/workflows/_video/window.ts";
import { row } from "../../engine/helpers.ts";

const NOW = new Date("2026-11-27T12:00:00Z");

describe("window", () => {
  it("defaults to the last 30 days, ending today", () => {
    const w = windowOf({ now: NOW });
    assert.equal(w.since, "2026-10-29", "today and the 29 days before it");
    assert.equal(w.until, "2026-11-27");
    assert.equal(w.days, 30);
    assert.equal(w.allTime, false);
  });

  it("takes --since and --until, and reads 2000-01-01 or earlier as all time", () => {
    assert.deepEqual(windowOf({ now: NOW, since: "2026-11-20", until: "2026-11-26" }).days, 7);
    assert.equal(windowOf({ now: NOW, since: "2000-01-01" }).allTime, true);
  });

  it("names the platform date filter that covers the window back from today", () => {
    assert.equal(tiktokDatePosted(windowOf({ now: NOW })), "this-month");
    assert.equal(tiktokDatePosted(windowOf({ now: NOW, since: "2026-11-21" })), "this-week");
    assert.equal(tiktokDatePosted(windowOf({ now: NOW, since: "2026-09-01" })), "last-3-months");
    assert.equal(tiktokDatePosted(windowOf({ now: NOW, since: "2000-01-01" })), undefined);
    assert.equal(youtubeUploadDate(windowOf({ now: NOW })), "this_month");
    assert.equal(youtubeUploadDate(windowOf({ now: NOW, since: "2026-03-01" })), "this_year");
    assert.equal(youtubeUploadDate(windowOf({ now: NOW, since: "2000-01-01" })), undefined);
    assert.equal(instagramDatePosted(windowOf({ now: NOW })), "last-month");
    assert.equal(instagramDatePosted(windowOf({ now: NOW, since: "2025-01-01" })), undefined);
  });

  it("keeps a row published inside the window, the last day included, and drops one with no date", () => {
    const w = windowOf({ now: NOW, since: "2026-11-01", until: "2026-11-20" });
    assert.equal(inWindow(row({ publishedAt: "2026-11-01T00:00:00Z" }), w), true);
    assert.equal(inWindow(row({ publishedAt: "2026-11-20T23:59:00Z" }), w), true);
    assert.equal(inWindow(row({ publishedAt: "2026-10-31T23:59:00Z" }), w), false);
    assert.equal(inWindow(row({ publishedAt: "2026-11-21T00:00:00Z" }), w), false);
    assert.equal(inWindow(row({ publishedAt: null }), w), false);
  });
});
