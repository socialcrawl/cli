// /linkedin-marketing, run: the week's posts on the keyword (topic-filtered, max_pages always
// sent), members' posts above the floor against their own earlier posts, and the comments of
// the two most liked posts.
import type { CostLedger, Meta } from "../../engine/rates.ts";
import { commentsOf, rowsOf } from "../../engine/rows.ts";
import type { CommentRow, Row } from "../../engine/rows.ts";
import { stageParams } from "../../engine/stages.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import { readBaselines } from "../social-viral/runner.ts";
import { VIRAL_PLATFORMS, rankViral } from "../social-viral/viral.ts";
import type { ViralPlatform, ViralResult } from "../social-viral/viral.ts";
import { candidatesOf } from "./linkedin.ts";

const DAY = 86_400_000;
export const PAGES = { default: 3, deep: 6 };
/** Credits for members' earlier posts (5 a member). */
export const BASELINE_CREDITS = { default: 25, deep: 50 };

export interface LinkedInInput {
  topic: string;
  about?: string;
}

export interface LinkedInOutput {
  window: { since: string; until: string };
  search: CallRecord | null;
  rows: Row[];
  people: Row[];
  companies: Row[];
  result: ViralResult;
  comments: { post: Row; record: CallRecord | null; rows: CommentRow[] }[];
  records: CallRecord[];
  meta: Meta;
  ledger: CostLedger;
  notRead: Session["notRead"];
  errors: Session["errors"];
}

export async function runLinkedIn(session: Session, input: LinkedInInput, opts: { deep: boolean; now: () => Date }): Promise<LinkedInOutput> {
  const now = opts.now();
  const days = opts.deep ? 30 : 7;
  const window = { since: new Date(now.getTime() - (days - 1) * DAY).toISOString().slice(0, 10), until: now.toISOString().slice(0, 10) };
  const pages = opts.deep ? PAGES.deep : PAGES.default;
  const params = stageParams("linkedin/search/posts", { query: input.topic, date_posted: opts.deep ? "past_month" : "past_week", max_pages: pages }, { topic: input.about ?? input.topic, labels: "default" });
  const search = await session.call("search:linkedin", "linkedin/search/posts", params, pages * 13);
  const rows = search ? rowsOf(search) : [];
  const { people, companies } = candidatesOf(rows, window.since, window.until);

  const shares = Object.fromEntries(VIRAL_PLATFORMS.map((p) => [p, p === "linkedin" ? (opts.deep ? BASELINE_CREDITS.deep : BASELINE_CREDITS.default) : 0])) as Record<ViralPlatform, number>;
  const { plans, pages: basePages } = await readBaselines(session, people, shares, opts.now);
  const result = rankViral(people, plans, basePages, { now });

  const comments: LinkedInOutput["comments"] = [];
  for (const post of [...rows].filter((r) => r.url).sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 2)) {
    const rec = await session.call("comments:linkedin", "linkedin/post/comments", { url: post.url as string, max_pages: 1 }, 5);
    comments.push({ post, record: rec, rows: rec ? commentsOf(rec) : [] });
  }
  return { window, search, rows, people, companies, result, comments, records: session.records.filter((r) => r.status === 200), meta: session.meta(), ledger: session.ledger, notRead: session.notRead, errors: session.errors };
}
