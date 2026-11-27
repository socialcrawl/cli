import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rowsOf } from "../../../src/engine/rows.ts";
import { activityCall, activityOf, splitSite, statusOf } from "../../../src/workflows/social-presence/presence.ts";
import { ACME, platform, postsPage } from "./fake.ts";

const byName = (name: string) => (ACME.data as { platforms: ReturnType<typeof platform>[] }).platforms.find((p) => p.platform === name)!;

describe("splitSite", () => {
  it("takes a website given in brackets, after a comma or as a link out of the name", () => {
    assert.deepEqual(splitSite("Linear (linear.app)"), { name: "Linear", website: "linear.app" });
    assert.deepEqual(splitSite("Linear, linear.app"), { name: "Linear", website: "linear.app" });
    assert.deepEqual(splitSite("Linear https://www.linear.app/about"), { name: "Linear", website: "linear.app" });
    assert.deepEqual(splitSite("Acme Notes (www.acmenotes.example)"), { name: "Acme Notes", website: "acmenotes.example" });
  });
  it("leaves a name with a dot in it whole", () => {
    assert.deepEqual(splitSite("Node.js"), { name: "Node.js" });
    assert.deepEqual(splitSite("Socket.io"), { name: "Socket.io" });
    assert.deepEqual(splitSite("Linear"), { name: "Linear" });
  });
});

describe("statusOf", () => {
  it("confirms an account only by a link: the site in its website field, a domain match or a cross-link", () => {
    assert.equal(statusOf(byName("twitter")).status, "confirmed");
    assert.deepEqual(statusOf(byName("twitter")).evidence, ["links to acmenotes.example in its website field", "its bio names acmenotes.example", "links to or from the brand's other accounts"]);
    assert.equal(statusOf(byName("linkedin")).status, "confirmed");
  });
  it("never confirms on a name and bio alone, even when the API accepted the match", () => {
    const s = statusOf(byName("youtube"));
    assert.equal(s.status, "judged");
    assert.deepEqual(s.evidence, ["name and bio judged the same; no link confirms it"]);
  });
  it("keeps weaker matches as possible, and says when nothing was found", () => {
    assert.equal(statusOf(byName("threads")).status, "possible");
    assert.equal(statusOf(byName("instagram")).status, "possible");
    assert.equal(statusOf(byName("tiktok")).status, "none");
  });
  it("never confirms a fan or parody account, whatever it links to", () => {
    const fan = platform("x", "acmefan", "same", 0.9, { cross_link: true, domain_match: true, fan_or_parody: true }, 50_000, true);
    assert.equal(statusOf(fan).status, "possible");
  });
});

describe("activityCall", () => {
  it("reads one page of recent posts on each platform it can", () => {
    assert.deepEqual(activityCall("twitter", "acmenotes", null), { endpoint: "twitter/user/tweets", params: { handle: "acmenotes" } });
    assert.deepEqual(activityCall("youtube", "@acmenotes", null), { endpoint: "youtube/channel/videos", params: { handle: "@acmenotes" } });
    assert.deepEqual(activityCall("threads", "acme_notes", null), { endpoint: "threads/user/posts", params: { handle: "acme_notes" } });
    assert.deepEqual(activityCall("linkedin", "jane", "https://www.linkedin.com/in/jane/"), { endpoint: "linkedin/profile/posts", params: { url: "https://www.linkedin.com/in/jane/" } });
  });
  it("cannot read a LinkedIn company's posts from a name search, and says why", () => {
    assert.deepEqual(activityCall("linkedin", "acmenotes", "https://www.linkedin.com/company/acmenotes/"), { why: "LinkedIn company posts need the company's numeric id, which a name search does not give" });
  });
});

describe("activityOf", () => {
  it("gives the last post, the posts in the last 30 days and the median reach", () => {
    const rows = rowsOf({ endpoint: "twitter/user/tweets", requestId: "r", body: postsPage("acmenotes", [1, 3, 8, 20, 40, 70], 2_000) as never });
    assert.deepEqual(activityOf(rows, new Date("2026-11-27T10:00:00Z")), { posts: 6, lastPost: "2026-11-26", last30: 4, medianViews: 2_000, medianLikes: 40 });
  });
  it("is empty for an account with no posts read", () => {
    assert.deepEqual(activityOf([], new Date("2026-11-27T10:00:00Z")), { posts: 0, lastPost: null, last30: 0, medianViews: null, medianLikes: null });
  });
});
