// reddit-marketing, the plan: which calls a run sends, before anything is spent.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baselineCall, commentCall, commentTargets, communitiesToRead, detailsCall, planQuote, searchCalls, topicOf, DEFAULT_DEPTH, DEEP_DEPTH } from "../../../src/workflows/reddit-marketing/plan.ts";
import { walkParams } from "../../../src/engine/rates.ts";
import { row } from "../../engine/helpers.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const IN = { keyword: "headless CMS", now: NOW };

describe("the topic", () => {
  it("is the keyword, or the fuller sentence the person gave", () => {
    assert.equal(topicOf(IN), "headless CMS");
    assert.equal(topicOf({ ...IN, about: "headless CMS software for websites" }), "headless CMS software for websites");
  });
});

describe("the searches", () => {
  it("reads the month's top threads and the last 7 days' new ones, both topic-filtered, each with max_pages", () => {
    const [top, fresh] = searchCalls(IN);
    assert.equal(top.endpoint, "reddit/search");
    assert.equal(top.params.query, '"headless CMS"');
    assert.equal(top.params.sort, "top");
    assert.equal(top.params.timeframe, "month");
    assert.equal(top.params.limit, 50);
    assert.equal(fresh.params.sort, "new");
    assert.equal(fresh.params.since, "2026-11-20T12:00:00Z");
    for (const c of [top, fresh]) {
      assert.equal(c.params.relevance, "filter");
      assert.equal(c.params.relevant_to, "headless CMS");
      assert.equal(c.params.max_pages, 1);
    }
  });

  it("leaves a one-word keyword unquoted, and a keyword the person quoted as typed", () => {
    assert.equal(searchCalls({ ...IN, keyword: "Strapi" })[0].params.query, "Strapi");
    assert.equal(searchCalls({ ...IN, keyword: '"page builder"' })[0].params.query, '"page builder"');
  });

  it("never sends a search whose price passes the cap the engine sends with it", () => {
    // The API prices one reddit/search read at 1 credit per 25 rows of `limit` plus the topic
    // filter's hold of 4; under that cap it answers a free 400 (req-UOhthEBsfN1JBUNo, 27/11/2026:
    // limit 200 cost 12 against a cap of 10, so a deep run read only the new search).
    for (const deep of [false, true]) {
      for (const c of searchCalls({ ...IN, deep })) {
        const sent = walkParams(c.endpoint, c.params, Infinity);
        const price = c.params.limit !== undefined ? Math.ceil(Number(c.params.limit) / 25) + 4 : Number(c.params.max_pages) * 5;
        assert.ok(price <= Number(sent.max_credits), `${deep ? "deep" : "default"} ${c.stage}: limit ${c.params.limit} costs ${price}, cap ${sent.max_credits}`);
      }
    }
  });

  it("reads a year on a deep run by walking pages, not by a deep limit", () => {
    // limit=150 with timeframe=year read one page of 26 rows and stopped at max_pages with more
    // to read (req-X9W0IqCgr0r5WJwY, 27/11/2026), so a deep run walks pages instead.
    const [top, fresh] = searchCalls({ ...IN, deep: true });
    assert.equal(top.params.timeframe, "year");
    assert.equal(top.params.limit, undefined);
    assert.equal(top.params.max_pages, DEEP_DEPTH.topPages);
    assert.equal(fresh.params.limit, undefined);
    assert.equal(fresh.params.max_pages, DEEP_DEPTH.newPages);
    assert.ok(DEEP_DEPTH.topPages > 1 && DEEP_DEPTH.newPages > 1);
  });
});

describe("which communities are read", () => {
  const t = (id: string, community: string, likes: number, intent: string | null = null) => ({ row: row({ platform: "reddit", id, community, likes }), intent });

  it("ranks communities by their on-topic threads, then by summed score, and leaves promotional threads out", () => {
    const threads = [
      t("1", "webdev", 35),
      t("2", "webdev", 8),
      t("3", "nextjs", 28),
      t("4", "cms", 5),
      t("5", "jobboard", 1, "promoting"),
      t("6", "jobboard", 1, "promoting"),
      t("7", "jobboard", 1, "promoting"),
    ];
    assert.deepEqual(communitiesToRead(threads, 2), ["webdev", "nextjs"]);
    assert.deepEqual(communitiesToRead(threads, 9), ["webdev", "nextjs", "cms"]);
  });

  it("reads each community's rules once and its top posts of the month as the baseline, unfiltered and unjudged", () => {
    assert.deepEqual(detailsCall("webdev"), { stage: "rules", endpoint: "reddit/subreddit/details", params: { subreddit: "webdev" } });
    const b = baselineCall("webdev");
    assert.equal(b.endpoint, "reddit/subreddit");
    assert.deepEqual({ ...b.params }, { subreddit: "webdev", sort: "top", timeframe: "month", max_pages: 1, judgments: "off" });
    assert.equal(b.params.relevant_to, undefined);
  });
});

describe("which threads' comments are read", () => {
  it("takes the threads that broke out or sit above usual first, then the most discussed", () => {
    const items = [
      { row: row({ platform: "reddit", id: "a", comments: 49 }), band: "normal" as const },
      { row: row({ platform: "reddit", id: "b", comments: 30 }), band: "above" as const },
      { row: row({ platform: "reddit", id: "c", comments: 53 }), band: "too_few" as const },
      { row: row({ platform: "reddit", id: "d", comments: 0 }), band: "beat" as const },
      { row: row({ platform: "reddit", id: "e", comments: 12 }), band: "normal" as const },
    ];
    assert.deepEqual(commentTargets(items, 3).map((r) => r.id), ["b", "c", "a"]);
  });

  it("never reads a thread with no comments", () => {
    assert.deepEqual(commentTargets([{ row: row({ platform: "reddit", id: "z", comments: 0 }), band: "beat" }], 3), []);
  });

  it("sends the four comment labels explicitly", () => {
    const c = commentCall("https://www.reddit.com/r/webdev/comments/t001/");
    assert.equal(c.endpoint, "reddit/post/comments");
    assert.equal(c.params.label, "sentiment,question,purchase_intent,complaint");
    assert.equal(c.params.max_pages, 1);
  });
});

describe("the free quote", () => {
  it("fits a default run well inside the 100 welcome credits", () => {
    const q = planQuote(IN);
    assert.ok(q.max <= 40, `at most ${q.max}`);
    assert.ok(q.expected >= 20 && q.expected <= q.max, `about ${q.expected}`);
  });

  it("prices a deep run higher, reading more communities and threads", () => {
    const deep = planQuote({ ...IN, deep: true });
    assert.ok(deep.max > planQuote(IN).max);
    assert.ok(DEEP_DEPTH.communities > DEFAULT_DEPTH.communities && DEEP_DEPTH.threads > DEFAULT_DEPTH.threads);
  });
});
