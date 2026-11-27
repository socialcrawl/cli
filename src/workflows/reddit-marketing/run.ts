// reddit-marketing, the run: sends the plan through the Session (one budget, every response
// kept, every credit booked) and reads what came back. What the budget or the API stopped is in
// session.notRead and session.errors; the report says so, it never guesses.
import { rateOf, walkParams } from "../../engine/rates.ts";
import { topicRead } from "../../engine/stages.ts";
import type { TopicRead } from "../../engine/stages.ts";
import type { ResponseRecord, Row } from "../../engine/rows.ts";
import type { Session } from "../../kit/record.ts";
import { baselineCall, commentCall, commentTargets, communitiesToRead, depthOf, detailsCall, searchCalls, topicOf } from "./plan.ts";
import type { RedditInput, StageCall } from "./plan.ts";
import { askSummary, commentsOf, communityOf, opportunities, threadBreakouts, threadsOf } from "./read.ts";
import type { AskSummary, Comment, Community, Opportunity, Thread, ThreadBreakout } from "./read.ts";

export interface CommentRead {
  threadId: string;
  /** Comments the response carried, replies included. */
  returned: number;
  /** The thread's own comment count (Reddit's count includes removed comments). */
  total: number | null;
  truncated: boolean;
  requestId: string | null;
}

export interface RedditRun {
  input: RedditInput;
  topic: string;
  /** The communities the plan chose to read, in rank order. */
  chosen: string[];
  threads: Thread[];
  breakouts: ThreadBreakout[];
  communities: Community[];
  /** Communities chosen whose rules did not come back, and why. */
  rulesFailed: { community: string; why: string }[];
  comments: Comment[];
  commentThreads: Row[];
  commentReads: CommentRead[];
  asks: AskSummary;
  opportunities: Opportunity[];
  topicReads: TopicRead[];
  searchRecords: ResponseRecord[];
}

/** A walk's ceiling: what its planned pages can cost (the engine's own sum), or the price of a call that does not walk. */
const ceilingOf = (c: StageCall) => (rateOf(c.endpoint).walks ? Number(walkParams(c.endpoint, c.params, Infinity).max_credits) : rateOf(c.endpoint).page);

export async function runReddit(session: Session, input: RedditInput): Promise<RedditRun> {
  const d = depthOf(input);
  const send = (c: StageCall) => session.call(c.stage, c.endpoint, c.params, ceilingOf(c));

  const searchRecords: ResponseRecord[] = [];
  for (const c of searchCalls(input)) {
    const rec = await send(c);
    if (rec) searchRecords.push(rec);
  }
  const threads = threadsOf(searchRecords);
  const chosen = communitiesToRead(threads, d.communities);

  const communities: Community[] = [];
  const rulesFailed: { community: string; why: string }[] = [];
  for (const name of chosen) {
    const stage = `rules:${name}`;
    const rec = await send({ ...detailsCall(name), stage });
    const c = rec ? communityOf(rec) : null;
    if (c) communities.push(c);
    else {
      const err = session.errors.find((e) => e.stage === stage);
      rulesFailed.push({ community: name, why: err ? `the API answered ${err.status ?? "an error"}` : session.notRead.some((n) => n.stage === stage) ? "not read: the run's budget was spent" : "the answer held no community" });
    }
  }
  const pages = new Map<string, ResponseRecord>();
  for (const name of chosen) {
    const rec = await send({ ...baselineCall(name), stage: `baseline:${name}` });
    if (rec) pages.set(name, rec);
  }
  const breakouts = threadBreakouts(threads, pages, input.now);

  const targets = commentTargets(
    breakouts.map((b) => ({ row: b.thread.row, band: b.breakout?.band ?? "too_few" })),
    d.threads,
  ).filter((r) => r.url !== null);
  const comments: Comment[] = [];
  const commentReads: CommentRead[] = [];
  const commentThreads: Row[] = [];
  for (const t of targets) {
    const rec = await send({ ...commentCall(t.url as string), stage: `comments:${t.id}` });
    if (!rec) continue;
    const cs = commentsOf(rec);
    comments.push(...cs);
    commentThreads.push(t);
    const data = (rec.body?.data ?? {}) as { comments_returned?: unknown; truncated?: unknown };
    commentReads.push({ threadId: t.id, returned: typeof data.comments_returned === "number" ? data.comments_returned : cs.length, total: t.comments, truncated: data.truncated === true, requestId: rec.requestId });
  }
  session.flush();

  const byName = new Map(communities.map((c) => [c.name, c]));
  return {
    input,
    topic: topicOf(input),
    chosen,
    threads,
    breakouts,
    communities,
    comments,
    commentThreads,
    commentReads,
    asks: askSummary(comments),
    rulesFailed,
    opportunities: opportunities(threads, byName, input.now, undefined, rulesFailed.map((r) => r.community)),
    topicReads: searchRecords.map(topicRead),
    searchRecords,
  };
}
