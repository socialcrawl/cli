// The evidence contract. Every finding carries its claim, a confidence (seen, seen but
// self-reported, inferred, unknown), its evidence (request ids and rows) and its limitations;
// a coverage block computed by the engine says how much was read ("read 1,130 of 1,130
// posts", pages, rows kept and dropped and why); "What we could not verify" lists the gaps,
// and a missing count is null with "unknown, not zero", never 0.
//
// Adapted from gtm-xray (richardsondx, MIT) and the Reddit MCP servers reddit-mcp-buddy
// (karanb192, MIT) and reddit-research-mcp (dialog-tools, MIT); REA's own evidence record
// (morluto/rea, MIT) is the ancestor of all three. See THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";

import { walkOutcome } from "./rates.ts";
import type { Meta } from "./rates.ts";
import type { Platform, ResponseRecord } from "./rows.ts";
import { platformOf } from "./rows.ts";

export type Confidence = "seen" | "self_reported" | "inferred" | "unknown";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  seen: "seen",
  self_reported: "seen, but self-reported",
  inferred: "inferred",
  unknown: "unknown",
};

export const UNKNOWN_NOT_ZERO = "unknown, not zero";

export interface Finding {
  id: string;
  claim: string;
  confidence: Confidence;
  /** Every number the claim states; null where it could not be read. */
  numbers: Record<string, number | null>;
  requests: string[];
  rows: string[];
  limitations: string[];
  method?: string;
}

export interface Dropped {
  reason: string;
  count: number;
}

export interface Coverage {
  stage: string;
  platform: Platform;
  endpoint: string;
  pages: number | null;
  rowsRead: number;
  rowsKept: number;
  /** How many exist in total, when the platform says; null when it does not. */
  of: number | null;
  dropped: Dropped[];
  stopped: string | null;
  /** The oldest date the rows reached, DD/MM/YYYY. */
  reached: string | null;
  credits: number;
  requests: string[];
  line: string;
}

export interface Unverified {
  what: string;
  why: string;
  /** Where a person can check by hand, if anywhere. */
  check?: string;
}

const n = (x: number) => x.toLocaleString("en-GB");

/** One line a reader can check: "twitter/search/tweets: read 60 rows on 3 pages, kept 44; dropped 16 off topic". */
export function coverageLine(c: Omit<Coverage, "line">): string {
  const of = c.of !== null ? ` of ${n(c.of)}` : "";
  const pages = c.pages !== null ? ` on ${c.pages} page${c.pages === 1 ? "" : "s"}` : "";
  const kept = c.rowsKept !== c.rowsRead ? `, kept ${n(c.rowsKept)}` : "";
  const dropped = c.dropped.filter((d) => d.count > 0).map((d) => `${n(d.count)} ${d.reason}`);
  const reach = c.reached ? `, back to ${c.reached}` : "";
  const stop = c.stopped && c.stopped !== "end" ? ` (stopped: ${c.stopped.replace(/_/g, " ")})` : "";
  return `${c.stage}, ${c.endpoint}: read ${n(c.rowsRead)}${of} rows${pages}${kept}${reach}${stop}${dropped.length ? `; dropped ${dropped.join(", ")}` : ""}`;
}

/** A short digest of a response body, printed beside a claim so a reader can match it to the saved file. */
export function digest(body: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

export function requestIdsOf(rec: { requestId: string | null; walkRequestIds?: string[] }): string[] {
  return [...new Set([rec.requestId, ...(rec.walkRequestIds ?? [])].filter((x): x is string => typeof x === "string" && x.length > 0))];
}

export interface EvidenceJson {
  version: 1;
  meta: Meta | null;
  findings: Finding[];
  coverage: Coverage[];
  unverified: Unverified[];
  requests: string[];
}

/** The run's ledger of findings, coverage and gaps; `toJSON()` is evidence.json. */
export class Evidence {
  findings: Finding[] = [];
  coverage: Coverage[] = [];
  unverified: Unverified[] = [];
  private requests = new Set<string>();

  /** Every request the run made (the cost ledger's ids); citations must resolve to one of these. */
  seeRequests(ids: Iterable<string>): void {
    for (const id of ids) this.requests.add(id);
  }

  /**
   * Add a finding. A seen, self-reported or inferred finding must cite a request; a number that
   * could not be read is null and gets "unknown, not zero" among its limitations.
   */
  add(f: Omit<Finding, "id" | "rows" | "limitations"> & { rows?: string[]; limitations?: string[] }): Finding {
    if (!f.claim.trim()) throw new Error("A finding needs a claim.");
    if (f.confidence !== "unknown" && f.requests.length === 0) throw new Error(`"${f.claim}" has no request id: every finding cites the response that shows it.`);
    const limitations = [...(f.limitations ?? [])];
    const nulls = Object.entries(f.numbers).filter(([, v]) => v === null).map(([k]) => k);
    if (nulls.length && !limitations.some((l) => l.includes(UNKNOWN_NOT_ZERO))) limitations.push(`${nulls.join(", ")}: ${UNKNOWN_NOT_ZERO}`);
    for (const [k, v] of Object.entries(f.numbers)) if (v !== null && !Number.isFinite(v)) throw new Error(`${k} is not a number`);
    const finding: Finding = { ...f, id: `F${this.findings.length + 1}`, rows: f.rows ?? [], limitations };
    for (const r of f.requests) this.requests.add(r);
    this.findings.push(finding);
    return finding;
  }

  /** The coverage of one stored response, computed from the API's own walk, relevance and label blocks. */
  cover(rec: ResponseRecord & { walkRequestIds?: string[] }, stage: string, extra: { kept?: number; of?: number | null; dropped?: Dropped[] } = {}): Coverage {
    const d = rec.body?.data ?? {};
    const rows = Array.isArray(d.items) ? d.items.length : d.post ? 1 : 0;
    const w = walkOutcome(rec.body as any);
    const offTopic = typeof d.relevance?.dropped === "number" ? d.relevance.dropped : 0;
    const read = rows + offTopic;
    const dropped: Dropped[] = [];
    if (offTopic) dropped.push({ reason: "off topic", count: offTopic });
    if (typeof d.walk?.duplicates === "number" && d.walk.duplicates > 0) dropped.push({ reason: "duplicates", count: d.walk.duplicates });
    dropped.push(...(extra.dropped ?? []));
    const c = {
      stage,
      platform: platformOf(rec.endpoint),
      endpoint: rec.endpoint.replace(/^\/?(v1\/)?/, ""),
      pages: w.pages,
      rowsRead: read,
      rowsKept: extra.kept ?? rows,
      of: extra.of ?? null,
      dropped,
      stopped: w.stopped,
      reached: w.reached,
      credits: w.credits,
      requests: requestIdsOf(rec),
    };
    const cov: Coverage = { ...c, line: coverageLine(c) };
    for (const r of cov.requests) this.requests.add(r);
    this.coverage.push(cov);
    return cov;
  }

  unknown(u: Unverified): void {
    this.unverified.push(u);
  }

  get requestIds(): Set<string> {
    return new Set(this.requests);
  }

  toJSON(meta: Meta | null = null): EvidenceJson {
    return { version: 1, meta, findings: this.findings, coverage: this.coverage, unverified: this.unverified, requests: [...this.requests].sort() };
  }
}
