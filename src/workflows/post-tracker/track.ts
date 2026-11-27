// post-tracker: one post's numbers, read now and kept. Each run adds a reading to the post's
// history file (socialcrawl-runs/post-tracker-history/<platform>-<id>.json, beside the run
// folders), so running it again later, by hand or on a schedule, builds the curve. The author's
// usual reach (the median of their comparable posts before this one, as every workflow measures
// it) is read on the first run and kept, so later readings cost only the post's own read.
// --every <minutes> --times <n> takes several readings in one run, waiting between them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TOPIC_LANES, breakoutWithPage, rowsOf, stageParams, timelineCall, xBaselineCall } from "../../engine/index.ts";
import type { Platform, Row } from "../../engine/index.ts";
import type { Params } from "../../kit/kit.ts";
import type { Session } from "../../kit/record.ts";
import type { WorkflowArgs } from "../types.ts";

export interface PostRef {
  platform: Platform;
  id: string;
  endpoint: string;
  short?: boolean;
}

/** The platform, post id and read lane of a post link; throws on anything else. */
export function postOf(url: string): PostRef {
  const u = url.trim();
  let m: RegExpMatchArray | null;
  if ((m = u.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i))) return { platform: "x", id: m[1], endpoint: "twitter/tweet" };
  if ((m = u.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i))) return { platform: "tiktok", id: m[1], endpoint: "tiktok/post" };
  if ((m = u.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/i))) return { platform: "instagram", id: m[1], endpoint: "instagram/post" };
  if ((m = u.match(/youtube\.com\/shorts\/([\w-]{11})/i))) return { platform: "youtube", id: m[1], endpoint: "youtube/video", short: true };
  if ((m = u.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([\w-]{11})/i))) return { platform: "youtube", id: m[1], endpoint: "youtube/video" };
  if ((m = u.match(/reddit\.com\/r\/[^/]+\/comments\/(\w+)/i))) return { platform: "reddit", id: m[1], endpoint: "reddit/post" };
  throw new Error(`post-tracker takes a post link from X, TikTok, Instagram, YouTube or Reddit, for example https://x.com/<account>/status/<id>. Got: ${u}`);
}

export interface Reading {
  at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** X and Threads only (post.ext.quote_count); null elsewhere. */
  quotes: number | null;
  requestId: string | null;
}

export interface KeptBaseline {
  metric: "views" | "likes";
  /** The engine's band for the first reading; "base_too_small" means no multiple is given. */
  band?: string;
  /** Null when the author had fewer than 8 comparable earlier posts on the pages read. */
  median: number | null;
  peers: number;
  /** Dates the peers cover, YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  requestIds: string[];
  readAt: string;
}

export interface History {
  url: string;
  platform: Platform;
  id: string;
  author: string;
  authorFollowers: number | null;
  publishedAt: string | null;
  text: string;
  baseline: KeptBaseline | null;
  /** True once the author's size was read where the post read carried none (YouTube, Instagram). */
  sizeRead?: boolean;
  readings: Reading[];
}

export interface Tracked {
  ref: PostRef;
  history: History;
  readings: Reading[];
  baseline: KeptBaseline | null;
  /** The latest reading over the author's usual reach; null without a baseline or a count. */
  multiple: number | null;
  /** Views (or likes) gained per hour from the first reading to the last; null with one reading. */
  gainPerHour: number | null;
  historyFile: string;
  /** Readings asked for in this run, and taken. */
  asked: number;
  taken: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function baselineCall(row: Row, ref: PostRef): { endpoint: string; params: Params } | null {
  if (row.platform === "x") return row.author ? xBaselineCall(row.author, row.publishedAt) : null;
  if (row.platform === "tiktok") return row.author ? { endpoint: "tiktok/profile/videos", params: { handle: row.author, max_pages: 3 } } : null;
  if (row.platform === "instagram") return row.author ? { endpoint: "instagram/profile/reels", params: { handle: row.author, max_pages: 2 } } : null;
  if (row.platform === "youtube") {
    if (!row.channelId) return null;
    return { endpoint: ref.short || row.format === "short" ? "youtube/channel/shorts" : "youtube/channel/videos", params: { channelId: row.channelId, max_pages: 1 } };
  }
  const c = timelineCall(row);
  return c ? { endpoint: c.endpoint, params: { ...c.params, max_pages: 1 } } : null;
}

function readingOf(row: Row, at: string, requestId: string | null, raw: unknown): Reading {
  const q = (raw as { post?: { ext?: { quote_count?: unknown } } } | null)?.post?.ext?.quote_count;
  return { at, views: row.views, likes: row.likes, comments: row.comments, shares: row.shares, saves: row.saves, quotes: typeof q === "number" ? q : null, requestId };
}

export interface TrackDeps {
  sleep?: (ms: number) => Promise<void>;
}

export async function trackPost(session: Session, args: WorkflowArgs, deps: TrackDeps = {}): Promise<Tracked> {
  const ref = postOf(args.input);
  const url = args.input.trim();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const times = Math.min(48, Math.max(1, Math.floor(Number(args.flags.times ?? 1)) || 1));
  const everyMs = Math.max(1, Number(args.flags.every ?? 60) || 60) * 60_000;
  const historyFile = path.join(path.dirname(session.dir), "post-tracker-history", `${ref.platform}-${ref.id}.json`);
  const kept: History | null = existsSync(historyFile) ? (JSON.parse(readFileSync(historyFile, "utf8")) as History) : null;

  let history: History | null = kept;
  let taken = 0;
  let latest: Row | null = null;
  for (let k = 0; k < times; k++) {
    if (k > 0) await sleep(everyMs);
    const at = k === 0 ? args.now : new Date(args.now.getTime() + k * everyMs);
    const rec = await session.call(`reading:${ref.platform}`, ref.endpoint, { url });
    if (!rec) break;
    const row = rowsOf(rec)[0];
    if (!row) break;
    latest = row;
    taken++;
    history ??= { url, platform: ref.platform, id: ref.id, author: row.author, authorFollowers: row.authorFollowers, publishedAt: row.publishedAt, text: row.text, baseline: null, readings: [] };
    history.authorFollowers = row.authorFollowers ?? history.authorFollowers;
    history.readings.push(readingOf(row, at.toISOString(), rec.requestId, rec.body?.data));
  }
  if (!history || !latest) throw new Error(`The post could not be read: ${session.errors[0]?.message ?? "no response"}.`);

  // The author's size, read once where the post read carries none, so the report can name an
  // account of 10,000 followers or more and describe a smaller one (YouTube's video read has no
  // subscriber count; Instagram's post read may have no follower count).
  if (history.authorFollowers === null && !history.sizeRead) {
    const size = ref.platform === "youtube" && latest.channelId ? { endpoint: "youtube/channel", params: { channelId: latest.channelId } } : ref.platform === "instagram" && latest.author ? { endpoint: "instagram/profile", params: { handle: latest.author } } : null;
    if (size) {
      const rec = await session.call(`size:${ref.platform}`, size.endpoint, size.params);
      const a = (rec?.body?.data as { author?: { username?: unknown; followers?: unknown } } | undefined)?.author;
      if (typeof a?.followers === "number") history.authorFollowers = a.followers;
      if (typeof a?.username === "string" && a.username) history.author = a.username.replace(/^@/, "");
      history.sizeRead = true;
    }
  }

  // The author's usual reach, read once and kept.
  if (!history.baseline) {
    const call = baselineCall(latest, ref);
    if (call) {
      const params = TOPIC_LANES.has(call.endpoint) ? { ...call.params, judgments: "off" } : stageParams(call.endpoint, call.params, { labels: "off" });
      const rec = await session.call(`baseline:${ref.platform}`, call.endpoint, params);
      if (rec) {
        const metric = ref.platform === "reddit" || latest.views === null ? "likes" : "views";
        const target = { ...latest, ...(ref.short ? { format: "short" as const } : {}) };
        const b = breakoutWithPage(target, rowsOf(rec), { now: args.now, metric });
        const dates = rowsOf(rec).filter((r) => b.peerIds.includes(r.id)).map((r) => r.publishedAt).filter((x): x is string => Boolean(x)).sort();
        history.baseline = { metric, band: b.band, median: b.base, peers: b.peers, from: dates[0]?.slice(0, 10) ?? null, to: dates.at(-1)?.slice(0, 10) ?? null, requestIds: b.requestIds, readAt: args.now.toISOString() };
      }
    }
  }

  mkdirSync(path.dirname(historyFile), { recursive: true });
  writeFileSync(historyFile, JSON.stringify(history, null, 1) + "\n");

  const metric = history.baseline?.metric ?? (latest.views !== null ? "views" : "likes");
  const value = (r: Reading) => (metric === "views" ? r.views : r.likes);
  const last = history.readings.at(-1)!;
  const first = history.readings[0];
  const base = history.baseline?.median ?? null;
  const lastValue = value(last);
  const tooSmall = history.baseline?.band === "base_too_small";
  const multiple = base && !tooSmall && lastValue !== null ? round2(lastValue / base) : null;
  const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
  const gainPerHour = history.readings.length > 1 && hours > 0 && value(first) !== null && lastValue !== null ? Math.round((lastValue - (value(first) as number)) / hours) : null;
  return { ref, history, readings: history.readings, baseline: history.baseline, multiple, gainPerHour, historyFile, asked: times, taken };
}
