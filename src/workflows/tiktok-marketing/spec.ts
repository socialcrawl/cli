// TikTok's stages for tiktok-marketing. Measured on 26/11 and 27/11/2026 (study files 18 and
// 25; req-pDuFDn2Qc6MCeA0H, req-09QuV22QqU9w4ovT): search rows carry views, follower counts,
// the sound and the hashtags; one profile page holds 10 videos, so a creator's baseline reads
// 3 pages to reach 8 videos before the candidate.
import { baselineKey } from "../../engine/index.ts";
import type { Row } from "../../engine/index.ts";
import { vttText } from "../_video/run.ts";
import { tiktokDatePosted } from "../_video/window.ts";
import type { SearchStep, VideoSpec } from "../_video/spec.ts";

export const TIKTOK: VideoSpec = {
  workflow: "tiktok-marketing",
  platform: "tiktok",
  label: "TikTok",
  postNoun: "video",
  accountNoun: "creator",
  defaultBudget: 60,
  deepBudget: 250,
  // Every stage carries the narrowest date_posted that covers the window (this-month for the
  // default 30 days); rows are then cut to the exact window.
  searches: (query, deep, w) => {
    const pages = deep ? 3 : 1;
    const date = tiktokDatePosted(w);
    const when = date ? { date_posted: date } : {};
    const out: SearchStep[] = [
      { stage: "top", endpoint: "tiktok/search", params: { query, ...when, max_pages: pages }, pages },
      { stage: "most-liked", endpoint: "tiktok/search", params: { query, sort_by: "most-liked", ...when, max_pages: pages }, pages },
    ];
    if (deep) out.push({ stage: "newest", endpoint: "tiktok/search", params: { query, sort_by: "date-posted", ...when, max_pages: pages }, pages });
    return out;
  },
  floorViews: 1_000,
  groupKey: (r: Row) => baselineKey(r),
  baselineCall: (r, deep) => (r.author ? { endpoint: "tiktok/profile/videos", params: { handle: r.author, max_pages: deep ? 4 : 3 } } : null),
  extraPages: { default: 2, deep: 3 },
  confirm: { default: 8, deep: 15 },
  recentDays: 60,
  preRank: "views_per_follower",
  comments: { endpoint: "tiktok/post/comments", posts: { default: 3, deep: 8 }, pages: { default: 1, deep: 2 } },
  transcripts: {
    endpoint: "tiktok/post/transcript",
    posts: { default: 1, deep: 3 },
    batch: false,
    text: (rec) => {
      const t = (rec.body?.data as { transcript?: unknown } | undefined)?.transcript;
      return typeof t === "string" && t.trim() ? vttText(t) : null;
    },
  },
  shares: {
    default: { search: 12, enrich: 0, baseline: 30, comments: 5, transcript: 10, names: 0 },
    deep: { search: 50, enrich: 0, baseline: 80, comments: 30, transcript: 30, names: 0 },
  },
};
