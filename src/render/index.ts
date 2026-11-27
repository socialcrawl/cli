// The render kit: a workflow's result becomes the run folder.
//   report.html  report.md  card.svg  card.md  data/*.csv  responses.jsonl  evidence.json  run.json
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderCard, renderReport, toCsv } from "../engine/outputs.ts";
import { renderCard675 } from "./card.ts";
import { renderReportHtml, tableFileName } from "./html.ts";
import type { RunOutput } from "./types.ts";

export const RUN_FILES = ["report.html", "report.md", "card.svg", "card.md", "responses.jsonl", "evidence.json", "run.json"];

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
    ...Object.entries(run.tables).map(([name, t]): [string, string] => [path.join("data", `${tableFileName(name)}.csv`), toCsv(t.rows, t.columns)]),
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
  const unknown = run.report.evidence.unverified.length;
  const gaps = [
    notSent ? `${notSent} call${notSent === 1 ? "" : "s"} (${[...new Set(run.run.notRead.map((n) => n.reason))].join(", ")})` : "",
    failed ? `${failed} call${failed === 1 ? "" : "s"} refused by the API` : "",
    unknown ? `${unknown} count${unknown === 1 ? "" : "s"} the platforms do not give` : "",
  ].filter(Boolean);
  if (gaps.length) lines.push(`Not read: ${gaps.join("; ")}. The report lists each one.`);
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
