import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTarget, parseTargets, TargetError } from "../../../src/workflows/social-teardown/targets.ts";

describe("reading what the person typed", () => {
  it("takes a bare handle or @handle as X", () => {
    assert.deepEqual(parseTarget("@treg_ai"), { platform: "x", handle: "treg_ai", url: "https://x.com/treg_ai" });
    assert.deepEqual(parseTarget("treg_ai"), { platform: "x", handle: "treg_ai", url: "https://x.com/treg_ai" });
  });

  it("takes a platform prefix", () => {
    assert.equal(parseTarget("tiktok:@khaby.lame").platform, "tiktok");
    assert.equal(parseTarget("tiktok:@khaby.lame").handle, "khaby.lame");
    assert.equal(parseTarget("twitter:treg_ai").platform, "x");
    assert.equal(parseTarget("ig:nike").platform, "instagram");
    assert.equal(parseTarget("yt:@mkbhd").platform, "youtube");
    assert.equal(parseTarget("reddit:u/spez").handle, "spez");
  });

  it("reads profile links on every platform", () => {
    assert.deepEqual(parseTarget("https://x.com/treg_ai"), { platform: "x", handle: "treg_ai", url: "https://x.com/treg_ai" });
    assert.equal(parseTarget("https://twitter.com/Treg_AI/").handle, "treg_ai");
    assert.equal(parseTarget("https://www.tiktok.com/@khaby.lame?lang=en").handle, "khaby.lame");
    assert.equal(parseTarget("https://www.instagram.com/nike/").handle, "nike");
    assert.deepEqual(parseTarget("https://www.youtube.com/@mkbhd/videos"), { platform: "youtube", handle: "mkbhd", url: "https://www.youtube.com/@mkbhd" });
    assert.deepEqual(parseTarget("https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ"), { platform: "youtube", handle: "UCBJycsmduvYEL83R_U4JriQ", channelId: "UCBJycsmduvYEL83R_U4JriQ", url: "https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ" });
    assert.equal(parseTarget("https://www.reddit.com/user/spez/").handle, "spez");
    assert.equal(parseTarget("https://www.threads.net/@zuck").platform, "threads");
    assert.equal(parseTarget("https://www.threads.com/@zuck").handle, "zuck");
  });

  it("tells a LinkedIn company from a member", () => {
    assert.deepEqual(parseTarget("https://www.linkedin.com/company/anthropicresearch/"), { platform: "linkedin", handle: "anthropicresearch", linkedinKind: "company", url: "https://www.linkedin.com/company/anthropicresearch/" });
    assert.equal(parseTarget("https://www.linkedin.com/in/satyanadella").linkedinKind, "member");
  });

  it("sends a post link to video-teardown instead of guessing", () => {
    assert.throws(() => parseTarget("https://x.com/treg_ai/status/2125546075855741424"), (e: Error) => e instanceof TargetError && /video-teardown/.test(e.message));
    assert.throws(() => parseTarget("https://www.tiktok.com/@khaby.lame/video/7300000000000000000"), TargetError);
  });

  it("refuses what it cannot read, and says what it can", () => {
    assert.throws(() => parseTarget(""), TargetError);
    assert.throws(() => parseTarget("myspace:tom"), (e: Error) => /x, tiktok, instagram, youtube, linkedin, reddit, threads/.test(e.message));
    assert.throws(() => parseTarget("linkedin:satya"), (e: Error) => /linkedin\.com/.test(e.message));
  });

  it("keeps several handles of one brand, once each", () => {
    const t = parseTargets(["@treg_ai", "x:jasonzhou1993", "https://x.com/treg_ai", "tiktok:treg_ai"]);
    assert.deepEqual(t.map((x) => `${x.platform}:${x.handle}`), ["x:treg_ai", "x:jasonzhou1993", "tiktok:treg_ai"]);
  });

  it("splits one argument on commas and spaces", () => {
    assert.equal(parseTargets(["@a, @b tiktok:c"]).length, 3);
  });
});
