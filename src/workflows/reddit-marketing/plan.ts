// reddit-marketing, the plan: a keyword in, the calls a run sends out. Pure; nothing here
// spends. Measured on 27/11/2026 for "headless CMS" (the fixtures in test/fixtures/reddit-marketing):
//
//   search:top   reddit/search, the month's top threads, 50 rows, topic-filtered
//   search:new   reddit/search, the last 7 days, newest first, topic-filtered: the fresh asks
//   rules        reddit/subreddit/details for the leading communities: subscribers and rules
//   baseline     reddit/subreddit top of the month per community: Reddit votes belong to the
//                community, so a thread is measured against its community (study file 18)
//   comments     reddit/post/comments on the leading threads, the four labels sent explicitly
import type { Breakout } from "../../engine/breakout.ts";
import { quote } from "../../engine/rates.ts";
import type { Quote } from "../../engine/rates.ts";
import type { Row } from "../../engine/rows.ts";
import { COMMENT_LABELS, stageParams, topicSentence } from "../../engine/stages.ts";
import type { Params } from "../../engine/stages.ts";

export const WORKFLOW = "reddit-marketing";

export interface RedditInput {
  /** The words the person typed: "headless CMS". */
  keyword: string;
  /** A fuller sentence for the topic filter, when the keyword alone is ambiguous. */
  about?: string;
  deep?: boolean;
  now: Date;
}

export interface Depth {
  /** One deep read of this many rows (1 credit per 25, plus the topic filter's hold of 4), or none. */
  topLimit?: number;
  topPages: number;
  newLimit?: number;
  newPages: number;
  communities: number;
  threads: number;
}

// The default reads deep in one call: limit=50 on the month read 41 rows and stopped at the end
// (req-Pd9Foo2ZFjxyFkaw, req-AeeJAqfNsvqwhYkD). A deep run walks pages instead: limit=150 on the
// year read one page of 26 rows and stopped with more to read (req-X9W0IqCgr0r5WJwY), and
// limit=200 cost 12 against the engine's one-page cap of 10 (req-UOhthEBsfN1JBUNo).
export const DEFAULT_DEPTH: Depth = { topLimit: 50, topPages: 1, newLimit: 25, newPages: 1, communities: 4, threads: 3 };
export const DEEP_DEPTH: Depth = { topPages: 6, newPages: 4, communities: 8, threads: 8 };

export const depthOf = (input: Pick<RedditInput, "deep">): Depth => (input.deep ? DEEP_DEPTH : DEFAULT_DEPTH);

export interface StageCall {
  stage: string;
  endpoint: string;
  params: Params;
}

export function topicOf(input: Pick<RedditInput, "keyword" | "about">): string {
  return topicSentence(input.keyword, input.about);
}

/** A phrase of two or more words is searched as a phrase; whatever the person quoted stays as typed. */
function queryOf(keyword: string): string {
  const k = keyword.trim();
  return /\s/.test(k) && !/["]/.test(k) ? `"${k}"` : k;
}

const isoMinute = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export function searchCalls(input: RedditInput): StageCall[] {
  const d = depthOf(input);
  const opts = { topic: topicOf(input), labels: "default" as const };
  const query = queryOf(input.keyword);
  const since = isoMinute(new Date(input.now.getTime() - 7 * 86_400_000));
  return [
    { stage: "search:top", endpoint: "reddit/search", params: stageParams("reddit/search", { query, sort: "top", timeframe: input.deep ? "year" : "month", limit: d.topLimit, max_pages: d.topPages }, opts) },
    { stage: "search:new", endpoint: "reddit/search", params: stageParams("reddit/search", { query, sort: "new", since, limit: d.newLimit, max_pages: d.newPages }, opts) },
  ];
}

export interface ThreadLike {
  row: Row;
  intent: string | null;
}

/** The communities that hold the most on-topic threads (promotional ones left out), then the highest summed score. */
export function communitiesToRead(threads: ThreadLike[], n: number): string[] {
  const by = new Map<string, { name: string; threads: number; score: number }>();
  for (const t of threads) {
    if (!t.row.community || t.intent === "promoting") continue;
    const k = t.row.community.toLowerCase();
    const c = by.get(k) ?? { name: t.row.community, threads: 0, score: 0 };
    c.threads++;
    c.score += t.row.likes ?? 0;
    by.set(k, c);
  }
  return [...by.values()]
    .sort((a, b) => b.threads - a.threads || b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((c) => c.name);
}

export function detailsCall(community: string): StageCall {
  return { stage: "rules", endpoint: "reddit/subreddit/details", params: { subreddit: community } };
}

/** The community's top posts of the month: never topic-filtered, judging off (no label is read). */
export function baselineCall(community: string): StageCall {
  return { stage: "baseline", endpoint: "reddit/subreddit", params: stageParams("reddit/subreddit", { subreddit: community, sort: "top", timeframe: "month", max_pages: 1 }, { labels: "off" }) };
}

export function commentCall(url: string): StageCall {
  return { stage: "comments", endpoint: "reddit/post/comments", params: { ...stageParams("reddit/post/comments", { url, max_pages: 1 }, { labels: "explicit" }), label: COMMENT_LABELS.join(",") } };
}

/** Threads that broke out or sit above usual first, then the most discussed; a thread with no comments is never read. */
export function commentTargets(items: { row: Row; band: Breakout["band"] }[], n: number): Row[] {
  const first = (b: Breakout["band"]) => (b === "beat" || b === "above" ? 0 : 1);
  return items
    .filter((i) => i.row.comments !== 0)
    .sort((a, b) => first(a.band) - first(b.band) || (b.row.comments ?? -1) - (a.row.comments ?? -1))
    .slice(0, n)
    .map((i) => i.row);
}

/** The free quote of a whole run, from the engine's one rate table. */
export function planQuote(input: RedditInput): Quote {
  const d = depthOf(input);
  const pages = (limit: number | undefined, walk: number) => (limit === undefined ? walk : Math.max(1, Math.ceil(limit / 25)));
  return quote([
    { stage: "search:top", endpoint: "reddit/search", pages: pages(d.topLimit, d.topPages), topic: true },
    { stage: "search:new", endpoint: "reddit/search", pages: pages(d.newLimit, d.newPages), topic: true },
    { stage: "rules", endpoint: "reddit/subreddit/details", count: d.communities },
    { stage: "baseline", endpoint: "reddit/subreddit", count: d.communities },
    { stage: "comments", endpoint: "reddit/post/comments", count: d.threads },
  ]);
}
