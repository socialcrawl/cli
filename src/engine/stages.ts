// What every stage sends, so no skill can forget it:
//   search stages     relevance=filter&relevant_to=<the topic sentence>, printed in the report
//                     (unfiltered, 0 of 30 TikTok rows for "scraping tools" were about software;
//                     study file 18, finding 1)
//   comment stages    label=sentiment,question,purchase_intent,complaint sent explicitly, so the
//                     free labels never fall to the shared per-minute budget (198 of 233 comments
//                     came back unlabelled without it; file 18, finding 5)
//   post listings     the post labels sent explicitly too, or judgments=off where a skill reads
//                     no post label
// One option, `labels`, chooses between "explicit" (the default), "default" (send nothing, take
// what the gate gives) and "off". Explicit judging labels at most 100 rows a page within a
// 4-second budget, so unlabelled rows are still counted (`labelGaps`) and reported.
import type { ResponseRecord } from "./rows.ts";

/** Comment lanes that take label= (the API's LABELLED_COMMENT_LANES). Others drop it with a warning. */
export const LABELLED_COMMENT_LANES = new Set([
  "twitter/tweet/replies",
  "tiktok/post/comments",
  "tiktok/video/comment/replies",
  "instagram/post/comments",
  "instagram/post/comment/replies",
  "youtube/video/comments",
  "youtube/video/comment/replies",
  "reddit/post/comments",
  "facebook/post/comments",
  "facebook/post/comment/replies",
]);

/** Comment lanes that can never be labelled through label= today: the report says so. */
export const UNLABELLED_COMMENT_LANES = new Set(["reddit/profile/comments", "threads/post/comments", "linkedin/post/comments"]);

/** Search lanes that take relevance=filter&relevant_to=. */
export const TOPIC_LANES = new Set([
  "twitter/search/tweets",
  "tiktok/search",
  "instagram/search/reels",
  "youtube/search",
  "reddit/search",
  "linkedin/search/posts",
  "search/multi",
]);

/** Post listings and searches that take the post labels (label= / judgments=). */
export const POST_LABEL_LANES = new Set([
  "twitter/user/tweets",
  "tiktok/profile/videos",
  "instagram/profile/reels",
  "reddit/subreddit",
  ...TOPIC_LANES,
]);

export const COMMENT_LABELS = ["sentiment", "question", "purchase_intent", "complaint"] as const;
export const POST_LABELS = ["sponsored", "intent", "niche"] as const;

export type LabelMode = "explicit" | "default" | "off";

export interface StageOptions {
  /** The topic sentence for search stages; required on every search lane. */
  topic?: string;
  labels?: LabelMode;
}

export type Params = Record<string, string | number | boolean | undefined>;

const lane = (endpoint: string) => endpoint.replace(/^\/?(v1\/)?/, "");

/**
 * The sentence the topic filter judges rows against, written from the user's keyword (the
 * skill may pass a fuller one, as file 18 did: "AI coding tools and AI coding assistants for
 * software developers"). At most 200 characters.
 */
export function topicSentence(keyword: string, about?: string): string {
  const s = (about ?? keyword).replace(/\s+/g, " ").trim();
  if (!s) throw new Error("A search stage needs a topic: the keyword the user typed.");
  return s.length <= 200 ? s : s.slice(0, 200).replace(/\s+\S*$/, "");
}

/** The params a stage sends, with the topic filter and the labels added by lane. */
export function stageParams(endpoint: string, params: Params, opts: StageOptions = {}): Params {
  const id = lane(endpoint);
  const mode = opts.labels ?? "explicit";
  const out: Params = { ...params };
  if (TOPIC_LANES.has(id)) {
    if (!opts.topic) throw new Error(`${id} is a search stage: pass the topic sentence, so the filter keeps only rows about it.`);
    out.relevance = "filter";
    out.relevant_to = topicSentence(opts.topic);
  }
  if (LABELLED_COMMENT_LANES.has(id)) {
    if (mode === "explicit") out.label = COMMENT_LABELS.join(",");
    if (mode === "off") out.judgments = "off";
  } else if (POST_LABEL_LANES.has(id)) {
    if (mode === "explicit") out.label = POST_LABELS.join(",");
    // judgments=off would also switch off the topic filter on a search lane.
    if (mode === "off" && !TOPIC_LANES.has(id)) out.judgments = "off";
  }
  return out;
}

export interface LabelGaps {
  endpoint: string;
  rows: number;
  /** Rows that came back with no labels: counted, never read as "no questions". */
  unlabelled: number;
  status: string | null;
  skipReason: string | null;
  /** True on lanes that cannot be labelled through label= at all. */
  unavailable: boolean;
  requestId: string | null;
}

/** How many rows of a comment response carry no labels, and why. */
export function labelGaps(rec: ResponseRecord): LabelGaps {
  const d = rec.body?.data ?? {};
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const labelled = items.filter((it) => {
    const l = it?.computed?.labels;
    return l && typeof l === "object" && Object.keys(l).length > 0;
  }).length;
  const reported = typeof d.labels?.labelled === "number" ? d.labels.labelled : null;
  const got = reported ?? labelled;
  return {
    endpoint: lane(rec.endpoint),
    rows: items.length,
    unlabelled: Math.max(0, items.length - got),
    status: d.labels?.status ?? null,
    skipReason: d.labels?.skip_reason ?? null,
    unavailable: UNLABELLED_COMMENT_LANES.has(lane(rec.endpoint)),
    requestId: rec.requestId,
  };
}

export interface TopicRead {
  sentence: string | null;
  rows: number;
  kept: number;
  dropped: number;
  mode: string | null;
  requestId: string | null;
}

/** What the topic filter kept and dropped on a search response (data.relevance). */
export function topicRead(rec: ResponseRecord): TopicRead {
  const r = rec.body?.data?.relevance ?? {};
  const sentence = typeof rec.params?.relevant_to === "string" ? (rec.params.relevant_to as string) : null;
  return {
    sentence,
    rows: Number(r.rows ?? 0),
    kept: Number(r.kept ?? 0),
    dropped: Number(r.dropped ?? 0),
    mode: r.mode ?? null,
    requestId: rec.requestId,
  };
}
