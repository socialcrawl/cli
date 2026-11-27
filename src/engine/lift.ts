// Launch lift, with its refusals. Moves (launches) within 42 days of the previous one join its
// cluster; a cluster's lift is the views per post of the three months from its start minus the
// three months before. Both windows must be fully inside the history read: a partial window
// gives null, never a misleading number. A "leading channel" (Spearman between a channel's
// monthly moves and the account's monthly growth, at lags 0 to 2) is refused under 18 months of
// history or 6 moves. Timing is a lead, not a verdict.
//
// Adapted from marketingskills' reverse-engineer-marketing (coreyhaines31/marketingskills, MIT:
// scripts/teardown.mjs lines 396 to 497). See THIRD_PARTY_NOTICES.md.
import { spearman } from "./baseline.ts";

export const CLUSTER_DAYS = 42;
export const LIFT_MONTHS = 3;
export const MIN_MONTHS = 18;
export const MIN_MOVES = 6;

const DAY = 86_400_000;

export interface Cluster {
  start: string;
  end: string;
  moves: string[];
}

/** Moves (ISO dates) in clusters: a move within 42 days of the previous one joins its cluster. */
export function clusterMoves(dates: string[], days = CLUSTER_DAYS): Cluster[] {
  const s = [...dates].sort();
  const out: Cluster[] = [];
  for (const d of s) {
    const last = out.at(-1);
    if (last && Date.parse(d) - Date.parse(last.end) <= days * DAY) {
      last.end = d;
      last.moves.push(d);
    } else out.push({ start: d, end: d, moves: [d] });
  }
  return out;
}

const addMonths = (t: number, m: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
};

export interface Lift {
  start: string;
  before: number | null;
  after: number | null;
  /** Views per post after minus before; null when a window is not wholly inside the history read. */
  lift: number | null;
  postsBefore: number;
  postsAfter: number;
  reason: string | null;
}

/**
 * Views per post in the three months from `start` minus the three months before, over the
 * posts read (`historyFrom` is the oldest date the read reached, `now` the read time).
 */
export function windowLift(posts: { publishedAt: string; views: number | null }[], start: string, historyFrom: string, now: Date, months = LIFT_MONTHS): Lift {
  const t = Date.parse(start);
  const from = addMonths(t, -months);
  const to = addMonths(t, months);
  const inRange = (a: number, b: number) => posts.filter((p) => p.views !== null && Date.parse(p.publishedAt) >= a && Date.parse(p.publishedAt) < b);
  const before = inRange(from, t);
  const after = inRange(t, to);
  const mean = (xs: typeof posts) => (xs.length ? Math.round(xs.reduce((s, p) => s + (p.views as number), 0) / xs.length) : null);
  let reason: string | null = null;
  if (Date.parse(historyFrom) > from) reason = `the read reaches back only to ${historyFrom.slice(0, 10)}; ${months} months before are needed`;
  else if (now.getTime() < to) reason = `${months} months after the start have not passed`;
  else if (!before.length || !after.length) reason = "no post with views on one side";
  const b = mean(before);
  const a = mean(after);
  return { start, before: b, after: a, lift: reason === null && a !== null && b !== null ? a - b : null, postsBefore: before.length, postsAfter: after.length, reason };
}

export type LeadingChannel =
  | { called: false; reason: string }
  | { called: true; channel: string; lag: number; rho: number };

/**
 * Which channel's moves lead the account's growth: Spearman between each channel's monthly move
 * count and the monthly growth, at lags 0, 1 and 2. Refused under 18 months or 6 moves.
 */
export function leadingChannel(channels: { channel: string; monthlyMoves: number[] }[], monthlyGrowth: number[]): LeadingChannel {
  const months = monthlyGrowth.length;
  const moves = channels.reduce((s, c) => s + c.monthlyMoves.reduce((a, b) => a + b, 0), 0);
  if (months < MIN_MONTHS) return { called: false, reason: `too few to call: ${months} months of history, ${MIN_MONTHS} needed` };
  if (moves < MIN_MOVES) return { called: false, reason: `too few to call: ${moves} moves, ${MIN_MOVES} needed` };
  let best: { channel: string; lag: number; rho: number } | null = null;
  for (const c of channels) {
    for (const lag of [0, 1, 2]) {
      const x = c.monthlyMoves.slice(0, months - lag);
      const y = monthlyGrowth.slice(lag, months);
      const rho = spearman(x, y);
      if (rho !== null && (!best || rho > best.rho)) best = { channel: c.channel, lag, rho };
    }
  }
  return best ? { called: true, ...best } : { called: false, reason: "too few to call: no channel varies" };
}
