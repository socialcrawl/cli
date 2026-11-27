// /social-viral, run: sends the plan of viral.ts through the Session, one call at a time,
// every call under the run's one budget, every response kept, every credit booked.
// Stops cleanly when the budget is spent: what was not read is reported, never guessed.
import { breakoutWithPage, morePage } from "../../engine/baseline.ts";
import { retweeterRead } from "../../engine/boosted.ts";
import type { CostLedger, Meta } from "../../engine/rates.ts";
import { rowsOf } from "../../engine/rows.ts";
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
import type { BaselinePage, Candidates, PlanInput, ViralResult } from "./viral.ts";

export interface ViralRunOptions {
  /** Retweeter pages read for the top X break-outs (1 credit each), to test the boosted rule. */
  retweeterPosts?: number;
  /** Multiplies each platform's baseline share (a deep run reads more authors). */
  shareScale?: number;
  now?: () => Date;
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
}

type Params = Record<string, string | number | boolean | undefined>;

export async function runViral(session: Session, input: PlanInput, opts: ViralRunOptions = {}): Promise<ViralRunOutput> {
  const now = opts.now ?? (() => new Date());
  const ok = () => session.records.filter((r) => r.status === 200);

  // 1. search. Each search may spend at most its own quoted ceiling, never what is left of the run.
  const search = planSearch(input);
  const ceilings = searchCeilings(search);
  for (const [k, c] of search.entries()) await session.call(c.stage, c.endpoint, c.params, ceilings[k]);

  // 2. floor
  const candidates = candidatesOf(ok().filter((r) => r.stage.startsWith("search:")), input);

  // 3. baselines, each platform inside its share. A baseline is the author's own earlier
  // posts (study file 25): never topic-filtered, and with judging off. When a page holds fewer
  // than 8 earlier comparable posts, one more page is read while the platform's share can pay.
  const plans = planViralBaselines(candidates.rows);
  const pages: BaselinePage[] = [];
  const baselineParams = (endpoint: string, params: Params) =>
    TOPIC_LANES.has(endpoint) ? { ...params, judgments: "off" } : stageParams(endpoint, { ...params }, { labels: "off" });
  for (const plan of plans) {
    const share = Math.floor(BASELINE_SHARE[plan.platform as keyof typeof BASELINE_SHARE] * (opts.shareScale ?? 1));
    let spent = 0;
    for (const step of plan.steps) {
      const stage = `baseline:${plan.platform}`;
      const rec = await session.call(stage, step.endpoint, baselineParams(step.endpoint, step.params), Math.min(step.credits, share - spent));
      if (!rec) continue;
      spent += rec.creditsUsed;
      const page: BaselinePage = { step, rows: rowsOf(rec) };
      pages.push(page);
      const thin = step.rowIds
        .map((id) => candidates.rows.find((r) => r.id === id))
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

  const meta = session.meta();
  const card = cardMarkdown({ topic: input.topic, since: input.since, until: input.until, credits: session.ledger.credits, candidates, result });
  return { records: ok(), candidates, result, card, meta, ledger: session.ledger, notRead: session.notRead, errors: session.errors };
}

export { SKILL };
