// /social-pulse, pure parts: the two windows, the discover call, its rows and its counts.
//
// One prism/discover read per week, with the same query and platforms, labels stance and
// intent on every kept post. The counts come from the answer's summary, which covers every
// kept row (not only the rows delivered), so this week and the week before compare like with
// like: the same searches, one page a platform, judged the same way.
import type { Platform, Row } from "../../engine/rows.ts";
import type { ApiBody } from "../../kit/kit.ts";

export const PULSE_PLATFORMS = ["twitter", "reddit", "tiktok", "instagram", "youtube", "linkedin"];

export interface Window {
  /** First day, YYYY-MM-DD, inclusive. */
  since: string;
  /** Last day, YYYY-MM-DD, inclusive. */
  until: string;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** The 7 days ending on `until` (default today) and the 7 days before them. */
export function weeksOf(o: { now: Date; until?: string }): { thisWeek: Window; before: Window } {
  const end = Date.parse(`${o.until ?? o.now.toISOString().slice(0, 10)}T00:00:00Z`);
  return {
    thisWeek: { since: day(end - 6 * DAY), until: day(end) },
    before: { since: day(end - 13 * DAY), until: day(end - 7 * DAY) },
  };
}

export function discoverParams(input: { topic: string; about?: string }, w: Window, deep: boolean): Record<string, string | number> {
  return {
    query: input.topic,
    platforms: PULSE_PLATFORMS.join(","),
    label: "stance,intent",
    limit: 100,
    since: w.since,
    until: w.until,
    ...(input.about ? { context: input.about } : {}),
    ...(deep ? { pages_per_platform: 2 } : {}),
  };
}

const PLATFORM: Record<string, Platform> = { twitter: "x", x: "x", reddit: "reddit", tiktok: "tiktok", instagram: "instagram", youtube: "youtube", linkedin: "linkedin" };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A discover item as an engine row, or null for a platform the engine does not measure. */
export function rowOf(it: any, requestId: string | null): Row | null {
  const platform = PLATFORM[String(it?.platform ?? "")];
  if (!platform) return null;
  const author = String(it.author?.username ?? "").replace(/^@/, "");
  const key = String(it.author?.key ?? "");
  return {
    platform,
    id: String(it.native_id ?? it.id ?? ""),
    url: it.url ?? null,
    author,
    authorFollowers: num(it.author?.followers),
    authorUrl: null,
    channelId: platform === "youtube" && /UC[\w-]{20,}/.test(key) ? (key.match(/UC[\w-]{20,}/)?.[0] ?? null) : null,
    community: platform === "reddit" ? (String(it.url ?? "").match(/\/r\/([^/]+)/)?.[1] ?? null) : null,
    text: String(it.text ?? ""),
    publishedAt: it.published_at ?? null,
    views: num(it.engagement?.views),
    likes: num(it.engagement?.likes),
    comments: num(it.engagement?.comments),
    shares: num(it.engagement?.shares),
    saves: null,
    durationSeconds: null,
    video: it.media_type === "video" || platform === "tiktok" || platform === "youtube",
    pinned: false,
    kind: "original",
    requestId,
  };
}

export interface WeekSummary {
  collected: number;
  kept: number;
  /** Kept posts beyond the delivered rows: counted, not listed. */
  overflow: number;
  positive: number;
  negative: number;
  /** Posts given a stance label (the base of the sentiment shares). */
  stanceN: number;
  question: number;
  complaint: number;
  recommendation: number;
  switching: number;
  byPlatform: Record<string, number>;
}

/** The counts of one discover answer, over every kept row. */
export function weekSummary(body: ApiBody): WeekSummary | null {
  const s = (body.data as any)?.summary;
  if (!s) return null;
  const n = (v: unknown) => num(v) ?? 0;
  const byPlatform: Record<string, number> = {};
  for (const [p, v] of Object.entries(s.by_platform ?? {})) byPlatform[p] = n((v as { kept?: { delivered?: number } }).kept?.delivered);
  return {
    collected: n(s.rows?.collected),
    kept: n(s.rows?.kept),
    overflow: n(s.kept?.overflow),
    positive: n(s.stance?.positive),
    negative: n(s.stance?.negative),
    stanceN: n(s.stance?.n),
    question: n(s.intent?.question),
    complaint: n(s.intent?.complaint),
    recommendation: n(s.intent?.recommendation),
    switching: n(s.intent?.switching),
    byPlatform,
  };
}

/** This week against the week before; the share is null when the week before had none. */
export function changeOf(now: number, before: number): { now: number; before: number; share: number | null } {
  return { now, before, share: before > 0 ? Math.round(((now - before) / before) * 100) / 100 : null };
}
