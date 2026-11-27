// reddit-marketing, reading the stored responses. Pure: records in, findings' raw material out.
//
// Privacy: comment authors are never read into a comment (text, score and link only), and the
// report describes thread authors instead of naming them; communities are named.
import { breakoutWithPage } from "../../engine/baseline.ts";
import type { Breakout } from "../../engine/breakout.ts";
import { rowsOf, uniqueRows } from "../../engine/rows.ts";
import type { ResponseRecord, Row } from "../../engine/rows.ts";

// ── Threads ──────────────────────────────────────────────────────────────────

export interface Thread {
  row: Row;
  title: string;
  /** The API's intent label on the post: asking_for_recommendation, promoting, news_or_discussion, other, or null. */
  intent: string | null;
  /** The API's buyer flag on the intent label, when it gave one. */
  buyer: boolean | null;
  /** The search stage that found it first. */
  stage: string;
}

/** Every thread of the search responses, once each; the first copy wins. */
export function threadsOf(records: (ResponseRecord & { stage?: string; name?: string })[]): Thread[] {
  const out: Thread[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const items: any[] = Array.isArray(rec.body?.data?.items) ? rec.body.data.items : [];
    const rows = uniqueRows(rowsOf(rec));
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const it = items.find((i) => String(i?.post?.id) === row.id);
      const intent = it?.computed?.labels?.intent;
      out.push({
        row,
        title: String(it?.post?.ext?.title ?? row.text.split("\n")[0]),
        intent: typeof intent?.label === "string" ? intent.label : null,
        buyer: typeof intent?.buyer === "boolean" ? intent.buyer : null,
        stage: rec.stage ?? rec.name ?? rec.endpoint,
      });
    }
  }
  return out;
}

// ── Comments ─────────────────────────────────────────────────────────────────

export interface CommentLabels {
  question: number | null;
  complaint: number | null;
  purchaseIntent: number | null;
  /** 0 very negative to 4 very positive. */
  sentiment: number | null;
}

export interface Comment {
  id: string;
  threadId: string | null;
  depth: number;
  text: string;
  likes: number | null;
  url: string | null;
  publishedAt: string | null;
  /** Null when the API sent no labels for this comment (it labels the top level of a tree). */
  labels: CommentLabels | null;
  requestId: string | null;
}

/** At most `k` characters, cut at a word, with an ellipsis when anything was cut. */
export function cut(s: string, k: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= k) return t;
  return `${t.slice(0, k).replace(/\s+\S*$/, "").replace(/[\s,;:]+$/, "")}…`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function labelsOf(l: any): CommentLabels | null {
  if (!l || typeof l !== "object" || Object.keys(l).length === 0) return null;
  return { question: num(l.question?.p), complaint: num(l.complaint?.p), purchaseIntent: num(l.purchase_intent?.p), sentiment: num(l.sentiment?.level) };
}

/** Every comment of one reddit/post/comments response, replies flattened, with its depth. */
export function commentsOf(rec: ResponseRecord): Comment[] {
  const d = rec.body?.data ?? {};
  const threadId = d.post?.id ? String(d.post.id) : null;
  const out: Comment[] = [];
  const walk = (nodes: any[], depth: number) => {
    for (const n of nodes ?? []) {
      const c = n?.comment ?? n;
      if (!c?.id) continue;
      out.push({
        id: String(c.id),
        threadId: c.post_id ? String(c.post_id) : threadId,
        depth: num(c.ext?.depth) ?? depth,
        text: String(c.text ?? ""),
        likes: num(c.engagement?.likes),
        url: typeof c.url === "string" ? c.url : null,
        publishedAt: typeof c.published_at === "string" ? c.published_at : null,
        labels: labelsOf(n?.computed?.labels ?? c.computed?.labels),
        requestId: rec.requestId,
      });
      walk(c.replies ?? [], depth + 1);
    }
  };
  walk(Array.isArray(d.items) ? d.items : [], 0);
  return out;
}

/** A comment counts as a question, a complaint or buying intent at this probability or more. */
export const LABEL_CUT = 0.5;
export const QUOTES_PER_KIND = 3;

export interface Quote {
  text: string;
  likes: number | null;
  url: string | null;
  requestId: string | null;
}

export interface AskSummary {
  comments: number;
  labelled: number;
  unlabelled: number;
  questions: number;
  complaints: number;
  purchaseIntent: number;
  positive: number;
  neutral: number;
  negative: number;
  quotes: { question: Quote[]; complaint: Quote[]; purchase_intent: Quote[] };
}

export function askSummary(comments: Comment[]): AskSummary {
  const labelled = comments.filter((c) => c.labels !== null);
  const is = (k: keyof CommentLabels) => labelled.filter((c) => (c.labels![k] ?? 0) >= LABEL_CUT);
  const quotes = (cs: Comment[]): Quote[] =>
    [...cs]
      .filter((c) => c.text.trim().length > 0)
      .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1))
      .slice(0, QUOTES_PER_KIND)
      .map((c) => ({ text: cut(c.text, 280), likes: c.likes, url: c.url, requestId: c.requestId }));
  const level = (f: (l: number) => boolean) => labelled.filter((c) => c.labels!.sentiment !== null && f(c.labels!.sentiment)).length;
  const q = is("question");
  const co = is("complaint");
  const pi = is("purchaseIntent");
  return {
    comments: comments.length,
    labelled: labelled.length,
    unlabelled: comments.length - labelled.length,
    questions: q.length,
    complaints: co.length,
    purchaseIntent: pi.length,
    positive: level((l) => l >= 3),
    neutral: level((l) => l === 2) + labelled.filter((c) => c.labels!.sentiment === null).length,
    negative: level((l) => l <= 1),
    quotes: { question: quotes(q), complaint: quotes(co), purchase_intent: quotes(pi) },
  };
}

// ── Communities ──────────────────────────────────────────────────────────────

export interface Rule {
  number: number;
  title: string;
  text: string;
}

export interface Community {
  name: string;
  members: number | null;
  weeklyActive: number | null;
  /** "listed" when the rules came back; "not_reported" means the source sent none, not that none exist. */
  rulesStatus: string;
  rules: Rule[];
  promotionRules: Rule[];
  requestId: string | null;
}

/** Where a rule's title ends: the first capitalised word after the second, unless it follows "&". */
function titleOf(body: string): string {
  const tok = body.split(/\s+/);
  for (let i = 2; i < tok.length; i++) if (/^[A-Z][a-z']+$/.test(tok[i]) && tok[i - 1] !== "&") return tok.slice(0, i).join(" ");
  return body;
}

/** "1 Be kind Treat others well.\n\n2 No spam ..." as numbered rules. */
export function parseRules(text: string | null | undefined): Rule[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n(?=\d+\s)/)
    .map((part) => part.trim().match(/^(\d+)\s+([\s\S]+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => {
      const body = m[2].replace(/\s+/g, " ").trim();
      const title = titleOf(body);
      // Reddit sends a rule's title and description run together: a full stop keeps them apart.
      const rest = body.slice(title.length).trim();
      const text = rest && !/[.!?:]$/.test(title) ? `${title}. ${rest}` : body;
      return { number: Number(m[1]), title, text };
    });
}

export const PROMOTION_RULE = /promot|shill|spam|advertis|solicit|show and tell|showcase|portfolio|your (?:own )?(?:project|product|business|startup)/i;

export function communityOf(rec: ResponseRecord): Community | null {
  const a = rec.body?.data?.author;
  if (!a?.username) return null;
  const rules = parseRules(a.ext?.rules_text);
  return {
    name: String(a.username),
    members: num(a.followers),
    weeklyActive: num(a.ext?.weekly_active_users),
    rulesStatus: String(a.ext?.rules_status ?? (rules.length ? "listed" : "not_reported")),
    rules,
    promotionRules: rules.filter((r) => PROMOTION_RULE.test(r.text)),
    requestId: rec.requestId,
  };
}

// ── Break-outs against the community ─────────────────────────────────────────

export interface ThreadBreakout {
  thread: Thread;
  breakout: Breakout | null;
  /** The thread's place in its community's top posts of the month, when it is among them. */
  monthRank: number | null;
  /** Why there is no breakout: the community's listing was not read. */
  reason: "community_not_read" | null;
}

/**
 * Each thread against its community's top posts of the month that came before it (the engine's
 * method: previous mode, the thread left out, no number under 8). Reddit's score is read as likes.
 */
export function threadBreakouts(threads: Thread[], pages: Map<string, ResponseRecord>, now: Date): ThreadBreakout[] {
  const lower = new Map([...pages].map(([k, v]) => [k.toLowerCase(), rowsOf(v)]));
  return threads.map((thread) => {
    const rows = thread.row.community ? lower.get(thread.row.community.toLowerCase()) : undefined;
    if (!rows) return { thread, breakout: null, monthRank: null, reason: "community_not_read" };
    const ranked = [...rows].sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));
    const at = ranked.findIndex((r) => r.id === thread.row.id);
    return { thread, breakout: breakoutWithPage(thread.row, rows, { now, metric: "likes" }), monthRank: at >= 0 ? at + 1 : null, reason: null };
  });
}

// ── Where a disclosed reply would help ───────────────────────────────────────

export const ASKING_INTENTS = new Set(["asking_for_recommendation", "comparing_options", "switching_away"]);
/** A reply is worth writing while a thread is fresh. */
export const OPPORTUNITY_DAYS = 30;
export const MAX_OPPORTUNITIES = 10;

export interface Opportunity {
  thread: Thread;
  ageDays: number;
  /** The community's rule on promotion, quoted, or why it is not known. */
  rule: string;
  score: number;
}

const ruleLine = (community: string, c: Community | undefined, failed: boolean): string => {
  if (!c && failed) return `r/${community}: the API did not return its rules in this run; read them on the community's page before replying`;
  if (!c) return `r/${community}: rules not read in this run; read them before replying`;
  if (c.rulesStatus !== "listed") return `r/${community}: rules not reported by the source, which does not mean there are none`;
  const r = c.promotionRules[0];
  return r ? `r/${community} rule ${r.number}: ${cut(r.text, 140)}` : `r/${community}: no rule on promotion among its ${c.rules.length} rules`;
};

/**
 * Recent threads where people ask for a tool (the API's intent label, or a title that asks), never
 * promotional ones. Fresher threads with fewer replies rank first: an answer there is still seen.
 */
export function opportunities(threads: Thread[], communities: Map<string, Community>, now: Date, max = MAX_OPPORTUNITIES, rulesFailed: string[] = []): Opportunity[] {
  const byName = new Map([...communities].map(([k, v]) => [k.toLowerCase(), v]));
  const failed = new Set(rulesFailed.map((c) => c.toLowerCase()));
  const out: Opportunity[] = [];
  for (const t of threads) {
    if (t.intent === "promoting" || !t.row.publishedAt || !t.row.community) continue;
    const asks = (t.intent !== null && ASKING_INTENTS.has(t.intent)) || /\?\s*$/.test(t.title);
    if (!asks) continue;
    const ageDays = (now.getTime() - Date.parse(t.row.publishedAt)) / 86_400_000;
    if (ageDays > OPPORTUNITY_DAYS) continue;
    const intentWeight = t.intent !== null && ASKING_INTENTS.has(t.intent) ? 2 : 1;
    const score = Math.round((intentWeight + 2 * (1 - ageDays / OPPORTUNITY_DAYS) + 1 / (1 + (t.row.comments ?? 0) / 10)) * 1000) / 1000;
    out.push({ thread: t, ageDays: Math.round(ageDays * 10) / 10, rule: ruleLine(t.row.community, byName.get(t.row.community.toLowerCase()), failed.has(t.row.community.toLowerCase())), score });
  }
  return out.sort((a, b) => b.score - a.score || a.thread.row.id.localeCompare(b.thread.row.id)).slice(0, max);
}
