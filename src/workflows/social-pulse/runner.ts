// /social-pulse, run: this week and the week before, read with the same discover call, then
// this week's posts above the reach floor measured against their authors' earlier posts.
// Every call goes through the Session; a week whose free quote no longer fits is not read.
import type { CostLedger, Meta } from "../../engine/rates.ts";
import type { Row } from "../../engine/rows.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import { followersOf, readBaselines, sizeCall, unsizedAccounts } from "../social-viral/runner.ts";
import { FLOORS, VIRAL_PLATFORMS, rankViral } from "../social-viral/viral.ts";
import type { ViralPlatform, ViralResult } from "../social-viral/viral.ts";
import { discoverParams, rowOf, weekSummary } from "./pulse.ts";
import type { WeekSummary, Window } from "./pulse.ts";

/** Baseline credits per platform at default. LinkedIn pays 5 an author, so it is left out. */
export const PULSE_SHARE: Record<ViralPlatform, number> = { x: 4, tiktok: 4, instagram: 3, youtube: 4, reddit: 2, linkedin: 0 };
export const DEEP_SCALE = 2.5;

export interface PulseInput {
  topic: string;
  about?: string;
  thisWeek: Window;
  before: Window;
}

export interface WeekRead {
  window: Window;
  record: CallRecord | null;
  summary: WeekSummary | null;
  rows: Row[];
  /** The raw discover items, for the tables and the questions. */
  items: Record<string, unknown>[];
  /** Why the week was not read, when it was not. */
  notRead: string | null;
}

export interface PulseOutput {
  thisWeek: WeekRead;
  before: WeekRead;
  candidates: Row[];
  result: ViralResult;
  sizes: Map<string, number>;
  records: CallRecord[];
  meta: Meta;
  ledger: CostLedger;
  notRead: Session["notRead"];
  errors: Session["errors"];
}

async function readWeek(session: Session, name: string, input: PulseInput, w: Window, deep: boolean): Promise<WeekRead> {
  const week: WeekRead = { window: w, record: null, summary: null, rows: [], items: [], notRead: null };
  const params = discoverParams(input, w, deep);
  const quote = await session.call(`${name}:quote`, "prism/discover", { ...params, dry_run: "true" });
  const need = Number((quote?.body.data as { estimate?: { min_max_credits?: unknown } } | undefined)?.estimate?.min_max_credits);
  if (!quote || !Number.isFinite(need)) {
    week.notRead = "its free quote did not come back";
    return week;
  }
  if (need > session.budget.left) {
    session.notRead.push({ stage: `${name}:read`, endpoint: "prism/discover", reason: "budget", limit: "run" });
    week.notRead = `its quote asks for ${need} credits and this run had ${session.budget.left} left`;
    return week;
  }
  const rec = await session.call(`${name}:read`, "prism/discover", { ...params, max_credits: need });
  if (!rec) {
    week.notRead = "the API refused the read";
    return week;
  }
  week.record = rec;
  week.summary = weekSummary(rec.body);
  week.items = ((rec.body.data as { items?: Record<string, unknown>[] } | undefined)?.items ?? []).filter((it) => it && typeof it === "object");
  week.rows = week.items.map((it) => rowOf(it, rec.requestId)).filter((r): r is Row => r !== null);
  return week;
}

/** This week's originals in the window and above their platform's reach floor. */
export function pulseCandidates(rows: Row[], w: Window): Row[] {
  return rows.filter((r) => {
    const floor = FLOORS[r.platform as ViralPlatform];
    const d = (r.publishedAt ?? "").slice(0, 10);
    if (!floor || !d || d < w.since || d > w.until || r.kind !== "original") return false;
    const v = floor.metric === "views" ? r.views : r.likes;
    return v !== null && v >= floor.min;
  });
}

export async function runPulse(session: Session, input: PulseInput, opts: { deep: boolean; now: () => Date }): Promise<PulseOutput> {
  const thisWeek = await readWeek(session, "this-week", input, input.thisWeek, opts.deep);
  const before = await readWeek(session, "week-before", input, input.before, opts.deep);

  const candidates = pulseCandidates(thisWeek.rows, input.thisWeek);
  const scale = opts.deep ? DEEP_SCALE : 1;
  const shares = Object.fromEntries(VIRAL_PLATFORMS.map((p) => [p, Math.floor(PULSE_SHARE[p] * scale)])) as Record<ViralPlatform, number>;
  const { plans, pages } = await readBaselines(session, candidates, shares, opts.now);
  const result = rankViral(candidates, plans, pages, { now: opts.now() });

  const ok = () => session.records.filter((r) => r.status === 200);
  const sizes = new Map<string, number>();
  const known = followersOf(ok());
  for (const r of thisWeek.rows) if (r.authorFollowers !== null) known.set(`${r.platform}:${r.author.toLowerCase()}`, r.authorFollowers);
  for (const i of unsizedAccounts(result.items, known)) {
    const c = sizeCall(i.row);
    if (!c) continue;
    const rec = await session.call(`sizes:${i.row.platform}`, c.endpoint, c.params, 1);
    const f = Number((rec?.body.data as { author?: { followers?: unknown } } | undefined)?.author?.followers);
    if (rec && Number.isFinite(f)) sizes.set(`${i.row.platform}:${i.row.author.toLowerCase()}`, f);
  }
  for (const [k, v] of known) if (!sizes.has(k)) sizes.set(k, v);

  return { thisWeek, before, candidates, result, sizes, records: ok(), meta: session.meta(), ledger: session.ledger, notRead: session.notRead, errors: session.errors };
}
