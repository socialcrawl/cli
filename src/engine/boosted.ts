// Posts whose reach does not look organic. Two labels, both inferred, never an accusation:
//
//   "likely boosted (inferred)"     X only, and only when BOTH hold: under 1.5 likes per 1,000
//                                   views, and more than 12% of the post's retweeters above
//                                   10,000 followers. These are the two numbers of the launch
//                                   census (study file 22, finding 5: paid launches ran 0.5 to
//                                   1.3 likes per 1,000 views against a median of 7.9, and 12%
//                                   to 39% of retweeters above 10,000 followers against 0% to
//                                   6%). A post so marked is never called viral.
//   "unusual engagement (inferred)" low likes per view without a retweeter list to check it (any
//                                   platform, or X when retweeters were not read), or one post
//                                   holding more than half of its account's timeline views (req
//                                   18-77: one post held 75% of 13.4 million). Shown beside the
//                                   post; never used to exclude it.
//
// The report states each number next to the run's median. No account is ever named as paid.
import type { Breakout } from "./breakout.ts";
import type { Row } from "./rows.ts";
import { median } from "./breakout.ts";

export const LOW_LIKES_PER_THOUSAND = 1.5;
export const BIG_RETWEETER_SHARE = 0.12;
export const BIG_FOLLOWERS = 10_000;
export const HOLD_SHARE = 0.5;
/** Below this many views a like rate says nothing; no flag is raised. */
export const MIN_VIEWS = 1_000;
/** A timeline share needs this many posts in the timeline to mean anything. */
export const MIN_TIMELINE_POSTS = 8;

export type EngagementFlag = "likely_boosted" | "unusual_engagement";

export const FLAG_LABEL: Record<EngagementFlag, string> = {
  likely_boosted: "likely boosted (inferred)",
  unusual_engagement: "unusual engagement (inferred)",
};

export interface FlagRead {
  id: string;
  flag: EngagementFlag | null;
  reasons: string[];
  likesPerThousand: number | null;
  runMedianLikesPerThousand: number | null;
  /** Share of read retweeters above 10,000 followers; null when not read. */
  bigRetweeterShare: number | null;
  retweetersRead: number | null;
  timelineShare: number | null;
}

export function likesPerThousand(r: Row): number | null {
  if (r.views === null || r.likes === null || r.views <= 0) return null;
  return Math.round((r.likes / r.views) * 1000 * 100) / 100;
}

/** From one twitter/tweet/retweeters response: how many retweeters were read and how many are above 10,000 followers. */
export function retweeterRead(body: { data?: any }): { read: number; big: number } {
  const items: any[] = Array.isArray(body?.data?.items) ? body.data.items : [];
  const f = items.map((it) => it?.author?.followers ?? it?.user?.followers).filter((x): x is number => typeof x === "number");
  return { read: f.length, big: f.filter((x) => x > BIG_FOLLOWERS).length };
}

export interface FlagOptions {
  /** Retweeters read per post id (sum the pages first). */
  retweeters?: Map<string, { read: number; big: number }>;
  /** Each account's timeline rows, to test the "more than half of its views" rule. */
  timelines?: Map<string, Row[]>;
  minViews?: number;
}

/** Flag every row of a run; the run's own median like rate is the context printed beside each flag. */
export function engagementFlags(rows: Row[], opts: FlagOptions = {}): FlagRead[] {
  const minViews = opts.minViews ?? MIN_VIEWS;
  const rates = rows.map(likesPerThousand).filter((x): x is number => x !== null);
  const runMedian = median(rates);
  return rows.map((r) => {
    const lpk = likesPerThousand(r);
    const reasons: string[] = [];
    const low = lpk !== null && (r.views ?? 0) >= minViews && lpk < LOW_LIKES_PER_THOUSAND;
    const rt = opts.retweeters?.get(r.id) ?? null;
    const share = rt && rt.read > 0 ? Math.round((rt.big / rt.read) * 100) / 100 : null;
    let flag: EngagementFlag | null = null;
    if (low) {
      reasons.push(`${lpk} likes per 1,000 views (run median ${runMedian ?? "unknown"})`);
      if (r.platform === "x" && share !== null && share > BIG_RETWEETER_SHARE) {
        reasons.push(`${Math.round(share * 100)}% of ${rt!.read} retweeters read are above 10,000 followers`);
        flag = "likely_boosted";
      } else {
        if (r.platform === "x") reasons.push(share === null ? "retweeters not read" : `${Math.round((share ?? 0) * 100)}% of ${rt!.read} retweeters above 10,000 followers`);
        flag = "unusual_engagement";
      }
    }
    let timelineShare: number | null = null;
    const tl = opts.timelines?.get(r.author.toLowerCase());
    if (tl && tl.length >= MIN_TIMELINE_POSTS && r.views !== null) {
      const total = tl.reduce((s, x) => s + (x.views ?? 0), 0);
      if (total > 0) {
        timelineShare = Math.round((r.views / total) * 100) / 100;
        if (timelineShare > HOLD_SHARE) {
          reasons.push(`holds ${Math.round(timelineShare * 100)}% of the views of ${tl.length} timeline posts`);
          flag ??= "unusual_engagement";
        }
      }
    }
    return { id: r.id, flag, reasons, likesPerThousand: lpk, runMedianLikesPerThousand: runMedian, bigRetweeterShare: share, retweetersRead: rt?.read ?? null, timelineShare };
  });
}

/** Called viral only at 3x or more over 8 or more comparable posts, and never when likely boosted. */
export function isViral(b: Breakout, flag: FlagRead | undefined): boolean {
  return b.band === "beat" && flag?.flag !== "likely_boosted";
}
