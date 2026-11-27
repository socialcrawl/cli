// What the comments ask, from the free labels the comment stage sends explicitly
// (label=sentiment,question,purchase_intent,complaint). A row is counted in a class at p of
// 0.5 or more. Unlabelled rows are counted apart and never read as "no questions".
import { commentsOf, labelGaps } from "../../engine/index.ts";
import type { LabelGaps, ResponseRecord } from "../../engine/index.ts";

export const LABEL_P = 0.5;
export const QUOTES_PER_CLASS = 3;
const QUOTE_MAX = 140;

export type AskClass = "question" | "purchase_intent" | "complaint";
export const ASK_CLASSES: AskClass[] = ["question", "purchase_intent", "complaint"];
export const ASK_LABEL: Record<AskClass, string> = { question: "questions", purchase_intent: "buying signals", complaint: "complaints" };

export interface Quote {
  text: string;
  likes: number | null;
  postId: string | null;
  commentId: string;
  requestId: string | null;
}

export interface AskSummary {
  read: number;
  labelled: number;
  unlabelled: number;
  gaps: LabelGaps[];
  classes: Record<AskClass, { count: number; quotes: Quote[] }>;
  /** Labelled comments at sentiment level 4 or 5, and at 1 or 2. */
  positive: number;
  negative: number;
  requestIds: string[];
}

/** A comment as a quote: no links, emails, phone numbers or mentions, at most 140 characters. */
export function quoteText(text: string): string {
  const s = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "")
    .replace(/@[\w.]+/g, "")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length <= QUOTE_MAX ? s : s.slice(0, QUOTE_MAX - 1).replace(/\s+\S*$/, "") + "…";
}

const p = (labels: Record<string, any> | null, k: string): number | null => {
  const v = labels?.[k]?.p;
  return typeof v === "number" ? v : null;
};

export function askSummary(records: ResponseRecord[]): AskSummary {
  const rows = records.flatMap((r) => commentsOf(r));
  const labelled = rows.filter((r) => r.labels && Object.keys(r.labels).length > 0);
  const classes = Object.fromEntries(ASK_CLASSES.map((k) => [k, { count: 0, quotes: [] as Quote[] }])) as AskSummary["classes"];
  for (const k of ASK_CLASSES) {
    const hits = labelled.filter((r) => (p(r.labels, k) ?? 0) >= LABEL_P);
    classes[k].count = hits.length;
    classes[k].quotes = hits
      .map((r) => ({ text: quoteText(r.text), likes: r.likes, postId: r.postId, commentId: r.id, requestId: r.requestId }))
      .filter((q) => q.text.length >= 3)
      .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1))
      .filter((q, i, all) => all.findIndex((o) => o.text.toLowerCase() === q.text.toLowerCase()) === i)
      .slice(0, QUOTES_PER_CLASS);
  }
  const level = (r: (typeof labelled)[number]) => {
    const v = (r.labels as Record<string, any>)?.sentiment?.level;
    return typeof v === "number" ? v : null;
  };
  return {
    read: rows.length,
    labelled: labelled.length,
    unlabelled: rows.length - labelled.length,
    gaps: records.map(labelGaps).filter((g) => g.unlabelled > 0 || g.unavailable),
    classes,
    positive: labelled.filter((r) => (level(r) ?? 0) >= 4).length,
    negative: labelled.filter((r) => (level(r) ?? 9) <= 2).length,
    requestIds: [...new Set(records.map((r) => r.requestId).filter((x): x is string => x !== null))],
  };
}
