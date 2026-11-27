// The adapters: for each platform, which calls read the profile, the timeline, a post's
// comments and its words, and how a profile answer reads. On recorded @notionhq answers
// (commenters and members aliased, their text removed). No key, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RATES } from "../../../src/engine/rates.ts";
import { rowsOf } from "../../../src/engine/rows.ts";
import type { CallRecord } from "../../../src/kit/record.ts";
import { ADAPTERS, ownRows, profileOf } from "../../../src/workflows/social-teardown/platforms.ts";
import { parseTarget } from "../../../src/workflows/social-teardown/targets.ts";
import { fixturePath } from "../../fixture-path.ts";

const recs: CallRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "notion-records.json"), "utf8"));
const rec = (endpoint: string) => recs.find((r) => r.endpoint === endpoint)!;

describe("every adapter", () => {
  it("names only endpoints the rate table prices, so the budget can hold every call", () => {
    for (const a of Object.values(ADAPTERS)) {
      const t = parseTarget(a.platform === "linkedin" ? "https://www.linkedin.com/company/notionhq/" : `${a.platform}:notionhq`);
      const calls = [a.profile(t), ...a.timeline(t, { id: "30898036" }, {}), a.comments("https://example.com/p/1"), a.transcript("https://example.com/p/1")].filter((c) => c !== null);
      for (const c of calls) assert.ok(RATES[c!.endpoint], `${a.platform}: ${c!.endpoint} has no rate`);
    }
  });
});

describe("profiles", () => {
  it("reads followers, posts and the bio links of each platform's answer", () => {
    const tt = profileOf(rec("tiktok/profile"));
    assert.equal(tt.followers, 143729);
    assert.equal(tt.posts, 330);
    assert.equal(tt.name, "Notion");
    const yt = profileOf(rec("youtube/channel"));
    assert.equal(yt.followers, 351000);
    assert.equal(yt.joined, "2018-06-03");
    assert.equal(yt.id, "UCoSvlWS5XcwaSzIcbuJ-Ysg");
    const li = profileOf(rec("linkedin/company"));
    assert.equal(li.id, "30898036");
    assert.ok(li.links.some((l) => /notion/.test(l)), "the company website is a link");
  });
});

describe("timelines", () => {
  it("reads TikTok, Instagram posts and reels, and YouTube videos and shorts", () => {
    const ig = ADAPTERS.instagram.timeline(parseTarget("ig:notionhq"), {}, {}).map((c) => c.endpoint);
    assert.deepEqual(ig, ["instagram/profile/reels", "instagram/profile/posts"]);
    const yt = ADAPTERS.youtube.timeline(parseTarget("yt:@Notion"), {}, {}).map((c) => c.endpoint);
    assert.deepEqual(yt, ["youtube/channel/videos", "youtube/channel/shorts"]);
  });

  it("asks for a LinkedIn company's posts by its id, from the profile answer", () => {
    const [c] = ADAPTERS.linkedin.timeline(parseTarget("https://www.linkedin.com/company/notionhq/"), { id: "30898036" }, {});
    assert.equal(c.endpoint, "linkedin/company/posts");
    assert.equal(c.params.company_id, "30898036");
  });

  it("passes a window when the person gives one", () => {
    const [c] = ADAPTERS.tiktok.timeline(parseTarget("tiktok:notionhq"), {}, { since: "2026-09-01", until: "2026-11-01" });
    assert.equal(c.params.since, "2026-09-01");
    assert.equal(c.params.until, "2026-11-01");
  });
});

describe("whose posts count", () => {
  it("keeps a LinkedIn company's own posts and counts the members' posts it shows apart", () => {
    const t = parseTarget("https://www.linkedin.com/company/notionhq/");
    const rows = rowsOf(rec("linkedin/company/posts"));
    const { own, others } = ownRows(t, rows, { id: "30898036" });
    assert.equal(own.length, 3);
    assert.equal(others.length, 6);
  });

  it("keeps the account's own TikTok videos", () => {
    const rows = rowsOf(rec("tiktok/profile/videos"));
    assert.equal(ownRows(parseTarget("tiktok:notionhq"), rows, {}).own.length, rows.length);
  });
});

describe("depth calls", () => {
  it("asks for labelled comments where the lane labels them, and a transcript where there is one", () => {
    const c = ADAPTERS.tiktok.comments("https://www.tiktok.com/@notionhq/video/1")!;
    assert.equal(c.endpoint, "tiktok/post/comments");
    assert.equal(c.params.label, "sentiment,question,purchase_intent,complaint");
    assert.equal(ADAPTERS.youtube.transcript("https://www.youtube.com/watch?v=1")!.endpoint, "youtube/video/transcript");
    assert.equal(ADAPTERS.reddit.transcript("https://www.reddit.com/r/a/comments/1/"), null);
  });
});
