// video-teardown's reads, every call through the Session, for one video link:
//
//   1. post        the video: counts, length, sound, its creator (post-tracker's postOf)
//   2. size        the creator's followers where the post read has none (YouTube, Instagram)
//   3. baseline    the creator's earlier comparable videos, never topic-filtered (post-tracker's
//                  readBaseline: TikTok and Instagram feeds, the YouTube channel's videos or Shorts,
//                  X originals up to the post's minute)
//   4. screen      on-screen text by the second (TikTok, Instagram); frames=all reads videos of
//                  180 s or less, so a longer one is read from its cover. YouTube and X give no frames.
//   5. words       the transcript: timed on TikTok and YouTube, untimed on Instagram and X
//   6. comments    the replies, labels sent explicitly; commenters are never named
import { rowsOf, stageParams } from "../../engine/index.ts";
import type { Platform, Row } from "../../engine/index.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import type { WorkflowArgs } from "../types.ts";
import { askSummary } from "../_video/comments.ts";
import type { AskSummary } from "../_video/comments.ts";
import { postOf, readBaseline, readSize } from "../post-tracker/track.ts";
import type { KeptBaseline, PostRef } from "../post-tracker/track.ts";
import { screenOf, SCREEN_PLATFORMS, wordsOf } from "./storyboard.ts";
import type { Screen, Words } from "./storyboard.ts";

/** frames=all reads a video of this many seconds or less (the API's 400 above it, 27/11/2026). */
export const FRAMES_ALL_MAX_SECONDS = 180;

export const ENDPOINTS: Record<"tiktok" | "instagram" | "youtube" | "x", { screen: string | null; words: string; comments: string }> = {
  tiktok: { screen: "tiktok/video/screen-text", words: "tiktok/post/transcript", comments: "tiktok/post/comments" },
  instagram: { screen: "instagram/media/screen-text", words: "instagram/media/transcript", comments: "instagram/post/comments" },
  youtube: { screen: null, words: "youtube/video/transcript", comments: "youtube/video/comments" },
  x: { screen: null, words: "twitter/tweet/transcript", comments: "twitter/tweet/replies" },
};
export type VideoPlatform = keyof typeof ENDPOINTS;
export const DEPTH = { default: { commentPages: 1 }, deep: { commentPages: 3 } };

export interface Sound {
  title: string | null;
  original: boolean | null;
}

export interface Teardown {
  url: string;
  ref: PostRef & { platform: VideoPlatform };
  row: Row;
  followers: number | null;
  baseline: KeptBaseline | null;
  /** The video's views (or likes) over its creator's usual; null without a usable baseline. */
  multiple: number | null;
  sound: Sound | null;
  screen: Screen;
  screenRequestId: string | null;
  words: Words;
  wordsRequestId: string | null;
  /** Why no transcript was read, from the API's answer; null when one was read. */
  transcriptError: string | null;
  comments: CallRecord[];
  asks: AskSummary;
  deep: boolean;
}

/** The video's platform and id; throws on a link that is not a TikTok, YouTube, Instagram or X post. */
export function videoOf(url: string): PostRef & { platform: VideoPlatform } {
  let ref: PostRef | null = null;
  try {
    ref = postOf(url);
  } catch {
    ref = null;
  }
  if (!ref || !(ref.platform in ENDPOINTS)) throw new Error(`video-teardown takes a video link from TikTok, YouTube, Instagram or X, for example https://www.tiktok.com/@<account>/video/<id>. Got: ${url.trim()}`);
  return ref as PostRef & { platform: VideoPlatform };
}

function soundOf(row: Row, data: unknown): Sound | null {
  if (row.sound?.title) return { title: row.sound.title, original: row.sound.original ?? null };
  const ext = (data as { post?: { ext?: Record<string, any> } } | null)?.post?.ext ?? {};
  const title = ext.music?.track_title ?? ext.music_title ?? null;
  if (typeof title !== "string" || !title) return null;
  const original = ext.music?.is_original ?? ext.music_is_original;
  return { title, original: typeof original === "boolean" ? original : null };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export async function runTeardown(session: Session, args: WorkflowArgs): Promise<Teardown> {
  const url = args.input.trim();
  const ref = videoOf(url);
  const p = ref.platform as Platform;
  const ep = ENDPOINTS[ref.platform];
  const depth = args.deep ? DEPTH.deep : DEPTH.default;

  // 1. post
  const rec = await session.call(`post:${p}`, ref.endpoint, { url });
  const row = rec ? rowsOf(rec)[0] : undefined;
  if (!rec || !row) throw new Error(`The video could not be read: ${session.errors[0]?.message ?? "no response"}.`);
  if (!row.video) throw new Error(`This post has no video, so there is nothing to take apart: ${url}`);

  // 2. size, 3. baseline
  let followers = row.authorFollowers;
  let author = row.author;
  if (followers === null) {
    const size = await readSize(session, row, ref);
    if (size?.followers != null) followers = size.followers;
    if (size?.handle) author = size.handle;
  }
  const measured: Row = { ...row, author, authorFollowers: followers };
  const baseline = await readBaseline(session, measured, ref, args.now);
  const value = baseline?.metric === "likes" ? row.likes : row.views;
  const multiple = baseline?.median && baseline.band !== "base_too_small" && value !== null ? round2(value / baseline.median) : null;

  // 4. screen
  let screen: Screen = screenOf(p, null);
  let screenRequestId: string | null = null;
  if (ep.screen && SCREEN_PLATFORMS.has(p)) {
    const whole = row.durationSeconds !== null && row.durationSeconds <= FRAMES_ALL_MAX_SECONDS;
    const s = await session.call(`screen:${p}`, ep.screen, whole ? { url, frames: "all" } : { url });
    if (s) {
      screen = screenOf(p, s.body?.data);
      screenRequestId = s.requestId;
    }
  }

  // 5. words
  const errorsBefore = session.errors.length;
  const w = await session.call(`words:${p}`, ep.words, { url });
  const words = wordsOf(p, w ? w.body?.data : null);
  const err = !w ? session.errors.slice(errorsBefore).at(-1) : undefined;
  const transcriptError = err ? `${err.status ?? "no status"} ${err.message}`.trim() : null;

  // 6. comments, labelled
  const comments: CallRecord[] = [];
  const c = await session.call(`comments:${p}`, ep.comments, stageParams(ep.comments, { url, max_pages: depth.commentPages }, { labels: "explicit" }));
  if (c) comments.push(c);

  return { url, ref, row: measured, followers, baseline, multiple, sound: soundOf(row, rec.body?.data), screen, screenRequestId, words, wordsRequestId: w?.requestId ?? null, transcriptError, comments, asks: askSummary(comments), deep: args.deep };
}
