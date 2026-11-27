// The window a marketing run reads. A person asking what is breaking out means now, so the
// default is the last 30 days; --since and --until change it, and --since 2000-01-01 (or
// earlier) reads all time. Each platform's search gets the narrowest date filter of its own
// that still covers the window back from today, and every row is then cut to the exact window.
import type { Row } from "../../engine/index.ts";

export const DEFAULT_DAYS = 30;
const ALL_TIME_BEFORE = "2000-01-02";
const DAY = 86_400_000;

export interface Window {
  /** YYYY-MM-DD, inclusive. */
  since: string;
  /** YYYY-MM-DD, inclusive. */
  until: string;
  /** Days from since to until, both included. */
  days: number;
  /** Days from since back from today: what a platform's "this month" must cover. */
  ageDays: number;
  allTime: boolean;
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

export function windowOf(a: { now: Date; since?: string; until?: string }): Window {
  const until = a.until ?? ymd(a.now.getTime());
  const since = a.since ?? ymd(Date.parse(`${until}T00:00:00Z`) - (DEFAULT_DAYS - 1) * DAY);
  return {
    since,
    until,
    days: Math.round((Date.parse(until) - Date.parse(since)) / DAY) + 1,
    ageDays: Math.ceil((a.now.getTime() - Date.parse(`${since}T00:00:00Z`)) / DAY),
    allTime: since < ALL_TIME_BEFORE,
  };
}

/** Published from since 00:00 UTC to the end of until, UTC. A row with no date is outside. */
export function inWindow(r: Row, w: Window): boolean {
  if (!r.publishedAt) return false;
  const t = Date.parse(r.publishedAt);
  return Number.isFinite(t) && t >= Date.parse(`${w.since}T00:00:00Z`) && t < Date.parse(`${w.until}T00:00:00Z`) + DAY;
}

/** tiktok/search date_posted; undefined for all time. */
export function tiktokDatePosted(w: Window): string | undefined {
  if (w.allTime) return undefined;
  if (w.ageDays <= 1) return "yesterday";
  if (w.ageDays <= 7) return "this-week";
  if (w.ageDays <= 31) return "this-month";
  if (w.ageDays <= 93) return "last-3-months";
  if (w.ageDays <= 186) return "last-6-months";
  return undefined;
}

/** youtube/search uploadDate (not for type=shorts, which refuses anything narrower than a year); undefined for all time. */
export function youtubeUploadDate(w: Window): string | undefined {
  if (w.allTime) return undefined;
  if (w.ageDays <= 1) return "today";
  if (w.ageDays <= 7) return "this_week";
  if (w.ageDays <= 31) return "this_month";
  if (w.ageDays <= 366) return "this_year";
  return undefined;
}

/** instagram/search/reels date_posted (a dated search carries no views without include=engagement); undefined past a year. */
export function instagramDatePosted(w: Window): string | undefined {
  if (w.allTime) return undefined;
  if (w.ageDays <= 7) return "last-week";
  if (w.ageDays <= 31) return "last-month";
  if (w.ageDays <= 366) return "last-year";
  return undefined;
}

export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
