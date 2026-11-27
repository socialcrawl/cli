// What every run writes: card.md and card.svg (one screen, titled with the command, footed
// "Read with SocialCrawl /<skill> · N credits · date" and the line to run it again),
// report.md (the summary first, the skill's sections, then the engine's own sections: how this
// was read, what we could not verify, method notes), evidence.json, and the CSVs.
//
// The one-screen summary first is TubeLab's four-line summary (MIT); the badge and footer the
// model copies verbatim are last30days' (MIT). See THIRD_PARTY_NOTICES.md.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Evidence } from "./evidence.ts";
import { CONFIDENCE_LABEL, UNKNOWN_NOT_ZERO } from "./evidence.ts";
import type { Meta } from "./rates.ts";

export interface CardInput {
  /** The command as the user typed it, for example `/social-viral "AI coding tools" --week`. */
  command: string;
  skill: string;
  /** At most three lines; each one a finding the engine computed. */
  headlines: string[];
  /** "534 posts read", "81 posts on 6 platforms". */
  basis: string;
  meta: Meta;
  /** The line to run it again. */
  rerun: string;
}

export const CARD_MAX_HEADLINES = 3;
export const CARD_MAX_CHARS = 110;

function cardLines(c: CardInput): string[] {
  if (c.headlines.length === 0) throw new Error("A card needs at least one headline finding.");
  if (c.headlines.length > CARD_MAX_HEADLINES) throw new Error(`A card has at most ${CARD_MAX_HEADLINES} headlines, so it fits one screen.`);
  for (const h of c.headlines) if (h.length > CARD_MAX_CHARS) throw new Error(`Headline over ${CARD_MAX_CHARS} characters: "${h}"`);
  const credits = `${c.meta.credits} credit${c.meta.credits === 1 ? "" : "s"}`;
  return [c.command, ...c.headlines.map((h) => `• ${h}`), `${c.basis} · ${credits}`, `Read with SocialCrawl /${c.skill} · ${credits} · ${c.meta.date}`, `Run it yourself: ${c.rerun}`];
}

export function renderCard(c: CardInput): string {
  const [title, ...rest] = cardLines(c);
  return `**${title}**\n\n${rest.join("\n")}\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The same card as a 1200 × 630 image a person can post. */
export function renderCardSvg(c: CardInput): string {
  const lines = cardLines(c);
  const rows = lines.map((l, i) => {
    const y = i === 0 ? 110 : 110 + 70 + (i - 1) * 64;
    const size = i === 0 ? 44 : i <= c.headlines.length ? 32 : 24;
    const weight = i === 0 ? 700 : 400;
    const fill = i > c.headlines.length ? "#5b6472" : "#111827";
    return `  <text x="64" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">`,
    `  <rect width="1200" height="630" fill="#ffffff"/>`,
    `  <rect x="0" y="0" width="12" height="630" fill="#111827"/>`,
    ...rows,
    `</svg>`,
    "",
  ].join("\n");
}

export interface ReportSection {
  title: string;
  body: string;
}

export interface ReportInput {
  command: string;
  skill: string;
  /** One line under the title: platform, window, posts read, version. */
  badge: string;
  /** The answer in five lines or fewer, each citing a finding ([F1]). */
  summary: string[];
  sections: ReportSection[];
  evidence: Evidence;
  meta: Meta;
  /** The thresholds and refusals the run applied, one line each. */
  methodNotes: string[];
}

/** The sections the engine writes itself; the validator does not lint their numbers. */
export const ENGINE_SECTIONS = ["How this was read", "What we could not verify", "Method notes"];

export function renderReport(r: ReportInput): string {
  const ev = r.evidence;
  const out: string[] = [`# ${r.command}`, "", r.badge, "", "## In short", "", ...r.summary.map((s, i) => `${i + 1}. ${s}`), ""];
  for (const s of r.sections) out.push(`## ${s.title}`, "", s.body.trim(), "");
  out.push("## How this was read", "");
  for (const c of ev.coverage) out.push(`- ${c.line} (${c.credits} credit${c.credits === 1 ? "" : "s"})`);
  out.push("", "## What we could not verify", "");
  const gaps = [
    ...ev.unverified.map((u) => `- ${u.what}: ${u.why}${u.check ? ` (check by hand: ${u.check})` : ""}`),
    ...ev.findings.filter((f) => f.limitations.length).map((f) => `- [${f.id}] ${f.limitations.join("; ")}`),
  ];
  out.push(...(gaps.length ? gaps : ["- Nothing: every count this report states was read."]), "");
  out.push("## Method notes", "", ...r.methodNotes.map((m) => `- ${m}`));
  out.push(`- Findings are labelled ${Object.values(CONFIDENCE_LABEL).join(", ")}; a count that could not be read is shown as unknown (${UNKNOWN_NOT_ZERO}).`, "");
  out.push("---", "", `Read with SocialCrawl /${r.skill} · ${r.meta.credits} credits · ${r.meta.calls} calls · ${r.meta.seconds} s · ${r.meta.date} · v${r.meta.version}`, "");
  return out.join("\n");
}

/** One CSV line per row: newlines in any form become a literal "\n". */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T & string)[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v.replace(/\r\n|[\r\n\u2028\u2029\u0085]/g, "\\n") : String(v);
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export interface RunFiles {
  card: CardInput;
  report: ReportInput;
  csv?: Record<string, string>;
}

/** Write card.md, card.svg, report.md, evidence.json and any CSVs into `dir`. */
export function writeRun(dir: string, run: RunFiles): string[] {
  mkdirSync(dir, { recursive: true });
  const files: [string, string][] = [
    ["card.md", renderCard(run.card)],
    ["card.svg", renderCardSvg(run.card)],
    ["report.md", renderReport(run.report)],
    ["evidence.json", JSON.stringify(run.report.evidence.toJSON(run.report.meta), null, 2) + "\n"],
    ...Object.entries(run.csv ?? {}),
  ];
  for (const [name, body] of files) writeFileSync(path.join(dir, name), body);
  return files.map(([name]) => path.join(dir, name));
}
