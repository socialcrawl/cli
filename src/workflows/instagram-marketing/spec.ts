// Instagram's stages for instagram-marketing. Measured on 27/11/2026: the undated reel search
// carries views on every row (req-8RDrukywrjbCvEbH, 18 kept of 30 for 3 credits, 26 s), while a
// date_posted search carries none unless include=engagement pays per reel (file 26, SR-40), so
// the default sends no window. Search rows carry no follower count, so the eight
// most viewed creators get one profile read each (1 credit, req-ZOPNCO5OxUiUn4uQ) before
// ranking, so views over followers chooses whom to baseline, as on TikTok; a live run ordered
// by raw views (req-dMCONf1bHYz9LaJM) read only large accounts on a normal day.
// A profile page holds 12 reels: the baseline reads 2 (req-lXvU9xsaiqQjfvyh).
import { baselineKey } from "../../engine/index.ts";
import type { Row } from "../../engine/index.ts";
import type { SearchStep, VideoSpec } from "../_video/spec.ts";
import { instagramDatePosted } from "../_video/window.ts";

export const INSTAGRAM: VideoSpec = {
  workflow: "instagram-marketing",
  platform: "instagram",
  label: "Instagram",
  postNoun: "reel",
  accountNoun: "creator",
  defaultBudget: 60,
  deepBudget: 250,
  // Default: the undated search (views on every row), cut to the window by date. Measured on
  // 27/11/2026: 2 pages for 4 credits gave 6 reels in the last 30 days, against 17 for 26 credits
  // on the dated search with include=engagement (req-m3nr835HORVizLHS, req-Snp1UDwQC5CTuCNp);
  // a default run measures 6 creators, so the dated search is kept for --deep.
  searches: (query, deep, w): SearchStep[] => {
    const out: SearchStep[] = [{ stage: "reels", endpoint: "instagram/search/reels", params: { query, max_pages: 2 }, pages: 2 }];
    const dated = instagramDatePosted(w);
    if (deep && dated) out.push({ stage: "reels-dated", endpoint: "instagram/search/reels", params: { query, date_posted: dated, include: "engagement", max_pages: 2 }, pages: 2, extraPerPage: 30 });
    return out;
  },
  floorViews: 1_000,
  groupKey: (r: Row) => baselineKey(r),
  baselineCall: (r, deep) => (r.author ? { endpoint: "instagram/profile/reels", params: { handle: r.author, max_pages: deep ? 3 : 2 } } : null),
  extraPages: { default: 3, deep: 4 },
  confirm: { default: 6, deep: 15 },
  recentDays: 30,
  preRank: "views_per_follower",
  comments: { endpoint: "instagram/post/comments", posts: { default: 1, deep: 6 }, pages: { default: 1, deep: 2 } },
  transcripts: {
    endpoint: "instagram/media/transcript",
    posts: { default: 1, deep: 3 },
    batch: false,
    text: (rec) => {
      const list = (rec.body?.data as { transcripts?: { text?: unknown }[] } | undefined)?.transcripts ?? [];
      const t = list.map((x) => (typeof x?.text === "string" ? x.text : "")).join(" ").trim();
      return t || null;
    },
  },
  names: {
    endpoint: "instagram/profile",
    params: (r) => ({ handle: r.author }),
    followers: (rec) => {
      const f = (rec.body?.data as { author?: { followers?: unknown } } | undefined)?.author?.followers;
      return typeof f === "number" ? f : null;
    },
    max: { default: 5, deep: 10 },
    preRead: { default: 6, deep: 20 },
  },
  shares: {
    default: { search: 10, enrich: 0, baseline: 24, comments: 5, transcript: 10, names: 11 },
    deep: { search: 80, enrich: 0, baseline: 60, comments: 40, transcript: 30, names: 30 },
  },
};
