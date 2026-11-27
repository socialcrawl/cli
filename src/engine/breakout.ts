// The break-out method: how far a post beat its own author's usual reach.
//
//   multiple = the post's metric / the median of the author's 20 comparable posts
//              (originals with originals, videos with videos), the post itself left out
//   no multiple below 8 comparable posts: the answer is "too few posts", never a number
//   bands: 3 times or more "beat its own reach"; 1.5 to 3 "above usual"; under 1.5 "a normal day"
//
// Then, for one account at a time: the top third against the bottom third with counts
// (24 settled posts at least, never across platforms), "beats its neighbours", turning
// points, and whether a format "travels" (two or more other authors win with it).
//
// Methods adapted, in our own code, from /x-viral (Jakeschincariol/x-agent-skill, MIT),
// TubeLab's youtube-research-skills (TubeLabHQ, MIT) and marketingskills'
// content-teardown (MIT); see THIRD_PARTY_NOTICES.md. The ratio is computed here from
// the timeline rows; the API's own `computed.vs_creator` is not read.
import type { Platform, Row } from "./rows.ts";

export const MIN_PEERS = 8;
export const PEER_WINDOW = 20;
export const BANDS = { beat: 3, above: 1.5 } as const;
/**
 * Posts younger than this are still gathering views. In a reverse-engineer walk
 * ("previous" mode) they are left out of every baseline. A discovery baseline is one
 * timeline page read newest first ("around" mode), where leaving them out would empty
 * most small creators' pages, so they stay in and are counted in `youngPeers`.
 */
export const SETTLE_HOURS = 48;
/** Above this share of young peers a multiple is marked `inflatedByYoung`. */
export const YOUNG_PEER_SHARE = 0.25;
/** The settled-only multiple needs at least this many peers 48 hours or older. */
export const MIN_SETTLED_PEERS = 5;

/** beat: 3x or more; above: 1.5x to 3x; normal: under 1.5x; too_few: under 8 comparable posts; no_metric: the post or its base has no count. */
export type Band = "beat" | "above" | "normal" | "too_few" | "no_metric";
export type Metric = "views" | "likes";

export interface Breakout {
  platform: Platform;
  id: string;
  author: string;
  metric: Metric;
  value: number | null;
  base: number | null;
  peers: number;
  peerIds: string[];
  /** Peers under 48 hours old inside the base (only in "around" mode); the report says so. */
  youngPeers: number;
  /** More than a quarter of the peers are under 48 hours old: they pull the median down, so the multiple may be high. */
  inflatedByYoung: boolean;
  /** The robustness check: the value over the median of the peers 48 hours or older, when 5 or more such peers exist; else null. */
  settledMultiple: number | null;
  settledPeers: number;
  /** The value over the best of its comparable posts: young peers cannot inflate it. Null under 8 peers. */
  overBestPeer: number | null;
  /** Two decimals; null whenever the band is too_few or no_metric. */
  multiple: number | null;
  band: Band;
  /** True when the post itself is under 48 hours old: its multiple is a floor, it can still rise. */
  settling: boolean;
  /** "previous": the 20 posts before it; "around": the 20 nearest in time (a discovery page read newest first). */
  mode: "previous" | "around";
  requestIds: string[];
}

export interface BreakoutOptions {
  now: Date;
  mode?: "previous" | "around";
  minPeers?: number;
  window?: number;
  /** Peers younger than this are left out; default 48 in "previous" mode, 0 in "around" mode. */
  settleHours?: number;
  /** Force a metric; by default views where the post has them, else likes. */
  metric?: Metric;
}

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const t = (r: Row) => (r.publishedAt ? Date.parse(r.publishedAt) : NaN);

export function bandOf(multiple: number | null): Band {
  if (multiple === null) return "too_few";
  if (multiple >= BANDS.beat) return "beat";
  if (multiple >= BANDS.above) return "above";
  return "normal";
}

/** Originals (thread heads included) that are not pinned. */
export function isComparableKind(r: Row): boolean {
  return r.kind === "original" && !r.pinned;
}

/**
 * Whose usual reach a post is measured against: its author's, except on Reddit, where
 * votes belong to the community, so the baseline is the community's (study file 18).
 */
export function baselineKey(r: Row): string {
  // YouTube lanes print the channel differently (search "@handle", channel/shorts the channel
  // id, the batch lookup nothing), so a YouTube row with a channel id is keyed on it.
  if (r.platform === "youtube" && r.channelId) return `yt:${r.channelId}`.toLowerCase();
  return (r.platform === "reddit" ? `r/${r.community ?? ""}` : r.author).toLowerCase();
}

/** Same author (or community), and videos with videos, everything else with everything else (not on Reddit). */
export function comparable(a: Row, b: Row): boolean {
  if (a.platform !== b.platform || baselineKey(a) !== baselineKey(b) || !isComparableKind(b)) return false;
  // Shorts with Shorts, long videos with long videos, where both rows say which they are.
  if (a.format && b.format && a.format !== b.format) return false;
  return a.platform === "reddit" || a.video === b.video;
}

export function metricValue(r: Row, metric: Metric): number | null {
  return metric === "views" ? r.views : r.likes;
}

/** One post against its own author's comparable posts in `pool` (the post itself is always left out). */
export function breakoutOf(target: Row, pool: Row[], opts: BreakoutOptions): Breakout {
  const mode = opts.mode ?? "previous";
  const minPeers = opts.minPeers ?? MIN_PEERS;
  const window = opts.window ?? PEER_WINDOW;
  const settleMs = (opts.settleHours ?? (mode === "around" ? 0 : SETTLE_HOURS)) * 3_600_000;
  const youngMs = SETTLE_HOURS * 3_600_000;
  const now = opts.now.getTime();
  const metric: Metric = opts.metric ?? (target.views !== null ? "views" : "likes");
  const at = t(target);

  const candidates = pool.filter(
    (p) =>
      p.id !== target.id &&
      comparable(target, p) &&
      metricValue(p, metric) !== null &&
      Number.isFinite(t(p)) &&
      now - t(p) >= settleMs &&
      (mode === "around" || t(p) < at),
  );
  const ordered =
    mode === "previous"
      ? candidates.sort((a, b) => t(b) - t(a))
      : candidates.sort((a, b) => Math.abs(t(a) - at) - Math.abs(t(b) - at) || t(b) - t(a));
  const peers = ordered.slice(0, window);
  const value = metricValue(target, metric);
  const base = peers.length >= minPeers ? median(peers.map((p) => metricValue(p, metric) as number)) : null;
  let multiple: number | null = null;
  let band: Band;
  if (peers.length < minPeers) band = "too_few";
  else if (value === null || base === null || base <= 0) band = "no_metric";
  else {
    multiple = round2(value / base);
    band = bandOf(multiple);
  }
  const young = peers.filter((p) => now - t(p) < youngMs).length;
  const settledVals = peers.filter((p) => now - t(p) >= youngMs).map((p) => metricValue(p, metric) as number);
  const settledBase = settledVals.length >= MIN_SETTLED_PEERS ? median(settledVals) : null;
  const settledMultiple = value !== null && settledBase !== null && settledBase > 0 ? round2(value / settledBase) : null;
  const best = peers.length >= minPeers ? Math.max(...peers.map((p) => metricValue(p, metric) as number)) : null;
  const overBestPeer = value !== null && best !== null && best > 0 ? round2(value / best) : null;
  const ids = new Set<string>();
  for (const r of [target, ...peers]) if (r.requestId) ids.add(r.requestId);
  return {
    platform: target.platform,
    id: target.id,
    author: target.author,
    metric,
    value,
    base,
    peers: peers.length,
    peerIds: peers.map((p) => p.id),
    youngPeers: young,
    inflatedByYoung: peers.length > 0 && young / peers.length > YOUNG_PEER_SHARE,
    settledMultiple,
    settledPeers: settledVals.length,
    overBestPeer,
    multiple,
    band,
    settling: Number.isFinite(at) && now - at < youngMs,
    mode,
    requestIds: [...ids],
  };
}

/** Every comparable post in `rows` against its own author's earlier posts in the same rows (a reverse-engineer walk). */
export function breakouts(rows: Row[], opts: BreakoutOptions): Breakout[] {
  return rows.filter(isComparableKind).map((r) => breakoutOf(r, rows, opts));
}

/** A post's line for a report: "12.4x its author's median of 1,509 views over 28 posts", or why there is no number. */
/**
 * A card may lead only with a post that broke out on a baseline it can stand on. When young
 * peers fill the base, the post must still be 3x or more over its settled peers alone, or 3x
 * or more over the best of all its comparable posts (which young peers cannot pull down).
 */
export function cardWorthy(b: Breakout): boolean {
  if (b.band !== "beat") return false;
  if (!b.inflatedByYoung) return true;
  return (b.settledMultiple ?? 0) >= BANDS.beat || (b.overBestPeer ?? 0) >= BANDS.beat;
}

export function describe(b: Breakout): string {
  const n = (x: number) => x.toLocaleString("en-GB");
  if (b.band === "too_few") return `too few posts (${b.peers} comparable, ${MIN_PEERS} needed)`;
  if (b.band === "no_metric") return `no ${b.metric} count to compare`;
  const notes = [
    b.settling ? "still rising" : null,
    b.inflatedByYoung ? `${b.youngPeers} of ${b.peers} comparable posts are under 48 hours old; the multiple may be high` : null,
    b.settledMultiple !== null && b.multiple !== null && Math.max(b.multiple, b.settledMultiple) / Math.max(0.01, Math.min(b.multiple, b.settledMultiple)) > 1.5
      ? `${b.settledMultiple}x over the ${b.settledPeers} posts 48 hours or older`
      : null,
    b.inflatedByYoung && b.overBestPeer !== null ? `${b.overBestPeer}x over its best comparable post` : null,
  ].filter(Boolean);
  // Reddit's score is read as likes in the shared row; the line names it as the card does.
  const base = b.platform === "reddit" && b.metric === "likes" ? `median score of ${n(b.base as number)}` : `median of ${n(b.base as number)} ${b.metric}`;
  return `${b.multiple}x its author's ${base} over ${b.peers} posts${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

// ── One account at a time: what separates its winners from its losers ─────────

export const PATTERN_MIN_POSTS = 24;
export const PATTERN_SETTLE_DAYS = 10;
/** A trait is called a finding only when 4 or more top-third posts carry it. */
export const FINDING_MIN_COUNT = 4;

export type Feature = (row: Row) => string | null;

export interface Trait {
  feature: string;
  value: string;
  top: number;
  bottom: number;
  topShare: number;
  bottomShare: number;
  topAuthors: number;
  finding: boolean;
}

export type Contrast =
  | { called: false; reason: "too_few_posts" | "mixed_platforms"; posts: number; needed: number }
  | { called: true; posts: number; top: string[]; bottom: string[]; traits: Trait[]; unclassified: Record<string, string[]> };

export interface ContrastOptions {
  now: Date;
  minPosts?: number;
  settleDays?: number;
  minCount?: number;
  /** For a run over many authors, a trait must also show up for this many different authors in the top third. */
  minAuthors?: number;
}

/**
 * Top third against bottom third by multiple, middle left out. Only posts with a multiple
 * and at least 10 days old count; under 24 such posts, or rows from two platforms, no
 * pattern is called. A feature that returns null for a post lists the post as unclassified.
 */
export function contrast(items: { row: Row; breakout: Breakout }[], features: Record<string, Feature>, opts: ContrastOptions): Contrast {
  const minPosts = opts.minPosts ?? PATTERN_MIN_POSTS;
  const settleMs = (opts.settleDays ?? PATTERN_SETTLE_DAYS) * 86_400_000;
  const minCount = opts.minCount ?? FINDING_MIN_COUNT;
  const minAuthors = opts.minAuthors ?? 1;
  const platforms = new Set(items.map((i) => i.row.platform));
  const settled = items
    .filter((i) => i.breakout.multiple !== null && Number.isFinite(t(i.row)) && opts.now.getTime() - t(i.row) >= settleMs)
    .sort((a, b) => (b.breakout.multiple as number) - (a.breakout.multiple as number));
  if (platforms.size > 1) return { called: false, reason: "mixed_platforms", posts: settled.length, needed: minPosts };
  if (settled.length < minPosts) return { called: false, reason: "too_few_posts", posts: settled.length, needed: minPosts };
  const third = Math.floor(settled.length / 3);
  const top = settled.slice(0, third);
  const bottom = settled.slice(settled.length - third);
  const traits: Trait[] = [];
  const unclassified: Record<string, string[]> = {};
  for (const [name, fn] of Object.entries(features)) {
    const values = new Set<string>();
    for (const i of [...top, ...bottom]) {
      const v = fn(i.row);
      if (v === null) (unclassified[name] ??= []).push(i.row.id);
      else values.add(v);
    }
    for (const value of values) {
      const inTop = top.filter((i) => fn(i.row) === value);
      const inBottom = bottom.filter((i) => fn(i.row) === value).length;
      const topAuthors = new Set(inTop.map((i) => i.row.author.toLowerCase())).size;
      const topShare = round2(inTop.length / top.length);
      const bottomShare = round2(inBottom / bottom.length);
      traits.push({
        feature: name,
        value,
        top: inTop.length,
        bottom: inBottom,
        topShare,
        bottomShare,
        topAuthors,
        finding: inTop.length >= minCount && inTop.length / top.length > inBottom / bottom.length && topAuthors >= minAuthors,
      });
    }
  }
  traits.sort((a, b) => Number(b.finding) - Number(a.finding) || b.topShare - b.bottomShare - (a.topShare - a.bottomShare));
  return { called: true, posts: settled.length, top: top.map((i) => i.row.id), bottom: bottom.map((i) => i.row.id), traits, unclassified };
}

// ── Neighbours and turning points over one account's catalogue (TubeLab) ─────

export interface Block {
  from: string;
  to: string;
  posts: string[];
  median: number;
}

/** The account's comparable posts in time order, cut into up to `blocks` blocks of at least 3 posts. */
export function blocksOf(rows: Row[], metric: Metric, blocks = 10): Block[] {
  const s = rows
    .filter((r) => isComparableKind(r) && metricValue(r, metric) !== null && Number.isFinite(t(r)))
    .sort((a, b) => t(a) - t(b));
  const count = Math.min(blocks, Math.floor(s.length / 3));
  if (count < 1) return [];
  const out: Block[] = [];
  for (let i = 0; i < count; i++) {
    const part = s.slice(Math.floor((i * s.length) / count), Math.floor(((i + 1) * s.length) / count));
    out.push({ from: part[0].publishedAt as string, to: part.at(-1)!.publishedAt as string, posts: part.map((p) => p.id), median: median(part.map((p) => metricValue(p, metric) as number)) as number });
  }
  return out;
}

/** A post "beats its neighbours" when it is above the median of the other posts in its own block (older posts had longer to gather views). */
export function neighbours(rows: Row[], metric: Metric, blocks = 10): Map<string, { blockMedian: number; beats: boolean }> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, { blockMedian: number; beats: boolean }>();
  for (const b of blocksOf(rows, metric, blocks)) {
    for (const id of b.posts) {
      const others = b.posts.filter((o) => o !== id).map((o) => metricValue(byId.get(o)!, metric) as number);
      const m = median(others) as number;
      out.set(id, { blockMedian: m, beats: (metricValue(byId.get(id)!, metric) as number) > m });
    }
  }
  return out;
}

export interface TurningPoint {
  at: string;
  direction: "up" | "down";
  from: number;
  to: number;
  then: number;
}

/**
 * A turning point is a lasting change: the block median moves by `factor` (default 1.5)
 * or more and the next block stays past the same line. One hit is never a turning point.
 */
export function turningPoints(rows: Row[], metric: Metric, factor = 1.5, blocks = 10): TurningPoint[] {
  const b = blocksOf(rows, metric, blocks);
  const out: TurningPoint[] = [];
  for (let i = 1; i + 1 < b.length; i++) {
    const before = b[i - 1].median;
    const [now, next] = [b[i].median, b[i + 1].median];
    if (before <= 0) continue;
    if (now >= before * factor && next >= before * factor) out.push({ at: b[i].from, direction: "up", from: before, to: now, then: next });
    else if (now <= before / factor && next <= before / factor) out.push({ at: b[i].from, direction: "down", from: before, to: now, then: next });
  }
  return out;
}

export interface Travel {
  format: string;
  authors: string[];
  travels: boolean;
}

/** A format "travels" when posts at 3x or more by two or more authors other than the subject use it. */
export function travels(items: { row: Row; breakout: Breakout }[], formatOf: Feature, subject?: string): Travel[] {
  const by = new Map<string, Set<string>>();
  for (const i of items) {
    if (i.breakout.band !== "beat") continue;
    const f = formatOf(i.row);
    if (f === null) continue;
    const a = i.row.author.toLowerCase();
    if (subject && a === subject.toLowerCase()) continue;
    if (!by.has(f)) by.set(f, new Set());
    by.get(f)!.add(a);
  }
  return [...by.entries()]
    .map(([format, a]) => ({ format, authors: [...a].sort(), travels: a.size >= 2 }))
    .sort((x, y) => y.authors.length - x.authors.length || x.format.localeCompare(y.format));
}
