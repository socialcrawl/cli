// The platform scorecard for presence and competitor runs: a status and a 0 to 3 strength per
// platform from fixed thresholds, each cell citing its evidence. The agent explains the table;
// it may not contradict it. Adapted from REM's src/analyze/scorecard.ts
// (dansugc/reverse-engineer-marketing, MIT); the thresholds below are ours, stated here and
// in the report's method notes.
import type { Platform } from "./rows.ts";

export type Status = "active" | "likely" | "dormant" | "none" | "unknown";

/** No post in this many days is dormant (REM's rule). */
export const DORMANT_DAYS = 45;
export const STRENGTH = {
  /** 3: followers or median reach at or above these. */
  strong: { followers: 100_000, reach: 50_000 },
  /** 2: followers or median reach at or above these. */
  solid: { followers: 10_000, reach: 5_000 },
} as const;

export interface PlatformRead {
  platform: Platform;
  /** False when this platform was not read at all (no call made). */
  read: boolean;
  /** True when an account was found and confirmed; false when the read found none; null when only a candidate exists. */
  account: boolean | null;
  handle?: string | null;
  followers: number | null;
  lastPostAt: string | null;
  postsInWindow: number | null;
  medianReach: number | null;
  requests: string[];
}

export interface Cell {
  platform: Platform;
  status: Status;
  strength: 0 | 1 | 2 | 3;
  seen: string;
  evidence: string[];
}

const n = (x: number) => x.toLocaleString("en-GB");

/** One row per platform; nothing is inferred beyond the thresholds. Unknown is never "none". */
export function scorecard(reads: PlatformRead[], now: Date): Cell[] {
  return reads.map((r) => {
    if (!r.read) return { platform: r.platform, status: "unknown", strength: 0, seen: "not read", evidence: [] };
    if (r.account === false) return { platform: r.platform, status: "none", strength: 0, seen: "no account found", evidence: r.requests };
    if (r.account === null) return { platform: r.platform, status: "likely", strength: 1, seen: `a candidate account${r.handle ? ` (${r.handle})` : ""}, not confirmed`, evidence: r.requests };
    const last = r.lastPostAt ? Date.parse(r.lastPostAt) : NaN;
    const days = Number.isFinite(last) ? Math.floor((now.getTime() - last) / 86_400_000) : null;
    const f = r.followers ?? 0;
    const reach = r.medianReach ?? 0;
    const facts = [
      r.followers !== null ? `${n(r.followers)} followers` : "followers unknown",
      r.postsInWindow !== null ? `${n(r.postsInWindow)} posts in the window` : null,
      r.medianReach !== null ? `median reach ${n(r.medianReach)}` : null,
      days !== null ? `last post ${days} day${days === 1 ? "" : "s"} ago` : "no post seen",
    ].filter(Boolean) as string[];
    if (days === null || days > DORMANT_DAYS) return { platform: r.platform, status: "dormant", strength: 1, seen: facts.join(", "), evidence: r.requests };
    const strength: 1 | 2 | 3 =
      f >= STRENGTH.strong.followers || reach >= STRENGTH.strong.reach ? 3 : f >= STRENGTH.solid.followers || reach >= STRENGTH.solid.reach ? 2 : 1;
    return { platform: r.platform, status: "active", strength, seen: facts.join(", "), evidence: r.requests };
  });
}

export function scorecardTable(cells: Cell[]): string {
  const rows = cells.map((c) => `| ${c.platform} | ${c.status} | ${c.strength} | ${c.seen} | ${c.evidence.slice(0, 3).join(", ")}${c.evidence.length > 3 ? ` and ${c.evidence.length - 3} more` : ""} |`);
  return ["| Platform | Status | Strength | What we saw | Evidence |", "|---|---|---|---|---|", ...rows].join("\n");
}

export const SCORECARD_METHOD = `Status: active (a post in the last ${DORMANT_DAYS} days), dormant (none since), likely (a candidate account not confirmed), none (no account found), unknown (not read). Strength 3 at ${n(STRENGTH.strong.followers)} followers or a median reach of ${n(STRENGTH.strong.reach)}; 2 at ${n(STRENGTH.solid.followers)} or ${n(STRENGTH.solid.reach)}; 1 below; 0 when absent or unknown.`;
