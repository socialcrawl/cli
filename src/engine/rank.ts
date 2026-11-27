// Discovery ranking: a post leads only when it is on topic, strong on its platform's own
// absolute scale, and above its own author's usual reach.
//
//   engagement   last30days' absolute log scale per platform (a weighted mean of log1p counts
//                over a "very high" reference), 0 to 100, so a platform's best row is not
//                automatically 100
//   fusion       reciprocal rank fusion, k = 60, of the engagement rank and the break-out rank
//                (and of any sub-query streams the skill passes)
//   entity       a row the server's topic filter kept (relevance=filter&relevant_to=) is on
//                topic; on a stream the filter did not judge, a row that does not name the
//                topic's head words is demoted below every row that does, whatever its
//                engagement (a caption such as "watch this" names nothing, so the filter's
//                judgement comes first)
//   floor        "Nothing solid this window" is a real answer: when no row is on topic, over the
//                engagement floor and at 3 times its author's reach or more, the run says so
//
// Adapted from last30days (mvanhorn/last30days-skill, MIT: signals.py, fusion.py, rerank.py);
// the per-author break-out is ours. Weights and references are last30days'; the floor of 25 is
// its confidence floor. See THIRD_PARTY_NOTICES.md.
import type { Breakout } from "./breakout.ts";
import type { Platform, Row } from "./rows.ts";

export const RRF_K = 60;
export const ENGAGEMENT_FLOOR = 25;

/** log1p of a "very high" count per platform (last30days): Reddit about 2,000 votes, X about 10,000 likes. */
const LIKE_REFERENCE: Partial<Record<Platform, number>> = { reddit: 7.6, x: 9.2, threads: 9.2, linkedin: 9.2 };
/** View platforms map log1p(views) between these two (last30days). */
const VIEW_RANGE = [2.1, 11.5] as const;

const l = (x: number | null) => Math.log1p(Math.max(0, x ?? 0));
const clamp = (x: number) => Math.max(0, Math.min(100, x));

/** 0 to 100 on the platform's own absolute scale; null when the row has no count at all. */
export function engagementScore(r: Row): number | null {
  if (r.views === null && r.likes === null && r.comments === null) return null;
  if (r.platform === "reddit") return clamp(((0.5 * l(r.likes) + 0.35 * l(r.comments)) / 0.85 / LIKE_REFERENCE.reddit!) * 100);
  if (r.views !== null && (r.platform === "youtube" || r.platform === "tiktok" || r.platform === "instagram" || r.platform === "x")) {
    const w = r.platform === "youtube" ? [0.45, 0.32, 0.13] : [0.45, 0.27, 0.18];
    // Views on the view range; likes and comments read as the same log scale.
    const raw = (w[0] * l(r.views) + w[1] * l(r.likes) + w[2] * l(r.comments)) / (w[0] + w[1] + w[2]);
    return clamp(((raw - VIEW_RANGE[0]) / (VIEW_RANGE[1] - VIEW_RANGE[0])) * 100);
  }
  const ref = LIKE_REFERENCE[r.platform] ?? 9.2;
  const parts = [l(r.likes), l(r.comments), l(r.shares)].sort((a, b) => b - a);
  return clamp(((parts[0] + 0.1 * (parts[1] + parts[2])) / ref) * 100);
}

/** Reciprocal rank fusion: each list adds weight / (k + rank) to every id in it. */
export function rrf(lists: { ids: string[]; weight?: number }[], k = RRF_K): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of lists) list.ids.forEach((id, i) => out.set(id, (out.get(id) ?? 0) + (list.weight ?? 1) / (k + i + 1)));
  return out;
}

const INTENT = new Set(["best", "top", "review", "reviews", "pricing", "price", "vs", "versus", "alternative", "alternatives", "tool", "tools", "app", "apps", "software", "for", "the", "a", "an", "and", "of", "in", "with", "how", "to", "new", "free"]);

/** The topic's head words: the keyword minus intent and stop words ("AI coding tools" gives "ai", "coding"). */
export function headWords(topic: string): string[] {
  const words = topic.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const head = words.filter((w) => !INTENT.has(w));
  return head.length ? head : words;
}

/** Does the text name the topic's entity? Every head word must appear, as a word or a word's start. Conservative on purpose. */
export function onEntity(text: string, topic: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  return headWords(topic).every((w) => new RegExp(`[^\\p{L}\\p{N}]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(t));
}

export interface Ranked {
  row: Row;
  breakout: Breakout | null;
  engagement: number | null;
  onEntity: boolean;
  fused: number;
  leads: boolean;
}

export interface Ranking {
  ranked: Ranked[];
  /** True when no row leads: the report says "Nothing solid this window". */
  nothingSolid: boolean;
}

/**
 * Rank one platform's candidates. Leaders (on topic, engagement at or over the floor, 3x or more
 * their author's reach) come first by fused rank, then the other on-topic rows, then the rows
 * that do not name the topic. Cross-platform lists fuse each platform's ranking with `rrf`;
 * raw scores are never compared across platforms.
 */
export interface RankOptions {
  /** The rows came from a search stage with the server's topic filter on: every kept row is on topic. */
  filtered?: boolean;
  /** More ranked id lists to fuse (sub-queries, other sorts). */
  extraLists?: { ids: string[]; weight?: number }[];
}

export function rankDiscovery(itemsIn: { row: Row; breakout: Breakout | null }[], topic: string, opts: RankOptions = {}): Ranking {
  // A post found by two searches is one candidate; the first copy wins.
  const seen = new Set<string>();
  const items = itemsIn.filter((i) => !seen.has(`${i.row.platform}:${i.row.id}`) && Boolean(seen.add(`${i.row.platform}:${i.row.id}`)));
  const scored = items.map((i) => ({ ...i, engagement: engagementScore(i.row), onEntity: opts.filtered === true || onEntity(i.row.text, topic) }));
  const byEngagement = scored.filter((s) => s.engagement !== null).sort((a, b) => (b.engagement as number) - (a.engagement as number)).map((s) => s.row.id);
  const byMultiple = scored.filter((s) => s.breakout?.multiple != null).sort((a, b) => (b.breakout!.multiple as number) - (a.breakout!.multiple as number)).map((s) => s.row.id);
  const fused = rrf([{ ids: byEngagement }, { ids: byMultiple }, ...(opts.extraLists ?? [])]);
  const ranked: Ranked[] = scored.map((s) => ({
    ...s,
    fused: Math.round((fused.get(s.row.id) ?? 0) * 1e6) / 1e6,
    leads: s.onEntity && (s.engagement ?? 0) >= ENGAGEMENT_FLOOR && s.breakout?.band === "beat",
  }));
  const tier = (r: Ranked) => (r.leads ? 0 : r.onEntity ? 1 : 2);
  ranked.sort((a, b) => tier(a) - tier(b) || b.fused - a.fused || a.row.id.localeCompare(b.row.id));
  return { ranked, nothingSolid: !ranked.some((r) => r.leads) };
}
