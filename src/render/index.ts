// The render kit: a workflow's result becomes the run folder.
//   report.html  report.md  card.svg  card.md  data/*.csv  responses.jsonl  evidence.json  run.json
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderCard, renderReport, toCsv } from "../engine/outputs.ts";
import { renderCard675 } from "./card.ts";
import { renderReportHtml, tableFileName } from "./html.ts";
import type { RunOutput } from "./types.ts";

export const RUN_FILES = ["report.html", "report.md", "card.svg", "card.md", "responses.jsonl", "evidence.json", "run.json"];

/**
 * Text a stranger wrote must not run as a formula when the CSV opens in a spreadsheet: a cell
 * starting with = + - @ or a control character gets a leading apostrophe. Numbers stay numbers.
 */
function noFormulas(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return out;
}

/** Write the whole run folder into `dir`; returns the paths written. */
export function writeRunFolder(dir: string, run: RunOutput): string[] {
  mkdirSync(path.join(dir, "data"), { recursive: true });
  const files: [string, string][] = [
    ["report.html", renderReportHtml(run)],
    ["report.md", renderReport(run.report)],
    ["card.svg", renderCard675(run.card)],
    ["card.md", renderCard(run.card)],
    ["responses.jsonl", run.records.map((r) => JSON.stringify(r)).join("\n") + (run.records.length ? "\n" : "")],
    ["evidence.json", JSON.stringify(run.report.evidence.toJSON(run.report.meta), null, 2) + "\n"],
    ["run.json", JSON.stringify(run.run, null, 2) + "\n"],
    ...Object.entries(run.tables).map(([name, t]): [string, string] => [path.join("data", `${tableFileName(name)}.csv`), toCsv(t.rows.map(noFormulas), t.columns)]),
  ];
  for (const [name, body] of files) writeFileSync(path.join(dir, name), body);
  return files.map(([name]) => path.join(dir, name));
}

const stripRefs = (s: string) => s.replace(/\s*\[F\d+\](?:\s*\[F\d+\])*/g, "").trim();

/** The answer in the terminal, at most 12 lines: headline, findings, gaps, cost, path. */
export function terminalSummary(run: RunOutput, dir: string): string[] {
  const headline = run.card.headlines[0];
  const lines = [headline];
  for (const s of run.report.summary.map(stripRefs)) {
    if (lines.length >= 6) break;
    if (s && s !== headline) lines.push(`  ${s}`);
  }
  const notSent = run.run.notRead.length;
  const failed = run.run.errors.length;
  // The same lines the report's "What we could not verify" lists: the gaps, and each finding with limitations.
  const ev = run.report.evidence;
  const unknown = ev.unverified.length + ev.findings.filter((f) => f.limitations.length).length;
  const gaps = [
    notSent || failed
      ? `Not read: ${[
          notSent ? `${notSent} call${notSent === 1 ? "" : "s"} (${[...new Set(run.run.notRead.map((n) => n.reason))].join(", ")})` : "",
          failed ? `${failed} call${failed === 1 ? "" : "s"} the API refused` : "",
        ]
          .filter(Boolean)
          .join(", ")}.`
      : "",
    unknown ? `Not verified: ${unknown} item${unknown === 1 ? "" : "s"}.` : "",
  ].filter(Boolean);
  if (gaps.length) lines.push(`${gaps.join(" ")} The report lists each one.`);
  const m = run.report.meta;
  lines.push(`Cost: ${m.credits} credit${m.credits === 1 ? "" : "s"}, ${m.calls} calls, ${m.seconds} s.`);
  lines.push(`Report: ${path.join(dir, "report.html")}`);
  return lines.slice(0, 12);
}

/** Lower-case ASCII words joined by "-", at most 40 characters. */
export function slugify(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = s.length > 40 ? s.slice(0, 40).replace(/-[^-]*$/, "") || s.slice(0, 40) : s;
  return cut.replace(/-+$/, "") || "run";
}

/** `<workflow>-<slug>-<YYYY-MM-DD>`, in the person's own time zone. */
export function runFolderName(workflow: string, input: string, at: Date): string {
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `${workflow}-${slugify(input)}-${d}`;
}

export { renderCard675 } from "./card.ts";
export { renderReportHtml } from "./html.ts";
export { barChartSvg, formatNumber, wrapText } from "./svg.ts";
export type { BarChart, RunInfo, RunOutput, Table, Tile, WorkflowResult } from "./types.ts";
