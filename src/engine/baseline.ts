// The baseline plan: which authors' usual reach a discovery run pays to read, within budget.
//
// Measured on 26/11/2026 (study file 18, section 4.4, and study file 25, job 1):
//   every platform the base is the author's posts BEFORE the candidate ("previous" mode): a page
//                  read newest first is mostly posts made after a break-out, which pulls the
//                  base down (file 25: TikTok 313x, 285x and 240x became 69x, 72x and 18.5x)
//   X              one originals-only search page ending at the post (from:<h> -filter:replies
//                  -filter:retweets, until=<post>, max_items=20, max_pages=2): 10 of 10 authors
//                  with 8 or more earlier originals for 11 credits, against 1 of 10 for one
//                  timeline page and 4 of 10 for three (file 25)
//   X and TikTok   candidates can still be ranked free by views over followers (Spearman 0.69 on
//                  X and 0.56 on TikTok against the strict ratio, file 25) to choose whom to read
//   YouTube, Instagram   pay the page (views over subscribers agreed at 0.18 only)
//   LinkedIn       pay the page (5 credits an author), so fewer authors fit
//   Reddit         the community's median, one 1-credit listing per community: votes belong
//                  to the community, not the author
// `profile/full` is never used for a baseline: five times the price for the same page, and a
// mean that one outlier moves.
import { RATES } from "./rates.ts";
import { breakoutOf, median } from "./breakout.ts";
import type { Breakout, BreakoutOptions } from "./breakout.ts";
import type { Platform, Row } from "./rows.ts";

export type BaselineMethod = "pre_rank_then_confirm" | "pay_page" | "community_median" | "none";

export const BASELINE_METHOD: Record<Platform, BaselineMethod> = {
  x: "pre_rank_then_confirm",
  tiktok: "pre_rank_then_confirm",
  youtube: "pay_page",
  instagram: "pay_page",
  linkedin: "pay_page",
  reddit: "community_median",
  threads: "none",
  facebook: "none",
  other: "none",
};

/** How many authors a platform confirms by default (file 18: the top 10 to 15). */
export const DEFAULT_CONFIRM = 12;

export interface BaselineStep {
  platform: Platform;
  /** The author, or the community on Reddit. */
  key: string;
  endpoint: string;
  params: Record<string, string | number>;
  /** The most this step may spend (its pages at the page price). */
  credits: number;
  /** The candidate rows this page is the baseline for. */
  rowIds: string[];
  preRank: number | null;
}

export type SkipReason = "below_top_n" | "budget" | "no_id" | "no_method";

export interface BaselinePlan {
  platform: Platform;
  method: BaselineMethod;
  steps: BaselineStep[];
  skipped: { key: string; reason: SkipReason; rowIds: string[] }[];
  credits: number;
}

export interface PlanOptions {
  confirm?: number;
  /** Credits this platform's baselines may spend; steps past it are skipped as "budget". */
  budget?: number;
  /** X only: which read is the baseline (see XBaselineRead). */
  xRead?: XBaselineRead;
}

/** Views over followers from a search row: the free pre-rank, labelled weaker than a baseline. */
export function viewsPerFollower(r: Row): number | null {
  if (r.views === null || r.authorFollowers === null || r.authorFollowers <= 0) return null;
  return r.views / r.authorFollowers;
}

/**
 * How an X author's baseline is read. "originals_search" (the default since study file 25):
 * the author's own originals up to the post, `max_items=20&max_pages=2`, so a short first page
 * continues without the other authors paying for a second. "timeline_page": one
 * `twitter/user/tweets` page, which reads the posts made after a break-out and left 9 of 10
 * authors under 8 earlier originals (file 25); kept only for comparison.
 */
export type XBaselineRead = "timeline_page" | "originals_search";

/** X's `until` to the minute before the post, as reader 25 sent it ("2026-11-24T13:46:00Z"); the post itself is dropped by id. */
export function untilOf(publishedAt: string): string {
  return `${new Date(publishedAt).toISOString().slice(0, 16)}:00Z`;
}

export function xBaselineCall(author: string, until: string | null = null, read: XBaselineRead = "originals_search"): { endpoint: string; params: Record<string, string | number> } {
  if (read === "originals_search") {
    const params: Record<string, string | number> = { query: `from:${author} -filter:replies -filter:retweets`, max_items: 20, max_pages: 2 };
    if (until) params.until = untilOf(until);
    return { endpoint: "twitter/search/tweets", params };
  }
  return { endpoint: "twitter/user/tweets", params: { handle: author } };
}

/** The timeline page that is an author's baseline, or null when the row lacks the id it needs (YouTube Shorts rows carry no channel id). */
export function timelineCall(r: Row, xRead: XBaselineRead = "originals_search"): { endpoint: string; params: Record<string, string | number> } | null {
  switch (r.platform) {
    case "x":
      return r.author ? xBaselineCall(r.author, r.publishedAt, xRead) : null;
    case "tiktok":
      return r.author ? { endpoint: "tiktok/profile/videos", params: { handle: r.author } } : null;
    case "instagram":
      return r.author ? { endpoint: "instagram/profile/reels", params: { handle: r.author } } : null;
    case "youtube":
      return r.channelId ? { endpoint: "youtube/channel/videos", params: { channelId: r.channelId } } : null;
    case "linkedin":
      return r.authorUrl ? { endpoint: "linkedin/profile/posts", params: { url: r.authorUrl } } : null;
    case "reddit":
      return r.community ? { endpoint: "reddit/subreddit", params: { subreddit: r.community, sort: "top", timeframe: "month" } } : null;
    default:
      return null;
  }
}

const keyOf = (r: Row) => (r.platform === "reddit" ? (r.community ?? "") : r.author).toLowerCase();

/**
 * Plan one platform's baselines for the candidate rows of a discovery run. Each author (or
 * community) is read once, however many of its posts are candidates. Order: X and TikTok by
 * views over followers, highest first, the rest by raw reach. Nothing is spent here.
 */
export function planBaselines(candidates: Row[], platform: Platform, opts: PlanOptions = {}): BaselinePlan {
  const method = BASELINE_METHOD[platform];
  const confirm = opts.confirm ?? DEFAULT_CONFIRM;
  const budget = opts.budget ?? Infinity;
  const rows = candidates.filter((r) => r.platform === platform);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const plan: BaselinePlan = { platform, method, steps: [], skipped: [], credits: 0 };
  if (method === "none") {
    for (const [key, g] of groups) plan.skipped.push({ key, reason: "no_method", rowIds: g.map((r) => r.id) });
    return plan;
  }
  const score = (g: Row[]): number => {
    if (method === "pre_rank_then_confirm") return Math.max(...g.map((r) => viewsPerFollower(r) ?? -1));
    return Math.max(...g.map((r) => r.views ?? r.likes ?? -1));
  };
  const ordered = [...groups.entries()].sort((a, b) => score(b[1]) - score(a[1]) || a[0].localeCompare(b[0]));
  // Reddit is capped by communities, not authors; the same top-N rule applies.
  for (const [key, g] of ordered) {
    const rowIds = g.map((r) => r.id);
    // One read per author: on X the search ends at the author's newest candidate, so it holds the
    // posts before every candidate of the group ("previous" mode drops the later ones per post).
    const newest = [...g].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    const call = newest.map((r) => timelineCall(r, opts.xRead)).find((c) => c !== null) ?? null;
    if (!call) {
      plan.skipped.push({ key, reason: "no_id", rowIds });
      continue;
    }
    if (plan.steps.length >= confirm) {
      plan.skipped.push({ key, reason: "below_top_n", rowIds });
      continue;
    }
    const credits = (RATES[call.endpoint]?.page ?? 1) * Math.max(1, Number(call.params.max_pages ?? 1));
    if (plan.credits + credits > budget) {
      plan.skipped.push({ key, reason: "budget", rowIds });
      continue;
    }
    const s = score(g);
    plan.steps.push({ platform, key, endpoint: call.endpoint, params: call.params, credits, rowIds, preRank: method === "pre_rank_then_confirm" && s >= 0 ? Math.round(s * 1000) / 1000 : null });
    plan.credits += credits;
  }
  return plan;
}

/**
 * A candidate post against its baseline page, in "previous" mode on every platform: only the
 * author's comparable posts published before it count (on Reddit, the community's earlier
 * posts in its listing, all of them). The post is joined to the page and left out of its own
 * base. Under 8 earlier posts the band is too_few, and `morePage` says whether one more page
 * may be read.
 */
export function breakoutWithPage(target: Row, page: Row[], opts: Omit<BreakoutOptions, "mode">): Breakout {
  const window = target.platform === "reddit" ? Infinity : opts.window;
  // Earlier posts under 48 hours old stay in the base (a busy account's day before a break-out),
  // counted in youngPeers, with inflatedByYoung, settledMultiple and overBestPeer as the checks.
  return breakoutOf(target, [target, ...page.filter((r) => r.id !== target.id)], { settleHours: 0, ...opts, window, mode: "previous" });
}

/**
 * One more page for a baseline that came back thin: the same call with the response's cursor,
 * when the band is too_few, the response says more exists, and the platform's share still has
 * room for it. Null otherwise; the report then says "too few posts".
 */
export function morePage(
  b: Breakout,
  step: BaselineStep,
  body: { data?: any; pagination?: any },
  shareLeft: number,
): BaselineStep | null {
  if (b.band !== "too_few") return null;
  const cursor = body?.pagination?.next_cursor ?? body?.data?.next_cursor ?? null;
  const more = body?.pagination?.has_more ?? Boolean(cursor);
  const credits = RATES[step.endpoint]?.page ?? 1;
  if (!cursor || !more || shareLeft < credits) return null;
  return { ...step, params: { ...step.params, cursor, max_pages: 1 }, credits };
}

export interface CommunityBaseline {
  community: string;
  median: number | null;
  posts: number;
  requestIds: string[];
}

/** Reddit: the median score of each community's listing, for the report (a post's own multiple comes from `breakoutWithPage`, which leaves the post out). Under 8 posts it is null. */
export function communityBaselines(listing: Row[], minPosts = 8): Map<string, CommunityBaseline> {
  const by = new Map<string, Row[]>();
  for (const r of listing) {
    if (!r.community || r.likes === null) continue;
    const k = r.community.toLowerCase();
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }
  const out = new Map<string, CommunityBaseline>();
  for (const [k, g] of by) {
    out.set(k, {
      community: g[0].community as string,
      median: g.length >= minPosts ? median(g.map((r) => r.likes as number)) : null,
      posts: g.length,
      requestIds: [...new Set(g.map((r) => r.requestId).filter((x): x is string => x !== null))],
    });
  }
  return out;
}

/** Spearman's rank correlation with average ranks for ties; null under 3 pairs. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? null : Math.round((num / Math.sqrt(da * db)) * 100) / 100;
}
