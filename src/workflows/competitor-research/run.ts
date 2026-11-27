// competitor-research's stages, every call through the Session:
//
//   1. mentions   one windowed, topic-filtered search per brand per platform (plan.ts)
//   2. share      posts and reach per brand per platform, among the posts read
//   3. best       each brand's most-reached post per platform, against its author's earlier
//                 posts (X: the originals before it; TikTok: 3 profile pages; YouTube: the
//                 channel's shelf of the same format) or, on Reddit, its community's month
//   4. sizes      one subscriber batch for the YouTube channels the report may name
//   5. comments   the best posts' comments with labels, so each brand gets its own questions
//                 and complaints (X, TikTok, YouTube; Reddit threads on --deep, at 5 a page)
//   6. ads        --deep: the TikTok ad library by advertiser name, kept only when the advertiser
//                 is the brand (a name search returns other advertisers: study file 18, N4, and
//                 the probe of 27/11/2026, req-vGm9MoNkRuVeYJjE)
import { TOPIC_LANES, breakoutWithPage, describe as describeBreakout, rowsOf, stageParams, timelineCall, uniqueRows, xBaselineCall } from "../../engine/index.ts";
import type { Breakout, Platform, Row } from "../../engine/index.ts";
import type { Params } from "../../kit/kit.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import type { WorkflowArgs } from "../types.ts";
import { askSummary } from "../_video/comments.ts";
import type { AskSummary } from "../_video/comments.ts";
import { inWindow, windowOf } from "../_video/window.ts";
import type { Window } from "../_video/window.ts";
import { parseBrands, planMentions, shareOfVoice } from "./plan.ts";
import type { PlatformShare } from "./plan.ts";

export interface Shares {
  mentions: number;
  baselines: number;
  sizes: number;
  comments: number;
  ads: number;
}
export const SHARES: { default: Shares; deep: Shares } = {
  default: { mentions: 60, baselines: 24, sizes: 5, comments: 10, ads: 0 },
  deep: { mentions: 150, baselines: 60, sizes: 10, comments: 50, ads: 30 },
};

export interface Best {
  brand: string;
  row: Row;
  breakout: Breakout | null;
  line: string;
}

export interface BrandAds {
  brand: string;
  own: Row[];
  others: number;
  requestId: string | null;
}

export interface CompetitorRun {
  brands: string[];
  about: string | null;
  window: Window;
  deep: boolean;
  mentions: { brand: string; platform: Platform; record: CallRecord | null }[];
  rows: { brand: string; row: Row }[];
  outsideWindow: number;
  share: PlatformShare[];
  best: Best[];
  asks: Map<string, AskSummary>;
  ads: BrandAds[];
  followers: Map<string, number | null>;
}

const spentIn = (session: Session, group: string) => session.ledger.lines.filter((l) => l.stage.split(":")[0] === group).reduce((s, l) => s + l.credits, 0);
const reachOf = (r: Row) => (r.platform === "reddit" ? r.likes : r.views) ?? 0;
const LEGAL = /\b(inc|llc|ltd|limited|gmbh|co|corp|corporation|plc|sa|bv|ag|pty)\b\.?/gi;
const norm = (s: string) => s.toLowerCase().replace(LEGAL, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The ad's advertiser is the brand itself: the same name, a legal suffix allowed. */
export function matchesAdvertiser(advertiser: string, brand: string): boolean {
  return norm(advertiser) === norm(brand);
}

/** The read that is this post's baseline, with its pages; null when the row lacks the id it needs. */
function baselineOf(r: Row): { endpoint: string; params: Params } | null {
  if (r.platform === "x") return r.author ? xBaselineCall(r.author, r.publishedAt) : null;
  if (r.platform === "tiktok") return r.author ? { endpoint: "tiktok/profile/videos", params: { handle: r.author, max_pages: 3 } } : null;
  if (r.platform === "youtube") {
    if (!r.channelId) return null;
    return { endpoint: r.format === "short" ? "youtube/channel/shorts" : "youtube/channel/videos", params: { channelId: r.channelId, max_pages: 1 } };
  }
  const c = timelineCall(r);
  return c ? { endpoint: c.endpoint, params: { ...c.params, max_pages: 1 } } : null;
}

const COMMENT_LANE: Partial<Record<Platform, string>> = { x: "twitter/tweet/replies", tiktok: "tiktok/post/comments", youtube: "youtube/video/comments", reddit: "reddit/post/comments" };

export async function runCompetitors(session: Session, args: WorkflowArgs): Promise<CompetitorRun> {
  const brands = parseBrands(args.input);
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about.trim() : null;
  const window = windowOf(args);
  const sh = args.deep ? SHARES.deep : SHARES.default;

  // 1. mentions
  const mentions: CompetitorRun["mentions"] = [];
  const rows: CompetitorRun["rows"] = [];
  let outsideWindow = 0;
  for (const c of planMentions(brands, { about: about ?? undefined, window, deep: args.deep })) {
    const record = await session.call(c.stage, c.endpoint, c.params, sh.mentions - spentIn(session, "mentions"));
    mentions.push({ brand: c.brand, platform: c.platform, record });
    if (!record) continue;
    for (const r of uniqueRows(rowsOf(record))) {
      if (r.kind !== "original") continue;
      if (!inWindow(r, window)) outsideWindow++;
      else rows.push({ brand: c.brand, row: r });
    }
  }

  // 2. share
  const share = shareOfVoice(rows, brands);

  // 3. best: each brand's most-reached post per platform
  const best: Best[] = [];
  for (const brand of brands)
    for (const platform of new Set(rows.filter((r) => r.brand === brand).map((r) => r.row.platform))) {
      const top = rows.filter((r) => r.brand === brand && r.row.platform === platform).map((r) => r.row).sort((a, b) => reachOf(b) - reachOf(a))[0];
      if (top) best.push({ brand, row: top, breakout: null, line: "not measured" });
    }
  const followers = new Map<string, number | null>();
  for (const { row } of rows) if (row.authorFollowers !== null) followers.set(`${row.platform}:${row.author.toLowerCase()}`, row.authorFollowers);

  for (const b of best) {
    const call = baselineOf(b.row);
    if (!call) {
      b.line = `no ${b.row.platform === "youtube" ? "channel id" : "author"} to read a baseline from`;
      continue;
    }
    // A baseline is the author's own posts: never topic-filtered, judging off (X's is a search lane).
    const params = TOPIC_LANES.has(call.endpoint) ? { ...call.params, judgments: "off" } : stageParams(call.endpoint, call.params, { labels: "off" });
    const rec = await session.call(`baselines:${b.row.platform}`, call.endpoint, params, sh.baselines - spentIn(session, "baselines"));
    if (!rec) {
      b.line = "baseline not read (budget or error)";
      continue;
    }
    const page = rowsOf(rec);
    b.breakout = breakoutWithPage(b.row, page, { now: args.now, metric: b.row.platform === "reddit" || b.row.views === null ? "likes" : "views" });
    b.line = describeBreakout(b.breakout);
  }

  // 4. sizes: subscriber counts for the YouTube channels the report may name
  const channels = [...new Set(best.filter((b) => b.row.platform === "youtube" && b.row.channelId).map((b) => b.row.channelId as string))];
  if (channels.length) {
    const rec = await session.post("sizes:youtube", "youtube/channels", { ids: channels }, sh.sizes);
    const items = ((rec?.body?.data as { items?: { author?: { id?: unknown; username?: unknown; followers?: unknown } }[] } | undefined)?.items ?? []).map((x) => x.author ?? {});
    for (const a of items) {
      if (typeof a.id !== "string") continue;
      for (const b of best.filter((x) => x.row.channelId === a.id)) {
        if (typeof a.username === "string" && a.username) b.row = { ...b.row, author: a.username.replace(/^@/, "") };
        followers.set(`youtube:${b.row.author.toLowerCase()}`, typeof a.followers === "number" ? a.followers : null);
      }
    }
  }

  // 5. comments on the best posts, labelled; Reddit threads on --deep
  const byBrand = new Map<string, CallRecord[]>(brands.map((b) => [b, []]));
  for (const b of best) {
    const lane = COMMENT_LANE[b.row.platform];
    if (!lane || !b.row.url) continue;
    if (lane === "reddit/post/comments" && !args.deep) continue;
    const params = stageParams(lane, { url: b.row.url, max_pages: 1 }, { labels: "explicit" });
    const rec = await session.call(`comments:${b.row.platform}`, lane, params, sh.comments - spentIn(session, "comments"));
    if (rec) byBrand.get(b.brand)!.push(rec);
  }
  const asks = new Map(brands.map((b) => [b, askSummary(byBrand.get(b) ?? [])]));

  // 6. ads, --deep only
  const ads: BrandAds[] = [];
  if (args.deep)
    for (const brand of brands) {
      const rec = await session.call("ads:tiktok", "tiktok/adlibrary/search", { advertiser_name: brand, max_pages: 1 }, sh.ads - spentIn(session, "ads"));
      if (!rec) continue;
      const all = rowsOf(rec);
      const advertiser = (r: Row) => r.author || "";
      const own = all.filter((r) => matchesAdvertiser(advertiser(r), brand));
      ads.push({ brand, own, others: all.length - own.length, requestId: rec.requestId });
    }

  return { brands, about, window, deep: args.deep, mentions, rows, outsideWindow, share, best, asks, ads, followers };
}
