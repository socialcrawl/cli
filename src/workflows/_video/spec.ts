// What a video-platform marketing workflow names: its searches, its reach floor, how a
// creator's baseline is read, its comment and transcript lanes, and its stage shares. The
// stages themselves (run.ts) and the report (report.ts) are shared by TikTok, Instagram and
// YouTube, so the method is written once.
import type { Platform, ResponseRecord, Row } from "../../engine/index.ts";
import type { Params } from "../../kit/kit.ts";
import type { Session } from "../../kit/record.ts";

export interface SearchStep {
  /** A short name for the stage line: "search:top". */
  stage: string;
  endpoint: string;
  /** Without the topic filter, which run.ts adds to every search. Always with max_pages. */
  params: Params;
  pages: number;
}

export interface Depth<T> {
  default: T;
  deep: T;
}

export interface Shares {
  search: number;
  enrich: number;
  baseline: number;
  comments: number;
  transcript: number;
  names: number;
}

export interface VideoSpec {
  workflow: string;
  platform: Platform;
  /** "TikTok", "Instagram", "YouTube". */
  label: string;
  /** "video", "reel". */
  postNoun: string;
  /** "creator" or "channel". */
  accountNoun: string;
  defaultBudget: number;
  deepBudget: number;
  searches(query: string, deep: boolean): SearchStep[];
  /** Candidates at or above this many views are measured; the rest are counted. */
  floorViews: number;
  /**
   * Optional, after the searches: fill what the search rows lack (YouTube: likes, durations,
   * channel ids and subscriber counts from the two batch lookups). Returns the rows to use and
   * any follower counts it read, by baseline key.
   */
  enrich?(session: Session, rows: Row[], shareMax: number): Promise<{ rows: Row[]; followers: Map<string, number | null> }>;
  /** Groups the candidates one baseline read serves (one creator; on YouTube one channel and one format). */
  groupKey(row: Row): string;
  /** The read that is a candidate's baseline, with max_pages; null when the row lacks the id it needs. */
  baselineCall(row: Row, deep: boolean): { endpoint: string; params: Params } | null;
  /** Rows of a baseline page made comparable with the candidate (YouTube: the format of the shelf read). */
  baselineRows?(rows: Row[], call: { endpoint: string }): Row[];
  /** Pages read one by one after the first read, while a candidate's baseline is still short (default 1, deep 2). */
  extraPages?: Depth<number>;
  /** How many creators get a baseline read. */
  confirm: Depth<number>;
  /** Candidates published within this many days are read first: the creator's newest pages can hold the posts before them. */
  recentDays?: number;
  /** Free order of who is read first: views over followers where the row has followers, else views. */
  preRank: "views_per_follower" | "views";
  comments: { endpoint: string; posts: Depth<number>; pages: Depth<number> };
  transcripts: {
    endpoint: string;
    posts: Depth<number>;
    /** One call per post (GET, url) or one POST for all ids. */
    batch: boolean;
    /** The spoken words in a transcript response, as plain text. */
    text(rec: ResponseRecord, row: Row): string | null;
  };
  /** Optional: read follower counts for accounts the report would name (Instagram rows carry none). */
  names?: {
    endpoint: string;
    params(row: Row): Params;
    followers(rec: ResponseRecord): number | null;
    /** Reads after ranking, for break-outs whose authors were not read yet. */
    max: Depth<number>;
    /** Reads before ranking, for the most viewed candidates' authors, so views over followers can order who gets a baseline. */
    preRead?: Depth<number>;
  };
  shares: Depth<Shares>;
}
