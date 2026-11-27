// The stages for one account on TikTok, Instagram, YouTube, LinkedIn, Reddit or Threads:
//   1 profile      the platform's profile read
//   2 timeline     the account's own posts, newest first, inside the timeline's share; a deep
//                  run follows the cursor until the share or the history runs out
//   3 outliers     no calls: the engine's break-out multiple on every post
//   4 comments     the top posts' comments, with the free question, intent and complaint labels
//   5 words        the top videos' transcripts (and on-screen text on a deep run)
// Every call goes through the Tracker, so the run's one budget and max_pages hold everywhere.
import { breakouts } from "../../engine/breakout.ts";
import type { Breakout } from "../../engine/breakout.ts";
import { rateOf } from "../../engine/rates.ts";
import { rowsOf, uniqueRows } from "../../engine/rows.ts";
import type { Row } from "../../engine/rows.ts";
import { ADAPTERS, ownRows, profileOf } from "./platforms.ts";
import type { Adapter, Call } from "./platforms.ts";
import type { Target } from "./targets.ts";
import type { TaggedRecord, Tracker } from "./tracker.ts";

export interface AccountOptions {
  /** How many top posts get comments and words read. */
  depth: number;
  /** Comment pages per top post. */
  commentPages: number;
  /** Transcripts at most (they cost 3 to 10 credits each). */
  transcripts: number;
  /** On-screen text reads at most (5 credits each). */
  screenTexts: number;
  /** Pages per timeline walk at most. */
  maxPages: number;
  /** Follow the timeline's cursor until its share or the history runs out. */
  follow: boolean;
  since?: string;
  until?: string;
  now?: Date;
}

export const ACCOUNT_DEFAULTS: AccountOptions = { depth: 3, commentPages: 1, transcripts: 2, screenTexts: 0, maxPages: 20, follow: false };
export const ACCOUNT_DEEP: AccountOptions = { depth: 12, commentPages: 3, transcripts: 8, screenTexts: 4, maxPages: 50, follow: true };

/** Each stage's share of one account's budget, in hundredths. */
export const ACCOUNT_SHARES = { timeline: 50, comments: 28, words: 22 } as const;

export interface AccountRun {
  target: Target;
  adapter: Adapter;
  records: TaggedRecord[];
  own: Row[];
  others: Row[];
  breakouts: Breakout[];
  depth: string[];
}

const pageOf = (endpoint: string) => rateOf(endpoint).page;

/** The posts worth the paid depth: those that broke out (biggest multiple first), then the most watched. */
export function depthOf(rows: Row[], bs: Breakout[], n: number, metric: "views" | "likes"): string[] {
  const beat = bs.filter((b) => b.band === "beat" && b.multiple !== null).sort((a, b) => (b.multiple as number) - (a.multiple as number)).map((b) => b.id);
  const top = rows.slice().sort((a, b) => ((metric === "views" ? b.views : b.likes) ?? 0) - ((metric === "views" ? a.views : a.likes) ?? 0)).map((r) => r.id);
  return [...new Set([...beat, ...top])].slice(0, n);
}

export async function runAccount(t: Tracker, target: Target, opts: AccountOptions, budget: number): Promise<AccountRun> {
  if (target.platform === "x") throw new Error("X accounts run through x/x.ts");
  const a = ADAPTERS[target.platform];
  const account = `${target.platform}:${target.handle.toLowerCase()}`;
  const now = opts.now ?? new Date();
  const tag = (m: Record<string, string> = {}) => ({ ...m, account });
  const mine = () => t.records.filter((r) => r.meta.account === account);

  // 1 profile
  const pc = a.profile(target);
  const profRec = await t.call("profile", pc.endpoint, pc.params, tag(), pageOf(pc.endpoint));
  const profile = profileOf(profRec);

  // 2 timeline: an even part of the share for each walk, newest first
  const share = Math.floor((budget * ACCOUNT_SHARES.timeline) / 100);
  const walks = a.timeline(target, profile, { since: opts.since, until: opts.until });
  let left = share;
  for (let i = 0; i < walks.length; i++) {
    const w = walks[i];
    let part = Math.floor(left / (walks.length - i));
    const price = pageOf(w.endpoint);
    let cursor: string | null = null;
    let reads = 0;
    do {
      const pages = Math.min(opts.maxPages, Math.floor(part / price));
      if (pages < 1) {
        t.limits.push({ stage: "timeline", endpoint: w.endpoint, reason: reads ? "the timeline's share is spent; older posts were not read" : `not read: the timeline's share of ${share} credits is spent` });
        break;
      }
      const params = { ...w.params, ...(rateOf(w.endpoint).walks ? { max_pages: pages } : {}), ...(cursor ? { cursor } : {}) };
      const rec = await t.call("timeline", w.endpoint, params, tag({ walk: String(i) }), rateOf(w.endpoint).walks ? pages * price : price);
      reads++;
      if (!rec) break;
      part -= rec.creditsUsed;
      left -= rec.creditsUsed;
      const d: any = rec.body.data ?? {};
      cursor = typeof d.next_cursor === "string" && d.next_cursor ? d.next_cursor : null;
      if (!opts.follow || !a.walks) break;
    } while (cursor);
  }

  // 3 outliers
  const rows = uniqueRows(mine().filter((r) => r.stage === "timeline" && r.status === 200).flatMap((r) => rowsOf(r)));
  const { own, others } = ownRows(target, rows, profile);
  const bs = breakouts(own, { now, mode: "previous", metric: a.metric });
  const depth = depthOf(own, bs, opts.depth, a.metric);
  const urlOf = (id: string) => own.find((r) => r.id === id)?.url ?? null;

  // 4 comments
  const commentCalls = depth
    .map((id) => ({ id, c: urlOf(id) ? a.comments(urlOf(id)!) : null }))
    .filter((x): x is { id: string; c: Call } => x.c !== null)
    .map((x) => ({ endpoint: x.c.endpoint, params: rateOf(x.c.endpoint).walks ? { ...x.c.params, max_pages: opts.commentPages } : x.c.params, meta: tag({ post_id: x.id }) }));
  await t.withinShare("comments", Math.floor((budget * ACCOUNT_SHARES.comments) / 100), commentCalls);

  // 5 words: transcripts of the top videos, then on-screen text on a deep run
  const videos = depth.filter((id) => own.find((r) => r.id === id)?.video);
  const wordCalls = [
    ...videos.slice(0, opts.transcripts).map((id) => ({ id, c: a.transcript(urlOf(id) ?? "") })),
    ...videos.slice(0, opts.screenTexts).map((id) => ({ id, c: a.screenText(urlOf(id) ?? "") })),
  ]
    .filter((x): x is { id: string; c: Call } => x.c !== null && Boolean(urlOf(x.id)))
    .map((x) => ({ endpoint: x.c.endpoint, params: x.c.params, meta: tag({ post_id: x.id }) }));
  await t.withinShare("words", Math.floor((budget * ACCOUNT_SHARES.words) / 100), wordCalls);

  return { target, adapter: a, records: mine(), own, others, breakouts: bs, depth };
}
