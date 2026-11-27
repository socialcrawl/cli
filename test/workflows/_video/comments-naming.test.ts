// What the comments ask (from the free labels, sent explicitly), and who may be named.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LABEL_P, askSummary } from "../../../src/workflows/_video/comments.ts";
import { accountLabel, mayName } from "../../../src/workflows/_video/naming.ts";
import type { ResponseRecord } from "../../../src/engine/index.ts";

const c = (id: string, text: string, likes: number, labels: Record<string, unknown> | null) => ({ comment: { id, post_id: "p1", text, author: { username: `u${id}` }, engagement: { likes } }, computed: labels === null ? {} : { labels } });
const L = (q: number, pi: number, co: number, level: number) => ({ question: { p: q }, purchase_intent: { p: pi }, complaint: { p: co }, sentiment: { level, score_0_1: level / 5 } });

const page = (items: unknown[], labels: Record<string, unknown> = { status: "complete", labelled: items.length }): ResponseRecord => ({
  endpoint: "tiktok/post/comments",
  params: { url: "https://www.tiktok.com/@a/video/p1" },
  requestId: "req-c1",
  body: { data: { items, labels } },
});

describe("askSummary", () => {
  it("counts questions, buying signals and complaints at p of 0.5 or more, and quotes the most liked", () => {
    const s = askSummary([
      page([
        c("1", "Does this work on Windows?", 40, L(0.92, 0.1, 0.05, 3)),
        c("2", "Where can I buy it?", 12, L(0.81, 0.77, 0.02, 4)),
        c("3", "It crashed twice, waste of time", 30, L(0.1, 0.02, 0.88, 1)),
        c("4", "love it", 3, L(0.04, 0.04, 0.05, 5)),
      ]),
    ]);
    assert.equal(LABEL_P, 0.5);
    assert.equal(s.read, 4);
    assert.equal(s.labelled, 4);
    assert.equal(s.classes.question.count, 2);
    assert.equal(s.classes.purchase_intent.count, 1);
    assert.equal(s.classes.complaint.count, 1);
    assert.equal(s.classes.question.quotes[0].text, "Does this work on Windows?");
    assert.equal(s.classes.question.quotes[0].requestId, "req-c1");
    assert.equal(s.positive, 2, "sentiment level 4 or 5");
    assert.equal(s.negative, 1, "sentiment level 1 or 2");
  });

  it("counts unlabelled rows and never reads them as 'no questions'", () => {
    const s = askSummary([page([c("1", "what tool is this?", 5, null), c("2", "nice", 1, L(0.1, 0.1, 0.1, 4))], { status: "skipped", skip_reason: "budget", labelled: 1 })]);
    assert.equal(s.read, 2);
    assert.equal(s.labelled, 1);
    assert.equal(s.unlabelled, 1);
    assert.equal(s.gaps[0].skipReason, "budget");
  });

  it("quotes the same words once, however many posts carry them", () => {
    const s = askSummary([page([c("1", "Does it work on Windows?", 5, L(0.9, 0, 0, 3))]), page([c("2", "does it work on windows?", 4, L(0.9, 0, 0, 3)), c("3", "Is it free?", 2, L(0.9, 0, 0, 3))])]);
    assert.equal(s.classes.question.count, 3, "every comment is counted");
    assert.deepEqual(s.classes.question.quotes.map((q) => q.text), ["Does it work on Windows?", "Is it free?"]);
  });

  it("scrubs contact details out of quotes and keeps them short", () => {
    const s = askSummary([page([c("1", `Is it free? mail me at a@b.co or call +44 7700 900123 ${"x".repeat(200)}`, 9, L(0.9, 0, 0, 3))])]);
    const q = s.classes.question.quotes[0].text;
    assert.doesNotMatch(q, /a@b\.co|7700/);
    assert.ok(q.length <= 140);
  });
});

describe("naming", () => {
  it("names an account of 10,000 followers or more, and describes the rest", () => {
    assert.equal(mayName(10_000), true);
    assert.equal(mayName(9_999), false);
    assert.equal(mayName(null), false, "unknown size is not named");
    assert.equal(accountLabel({ platform: "tiktok", handle: "maverickgpt", followers: 641_411 }), "@maverickgpt");
    assert.equal(accountLabel({ platform: "tiktok", handle: "smallcreator", followers: 1_189 }), "a creator with 1,189 followers");
    assert.equal(accountLabel({ platform: "instagram", handle: "someone", followers: null }), "a creator of unknown size");
    assert.equal(accountLabel({ platform: "youtube", handle: "@IBMTechnology", followers: 1_850_000 }), "@IBMTechnology");
    assert.equal(accountLabel({ platform: "youtube", handle: null, followers: 6_220 }), "a channel with 6,220 subscribers");
    assert.equal(accountLabel({ platform: "youtube", handle: null, followers: 1_850_000, title: "IBM Technology" }), "IBM Technology", "a big channel with no handle is named by its title");
  });
});
