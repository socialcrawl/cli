// x-marketing's stages, every call through the Session:
//
//   1. search      top and latest posts on the keyword over the window, topic-filtered
//   2. candidates  originals in the window at or above the floor, one copy each
//   3. baselines   social-viral's readBaselines: the engine's X read, the author's originals up
//                  to the post's minute (from:<h> -filter:replies -filter:retweets, until=,
//                  max_items 20, max_pages 2; study file 25), one more page when short
//   4. rank        social-viral's rankViral: the multiple, the band, the engagement flags
//   5. amplifiers  one retweeter page for the top break-outs and for any break-out with low likes
//                  per view, so the boosted flag can test both of its conditions (study file 22)
//   6. quotes      quoted_tweet_id:<id> for the top break-outs: about two thirds of the quotes a
//                  post has (an undocumented operator, file 18 N12) until SOC-01 ships
//   7. replies     the top break-outs' replies, labels sent explicitly
import { BIG_FOLLOWERS, rateOf, retweeterRead, rowsOf, stageParams, topicSentence, uniqueRows } from "../../engine/index.ts";
import type { Row } from "../../engine/index.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import type { WorkflowArgs } from "../types.ts";
import { askSummary } from "../_video/comments.ts";
import type { AskSummary } from "../_video/comments.ts";
import { inWindow, windowOf } from "../_video/window.ts";
import type { Window } from "../_video/window.ts";
import { readBaselines } from "../social-viral/runner.ts";
import { rankViral } from "../social-viral/viral.ts";
import type { ViralItem, ViralPlatform, ViralResult } from "../social-viral/viral.ts";

export const FLOOR_VIEWS = 1_000;

export interface XShares {
  search: number;
  baselines: number;
  amplifiers: number;
  quotes: number;
  replies: number;
}
export const SHARES: { default: XShares; deep: XShares } = {
  default: { search: 16, baselines: 30, amplifiers: 5, quotes: 3, replies: 5 },
  deep: { search: 40, baselines: 60, amplifiers: 24, quotes: 12, replies: 32 },
};
export const DEPTH = {
  default: { topPages: 2, latestPages: 1, amplified: 3, quoted: 2, replied: 3, replyPages: 1, retweeterPages: 1 },
  deep: { topPages: 4, latestPages: 2, amplified: 6, quoted: 6, replied: 8, replyPages: 2, retweeterPages: 2 },
};

export interface Candidates {
  rows: Row[];
  read: number;
  outsideWindow: number;
  notOriginal: number;
  noViews: number;
  belowFloor: number;
}

export interface Amplifiers {
  postId: string;
  read: number;
  big: number;
  /** Retweeters of 10,000 followers or more, by handle, largest first: the only ones a report names. */
  bigAccounts: { handle: string; followers: number }[];
  requestId: string | null;
}

export interface Quotes {
  postId: string;
  found: number;
  /** Quoting accounts of 10,000 followers or more, largest first. */
  bigQuoters: { handle: string; followers: number }[];
  /** Minutes from the post to its first quote found; null when none was found. */
  firstMinutes: number | null;
  requestId: string | null;
}

export interface XRun {
  query: string;
  topic: string;
  window: Window;
  deep: boolean;
  searches: CallRecord[];
  allRows: Row[];
  candidates: Candidates;
  result: ViralResult;
  /** The ranked candidates with a baseline read: result.items, after the retweeter reads. */
  items: ViralItem[];
  amplifiers: Amplifiers[];
  quotes: Quotes[];
  replies: CallRecord[];
  asks: AskSummary;
}

const spentIn = (session: Session, group: string) => session.ledger.lines.filter((l) => l.stage.split(":")[0] === group).reduce((s, l) => s + l.credits, 0);
const urlOf = (r: Row) => r.url ?? `https://x.com/i/status/${r.id}`;

export function candidatesOf(rows: Row[], w: Window, floor = FLOOR_VIEWS): Candidates {
  const c: Candidates = { rows: [], read: rows.length, outsideWindow: 0, notOriginal: 0, noViews: 0, belowFloor: 0 };
  for (const r of rows) {
    if (!inWindow(r, w)) c.outsideWindow++;
    else if (r.kind !== "original") c.notOriginal++;
    else if (r.views === null) c.noViews++;
    else if (r.views < floor) c.belowFloor++;
    else c.rows.push(r);
  }
  return c;
}

/** Accounts of 10,000 followers or more in a page, largest first, never the post's own author. */
function accountsOf(rec: CallRecord | null, pick: (it: any) => { handle: unknown; followers: unknown }, author: string): { handle: string; followers: number }[] {
  const self = author.replace(/^@/, "").toLowerCase();
  const items: any[] = Array.isArray((rec?.body?.data as { items?: unknown[] } | undefined)?.items) ? ((rec!.body.data as { items: unknown[] }).items as any[]) : [];
  return items
    .map(pick)
    .filter((a): a is { handle: string; followers: number } => typeof a.handle === "string" && typeof a.followers === "number" && a.followers >= BIG_FOLLOWERS)
    .map((a) => ({ handle: a.handle.replace(/^@/, ""), followers: a.followers }))
    .filter((a) => a.handle.toLowerCase() !== self)
    .sort((a, b) => b.followers - a.followers);
}

export async function runX(session: Session, args: WorkflowArgs): Promise<XRun> {
  const query = args.input.trim();
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about : query;
  const topic = topicSentence(query, about);
  const window = windowOf(args);
  const sh = args.deep ? SHARES.deep : SHARES.default;
  const depth = args.deep ? DEPTH.deep : DEPTH.default;

  // 1. search
  const searches: CallRecord[] = [];
  const r = rateOf("twitter/search/tweets");
  for (const [sort, pages] of [["top", depth.topPages], ["latest", depth.latestPages]] as const) {
    const params = stageParams("twitter/search/tweets", { query, sort, ...(window.allTime ? {} : { since: window.since }), max_pages: pages }, { topic, labels: "default" });
    const rec = await session.call(`search:${sort}`, "twitter/search/tweets", params, Math.min(pages * (r.page + (r.topicHold ?? 0)), sh.search - spentIn(session, "search")));
    if (rec) searches.push(rec);
  }
  const allRows = uniqueRows(searches.flatMap((x) => rowsOf(x)));

  // 2. candidates
  const candidates = candidatesOf(allRows, window);

  // 3 and 4. baselines and rank, through social-viral's shared path
  const shares: Record<ViralPlatform, number> = { x: sh.baselines, tiktok: 0, instagram: 0, youtube: 0, reddit: 0, linkedin: 0 };
  const { plans, pages } = await readBaselines(session, candidates.rows, shares, () => args.now);
  let result = rankViral(candidates.rows, plans, pages, { now: args.now });

  // 5. amplifiers: the top break-outs, and any break-out whose likes per view are low
  const byMultiple = (a: ViralItem, b: ViralItem) => (b.breakout.multiple ?? 0) - (a.breakout.multiple ?? 0);
  const viral = result.items.filter((i) => i.viral).sort(byMultiple);
  const suspect = result.items.filter((i) => i.breakout.band === "beat" && i.flag?.flag === "unusual_engagement");
  const toRead = [...new Map([...viral.slice(0, depth.amplified), ...suspect].map((i) => [i.row.id, i])).values()];
  const retweeters = new Map<string, { read: number; big: number }>();
  const amplifiers: Amplifiers[] = [];
  for (const i of toRead) {
    const rec = await session.call("amplifiers:x", "twitter/tweet/retweeters", { url: urlOf(i.row), max_pages: depth.retweeterPages }, sh.amplifiers - spentIn(session, "amplifiers"));
    if (!rec) continue;
    const read = retweeterRead(rec.body);
    retweeters.set(i.row.id, read);
    amplifiers.push({ postId: i.row.id, read: read.read, big: read.big, bigAccounts: accountsOf(rec, (it) => ({ handle: it?.author?.username ?? it?.user?.username, followers: it?.author?.followers ?? it?.user?.followers }), i.row.author), requestId: rec.requestId });
  }
  if (retweeters.size) result = rankViral(candidates.rows, plans, pages, { now: args.now, retweeters });

  // 6. quotes, through the quoted_tweet_id: operator
  const top = result.items.filter((i) => i.viral).sort(byMultiple);
  const quotes: Quotes[] = [];
  for (const i of top.slice(0, depth.quoted)) {
    // A quote search is not a topic search: judging off, no topic filter.
    const rec = await session.call("quotes:x", "twitter/search/tweets", { query: `quoted_tweet_id:${i.row.id}`, max_pages: 1, judgments: "off" }, sh.quotes - spentIn(session, "quotes"));
    if (!rec) continue;
    const found = rowsOf(rec).filter((q) => q.id !== i.row.id);
    const t0 = i.row.publishedAt ? Date.parse(i.row.publishedAt) : NaN;
    const first = found.map((q) => (q.publishedAt ? Date.parse(q.publishedAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    quotes.push({
      postId: i.row.id,
      found: found.length,
      bigQuoters: found.filter((q) => (q.authorFollowers ?? 0) >= BIG_FOLLOWERS && q.author.toLowerCase() !== i.row.author.toLowerCase()).map((q) => ({ handle: q.author, followers: q.authorFollowers as number })).sort((a, b) => b.followers - a.followers),
      firstMinutes: Number.isFinite(t0) && first !== undefined ? Math.max(0, Math.round((first - t0) / 60_000)) : null,
      requestId: rec.requestId,
    });
  }

  // 7. replies, labelled
  const replies: CallRecord[] = [];
  for (const i of top.slice(0, depth.replied)) {
    const params = stageParams("twitter/tweet/replies", { url: urlOf(i.row), max_pages: depth.replyPages }, { labels: "explicit" });
    const rec = await session.call("replies:x", "twitter/tweet/replies", params, sh.replies - spentIn(session, "replies"));
    if (rec) replies.push(rec);
  }

  return { query, topic, window, deep: args.deep, searches, allRows, candidates, result, items: result.items, amplifiers, quotes, replies, asks: askSummary(replies) };
}
