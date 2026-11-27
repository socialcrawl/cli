// The rate rows the workflows call, each read from the registry's published price on
// 27/11/2026 (x-credit-cost, whether the endpoint takes max_pages, the topic filter's hold).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RATES, postCost, rateOf } from "../../src/engine/rates.ts";

const ROWS: Record<string, { page: number; walks: boolean; topicHold?: number; perIds?: number }> = {
  "reddit/subreddit/details": { page: 1, walks: false },
  "reddit/subreddits/search": { page: 1, walks: true },
  "reddit/search/comments": { page: 1, walks: true, topicHold: 4 },
  "youtube/channel/shorts": { page: 1, walks: true },
  "prism/discover": { page: 0, walks: false },
  "tiktok/adlibrary/search": { page: 5, walks: true },
  "reddit/post": { page: 1, walks: false },
  "youtube/videos": { page: 5, walks: false, perIds: 50 },
  "youtube/channels": { page: 5, walks: false, perIds: 50 },
  "youtube/transcripts": { page: 3, walks: false, perIds: 1 },
  "instagram/profile": { page: 1, walks: false },
  "tiktok/profile": { page: 1, walks: false },
  "youtube/channel": { page: 1, walks: false },
  "tiktok/search/hashtag": { page: 1, walks: true },
  "instagram/search/hashtag": { page: 1, walks: true },
  "tiktok/post": { page: 1, walks: false },
  "tiktok/video/screen-text": { page: 5, walks: false },
  "instagram/profile/posts": { page: 1, walks: true },
  "instagram/post": { page: 1, walks: false },
  "instagram/media/screen-text": { page: 5, walks: false },
  "youtube/video": { page: 1, walks: false },
  "youtube/video/transcript": { page: 3, walks: false },
  "linkedin/company": { page: 5, walks: false },
  "linkedin/profile": { page: 5, walks: false },
  "linkedin/company/posts": { page: 5, walks: true },
  "threads/profile": { page: 1, walks: false },
  "threads/user/posts": { page: 1, walks: false },
  "threads/post/comments": { page: 1, walks: false },
  "twitter/user/media": { page: 1, walks: true },
};

describe("the rate rows the workflows call", () => {
  for (const [id, want] of Object.entries(ROWS)) {
    it(id, () => {
      const r = rateOf(id);
      assert.equal(r.page, want.page);
      assert.equal(r.walks, want.walks);
      assert.equal(r.topicHold, want.topicHold);
      assert.equal(r.perIds, want.perIds);
    });
  }
  it("keeps every row's price a whole number of credits", () => {
    for (const [id, r] of Object.entries(RATES)) assert.ok(Number.isInteger(r.page) && r.page >= 0, id);
  });
});

describe("postCost", () => {
  it("prices a batch by its chunks of ids: 5 per 50 video ids", () => {
    assert.equal(postCost("youtube/videos", { ids: Array.from({ length: 28 }, (_, i) => `v${i}`) }), 5);
    assert.equal(postCost("youtube/videos", { ids: Array.from({ length: 50 }, (_, i) => `v${i}`) }), 5);
    assert.equal(postCost("youtube/videos", { ids: Array.from({ length: 51 }, (_, i) => `v${i}`) }), 10);
  });
  it("prices transcripts at 3 per id", () => {
    assert.equal(postCost("youtube/transcripts", { ids: ["a", "b", "c", "d"] }), 12);
  });
  it("falls back to one page for a body without ids", () => {
    assert.equal(postCost("youtube/videos", {}), 5);
  });
});
