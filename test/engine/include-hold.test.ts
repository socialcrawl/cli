// include= holds. A search sent with include=engagement holds more than its page and topic
// filter: on instagram/search/reels 1 credit a reel it fills, up to 30 a page. Before the hold was
// in the rate table, walkParams capped such a call at the page and topic hold alone, and the API
// refused it as a free 400 ("a page of /v1/instagram/search/reels ... costs 35 credits",
// req-GCrgEsRS3xvKvDxM, 27/11/2026). Calls without include= are unchanged.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Budget, BudgetSpent, rateOf, walkParams } from "../../src/engine/rates.ts";

describe("include= holds", () => {
  it("pins the holds the workflows send", () => {
    assert.deepEqual(rateOf("instagram/search/reels").includeHold, { engagement: 30 });
    assert.deepEqual(rateOf("youtube/search").includeHold, { engagement: 5, channel: 5 });
  });

  it("raises max_credits on instagram/search/reels with include=engagement to the 35 a page the server asked for", () => {
    const p = walkParams("instagram/search/reels", { query: "q", relevant_to: "q", include: "engagement", max_pages: 1 }, 100);
    assert.equal(p.max_credits, 35);
    const two = walkParams("instagram/search/reels", { query: "q", relevant_to: "q", include: "engagement", max_pages: 2 }, 100);
    assert.equal(two.max_credits, 70);
  });

  it("adds each token's hold, and ignores tokens it has no hold for", () => {
    assert.equal(walkParams("youtube/search", { query: "q", relevant_to: "q", include: "engagement,channel" }, 100).max_credits, 15);
    assert.equal(walkParams("instagram/search/reels", { query: "q", relevant_to: "q", include: "engagement, creator" }, 100).max_credits, 35);
  });

  it("changes nothing for a call without include=", () => {
    assert.equal(walkParams("instagram/search/reels", { query: "q", relevant_to: "q", max_pages: 2 }, 100).max_credits, 10);
    assert.equal(walkParams("instagram/search/reels", { query: "q", max_pages: 1 }, 100).max_credits, 1);
  });

  it("refuses locally a stage too small for one page with its holds, instead of sending it to a free 400", () => {
    const b = new Budget(100);
    assert.throws(() => b.allow("instagram/search/reels", { query: "q", relevant_to: "q", include: "engagement", max_pages: 1 }, 10), BudgetSpent);
    assert.equal(b.allow("instagram/search/reels", { query: "q", relevant_to: "q", include: "engagement", max_pages: 1 }, 40).max_credits, 35);
  });
});
