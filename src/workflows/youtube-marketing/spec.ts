// YouTube's stages for youtube-marketing. Measured on 26/11 and 27/11/2026 (study file 18,
// sections 2.1 and 4.4; req-XRyPXUzG07MZql8s to req-CCo2sflpMZ5F9mnc): search rows carry views
// but no likes, and search Shorts carry no channel id; one POST youtube/videos over every id
// fills likes, durations and channel ids for 5 credits per 50 (cheaper and fuller than
// include=engagement on the search, file 18 N8); one POST youtube/channels gives subscriber
// counts. A Short is measured against the channel's Shorts shelf (48 a page) and a long video
// against its Videos tab (30 a page), never against each other. Candidates are read in order
// of views: views over subscribers agreed poorly with the channel's own median (file 18, 0.18).
import { baselineKey, rowsOf } from "../../engine/index.ts";
import type { Row } from "../../engine/index.ts";
import type { Session } from "../../kit/record.ts";
import type { SearchStep, VideoSpec } from "../_video/spec.ts";
import { youtubeUploadDate } from "../_video/window.ts";

const VIDEO_ID = /^[\w-]{11}$/;
const CHUNK = 50;

/** Likes, comments, durations and channel ids from the batch lookup; subscriber counts and handles from the channel batch. */
async function enrich(session: Session, rows: Row[], shareMax: number): Promise<{ rows: Row[]; followers: Map<string, number | null> }> {
  const out = rows.map((r) => ({ ...r }));
  const byId = new Map(out.map((r) => [r.id, r]));
  // The most viewed first: a budget that stops after one chunk keeps the rows that matter.
  const ids = [...new Set([...out].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).map((r) => r.id).filter((id) => VIDEO_ID.test(id)))];
  let spent = 0;
  const asked = new Set<string>();

  async function videos(chunk: string[]): Promise<boolean> {
    const rec = await session.post("enrich:videos", "youtube/videos", { ids: chunk }, shareMax - spent);
    if (!rec) return false;
    spent += rec.creditsUsed;
    for (const b of rowsOf(rec)) {
      const r = byId.get(b.id);
      if (!r) continue;
      r.views = b.views ?? r.views;
      r.likes = b.likes ?? r.likes;
      r.comments = b.comments ?? r.comments;
      r.durationSeconds = b.durationSeconds ?? r.durationSeconds;
      r.channelId = r.channelId ?? b.channelId;
      r.publishedAt = b.publishedAt ?? r.publishedAt;
    }
    return true;
  }

  async function channels(): Promise<void> {
    const todo = [...new Set(out.map((r) => r.channelId).filter((c): c is string => Boolean(c) && !asked.has(c as string)))];
    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      const rec = await session.post("enrich:channels", "youtube/channels", { ids: chunk }, shareMax - spent);
      if (!rec) return;
      spent += rec.creditsUsed;
      chunk.forEach((c) => asked.add(c));
      const items = ((rec.body?.data as { items?: { author?: { id?: unknown; username?: unknown; followers?: unknown } }[] } | undefined)?.items ?? []).map((x) => x.author ?? {});
      for (const a of items) {
        if (typeof a.id !== "string") continue;
        for (const r of out.filter((x) => x.channelId === a.id)) {
          if (typeof a.followers === "number") r.authorFollowers = a.followers;
          if (typeof a.username === "string" && a.username) r.author = a.username.replace(/^@/, "");
        }
      }
    }
  }

  // Subscriber counts come right after the first chunk: without them no channel can be named.
  if (ids.length && (await videos(ids.slice(0, CHUNK)))) await channels();
  for (let i = CHUNK; i < ids.length; i += CHUNK) if (!(await videos(ids.slice(i, i + CHUNK)))) break;
  await channels();
  return { rows: out, followers: new Map() };
}

export const YOUTUBE: VideoSpec = {
  workflow: "youtube-marketing",
  platform: "youtube",
  label: "YouTube",
  postNoun: "video",
  accountNoun: "channel",
  defaultBudget: 60,
  deepBudget: 250,
  // The video search carries the window's uploadDate (this_month for the default 30 days); the
  // Shorts search cannot (YouTube refuses a window narrower than a year there), so its rows are
  // cut to the window by date, as every row is.
  searches: (query, deep, w): SearchStep[] => {
    const pages = deep ? 3 : 1;
    const upload = youtubeUploadDate(w);
    return [
      { stage: "videos", endpoint: "youtube/search", params: { query, ...(upload ? { uploadDate: upload } : {}), max_pages: pages }, pages },
      { stage: "shorts", endpoint: "youtube/search", params: { query, type: "shorts", max_pages: pages }, pages },
    ];
  },
  floorViews: 1_000,
  enrich,
  // One read per channel and format: a channel's Shorts and long videos are two baselines.
  groupKey: (r: Row) => `${baselineKey(r)}:${r.format ?? "any"}`,
  baselineCall: (r, deep) => {
    if (!r.channelId) return null;
    const pages = deep ? 2 : 1;
    return r.format === "short"
      ? { endpoint: "youtube/channel/shorts", params: { channelId: r.channelId, max_pages: pages } }
      : { endpoint: "youtube/channel/videos", params: { channelId: r.channelId, max_pages: pages } };
  },
  confirm: { default: 10, deep: 25 },
  preRank: "views",
  comments: { endpoint: "youtube/video/comments", posts: { default: 3, deep: 8 }, pages: { default: 1, deep: 2 } },
  transcripts: {
    endpoint: "youtube/transcripts",
    posts: { default: 2, deep: 5 },
    batch: true,
    text: (rec, row) => {
      const results = (rec.body?.data as { results?: { target?: unknown; status?: unknown; data?: { video_id?: unknown; transcript?: unknown } }[] } | undefined)?.results ?? [];
      const hit = results.find((x) => x.target === row.id || x.data?.video_id === row.id);
      const t = hit?.data?.transcript;
      return typeof t === "string" && t.trim() ? t.replace(/\s+/g, " ").trim() : null;
    },
  },
  shares: {
    default: { search: 10, enrich: 10, baseline: 20, comments: 3, transcript: 6, names: 0 },
    deep: { search: 50, enrich: 20, baseline: 60, comments: 20, transcript: 15, names: 0 },
  },
};
