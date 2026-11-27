// The X stages of social-teardown, in order. Every call goes through the Tracker (the
// harness's Session: one budget, max_pages on every walk, every response kept); the free
// quote for the whole run is the workflow's quote(), before any of this runs.
//
//   1 profile           twitter/profile
//   2 timeline          twitter/search/tweets from:<handle>, one walk per month back to the start
//                       window, plus twitter/user/tweets for the newest posts (search leaves out
//                       posts that are only a link, which is how many accounts post "repo below")
//   2b missing roots    twitter/tweet for conversation roots the search left out
//   3 code + outliers   no calls (codebook.ts)
//   4 depth set         the top posts by views and the main post of each top launch
//   5 amplifiers        twitter/tweet/retweeters
//   6 replies           twitter/tweet/replies, with the API's free question / intent / complaint labels
//   7 transcripts       twitter/tweet/transcript for the video posts of the depth set (10 credits each)
//   8 off-platform      github/repo for each repository the account links
//   9 Reddit footprint  reddit/search for the handle and the top launch names
//  10 first hours       twitter/search/tweets for other accounts naming the handle or the launch's
//                       domain from 1 hour before to 2 hours after each top launch post
//  10b quotes           twitter/search/tweets quoted_tweet_id:<id> in the first 3 hours
//  11 off-X echo        prism/launch-echo (Hacker News and developer blogs), deep runs only
import { codePosts, repoOf, toXPost, urlsIn } from "./codebook.ts";
import type { XPost } from "./codebook.ts";
import { clusterLaunches, depthSet } from "./analyse.ts";
import { stageParams } from "../../../engine/stages.ts";
import type { PlannedCall, TaggedRecord, Tracker } from "../tracker.ts";

export interface XOptions {
  since?: string;
  /** Months back from now; 0 reads from the join date. */
  months?: number;
  depth: number;
  rtPages: number;
  replyPages: number;
  transcripts: number;
  repos: number;
  reddit: boolean;
  squad: number;
  echo: number;
  quotes: boolean;
  /** Hours after a post the quote search covers. X search reads newest first, so a short window is read to its start. */
  quoteHours: number;
  /** Minutes after a launch post the first-hours search covers (it starts 10 minutes before). */
  squadMinutes: number;
  now?: Date;
}

/**
 * Each stage's share of a 100-credit account budget, scaled with the budget the account is
 * given (xShares). A stage stops at its share and the report says what it did not read; the
 * timeline walk is newest first, so its share decides how far back the run reaches.
 */
export const X_SHARES: Record<string, number> = {
  profile: 1,
  timeline: 42,
  roots: 5,
  retweeters: 8,
  replies: 10,
  transcript: 10,
  github: 2,
  reddit: 0,
  squad: 8,
  quotes: 14,
};

/** Reddit's share on a deep run: one reddit/search with relevant_to needs at least 10 credits. */
export const X_REDDIT_DEEP = 4;

/** The shares for an account budget: every share scaled, the profile always 1, echo 20 each when it runs. */
export function xShares(budget: number): Record<string, number> {
  const k = budget / 100;
  const out: Record<string, number> = { echo: 20 };
  for (const [stage, share] of Object.entries(X_SHARES)) out[stage] = stage === "profile" ? 1 : Math.floor(share * k);
  if (budget > 100) out.reddit = Math.floor(X_REDDIT_DEEP * k);
  return out;
}

export const X_DEFAULTS: XOptions = { depth: 6, rtPages: 5, replyPages: 3, transcripts: 1, repos: 8, reddit: false, squad: 4, echo: 0, quotes: true, quoteHours: 1, squadMinutes: 60, months: 12 };

/** The research-grade read, as the study read Treg: the whole account and every top post's people. */
export const X_DEEP: XOptions = { depth: 10, rtPages: 10, replyPages: 5, transcripts: 5, repos: 8, reddit: true, squad: 8, echo: 1, quotes: true, quoteHours: 3, squadMinutes: 120, months: 0 };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Month windows [since, until) from the start date to now, newest first. */
export function monthWindows(start: Date, now: Date): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= now) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const since = cur < start ? start : cur;
    const until = next > now ? new Date(now.getTime() + 86_400_000) : next;
    out.push({ since: ymd(since), until: ymd(until) });
    cur = next;
  }
  return out.reverse();
}

export function postsFromRecords(rec: { stage: string; status: number; requestId: string | null; body: { data?: unknown } }[]): XPost[] {
  const posts: XPost[] = [];
  for (const r of rec) {
    if (r.stage !== "timeline" || r.status !== 200) continue;
    const d = r.body.data as any;
    const items = d?.items ?? (d?.post ? [{ post: d.post }] : []);
    for (const it of items) if (it?.post?.id) posts.push(toXPost(it.post, r.requestId ?? ""));
  }
  return posts;
}

/** The timeline's start: --since, else the join date, cut to `months` back when months > 0. */
export function timelineStart(opts: XOptions, joined: Date | null, now: Date): Date {
  let start = opts.since ? new Date(opts.since) : joined ?? new Date(now.getTime() - 365 * 86_400_000);
  if (!opts.since && opts.months && opts.months > 0) {
    const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - opts.months + 1, 1));
    if (start < floor) start = floor;
  }
  return start;
}

/** The X stages for one account, inside `budget` credits; `account` tags every call. */
export async function runX(t: Tracker, handleIn: string, opts: XOptions, budget: number, account = `x:${handleIn.replace(/^@/, "").toLowerCase()}`): Promise<TaggedRecord[]> {
  const handle = handleIn.replace(/^@/, "");
  const now = opts.now ?? new Date();
  const shares = xShares(budget);
  const tag = (m: Record<string, string> = {}) => ({ ...m, account });
  const share = (stage: string, sh: number, calls: PlannedCall[]) => t.withinShare(stage, sh, calls.map((c) => ({ ...c, meta: tag(c.meta) })));
  const mine = () => t.records.filter((r) => r.meta.account === account);

  // 1 profile
  await t.call("profile", "twitter/profile", { handle }, tag(), shares.profile);
  const prof: any = mine().find((x) => x.stage === "profile" && x.status === 200)?.body.data;
  const joined = prof?.author?.joined_at ? new Date(prof.author.joined_at) : null;

  // 2 timeline: the newest posts first (search leaves out link-only posts), then the months,
  // newest first, so a share that runs out cuts the oldest months, never the newest.
  const windows = monthWindows(timelineStart(opts, joined, now), now);
  const calls: PlannedCall[] = [{ endpoint: "twitter/user/tweets", params: { handle, max_pages: 5 }, meta: tag({ window: "newest" }) }];
  for (const w of windows) calls.push({ endpoint: "twitter/search/tweets", params: { query: `from:${handle}`, since: w.since, until: w.until, max_pages: 40 }, meta: tag({ window: `${w.since}..${w.until}` }) });
  await walkTimeline(t, calls, shares.timeline);

  // 2b missing roots: X search leaves some posts out, but the account's own replies under them
  // still point at them by conversation id. A root with 3 or more own replies is fetched by id.
  const roots = missingRoots(postsFromRecords(mine()), handle);
  await share("timeline", shares.roots, roots.map((id) => ({ endpoint: "twitter/tweet", params: { url: `https://x.com/${handle}/status/${id}` }, meta: { root: id } })));

  // 3 code, then 4 the depth set
  const coded = codePosts(postsFromRecords(mine()), handle);
  const launches = clusterLaunches(coded, handle);
  const depth = depthSet(coded, launches, opts.depth);
  const urlOf = (id: string) => coded.find((c) => c.post_id === id)?.url ?? `https://x.com/${handle}/status/${id}`;

  // 5 amplifiers, 6 replies
  await share("retweeters", shares.retweeters, depth.map((id) => ({ endpoint: "twitter/tweet/retweeters", params: { url: urlOf(id), max_pages: opts.rtPages }, meta: { post_id: id } })));
  await share("replies", shares.replies, depth.map((id) => ({ endpoint: "twitter/tweet/replies", params: stageParams("twitter/tweet/replies", { url: urlOf(id), max_pages: opts.replyPages }), meta: { post_id: id } })));

  // 7 transcripts
  const videos = depth.filter((id) => coded.find((c) => c.post_id === id)?.format === "video").slice(0, opts.transcripts);
  await share("transcript", shares.transcript * Math.max(1, videos.length), videos.map((id) => ({ endpoint: "twitter/tweet/transcript", params: { url: urlOf(id) }, meta: { post_id: id } })));

  // 8 off-platform: GitHub
  const repos = [...new Set(coded.filter((c) => c.kind !== "retweet").map((c) => urlsIn(c.text).map(repoOf).find(Boolean)).filter((x): x is string => Boolean(x)))].slice(0, opts.repos);
  await share("github", shares.github, repos.map((repo) => ({ endpoint: "github/repo", params: { url: `https://github.com/${repo}` }, meta: { repo } })));

  // 9 Reddit footprint
  const topLaunches = launches.slice().sort((a, b) => (b.mainViews ?? 0) - (a.mainViews ?? 0));
  if (opts.reddit) {
    const names = topLaunches.slice(0, 3).map((l) => shortName(l.artefactName)).filter(Boolean);
    const queries = [...new Set([handle, ...names])];
    await share("reddit", shares.reddit, queries.map((q) => ({ endpoint: "reddit/search", params: { query: `"${q}"`, sort: "top", timeframe: "year", limit: 25 }, meta: { query: q } })));
  }

  // 10 first hours: who else posts about the launch within the hours around it
  const squadQuery = (l: (typeof launches)[number]) => {
    const ts = Math.floor(new Date(coded.find((c) => c.post_id === l.mainPost)!.created_utc).getTime() / 1000);
    const dom = launchDomain(l.artefactName);
    return `(@${handle}${dom ? ` OR "${dom}"` : ""}) -from:${handle} since_time:${ts - 600} until_time:${ts + opts.squadMinutes * 60}`;
  };
  await share("squad", shares.squad, topLaunches.slice(0, opts.squad).map((l) => ({ endpoint: "twitter/search/tweets", params: { query: squadQuery(l), sort: "latest", max_pages: 3 }, meta: { post_id: l.mainPost, launch: l.artefactName, minutes: String(opts.squadMinutes) } })));

  // 10b quotes: who quoted each depth post, found with X's quoted_tweet_id: operator (the API
  // has no quote-list endpoint and no quoted post on rows, file 26 SR-01 and SR-02). The window
  // is the first 3 hours: on a large post a newest-first read never reaches the early quotes.
  const quoteQuery = (id: string) => {
    const ts = Math.floor(new Date(coded.find((c) => c.post_id === id)?.created_utc ?? now).getTime() / 1000);
    return `quoted_tweet_id:${id} since_time:${ts} until_time:${ts + opts.quoteHours * 3600}`;
  };
  if (opts.quotes) await share("quotes", shares.quotes, depth.map((id) => ({ endpoint: "twitter/search/tweets", params: { query: quoteQuery(id), sort: "latest", max_pages: 3 }, meta: { post_id: id, window: `${opts.quoteHours}h` } })));

  // 11 off-X echo: Hacker News and developer blogs (deep runs; it answers 502 when there is no echo, SR-47)
  const echoFor = topLaunches.slice(0, opts.echo).filter((l) => shortName(l.artefactName).length >= 3);
  const echoParams = (l: (typeof launches)[number]) => {
    const d = new Date(l.launchDate);
    return { query: shortName(l.artefactName), date_from: ymd(new Date(d.getTime() - 86_400_000)), date_to: ymd(new Date(d.getTime() + 14 * 86_400_000)) };
  };
  await share("echo", shares.echo * echoFor.length, echoFor.map((l) => ({ endpoint: "prism/launch-echo", params: echoParams(l), meta: { post_id: l.mainPost, launch: l.artefactName } })));
  return mine();
}

/**
 * The timeline inside its share: the newest posts, then each month newest first, every walk
 * capped at what is left of the share. When the share runs out the older months are not read,
 * and the report gives the oldest date the posts reached.
 */
async function walkTimeline(t: Tracker, calls: PlannedCall[], share: number): Promise<void> {
  let left = share;
  for (let i = 0; i < calls.length; i++) {
    const refused = t.session.notRead.length;
    const rec = left >= 1 ? await t.call("timeline", calls[i].endpoint, calls[i].params, calls[i].meta, left) : null;
    if (left < 1 || t.session.notRead.length > refused) {
      t.limits.push({ stage: "timeline", endpoint: calls[i].endpoint, reason: `${calls.length - i} of ${calls.length} timeline reads not made: the timeline's share of ${share} credits is spent; older months were not read` });
      return;
    }
    if (rec) left -= rec.creditsUsed;
  }
}

/** "superdesigndev/treg" -> "treg"; "treg.to/rea-marketing" -> "rea-marketing"; "/rea-brand" -> "rea-brand". */
export function shortName(name: string): string {
  const parts = name.replace(/^\//, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** The launch's own domain, when its name is a try-URL ("treg.to/rea-marketing" -> "treg.to"). */
export function launchDomain(name: string): string {
  const m = name.match(/^([a-z0-9-]+(\.[a-z0-9-]+)+)\//i);
  return m && !/github\.com$/i.test(m[1]) ? m[1].toLowerCase() : "";
}

/** Conversation roots that the account replied under 3 or more times but that no timeline read returned. */
export function missingRoots(posts: XPost[], handleIn: string): string[] {
  const me = handleIn.replace(/^@/, "").toLowerCase();
  const have = new Set(posts.map((p) => p.id));
  const count = new Map<string, number>();
  for (const p of posts) {
    if (p.author.toLowerCase() !== me || !p.conversationId || p.conversationId === p.id || have.has(p.conversationId)) continue;
    count.set(p.conversationId, (count.get(p.conversationId) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, k]) => k >= 3).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
}
