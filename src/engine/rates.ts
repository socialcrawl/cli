// One rate table drives the free quote, the dry run and the ledger, so the three can
// never disagree. Prices are the API's published per-page prices (checked against the
// registry by test/engine/endpoints.contract.test.ts in the SocialCrawl monorepo); the
// live `utility/estimate` quote stays the authority before any paid stage.
//
// Every walk carries `max_credits`, so a page never starts past the stage's budget; the
// walk reports where it stopped and the oldest date it reached, and the report says so.
// The cost hygiene (one table, confirm above a cost, a budget stop, a meta block on every
// output) is adapted from xint (0xNyk/xint, MIT); see THIRD_PARTY_NOTICES.md.

export interface Rate {
  /** Credits per page (or per call where the endpoint has no pages). */
  page: number;
  /** Extra credits held when relevance=filter&relevant_to= is sent; settles to 1 per started 25 rows judged. */
  topicHold?: number;
  /** True when the endpoint walks pages and takes max_credits. */
  walks: boolean;
  /**
   * The least max_credits the server accepts for one page, when it is above the published
   * price (its gate prices the page with holds the docs do not list; a lower cap is a free 400
   * that names `page_credits`). Measured, never guessed.
   */
  minMaxCredits?: number;
  note?: string;
}

export const RATES: Record<string, Rate> = {
  "twitter/search/tweets": { page: 1, topicHold: 4, walks: true },
  "twitter/user/tweets": { page: 1, walks: true },
  "twitter/profile": { page: 1, walks: false },
  "twitter/tweet": { page: 1, walks: false },
  "twitter/tweet/replies": { page: 1, walks: true },
  "twitter/tweet/retweeters": { page: 1, walks: true },
  "twitter/tweet/transcript": { page: 10, walks: false },
  "tiktok/search": { page: 1, topicHold: 5, walks: true },
  "tiktok/profile/videos": { page: 1, walks: true },
  "tiktok/post/comments": { page: 1, walks: true },
  "tiktok/post/transcript": { page: 10, walks: false },
  "instagram/search/reels": { page: 1, topicHold: 4, walks: true },
  "instagram/profile/reels": { page: 1, walks: true },
  "instagram/post/comments": { page: 5, walks: true },
  "instagram/media/transcript": { page: 10, walks: false },
  "youtube/search": { page: 1, topicHold: 4, walks: true },
  "youtube/channel/videos": { page: 1, walks: true },
  "youtube/video/comments": { page: 1, walks: true },
  "youtube/transcripts": { page: 3, walks: false, note: "3 per transcript" },
  // minMaxCredits 10 works around an API bug, not a price. Production read max_pages=1 sent
  // with max_credits as "every post the cap can pay for" (row-walk/deep-page.ts), so any cap was
  // refused at cap + 4: 6 asked for 10 (live /social-viral run, 26/11/2026; SOC-33). Fixed in the
  // tree by codebase-1f, not yet deployed. Once the fix is live, set this to 5 (the page plus the
  // topic hold), or drop it, since the general floor is already page + topicHold for one page.
  // Harmless meanwhile: one page still spends 1 credit.
  "reddit/search": { page: 1, topicHold: 4, walks: true, minMaxCredits: 10 },
  "reddit/subreddit": { page: 1, walks: true },
  "reddit/post/comments": { page: 5, walks: true },
  "reddit/profile": { page: 1, walks: false },
  "reddit/profile/posts": { page: 1, walks: true },
  "reddit/profile/comments": { page: 2, walks: false, note: "2 per comment returned; quote it first" },
  "linkedin/search/posts": { page: 5, topicHold: 8, walks: true },
  "linkedin/profile/posts": { page: 5, walks: false },
  "linkedin/post/comments": { page: 5, walks: true },
  "github/repo": { page: 1, walks: false },
  "prism/launch-echo": { page: 20, walks: false },
  "utility/estimate": { page: 0, walks: false },
  "credits/balance": { page: 0, walks: false },
};

/** A stage asks before it spends above this many credits. */
export const CONFIRM_ABOVE = 25;
/** Every default run of every skill fits the welcome credits. */
export const DEFAULT_RUN_BUDGET = 100;

export interface PlannedCall {
  stage: string;
  endpoint: string;
  pages?: number;
  /** How many such calls (for example one per author). */
  count?: number;
  /** relevance=filter&relevant_to= is on the call. */
  topic?: boolean;
}

export interface QuoteLine {
  stage: string;
  endpoint: string;
  calls: number;
  /** What it settles to when every judged page is new rows: pages × price + the topic filter's 1 per 25 rows. */
  expected: number;
  /** The most it can hold before refunds. */
  max: number;
}

export interface Quote {
  lines: QuoteLine[];
  expected: number;
  max: number;
  /** Stages above CONFIRM_ABOVE, which ask first. */
  confirm: string[];
}

export function rateOf(endpoint: string): Rate {
  const r = RATES[endpoint.replace(/^\/?(v1\/)?/, "")];
  if (!r) throw new Error(`No rate for ${endpoint}: add it to RATES (src/engine/rates.ts) before a skill calls it.`);
  return r;
}

/** The dry run: what each stage will cost, from the table alone (free, no network). */
export function quote(calls: PlannedCall[], confirmAbove = CONFIRM_ABOVE): Quote {
  const lines: QuoteLine[] = [];
  for (const c of calls) {
    const r = rateOf(c.endpoint);
    const pages = c.pages ?? 1;
    const count = c.count ?? 1;
    const base = r.page * pages * count;
    // The topic filter settles to about one credit per page of up to 25 rows judged.
    const topicExpected = c.topic && r.topicHold ? pages * count : 0;
    const topicMax = c.topic && r.topicHold ? r.topicHold * pages * count : 0;
    lines.push({ stage: c.stage, endpoint: c.endpoint, calls: count, expected: base + topicExpected, max: base + topicMax });
  }
  const byStage = new Map<string, number>();
  for (const l of lines) byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + l.max);
  return {
    lines,
    expected: lines.reduce((s, l) => s + l.expected, 0),
    max: lines.reduce((s, l) => s + l.max, 0),
    confirm: [...byStage.entries()].filter(([, v]) => v > confirmAbove).map(([k]) => k),
  };
}

export function quoteLines(q: Quote): string[] {
  const out = q.lines.map((l) => `${l.stage}: ${l.calls} × ${l.endpoint}, about ${l.expected} credits (at most ${l.max})`);
  out.push(`Total: about ${q.expected} credits, at most ${q.max}.`);
  if (q.confirm.length) out.push(`Asks before: ${q.confirm.join(", ")} (over ${CONFIRM_ABOVE} credits each).`);
  return out;
}

/**
 * The params of one walk. max_pages is always sent: the caller's planned pages, default 1.
 * Sent without it, max_credits turns any call into a walk of up to 50 pages that spends the
 * whole cap (the first live /social-viral run, 26/11/2026: one LinkedIn search walked 11 pages
 * for 66 credits and starved every baseline). max_credits is then the smallest of the cap
 * given, and what the planned pages can cost at most (each page's price plus the topic
 * filter's hold when relevant_to is sent).
 */
export function walkParams(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  maxCredits: number,
): Record<string, string | number | boolean | undefined> {
  const r = rateOf(endpoint);
  if (!r.walks) return params;
  const pages = Math.max(1, Math.floor(Number(params.max_pages ?? 1)) || 1);
  const topic = params.relevant_to !== undefined && r.topicHold ? r.topicHold : 0;
  const floor = Math.max(r.page, r.minMaxCredits ?? 0);
  const most = Math.max(pages * (r.page + topic), floor);
  const cap = Math.floor(Math.min(maxCredits, most));
  if (cap < floor) throw new Error(`${endpoint} needs max_credits of at least ${floor} for a page; a budget of ${maxCredits} cannot start it.`);
  return { ...params, max_pages: pages, max_credits: cap };
}

export interface WalkOutcome {
  pages: number | null;
  stopped: string | null;
  credits: number;
  /** The oldest published_at among the rows, as DD/MM/YYYY: how far back the walk reached. */
  reached: string | null;
  hasMore: boolean;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Read a walk's own report from a response, and the date its rows reached back to. */
export function walkOutcome(body: { data?: any; credits_used?: number; pagination?: any }): WalkOutcome {
  const d = body.data ?? {};
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const dates = items.map((it) => it?.post?.published_at ?? it?.comment?.published_at).filter((x): x is string => typeof x === "string").sort();
  return {
    pages: typeof d.walk?.pages === "number" ? d.walk.pages : null,
    stopped: d.walk?.stopped ?? null,
    credits: Number(body.credits_used ?? 0),
    reached: dates.length ? dmy(dates[0]) : null,
    hasMore: Boolean(body.pagination?.has_more ?? d.next_cursor),
  };
}

export class BudgetSpent extends Error {
  constructor(endpoint: string, left: number, page: number) {
    super(`The run's budget has ${left} credits left; ${endpoint} costs ${page}. The report says what was not read.`);
    this.name = "BudgetSpent";
  }
}

/**
 * The run-level cap: every stage of a run draws on one budget (100 credits for a default
 * run), so the sum of every walk's max_credits can never pass it. A call is let through
 * only with a cap that fits what is left; a walk's actual spend is booked after it returns.
 */
export class Budget {
  readonly total: number;
  spent = 0;
  constructor(total: number = DEFAULT_RUN_BUDGET) {
    this.total = total;
  }
  get left(): number {
    return Math.max(0, this.total - this.spent);
  }
  canAfford(credits: number): boolean {
    return credits <= this.left;
  }
  /**
   * The params to send for one call: a walk gets its planned max_pages (default 1) and
   * max_credits = the smallest of its stage's share, what is left of the run and what those
   * pages can cost; a one-page call must fit what is left. Throws BudgetSpent when not even
   * one page fits.
   */
  allow(endpoint: string, params: Record<string, string | number | boolean | undefined>, stageMax = Infinity): Record<string, string | number | boolean | undefined> {
    const r = rateOf(endpoint);
    const cap = Math.min(stageMax, this.left);
    const floor = r.walks ? Math.max(r.page, r.minMaxCredits ?? 0) : r.page;
    if (cap < floor) throw new BudgetSpent(endpoint, this.left, floor);
    return r.walks ? walkParams(endpoint, params, cap) : params;
  }
  spend(credits: number): void {
    this.spent += credits;
  }
}

export interface LedgerLine {
  stage: string;
  endpoint: string;
  requestId: string | null;
  credits: number;
  status: number;
}

/** What the run actually spent, by stage, against what was quoted. */
export class CostLedger {
  lines: LedgerLine[] = [];
  add(line: LedgerLine): void {
    this.lines.push(line);
  }
  get credits(): number {
    return this.lines.reduce((s, l) => s + l.credits, 0);
  }
  byStage(): Record<string, { calls: number; credits: number }> {
    const out: Record<string, { calls: number; credits: number }> = {};
    for (const l of this.lines) {
      out[l.stage] ??= { calls: 0, credits: 0 };
      out[l.stage].calls++;
      out[l.stage].credits += l.credits;
    }
    return out;
  }
  requestIds(): Set<string> {
    return new Set(this.lines.map((l) => l.requestId).filter((x): x is string => x !== null));
  }
}

export interface Meta {
  skill: string;
  version: string;
  credits: number;
  calls: number;
  seconds: number;
  /** DD/MM/YYYY */
  date: string;
  generated_at: string;
}

export function metaBlock(o: { skill: string; version: string; ledger: CostLedger; startedAt: Date; now: Date }): Meta {
  return {
    skill: o.skill,
    version: o.version,
    credits: o.ledger.credits,
    calls: o.ledger.lines.length,
    seconds: Math.round((o.now.getTime() - o.startedAt.getTime()) / 100) / 10,
    date: dmy(o.now.toISOString()),
    generated_at: o.now.toISOString(),
  };
}
