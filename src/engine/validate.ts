// The report gate. The agent writes the prose; this code decides whether the report may be
// shown. It fails a report when:
//   - a citation ([F3]) or a request id (req-…) does not resolve to evidence.json
//   - a required section is missing or out of order
//   - fewer than 80% of five or more playbook steps cite evidence
//   - a summary line cites nothing
//   - a spend figure appears (spend is never public; credits are the only money we state)
//   - a banned token appears (the monorepo passes its supplier list here)
//   - "paid", "bot", "ring" or "undisclosed" sits in a sentence with a named account
//   - a sentence of prose states a number that is not in evidence.json (numbers come only
//     from the engine)
//
// The gate is REM's src/report/validate.ts (dansugc/reverse-engineer-marketing, MIT) with our
// additions, and the number lint is dissect's rule (0xpratzyy/dissect, MIT): measured numbers
// pasted, words interpreted. See THIRD_PARTY_NOTICES.md.
import type { EvidenceJson } from "./evidence.ts";

export type ProblemCode =
  | "unresolved_citation"
  | "unresolved_request"
  | "missing_section"
  | "section_order"
  | "playbook_uncited"
  | "summary_uncited"
  | "spend_figure"
  | "banned_token"
  | "accusation"
  | "number_not_in_evidence";

export interface Problem {
  code: ProblemCode;
  line: number;
  detail: string;
}

export interface ValidateOptions {
  /** Section headings ("## Title") that must appear, in this order. */
  requiredSections?: string[];
  /** The heading whose numbered steps must cite evidence (REM's 80% rule). */
  playbookSection?: string;
  /** The heading whose every bullet or numbered line must cite evidence. */
  summarySection?: string;
  /** Sections the engine wrote itself: their numbers are not linted. */
  engineSections?: string[];
  /** Words that may never appear (lower-case). The monorepo passes SUPPLIER_TOKENS. */
  bannedTokens?: readonly string[];
  /** Account names (besides @handles) that count as named accounts. */
  namedAccounts?: string[];
  /** Numbers that may appear without evidence (for example the version or the welcome credits). */
  allowNumbers?: number[];
}

export interface Validation {
  ok: boolean;
  problems: Problem[];
}

export const ACCUSATION = /\b(paid|bots?|ring|undisclosed)\b/i;
const SPEND = /(?:[$£€]\s?\d|\b\d[\d,.]*\s?(?:usd|gbp|eur|dollars|pounds)\b)/i;
const SPEND_WORD = /\b(spen[dt]|spending|budget|ad spend|on ads|media buy)\b/i;
const CITE = /\[F\d+\]|\breq-[A-Za-z0-9]+/;

interface Line {
  no: number;
  text: string;
  section: string | null;
  kind: "heading" | "table" | "code" | "quote" | "prose" | "blank";
}

function linesOf(md: string): Line[] {
  const out: Line[] = [];
  let section: string | null = null;
  let fence = false;
  md.split(/\r?\n/).forEach((text, i) => {
    let kind: Line["kind"];
    if (/^\s*```/.test(text)) {
      fence = !fence;
      kind = "code";
    } else if (fence) kind = "code";
    else if (/^#{1,6}\s/.test(text)) {
      kind = "heading";
      if (/^##\s/.test(text)) section = text.replace(/^##\s+/, "").trim();
    } else if (/^\s*\|/.test(text)) kind = "table";
    else if (/^\s*>/.test(text)) kind = "quote";
    else if (!text.trim()) kind = "blank";
    else kind = "prose";
    out.push({ no: i + 1, text, section, kind });
  });
  return out;
}

/** Sentences of one line (a line is short in these reports; a sentence never spans lines). */
const sentences = (s: string) => s.split(/(?<=[.!?;])\s+(?=[A-Z@"“(\d])/);

/** Every number in the evidence, in the forms a sentence may print it. */
function knownNumbers(ev: EvidenceJson, allow: number[]): number[] {
  const out: number[] = [...allow];
  const take = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  };
  for (const f of ev.findings) for (const v of Object.values(f.numbers)) take(v);
  for (const c of ev.coverage) {
    [c.pages, c.rowsRead, c.rowsKept, c.of, c.credits].forEach(take);
    c.dropped.forEach((d) => take(d.count));
  }
  if (ev.meta) [ev.meta.credits, ev.meta.calls, ev.meta.seconds].forEach(take);
  return out;
}

/** True when `shown` (as printed, with `decimals` places) is one of the known numbers, as itself or as a percentage of a share. */
function matches(shown: number, decimals: number, known: number[]): boolean {
  const r = (x: number) => Math.round(x * 10 ** decimals) / 10 ** decimals;
  return known.some((k) => r(k) === shown || r(k * 100) === shown || (Math.abs(k) >= 1e6 && r(k / 1e6) === shown) || (Math.abs(k) >= 1e3 && r(k / 1e3) === shown));
}

/** The numbers a prose line states, with what is not a stated quantity masked out first. */
export function statedNumbers(text: string): { value: number; decimals: number; raw: string }[] {
  const masked = text
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[F\d+\]/g, " ")
    .replace(/\breq[- ][A-Za-z0-9-]+/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/\bv\d+(?:\.\d+)+\b/g, " ")
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, " ")
    .replace(/\/[\w-]+/g, " ");
  const out: { value: number; decimals: number; raw: string }[] = [];
  for (const m of masked.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,(?=\d{3}\b)/g, "");
    if (/,/.test(raw)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ value, decimals: raw.includes(".") ? raw.split(".")[1].length : 0, raw: m[0] });
  }
  return out;
}

export function validateReport(report: string, ev: EvidenceJson, opts: ValidateOptions = {}): Validation {
  const problems: Problem[] = [];
  const lines = linesOf(report);
  const findingIds = new Set(ev.findings.map((f) => f.id));
  const requestIds = new Set(ev.requests);
  const named = (opts.namedAccounts ?? []).map((a) => a.toLowerCase());
  const engine = new Set(opts.engineSections ?? []);
  const known = knownNumbers(ev, opts.allowNumbers ?? []);

  // Citations and request ids resolve.
  for (const l of lines) {
    for (const m of l.text.matchAll(/\[(F\d+)\]/g)) if (!findingIds.has(m[1])) problems.push({ code: "unresolved_citation", line: l.no, detail: m[1] });
    for (const m of l.text.matchAll(/\breq-[A-Za-z0-9]+/g)) if (!requestIds.has(m[0])) problems.push({ code: "unresolved_request", line: l.no, detail: m[0] });
  }

  // Sections present and in order.
  const headings = lines.filter((l) => l.kind === "heading" && /^##\s/.test(l.text)).map((l) => ({ title: l.section as string, line: l.no }));
  let last = -1;
  for (const want of opts.requiredSections ?? []) {
    const at = headings.findIndex((h) => h.title === want);
    if (at < 0) problems.push({ code: "missing_section", line: 0, detail: want });
    else if (at < last) problems.push({ code: "section_order", line: headings[at].line, detail: want });
    else last = at;
  }

  // The playbook: 80% of five or more steps cite evidence.
  if (opts.playbookSection) {
    const steps = lines.filter((l) => l.section === opts.playbookSection && l.kind === "prose" && /^\s*\d+[.)]\s/.test(l.text));
    const cited = steps.filter((l) => CITE.test(l.text)).length;
    if (steps.length >= 5 && cited / steps.length < 0.8) problems.push({ code: "playbook_uncited", line: steps[0].no, detail: `${cited} of ${steps.length} steps cite evidence; 80% needed` });
  }

  // The summary: every bullet or numbered line cites evidence.
  if (opts.summarySection) {
    for (const l of lines) if (l.section === opts.summarySection && l.kind === "prose" && /^\s*(?:\d+[.)]|[-*•])\s/.test(l.text) && !CITE.test(l.text)) problems.push({ code: "summary_uncited", line: l.no, detail: l.text.trim().slice(0, 80) });
  }

  for (const l of lines) {
    if (l.kind === "code" || l.kind === "blank") continue;
    const lower = l.text.toLowerCase();
    for (const t of opts.bannedTokens ?? []) if (lower.includes(t)) problems.push({ code: "banned_token", line: l.no, detail: t });
    for (const s of sentences(l.text)) {
      const hasName = /@\w{2,}/.test(s) || named.some((a) => s.toLowerCase().includes(a));
      // The words are judged outside the handles: "@bot" names an account, it accuses nobody.
      if (hasName && ACCUSATION.test(s.replace(/@\w+/g, " "))) problems.push({ code: "accusation", line: l.no, detail: s.trim().slice(0, 100) });
      if (SPEND.test(s) && SPEND_WORD.test(s)) problems.push({ code: "spend_figure", line: l.no, detail: s.trim().slice(0, 100) });
    }
    // Numbers in prose (tables, quotes, code and the engine's own sections are the engine's or the source's).
    if (l.kind !== "prose" || (l.section !== null && engine.has(l.section))) continue;
    for (const x of statedNumbers(l.text)) if (!matches(x.value, x.decimals, known)) problems.push({ code: "number_not_in_evidence", line: l.no, detail: x.raw });
  }

  return { ok: problems.length === 0, problems };
}
