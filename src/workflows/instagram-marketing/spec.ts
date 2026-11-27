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

export const INSTAGRAM: VideoSpec = {
  workflow: "instagram-marketing",
  platform: "instagram",
  label: "Instagram",
  postNoun: "reel",
  accountNoun: "creator",
  defaultBudget: 60,
  deepBudget: 250,
  searches: (query, deep): SearchStep[] => {
    const pages = deep ? 4 : 2;
    return [{ stage: "reels", endpoint: "instagram/search/reels", params: { query, max_pages: pages }, pages }];
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
    max: { default: 3, deep: 10 },
    preRead: { default: 8, deep: 20 },
  },
  shares: {
    default: { search: 10, enrich: 0, baseline: 24, comments: 5, transcript: 10, names: 11 },
    deep: { search: 20, enrich: 0, baseline: 60, comments: 60, transcript: 30, names: 30 },
  },
};
