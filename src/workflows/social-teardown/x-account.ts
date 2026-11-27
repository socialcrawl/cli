// One X account, analysed: the coded timeline (x/codebook.ts) becomes the same rows every
// platform has, so the shared analysis runs on it, and the X reads the other platforms lack
// (launches, amplifiers, quotes, the first hours, repeat repliers) come from x/analyse.ts.
import { breakouts } from "../../engine/breakout.ts";
import type { Row } from "../../engine/rows.ts";
import { analyseAccount } from "./analyse.ts";
import type { AccountAnalysis } from "./analyse.ts";
import { parseTarget } from "./targets.ts";
import type { TaggedRecord } from "./tracker.ts";
import { analyseX } from "./x/analyse.ts";
import type { Analysis } from "./x/analyse.ts";
import { codePosts } from "./x/codebook.ts";
import type { CodedPost } from "./x/codebook.ts";
import { postsFromRecords } from "./x/x.ts";

export interface XAccount {
  account: AccountAnalysis;
  x: Analysis;
  coded: CodedPost[];
}

/** A coded X post as the engine's row: originals and thread heads are the account's own posts. */
export function rowOfCoded(c: CodedPost): Row {
  return {
    platform: "x",
    id: c.post_id,
    url: c.url,
    author: c.account,
    authorFollowers: null,
    authorUrl: null,
    channelId: null,
    community: null,
    text: c.text,
    publishedAt: c.created_utc,
    views: c.views,
    likes: c.likes,
    comments: c.replies,
    shares: c.reposts,
    saves: c.bookmarks,
    durationSeconds: c.video_seconds,
    video: c.format === "video",
    pinned: false,
    kind: c.kind === "original" || c.kind === "thread_head" ? "original" : c.kind === "retweet" ? "repost" : c.kind === "reply_other" ? "reply" : "thread_part",
    requestId: c.request_no || null,
  };
}

export function analyseXAccount(records: TaggedRecord[], handleIn: string, now: Date): XAccount {
  const handle = handleIn.replace(/^@/, "").toLowerCase();
  const coded = codePosts(postsFromRecords(records), handle);
  const x = analyseX(records, coded, handle);
  const own = coded.filter((c) => c.kind === "original" || c.kind === "thread_head").map(rowOfCoded);
  // The newest post read stands for "now", so a re-render of a kept run gives the same multiples.
  const newest = new Date(own.reduce((m, r) => Math.max(m, Date.parse(r.publishedAt ?? "") || 0), 0) || now.getTime());
  const bs = breakouts(own, { now: newest, mode: "previous", metric: "views" });
  // The shared comment reader reads X's replies as comments.
  const asComments = records.map((r) => (r.stage === "replies" ? { ...r, stage: "comments" } : r));
  const account = analyseAccount({ target: parseTarget(`x:${handle}`), adapter: { metric: "views" }, records: asComments, own, others: [], breakouts: bs, depth: [] }, now);
  return { account, x, coded };
}
