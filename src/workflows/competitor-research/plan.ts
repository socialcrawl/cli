// competitor-research's plan: the brands, one filter sentence per brand, the windowed searches
// that find what is said about each brand on each platform, and the share of voice counted from
// those rows.
//
// The share is counted here, not read from prism/share-of-voice: that endpoint counts the bare
// word on the web, so a brand whose name is a common word took 81.6% ("neon", study file 18, N3).
// Each brand's search instead runs with relevance=filter and a sentence that names the brand
// and its category, so the judge keeps only posts about that brand.
import { stageParams } from "../../engine/index.ts";
import type { Platform, Row } from "../../engine/index.ts";
import type { Params } from "../../kit/kit.ts";
import { tiktokDatePosted, youtubeUploadDate } from "../_video/window.ts";
import type { Window } from "../_video/window.ts";

export const MIN_BRANDS = 2;
export const MAX_BRANDS = 5;
export const PLATFORMS: Platform[] = ["x", "tiktok", "instagram", "youtube", "reddit", "linkedin"];
export const DEFAULT_PLATFORMS: Platform[] = ["x", "tiktok", "youtube", "reddit"];

/** "Supabase, Firebase, Neon" or "Notion vs Obsidian": one copy of each brand, in order. */
export function parseBrands(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of input.split(/\s*(?:,|;|\bvs\.?\b|\bversus\b)\s*/i).map((s) => s.trim()).filter(Boolean)) {
    if (seen.has(b.toLowerCase())) continue;
    seen.add(b.toLowerCase());
    out.push(b);
  }
  if (out.length < MIN_BRANDS || out.length > MAX_BRANDS) throw new Error(`competitor-research takes two to five brands, separated by commas: "Supabase, Firebase, Neon". Got ${out.length}.`);
  return out;
}

/** The sentence the topic filter judges each row against: the brand, its category when given. */
export function brandSentence(brand: string, about?: string): string {
  return about ? `${brand}, in ${about}: posts about this brand or its product` : `${brand}: posts about this brand or its product`;
}

export interface MentionCall {
  brand: string;
  platform: Platform;
  stage: string;
  endpoint: string;
  params: Params;
  pages: number;
}

function redditTimeframe(w: Window): string {
  if (w.allTime) return "all";
  if (w.ageDays <= 7) return "week";
  if (w.ageDays <= 31) return "month";
  if (w.ageDays <= 366) return "year";
  return "all";
}

/** One windowed, topic-filtered search per brand per platform. */
export function planMentions(brands: string[], o: { about?: string; window: Window; deep: boolean }): MentionCall[] {
  const pages = o.deep ? 2 : 1;
  const platforms = o.deep ? [...DEFAULT_PLATFORMS, "instagram" as Platform] : DEFAULT_PLATFORMS;
  const out: MentionCall[] = [];
  for (const brand of brands) {
    const topic = brandSentence(brand, o.about);
    const add = (platform: Platform, endpoint: string, base: Params) =>
      out.push({ brand, platform, stage: `mentions:${platform}`, endpoint, params: stageParams(endpoint, { ...base, max_pages: pages }, { topic, labels: "default" }), pages });
    for (const p of platforms) {
      if (p === "x") add("x", "twitter/search/tweets", { query: `"${brand}"`, sort: "top", ...(o.window.allTime ? {} : { since: o.window.since }) });
      if (p === "tiktok") {
        const d = tiktokDatePosted(o.window);
        add("tiktok", "tiktok/search", { query: brand, ...(d ? { date_posted: d } : {}) });
      }
      if (p === "youtube") {
        const u = youtubeUploadDate(o.window);
        add("youtube", "youtube/search", { query: brand, ...(u ? { uploadDate: u } : {}) });
      }
      if (p === "reddit") add("reddit", "reddit/search", { query: `"${brand}"`, sort: "top", timeframe: redditTimeframe(o.window) });
      if (p === "instagram") add("instagram", "instagram/search/reels", { query: brand });
    }
  }
  return out;
}

export interface BrandShare {
  brand: string;
  posts: number;
  /** Views (X, TikTok, Instagram, YouTube) or score (Reddit) summed over the brand's posts. */
  reach: number;
  postShare: number;
  reachShare: number;
  /** Share of the brand's reach its single largest post holds: near 1, the reach share rests on one post. */
  topPostShare: number;
}

export interface PlatformShare {
  platform: Platform;
  metric: "views" | "score";
  brands: BrandShare[];
  /** Posts found under two or more brands: counted once for each, since they are about each. */
  sharedPosts: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Share of posts and of reach per platform, among the posts read; never summed across platforms. */
export function shareOfVoice(rows: { brand: string; row: Row }[], brands: string[]): PlatformShare[] {
  const out: PlatformShare[] = [];
  for (const platform of PLATFORMS) {
    const here = rows.filter((r) => r.row.platform === platform);
    if (!here.length) continue;
    const metric = platform === "reddit" ? "score" : "views";
    const per = brands.map((brand) => {
      const mine = new Map<string, Row>();
      for (const r of here) if (r.brand === brand) mine.set(r.row.id, r.row);
      const reach = [...mine.values()].reduce((s, r) => s + ((metric === "score" ? r.likes : r.views) ?? 0), 0);
      const largest = Math.max(0, ...[...mine.values()].map((r) => (metric === "score" ? r.likes : r.views) ?? 0));
      return { brand, posts: mine.size, reach, topPostShare: reach ? round2(largest / reach) : 0 };
    });
    const posts = per.reduce((s, b) => s + b.posts, 0);
    const reach = per.reduce((s, b) => s + b.reach, 0);
    const owners = new Map<string, Set<string>>();
    for (const r of here) (owners.get(r.row.id) ?? owners.set(r.row.id, new Set()).get(r.row.id)!).add(r.brand);
    out.push({
      platform,
      metric,
      brands: per.map((b) => ({ ...b, postShare: posts ? round2(b.posts / posts) : 0, reachShare: reach ? round2(b.reach / reach) : 0 })),
      sharedPosts: [...owners.values()].filter((s) => s.size > 1).length,
    });
  }
  return out;
}

/** What a best post's multiple is measured against: Reddit votes belong to the community. */
export function usualOf(platform: Platform): string {
  return platform === "reddit" ? "its community's usual score" : "its author's usual reach";
}
