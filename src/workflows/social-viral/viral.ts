// /social-viral: a topic and a window in, the posts that broke out across platforms out.
//
// A break-out is a post at 3 times or more its own author's usual reach (its community's,
// on Reddit), over at least 8 comparable earlier posts. Raw reach only decides who is read:
// a floor per platform, so a 20-view account never tops the list. The stages (study file 19,
// "/social-viral"; measured by hand in study file 18, section 4.4):
//
//   1. search      the top posts on the topic in the window, per platform, topic-filtered
//   2. floor       in the window and above the platform's reach floor; originals only
//   3. baselines   each remaining author's (or community's) usual reach, within budget
//   4. ratio       each candidate against its baseline page, the post itself left out
//   5. flags       likely boosted (X, two numbers) or unusual engagement (one number)
//   6. rank        across platforms by multiple; a card leads only with a post it can stand on
//
// This file is pure: it plans calls and reads stored responses. The runner sends the calls
// through the kit, books each one in the ledger, and stops at the run's budget.
import { planBaselines, breakoutWithPage } from "../../engine/baseline.ts";
import type { BaselinePlan, BaselineStep } from "../../engine/baseline.ts";
import { cardWorthy, describe as describeBreakout } from "../../engine/breakout.ts";
import type { Breakout, Metric } from "../../engine/breakout.ts";
import { engagementFlags, isViral, FLAG_LABEL } from "../../engine/boosted.ts";
import type { FlagRead } from "../../engine/boosted.ts";
import { DEFAULT_RUN_BUDGET, quote, rateOf } from "../../engine/rates.ts";
import type { PlannedCall, Quote } from "../../engine/rates.ts";
import { rowsOf, uniqueRows } from "../../engine/rows.ts";
import type { Platform, ResponseRecord, Row } from "../../engine/rows.ts";
import { stageParams } from "../../engine/stages.ts";
import type { LabelMode, Params } from "../../engine/stages.ts";

export const SKILL = "social-viral";

export type ViralPlatform = "x" | "tiktok" | "instagram" | "youtube" | "reddit" | "linkedin";
export const VIRAL_PLATFORMS: ViralPlatform[] = ["x", "tiktok", "instagram", "youtube", "reddit", "linkedin"];

/** Who gets read: a post below its platform's floor is never a candidate (file 18, section 2.4). */
export const FLOORS: Record<ViralPlatform, { metric: Metric; min: number; note: string }> = {
  x: { metric: "views", min: 10_000, note: "views" },
  tiktok: { metric: "views", min: 10_000, note: "views" },
  // A date-windowed reel search carries no view count, so Instagram is ranked by likes (file 18, N13).
  instagram: { metric: "likes", min: 300, note: "likes (the windowed reel search has no views)" },
  youtube: { metric: "views", min: 10_000, note: "views" },
  // Reddit's score is read as likes in the shared row.
  reddit: { metric: "likes", min: 200, note: "score" },
  linkedin: { metric: "likes", min: 50, note: "likes" },
};

/**
 * Baseline credits per platform at default. Searches take about 32 credits at the topic
 * filter's settled price (file 18: X 10, TikTok 6, Instagram 6, YouTube 9, Reddit 0 to 2,
 * LinkedIn 6 at the 5-credit page); baselines take what is left of 80, the default target,
 * inside the run's hard cap of 100. LinkedIn pays 5 an author, so it gets two.
 */
export const BASELINE_SHARE: Record<ViralPlatform, number> = { x: 12, tiktok: 10, instagram: 5, youtube: 8, reddit: 4, linkedin: 10 };
export const DEFAULT_TARGET = 80;

export interface ViralWindow {
  /** First day, YYYY-MM-DD, inclusive. */
  since: string;
  /** Last day, YYYY-MM-DD, inclusive. */
  until: string;
}

export interface SearchCall {
  stage: string;
  platform: ViralPlatform;
  endpoint: string;
  params: Params;
  pages: number;
}

export interface PlanInput extends ViralWindow {
  /** The words the user typed: "AI coding tools". */
  topic: string;
  /** The fuller sentence the topic filter judges against; defaults to the topic. */
  about?: string;
  platforms?: ViralPlatform[];
  labels?: LabelMode;
}

/**
 * Stage 1: the searches. X reads 2 pages and Reddit 1 (file 18 read 3 and 2): at their most,
 * with every topic-filter hold unrefunded, the searches and every baseline share then come to
 * 97 credits, under the run's cap of 100, so no stage is starved by an earlier one's holds.
 * Every search sends max_pages: with max_credits and no max_pages the API walks up to 50
 * pages (api-overview, "Get More in One Call"); the first live run lost 66 credits to one
 * LinkedIn search that way (26/11/2026).
 * The platforms' own window words are used where a date range is
 * refused ("this-week" on TikTok, "past_week" on LinkedIn, "week" on Reddit); the rows are
 * then cut to the exact window in stage 2, and the report says which platforms were cut so.
 */
export function planSearch(input: PlanInput): SearchCall[] {
  const topic = input.about ?? input.topic;
  // /social-viral reads no post label, so its searches send none: explicit judging sits
  // outside the owner's default judging ceiling, an open decision (file 23, SOC-31).
  const opts = { topic, labels: input.labels ?? ("default" as LabelMode) };
  const q = input.topic;
  const out: SearchCall[] = [];
  const add = (platform: ViralPlatform, endpoint: string, params: Params, pages: number) =>
    out.push({ stage: `search:${platform}`, platform, endpoint, params: stageParams(endpoint, { query: q, ...params }, opts), pages });
  for (const p of input.platforms ?? VIRAL_PLATFORMS) {
    if (p === "x") add("x", "twitter/search/tweets", { sort: "top", since: input.since, max_pages: 2 }, 2);
    if (p === "tiktok") add("tiktok", "tiktok/search", { date_posted: "this-week", max_pages: 1 }, 1);
    if (p === "instagram") add("instagram", "instagram/search/reels", { date_posted: "last-week", max_pages: 1 }, 1);
    if (p === "youtube") add("youtube", "youtube/search", { uploadDate: "this_week", max_pages: 1 }, 1);
    if (p === "reddit") add("reddit", "reddit/search", { sort: "top", timeframe: "week", max_pages: 1 }, 1);
    if (p === "linkedin") add("linkedin", "linkedin/search/posts", { date_posted: "past_week", max_pages: 1 }, 1);
  }
  return out;
}

export function searchQuote(calls: SearchCall[]): Quote {
  return quote(calls.map((c): PlannedCall => ({ stage: c.stage, endpoint: c.endpoint, pages: c.pages, topic: true })));
}

/**
 * The most each search may spend: its quoted ceiling, raised to the least max_credits the
 * server accepts for one page where that is higher (reddit/search with the topic filter is
 * priced at 10 by the server's gate, 26/11/2026), so no search is sent to a free 400.
 */
export function searchCeilings(calls: SearchCall[]): number[] {
  const q = searchQuote(calls);
  return calls.map((c, k) => Math.max(q.lines[k].max, rateOf(c.endpoint).minMaxCredits ?? 0));
}

/**
 * The one exclusion rule, printed on the method page: posts whose subject is a data API, a
 * scraping service or a data vendor are left out, ours included, so the list never names or
 * favours a supplier. Matched on the post's own words; the report counts what it left out.
 */
export const DATA_VENDOR_SUBJECT =
  /\b(scrap(e|er|ers|ing)\s+(api|tool|service|platform)s?|web\s+scrap(er|ing)|data\s+(api|vendor|provider)s?|proxy\s+(network|provider)s?|residential\s+proxies)\b/i;

export interface Candidates {
  rows: Row[];
  /** Read in stage 1, after deduplication. */
  read: number;
  outsideWindow: number;
  belowFloor: number;
  notOriginal: number;
  excludedSubject: number;
  /** Rows whose platform metric is missing (for example an Instagram reel with no likes). */
  noMetric: number;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Stage 2: in the window, above the floor, originals only, the exclusion rule applied. */
export function candidatesOf(records: ResponseRecord[], w: ViralWindow, exclude: RegExp | null = DATA_VENDOR_SUBJECT): Candidates {
  const all = uniqueRows(records.flatMap(rowsOf));
  const c: Candidates = { rows: [], read: all.length, outsideWindow: 0, belowFloor: 0, notOriginal: 0, excludedSubject: 0, noMetric: 0 };
  for (const r of all) {
    const floor = FLOORS[r.platform as ViralPlatform];
    if (!floor) continue;
    const d = day(r.publishedAt);
    if (!d || d < w.since || d > w.until) {
      c.outsideWindow++;
      continue;
    }
    if (r.kind !== "original") {
      c.notOriginal++;
      continue;
    }
    if (exclude && exclude.test(r.text)) {
      c.excludedSubject++;
      continue;
    }
    const v = floor.metric === "views" ? r.views : r.likes;
    if (v === null) {
      c.noMetric++;
      continue;
    }
    if (v < floor.min) {
      c.belowFloor++;
      continue;
    }
    c.rows.push(r);
  }
  return c;
}

/** Stage 3: the baseline plan, platform by platform, each inside its share. */
/** `confirm` caps the authors read per platform; a platform left out keeps the engine's DEFAULT_CONFIRM. */
export function planViralBaselines(cands: Row[], shares: Record<ViralPlatform, number> = BASELINE_SHARE, confirm: Partial<Record<ViralPlatform, number>> = {}): BaselinePlan[] {
  return VIRAL_PLATFORMS.map((p) => planBaselines(cands, p, { budget: shares[p], confirm: confirm[p] }));
}

export interface BaselinePage {
  step: BaselineStep;
  rows: Row[];
}

export interface ViralItem {
  row: Row;
  breakout: Breakout;
  flag: FlagRead | null;
  /** 3x or more over 8 or more comparable posts, and not likely boosted. */
  viral: boolean;
  /** Viral, and its base is not inflated by young posts: a card may lead with it. */
  cardWorthy: boolean;
  /** "12.4x its author's median ...", or why there is no number. */
  line: string;
}

export interface ViralResult {
  items: ViralItem[];
  /** Candidates with no baseline read (skipped for budget, rank or a missing id). */
  unread: { row: Row; reason: string }[];
  byPlatform: Record<ViralPlatform, { candidates: number; withBaseline: number; viral: number }>;
}

/**
 * Stages 4 to 6. `pages` are the stored baseline pages, each with the plan step it answers;
 * `retweeters` the retweeter reads of X candidates, when stage 5 read them.
 */
export function rankViral(
  cands: Row[],
  plans: BaselinePlan[],
  pages: BaselinePage[],
  opts: { now: Date; retweeters?: Map<string, { read: number; big: number }> },
): ViralResult {
  const pageOf = new Map<string, BaselinePage>();
  for (const pg of pages) for (const id of pg.step.rowIds) pageOf.set(`${pg.step.platform}:${id}`, pg);
  const skippedWhy = new Map<string, string>();
  for (const pl of plans) for (const s of pl.skipped) for (const id of s.rowIds) skippedWhy.set(`${pl.platform}:${id}`, s.reason);
  // Planned, but the run's budget or the API stopped before its page was read.
  for (const pl of plans) for (const s of pl.steps) for (const id of s.rowIds) if (!skippedWhy.has(`${pl.platform}:${id}`)) skippedWhy.set(`${pl.platform}:${id}`, "planned_not_read");
  const flags = new Map(engagementFlags(cands, { retweeters: opts.retweeters }).map((f) => [f.id, f]));

  const items: ViralItem[] = [];
  const unread: ViralResult["unread"] = [];
  const byPlatform = Object.fromEntries(VIRAL_PLATFORMS.map((p) => [p, { candidates: 0, withBaseline: 0, viral: 0 }])) as ViralResult["byPlatform"];
  for (const r of cands) {
    const p = r.platform as ViralPlatform;
    byPlatform[p].candidates++;
    const pg = pageOf.get(`${p}:${r.id}`);
    if (!pg) {
      unread.push({ row: r, reason: skippedWhy.get(`${p}:${r.id}`) ?? "not_planned" });
      continue;
    }
    byPlatform[p].withBaseline++;
    const b = breakoutWithPage(r, pg.rows, { now: opts.now, metric: FLOORS[p].metric });
    const flag = flags.get(r.id) ?? null;
    const viral = isViral(b, flag ?? undefined);
    if (viral) byPlatform[p].viral++;
    items.push({ row: r, breakout: b, flag, viral, cardWorthy: viral && cardWorthy(b), line: describeBreakout(b) });
  }
  items.sort((a, b) => Number(b.viral) - Number(a.viral) || (b.breakout.multiple ?? -1) - (a.breakout.multiple ?? -1));
  return { items, unread, byPlatform };
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const n = (x: number) => x.toLocaleString("en-GB");

export interface CardInput extends ViralWindow {
  topic: string;
  credits: number;
  candidates: Candidates;
  result: ViralResult;
  /** How many items the card lists. */
  top?: number;
}

/**
 * The one-screen card: titled with the command, so a user's post names the tool by itself,
 * and footed with the cost and the line to run it. It leads only with card-worthy posts and
 * never says "paid", "bot" or "ring"; a flagged post is shown with its flag, not hidden.
 */
export function cardMarkdown(c: CardInput): string {
  const top = c.top ?? 5;
  const viral = c.result.items.filter((i) => i.viral);
  const lead = viral.filter((i) => i.cardWorthy).slice(0, top);
  const platforms = VIRAL_PLATFORMS.filter((p) => c.result.byPlatform[p].viral > 0);
  const tooFew = c.result.items.filter((i) => i.breakout.band === "too_few").length;
  const lines: string[] = [];
  lines.push(`# /${SKILL} "${c.topic}" · ${dmy(c.since)} to ${dmy(c.until)}`);
  lines.push("");
  lines.push(
    `${viral.length} posts at 3 times or more their author's usual reach, on ${platforms.length} platform${platforms.length === 1 ? "" : "s"}, out of ${c.candidates.rows.length} above the reach floor.`,
  );
  lines.push("");
  lead.forEach((i, k) => {
    const reach = i.breakout.value === null ? "" : `, ${n(i.breakout.value)} ${FLOORS[i.row.platform as ViralPlatform].note}`;
    const link = i.row.url ? ` ${i.row.url}` : "";
    lines.push(`${k + 1}. ${label(i.row.platform)}: ${i.breakout.multiple}x${reach}.${link}`);
  });
  const flagged = viral.filter((i) => i.flag?.flag);
  if (flagged.length) {
    lines.push("");
    for (const i of flagged) lines.push(`- ${label(i.row.platform)} post at ${i.breakout.multiple}x: ${FLAG_LABEL[i.flag!.flag!]}.`);
  }
  lines.push("");
  lines.push(`Not called: ${tooFew} posts whose authors had fewer than 8 comparable posts to compare with; ${c.result.unread.length} candidates whose baseline was not read.`);
  lines.push("");
  lines.push(`Read with SocialCrawl /${SKILL} · ${c.credits} credits · ${dmy(c.until)}`);
  lines.push(`Run it yourself: /${SKILL} "${c.topic}" --since ${c.since} --until ${c.until}`);
  return lines.join("\n");
}

function label(p: Platform): string {
  return { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", reddit: "Reddit", linkedin: "LinkedIn" }[p as ViralPlatform] ?? p;
}

/** The run's default fits the welcome credits with room: searches at their settled price plus every baseline share. */
export function defaultPlanCredits(input: PlanInput): { search: Quote; ceiling: number; baselines: number; expected: number; cap: number } {
  const calls = planSearch(input);
  const search = searchQuote(calls);
  const ceiling = searchCeilings(calls).reduce((s, x) => s + x, 0);
  const baselines = (input.platforms ?? VIRAL_PLATFORMS).reduce((s, p) => s + BASELINE_SHARE[p], 0);
  return { search, ceiling, baselines, expected: search.expected + baselines, cap: DEFAULT_RUN_BUDGET };
}
