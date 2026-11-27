// What a run hands the render kit. A workflow returns a WorkflowResult; the harness adds
// the records and the run block, then writeRunFolder writes report.html, report.md,
// card.svg, card.md, data/*.csv, responses.jsonl, evidence.json and run.json.
import type { CardInput, ReportInput } from "../engine/outputs.ts";
import type { CallRecord } from "../kit/record.ts";

/** A stat tile at the top of report.html: "Posts read" / "1,130 of 1,130". */
export interface Tile {
  label: string;
  value: string;
  /** The finding this number comes from ("F1"); the tile links to its evidence entry. */
  finding?: string;
}

/** A horizontal bar chart, drawn as inline SVG. */
export interface BarChart {
  title: string;
  /** Shown after each value: "x" for a multiple, "views". */
  unit?: string;
  bars: { label: string; value: number; note?: string; finding?: string }[];
}

/** Rows that become data/<name>.csv. Every row read, flattened, so the person keeps the data. */
export interface Table {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface WorkflowResult {
  card: CardInput;
  report: ReportInput;
  tiles?: Tile[];
  charts?: BarChart[];
  /** By file name without extension: { posts: ..., authors: ... } gives data/posts.csv and data/authors.csv. */
  tables: Record<string, Table>;
}

export interface RunInfo {
  workflow: string;
  version: string;
  inputs: Record<string, unknown>;
  stages: { name: string; calls: number; credits: number }[];
  credits: number;
  calls: number;
  seconds: number;
  startedAt: string;
  notRead: { stage: string; endpoint: string; reason: string; limit?: "run" | "stage" }[];
  errors: { stage: string; endpoint: string; status: number | null; message: string; requestId: string | null }[];
}

export interface RunOutput extends WorkflowResult {
  records: CallRecord[];
  run: RunInfo;
}
