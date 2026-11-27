// The measured blocks of one video, from what the API returns: its words (the transcript, timed on
// TikTok and YouTube, untimed on Instagram and X), what is on screen (a timeline of text by the
// second on TikTok and Instagram; YouTube and X give no frames), and a storyboard that puts the two
// into the same time windows. Nothing here interprets: the report prints these blocks as they are
// and the agent writes what each beat does (study file 21, 2.10: "the numbers are done; your value
// is interpretation").
import type { Platform } from "../../engine/index.ts";

export interface Segment {
  start: number | null;
  end: number | null;
  text: string;
}

export interface Words {
  /** words: a transcript with text; no_speech: read, and empty (SOC-02); not_read: no transcript read. */
  state: "words" | "no_speech" | "not_read";
  timed: boolean;
  segments: Segment[];
  text: string;
  wordCount: number;
}

export interface ScreenItem {
  at: number | null;
  text: string;
}

export interface Screen {
  /**
   * timed: a timeline of text by the second; cover: only the cover frame was read; untimed: text
   * without times; none: read, and the video shows no text; not_read: no screen read;
   * no_frames: the platform gives no frames (YouTube, X).
   */
  state: "timed" | "cover" | "untimed" | "none" | "not_read" | "no_frames";
  frame: "all" | "cover" | null;
  items: ScreenItem[];
}

export interface Beat {
  from: number;
  to: number;
  onScreen: string[];
  said: string[];
}

/** The platforms whose API returns on-screen text. */
export const SCREEN_PLATFORMS = new Set<Platform>(["tiktok", "instagram"]);

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const countWords = (s: string) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

function wordsFrom(segments: Segment[], timed: boolean): Words {
  const kept = segments.map((s) => ({ ...s, text: clean(s.text) })).filter((s) => s.text);
  const text = kept.map((s) => s.text).join(" ");
  return { state: text ? "words" : "no_speech", timed: timed && kept.length > 0, segments: kept, text, wordCount: countWords(text) };
}

/** The transcript of one video, from the data of its platform's transcript endpoint; null when none was read. */
export function wordsOf(platform: Platform, data: unknown): Words {
  if (data === null || data === undefined) return { state: "not_read", timed: false, segments: [], text: "", wordCount: 0 };
  const d = data as Record<string, any>;
  if (platform === "tiktok") {
    const ts = Array.isArray(d.transcript_with_timestamp) ? d.transcript_with_timestamp : [];
    if (ts.length) return wordsFrom(ts.map((s: any) => ({ start: typeof s.start === "number" ? r3(s.start) : null, end: typeof s.end === "number" ? r3(s.end) : null, text: s.text })), true);
    const plain = clean(String(d.transcript ?? "").replace(/^WEBVTT/, "").replace(/\d\d:\d\d[.:\d]* --> [\d:.]+/g, " "));
    return wordsFrom([{ start: null, end: null, text: plain }], false);
  }
  if (platform === "youtube") {
    const ts = Array.isArray(d.transcript) ? d.transcript : [];
    return wordsFrom(ts.map((s: any) => ({ start: typeof s.offset === "number" ? r3(s.offset) : null, end: typeof s.offset === "number" && typeof s.duration === "number" ? r3(s.offset + s.duration) : null, text: s.text })), true);
  }
  if (platform === "instagram") {
    const ts = Array.isArray(d.transcripts) ? d.transcripts : [];
    return wordsFrom(ts.map((s: any) => ({ start: null, end: null, text: s.text })), false);
  }
  return wordsFrom([{ start: null, end: null, text: typeof d.transcript === "string" ? d.transcript : "" }], false);
}

/** What is on screen, from the data of the platform's screen-text endpoint; null when none was read. */
export function screenOf(platform: Platform, data: unknown): Screen {
  if (!SCREEN_PLATFORMS.has(platform)) return { state: "no_frames", frame: null, items: [] };
  if (data === null || data === undefined) return { state: "not_read", frame: null, items: [] };
  const d = data as Record<string, any>;
  const frame = d.frame === "all" || d.frame === "cover" ? d.frame : null;
  const timeline = Array.isArray(d.timeline) ? d.timeline : [];
  const seen = new Set<string>();
  const items: ScreenItem[] = [];
  for (const t of timeline) {
    const text = clean(t?.text);
    if (!text || (t?.kind && t.kind !== "text")) continue;
    const at = typeof t.at_seconds === "number" ? t.at_seconds : null;
    const key = `${at}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ at, text });
  }
  if (items.length) return { state: "timed", frame, items };
  const texts = (Array.isArray(d.texts) ? d.texts : []).map(clean).filter(Boolean);
  if (!texts.length) return { state: "none", frame, items: [] };
  return { state: frame === "cover" ? "cover" : "untimed", frame, items: [...new Set<string>(texts)].map((text) => ({ at: null, text })) };
}

/** Seconds per storyboard beat: 3 on a short video, wider on a long one so it keeps at most 20 beats. */
export function beatStep(durationSeconds: number | null): number {
  if (!durationSeconds || durationSeconds <= 60) return 3;
  return Math.max(3, Math.ceil(durationSeconds / 20));
}

/** On-screen text and spoken words in the same time windows; empty when neither is timed. */
export function storyboardOf(screen: Screen, words: Words, durationSeconds: number | null): Beat[] {
  const timedScreen = screen.state === "timed";
  if (!timedScreen && !words.timed) return [];
  const step = beatStep(durationSeconds);
  const lastAt = Math.max(0, ...screen.items.map((i) => i.at ?? 0), ...words.segments.map((s) => s.start ?? 0));
  const end = durationSeconds ?? lastAt + 1;
  const beats: Beat[] = [];
  for (let from = 0; from < end; from += step) {
    const to = Math.min(from + step, Math.ceil(end));
    const onScreen = timedScreen ? [...new Set(screen.items.filter((i) => i.at !== null && i.at >= from && i.at < to).map((i) => i.text))] : [];
    const said = words.timed ? words.segments.filter((s) => s.start !== null && s.start >= from && s.start < to).map((s) => s.text) : [];
    const prev = beats.at(-1);
    // A run of empty beats is one row: a long video with words only at the start keeps a short table.
    if (!onScreen.length && !said.length && prev && !prev.onScreen.length && !prev.said.length) prev.to = to;
    else beats.push({ from, to, onScreen, said });
  }
  return beats;
}

/** A cell's text cut at a word boundary, so a long video's storyboard stays a table. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length) + " …";
}

export const HOOK_TEXTS = 4;
export const HOOK_WORDS = 25;

/** What is on screen and said in the first 3 seconds (for untimed words, the first sentence), kept short: 4 texts, 25 words. */
export function hookOf(screen: Screen, words: Words): { onScreen: string[]; moreOnScreen: number; said: string | null } {
  const all = screen.state === "timed" ? [...new Set(screen.items.filter((i) => i.at !== null && i.at < 3).map((i) => i.text))] : [];
  const onScreen = all.slice(0, HOOK_TEXTS);
  let said: string | null = null;
  if (words.state === "words") {
    if (words.timed) said = words.segments.filter((s) => s.start !== null && s.start < 3).map((s) => s.text).join(" ") || null;
    else said = (words.text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? words.text.split(/\s+/).slice(0, 20).join(" ")).trim();
  }
  if (said) {
    const w = said.split(/\s+/);
    if (w.length > HOOK_WORDS) said = w.slice(0, HOOK_WORDS).join(" ") + " …";
  }
  return { onScreen, moreOnScreen: all.length - onScreen.length, said };
}

/** Words spoken per minute over the whole video; null without words or a length. */
export function wordsPerMinute(words: Words, durationSeconds: number | null): number | null {
  if (words.state !== "words" || !durationSeconds) return null;
  return Math.round(words.wordCount / (durationSeconds / 60));
}
