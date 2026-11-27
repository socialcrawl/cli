// /social-viral, run: sends the plan of viral.ts through the Session, one call at a time,
// every call under the run's one budget, every response kept, every credit booked.
// Stops cleanly when the budget is spent: what was not read is reported, never guessed.
import { breakoutWithPage, morePage } from "../../engine/baseline.ts";
import type { BaselinePlan } from "../../engine/baseline.ts";
import { retweeterRead } from "../../engine/boosted.ts";
import type { CostLedger, Meta } from "../../engine/rates.ts";
import { rowsOf } from "../../engine/rows.ts";
import type { ResponseRecord, Row } from "../../engine/rows.ts";
import { TOPIC_LANES, stageParams } from "../../engine/stages.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import {
  BASELINE_SHARE,
  SKILL,
  candidatesOf,
  cardMarkdown,
  planSearch,
  planViralBaselines,
  rankViral,
  searchCeilings,
} from "./viral.ts";
import type { BaselinePage, Candidates, PlanInput, ViralItem, ViralPlatform, ViralResult } from "./viral.ts";

export interface ViralRunOptions {
  /** Retweeter pages read for the top X break-outs (1 credit each), to test the boosted rule. */
  retweeterPosts?: number;
  /** Multiplies each platform's baseline share (a deep run reads more authors). */
  shareScale?: number;
  now?: () => Date;
}

/** Break-out accounts whose size no response gave get one profile read each, at most this many a run. */
export const SIZE_READS = 20;

/** The largest follower count read for each author ("tiktok:acme"), across every response of the run. */
export function followersOf(records: ResponseRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const rec of records)
    for (const r of rowsOf(rec)) {
      if (r.authorFollowers === null || !r.author) continue;
      const k = `${r.platform}:${r.author.toLowerCase()}`;
      m.set(k, Math.max(m.get(k) ?? 0, r.authorFollowers));
    }
  return m;
}

/** The 1-credit read that gives an account's follower count, for the platforms whose search leaves it out. */
export function sizeCall(r: Row): { endpoint: string; params: Params } | null {
  if (r.platform === "youtube") return r.channelId ? { endpoint: "youtube/channel", params: { channelId: r.channelId } } : r.author ? { endpoint: "youtube/channel", params: { handle: r.author } } : null;
  if (r.platform === "instagram" && r.author) return { endpoint: "instagram/profile", params: { handle: r.author } };
  return null;
}

/** The break-outs whose account needs a size read: one per account, the platforms with a profile read, in rank order. */
export function unsizedAccounts(items: ViralItem[], known: Map<string, number>, max = SIZE_READS): ViralItem[] {
  const seen = new Set<string>();
  const out: ViralItem[] = [];
  for (const i of items) {
    const k = `${i.row.platform}:${i.row.author.toLowerCase()}`;
    if (!i.viral || i.row.authorFollowers !== null || known.has(k) || seen.has(k) || !sizeCall(i.row)) continue;
    seen.add(k);
    out.push(i);
  }
  return out.slice(0, max);
}

export interface ViralRunOutput {
  /** The successful responses, in order. */
  records: CallRecord[];
  candidates: Candidates;
  result: ViralResult;
  card: string;
  meta: Meta;
  ledger: CostLedger;
  notRead: Session["notRead"];
  errors: Session["errors"];
  /** Follower counts read for card-worthy accounts the search gave no size for ("youtube:channel"). */
  sizes: Map<string, number>;
}

type Params = Record<string, string | number | boolean | undefined>;

/**
 * Each candidate's author's earlier posts, platform by platform inside its share. A baseline is
 * the author's own earlier posts (study file 25): never topic-filtered, and with judging off.
 * When a page holds fewer than 8 earlier comparable posts, one more page is read while the
 * platform's share can pay for it. Shared by every workflow that measures break-outs.
 */
export async function readBaselines(session: Session, rows: Row[], shares: Record<ViralPlatform, number>, now: () => Date, opts: { confirm?: Partial<Record<ViralPlatform, number>> } = {}): Promise<{ plans: BaselinePlan[]; pages: BaselinePage[] }> {
  const plans = planViralBaselines(rows, shares, opts.confirm ?? {});
  const pages: BaselinePage[] = [];
  const baselineParams = (endpoint: string, params: Params) =>
    TOPIC_LANES.has(endpoint) ? { ...params, judgments: "off" } : stageParams(endpoint, { ...params }, { labels: "off" });
  for (const plan of plans) {
    const share = shares[plan.platform as ViralPlatform] ?? 0;
    let spent = 0;
    for (const step of plan.steps) {
      const stage = `baseline:${plan.platform}`;
      const rec = await session.call(stage, step.endpoint, baselineParams(step.endpoint, step.params), Math.min(step.credits, share - spent));
      if (!rec) continue;
      spent += rec.creditsUsed;
      const page: BaselinePage = { step, rows: rowsOf(rec) };
      pages.push(page);
      const thin = step.rowIds
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => breakoutWithPage(r, page.rows, { now: now() }))
        .find((b) => b.band === "too_few");
      const next = thin ? morePage(thin, step, rec.body, share - spent) : null;
      if (next) {
        const more = await session.call(stage, next.endpoint, baselineParams(next.endpoint, next.params), Math.min(next.credits, share - spent));
        if (more) {
          spent += more.creditsUsed;
          page.rows = [...page.rows, ...rowsOf(more)];
        }
      }
    }
  }
  return { plans, pages };
}

export async function runViral(session: Session, input: PlanInput, opts: ViralRunOptions = {}): Promise<ViralRunOutput> {
  const now = opts.now ?? (() => new Date());
  const ok = () => session.records.filter((r) => r.status === 200);

  // 1. search. Each search may spend at most its own quoted ceiling, never what is left of the run.
  const search = planSearch(input);
  const ceilings = searchCeilings(search);
  for (const [k, c] of search.entries()) await session.call(c.stage, c.endpoint, c.params, ceilings[k]);

  // 2. floor
  const candidates = candidatesOf(ok().filter((r) => r.stage.startsWith("search:")), input);

  // 3. baselines, each platform inside its share (a deep run gives each a larger one).
  const scale = opts.shareScale ?? 1;
  const shares = Object.fromEntries(Object.entries(BASELINE_SHARE).map(([p, v]) => [p, Math.floor(v * scale)])) as Record<ViralPlatform, number>;
  const { plans, pages } = await readBaselines(session, candidates.rows, shares, now);

  // 4 to 6. ratio, flags, rank; the top X break-outs get one retweeter page each.
  let result = rankViral(candidates.rows, plans, pages, { now: now() });
  const topX = result.items.filter((i) => i.viral && i.row.platform === "x").slice(0, opts.retweeterPosts ?? 2);
  if (topX.length) {
    const retweeters = new Map<string, { read: number; big: number }>();
    for (const i of topX) {
      const rec = await session.call("amplifiers:x", "twitter/tweet/retweeters", { url: i.row.url ?? `https://x.com/i/status/${i.row.id}` }, 1);
      if (rec) retweeters.set(i.row.id, retweeterRead(rec.body));
    }
    result = rankViral(candidates.rows, plans, pages, { now: now(), retweeters });
  }

  // 7. sizes: the report names an account only from 10,000 followers, so each break-out's
  // account the search returned without a count gets one profile read, inside the budget.
  const sizes = new Map<string, number>();
  const known = followersOf(ok());
  for (const i of unsizedAccounts(result.items, known)) {
    const c = sizeCall(i.row);
    if (!c) continue;
    const rec = await session.call(`sizes:${i.row.platform}`, c.endpoint, c.params, 1);
    const f = Number((rec?.body.data as { author?: { followers?: unknown } } | undefined)?.author?.followers);
    if (rec && Number.isFinite(f)) sizes.set(`${i.row.platform}:${i.row.author.toLowerCase()}`, f);
  }

  const meta = session.meta();
  const card = cardMarkdown({ topic: input.topic, since: input.since, until: input.until, credits: session.ledger.credits, candidates, result });
  return { records: ok(), candidates, result, card, meta, ledger: session.ledger, notRead: session.notRead, errors: session.errors, sizes };
}

export { SKILL };
