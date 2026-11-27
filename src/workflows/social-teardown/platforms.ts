// One adapter per platform the teardown reads after X: the calls that read the profile, the
// timeline, a post's comments and its words, and how a profile answer reads. X has its own
// deeper stages in x/x.ts (amplifiers, quotes, the first hours, launches).
import type { Row } from "../../engine/rows.ts";
import { stageParams } from "../../engine/stages.ts";
import type { Params } from "../../kit/kit.ts";
import type { CallRecord } from "../../kit/record.ts";
import type { Target, TeardownPlatform } from "./targets.ts";

export interface Call {
  endpoint: string;
  params: Params;
}

export interface Window {
  since?: string;
  until?: string;
}

/** What a profile answer says, unknown as null. */
export interface Profile {
  id: string | null;
  handle: string | null;
  name: string | null;
  bio: string | null;
  followers: number | null;
  posts: number | null;
  joined: string | null;
  verified: boolean | null;
  url: string | null;
  /** Bio links, the website, and the link-in-bio: where the account sends people. */
  links: string[];
}

export interface Adapter {
  platform: Exclude<TeardownPlatform, "x">;
  /** The metric a post is compared on: views where the platform counts them, else likes (Reddit's score). */
  metric: "views" | "likes";
  profile(t: Target): Call;
  /** The timeline walks, newest first; the planner sets max_pages. `profile` gives ids some platforms need. */
  timeline(t: Target, profile: { id?: string | null }, w: Window): Call[];
  /** Whether a timeline walk takes max_pages (Threads and LinkedIn members read one fixed window). */
  walks: boolean;
  comments(postUrl: string): Call | null;
  transcript(postUrl: string): Call | null;
  /** On-screen text, for video teardowns and deep runs. */
  screenText(postUrl: string): Call | null;
}

/** A timeline read: the author's own posts, never topic-filtered, labels off (no label is read on it). */
const walk = (endpoint: string, params: Params, w: Window): Call => ({
  endpoint,
  params: stageParams(endpoint, { ...params, ...(w.since ? { since: w.since } : {}), ...(w.until ? { until: w.until } : {}) }, { labels: "off" }),
});

/** A comments read with the four free labels asked for explicitly where the lane labels them. */
const comments = (endpoint: string, url: string, pages = true): Call => ({ endpoint, params: stageParams(endpoint, pages ? { url, max_pages: 1 } : { url }) });

export const ADAPTERS: Record<Adapter["platform"], Adapter> = {
  tiktok: {
    platform: "tiktok",
    metric: "views",
    walks: true,
    profile: (t) => ({ endpoint: "tiktok/profile", params: { handle: t.handle } }),
    timeline: (t, _p, w) => [walk("tiktok/profile/videos", { handle: t.handle }, w)],
    comments: (u) => comments("tiktok/post/comments", u),
    transcript: (u) => ({ endpoint: "tiktok/post/transcript", params: { url: u } }),
    screenText: (u) => ({ endpoint: "tiktok/video/screen-text", params: { url: u } }),
  },
  instagram: {
    platform: "instagram",
    metric: "views",
    walks: true,
    profile: (t) => ({ endpoint: "instagram/profile", params: { handle: t.handle } }),
    // Reels first: they carry the views; the posts read adds the photos and carousels.
    timeline: (t, _p, w) => [walk("instagram/profile/reels", { handle: t.handle }, w), walk("instagram/profile/posts", { handle: t.handle }, w)],
    comments: (u) => comments("instagram/post/comments", u),
    transcript: (u) => ({ endpoint: "instagram/media/transcript", params: { url: u } }),
    screenText: (u) => ({ endpoint: "instagram/media/screen-text", params: { url: u } }),
  },
  youtube: {
    platform: "youtube",
    metric: "views",
    walks: true,
    profile: (t) => ({ endpoint: "youtube/channel", params: t.channelId ? { channelId: t.channelId } : { handle: t.handle } }),
    timeline: (t, p, w) => {
      const who = p.id ? { channelId: p.id } : t.channelId ? { channelId: t.channelId } : { handle: t.handle };
      return [walk("youtube/channel/videos", who, w), walk("youtube/channel/shorts", who, w)];
    },
    comments: (u) => comments("youtube/video/comments", u),
    transcript: (u) => ({ endpoint: "youtube/video/transcript", params: { url: u } }),
    screenText: () => null,
  },
  linkedin: {
    platform: "linkedin",
    metric: "likes",
    walks: true,
    profile: (t) => ({ endpoint: t.linkedinKind === "company" ? "linkedin/company" : "linkedin/profile", params: { url: t.url } }),
    timeline: (t, p, w) =>
      t.linkedinKind === "company"
        ? [walk("linkedin/company/posts", { company_id: p.id ?? t.handle }, w)]
        : [{ endpoint: "linkedin/profile/posts", params: { url: t.url, ...(w.since ? { since: w.since } : {}), ...(w.until ? { until: w.until } : {}) } }],
    comments: (u) => ({ endpoint: "linkedin/post/comments", params: { url: u, max_pages: 1 } }),
    transcript: () => null,
    screenText: () => null,
  },
  reddit: {
    platform: "reddit",
    metric: "likes",
    walks: true,
    profile: (t) => ({ endpoint: "reddit/profile", params: { handle: t.handle } }),
    timeline: (t, _p, w) => [walk("reddit/profile/posts", { handle: t.handle, sort: "new" }, w)],
    comments: (u) => comments("reddit/post/comments", u),
    transcript: () => null,
    screenText: () => null,
  },
  threads: {
    platform: "threads",
    metric: "likes",
    walks: false,
    profile: (t) => ({ endpoint: "threads/profile", params: { handle: t.handle } }),
    timeline: (t, _p, w) => [{ endpoint: "threads/user/posts", params: { handle: t.handle, ...(w.since ? { since: w.since } : {}), ...(w.until ? { until: w.until } : {}) } }],
    comments: (u) => ({ endpoint: "threads/post/comments", params: { url: u } }),
    transcript: () => null,
    screenText: () => null,
  },
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The profile answer of any platform, read the same way. */
export function profileOf(rec: Pick<CallRecord, "body"> | null | undefined): Profile {
  const a: any = (rec?.body?.data as any)?.author ?? {};
  const ext: any = a.ext ?? {};
  const links = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) links.add(v);
    else if (v && typeof v === "object" && typeof (v as any).url === "string") links.add((v as any).url);
  };
  for (const v of [ext.bio_link, ext.website, a.website]) add(v);
  for (const v of [ext.bio_links, ext.social_links, ext.links]) if (Array.isArray(v)) v.forEach(add);
  for (const m of String(a.bio ?? "").matchAll(/https?:\/\/[^\s)]+/g)) links.add(m[0]);
  return {
    id: str(a.id) ?? (typeof a.id === "number" ? String(a.id) : null),
    handle: str(a.username)?.replace(/^@/, "") ?? null,
    name: str(a.display_name),
    bio: str(a.bio),
    followers: num(a.followers),
    posts: num(a.posts_count),
    joined: str(a.joined_at),
    verified: typeof a.verified === "boolean" ? a.verified : null,
    url: str(a.url),
    links: [...links],
  };
}

/**
 * The account's own posts, and the posts by other people its feed shows (a LinkedIn company
 * page reshares its staff; those are counted apart and never named).
 */
export function ownRows(t: Target, rows: Row[], profile: { id?: string | null; handle?: string | null }): { own: Row[]; others: Row[] } {
  const me = new Set([t.handle.toLowerCase(), (profile.handle ?? "").toLowerCase()].filter(Boolean));
  const own: Row[] = [];
  const others: Row[] = [];
  for (const r of rows) {
    const author = r.author.replace(/^@/, "").toLowerCase();
    // A row with no author on a profile's own timeline is the profile's.
    if (!author || me.has(author)) own.push(r);
    else others.push(r);
  }
  return { own, others };
}
