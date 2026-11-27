// One row shape for every platform, read from the API's shared envelope
// (`data.items[].post` or `data.items[].comment`). Every engine module works on
// these rows, so a skill for a new platform only has to name its endpoints.
//
// Unknown is null, never zero: a row without a view count has `views: null`.

export type Platform = "x" | "tiktok" | "instagram" | "youtube" | "reddit" | "linkedin" | "threads" | "facebook" | "other";

/** original: the author's own post (a thread's first post counts); thread_part: a reply to themselves; reply: a reply to someone else; repost: a retweet or reshare. */
export type RowKind = "original" | "thread_part" | "reply" | "repost";

export interface Row {
  platform: Platform;
  id: string;
  url: string | null;
  author: string;
  authorFollowers: number | null;
  authorUrl: string | null;
  channelId: string | null;
  community: string | null;
  text: string;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  durationSeconds: number | null;
  video: boolean;
  pinned: boolean;
  kind: RowKind;
  /** The request that returned this row; every finding about it cites this id. */
  requestId: string | null;
  /** Hashtags parsed from the caption (`ext.hashtags`); absent when the response gives none. */
  hashtags?: string[];
  /** The sound a video uses (TikTok `music_*`, Instagram `ext.music`); `original` is the creator's own sound, null when unknown. Absent when the response gives none. */
  sound?: { id: string | null; title: string | null; original: boolean | null };
  /** YouTube only: a Short or a regular upload, from `ext.content_type`. Shorts are compared only with Shorts. Absent when unknown. */
  format?: "short" | "long";
}

/** The slice of a stored call the engine reads (the prototype's CallRecord fits). */
export interface ResponseRecord {
  endpoint: string;
  params?: Record<string, unknown>;
  status?: number;
  requestId: string | null;
  creditsUsed?: number;
  body: { data?: any; credits_used?: number; request_id?: string; [k: string]: unknown };
}

const PREFIX: Record<string, Platform> = {
  twitter: "x",
  x: "x",
  tiktok: "tiktok",
  instagram: "instagram",
  youtube: "youtube",
  reddit: "reddit",
  linkedin: "linkedin",
  threads: "threads",
  facebook: "facebook",
};

/** "twitter/user/tweets" is X. */
export function platformOf(endpoint: string): Platform {
  return PREFIX[endpoint.replace(/^\/?(v1\/)?/, "").split("/")[0]] ?? "other";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function kindOf(p: any, author: string, text: string): RowKind {
  const ext = p.ext ?? {};
  if (/^RT @\w/.test(text) || ext.reposted_by || ext.is_repost_quote === true) return "repost";
  if (ext.in_reply_to_id) {
    const to = str(ext.in_reply_to_username);
    if (to) return to.toLowerCase() === author.toLowerCase() ? "thread_part" : "reply";
    // Search rows often carry no parent name: a leading @name means a reply to that account.
    const lead = text.match(/^@(\w{1,30})\b/)?.[1];
    return lead && lead.toLowerCase() !== author.toLowerCase() ? "reply" : "thread_part";
  }
  return "original";
}

function isVideo(platform: Platform, p: any): boolean {
  const ext = p.ext ?? {};
  const type = String(ext.content_type ?? ext.media_type ?? ext.post_type ?? "").toLowerCase();
  if (platform === "tiktok") return true;
  if (/video|short|reel|clip/.test(type)) return true;
  return (num(p.content?.duration_seconds) ?? 0) > 0;
}

/** A post row from the shared envelope. */
export function rowOf(post: any, platform: Platform, requestId: string | null): Row {
  const author = String(post.author?.username ?? "").replace(/^@/, "");
  const text = String(post.content?.text ?? "");
  const ext = post.ext ?? {};
  const e = post.engagement ?? {};
  const extras: Pick<Row, "hashtags" | "sound" | "format"> = {};
  if (Array.isArray(ext.hashtags)) extras.hashtags = ext.hashtags.filter((h: unknown): h is string => typeof h === "string");
  const soundId = str(ext.music_id) ?? str(ext.music?.id);
  const soundTitle = str(ext.music_title) ?? str(ext.music?.track_title);
  if (soundId || soundTitle) extras.sound = { id: soundId, title: soundTitle, original: typeof ext.music_is_original === "boolean" ? ext.music_is_original : null };
  if (platform === "youtube" && ext.content_type === "short") extras.format = "short";
  else if (platform === "youtube" && ext.content_type === "video") extras.format = "long";
  return {
    ...extras,
    platform,
    id: String(post.id),
    url: str(post.url),
    author,
    authorFollowers: num(ext.author_followers),
    authorUrl: str(ext.author_url),
    channelId: str(ext.channel_id),
    community: str(ext.subreddit),
    text,
    publishedAt: str(post.published_at),
    views: num(e.views),
    likes: num(e.likes),
    comments: num(e.comments),
    shares: num(e.shares),
    saves: num(e.saves),
    durationSeconds: num(post.content?.duration_seconds),
    video: isVideo(platform, post),
    pinned: post.flags?.pinned === true,
    kind: kindOf(post, author, text),
    requestId,
  };
}

/** Every post row in one stored response (comment rows are read by `commentsOf`). */
export function rowsOf(rec: ResponseRecord): Row[] {
  const platform = platformOf(rec.endpoint);
  const d = rec.body?.data;
  const items: any[] = Array.isArray(d?.items) ? d.items : d?.post ? [{ post: d.post }] : [];
  const out: Row[] = [];
  for (const it of items) if (it?.post?.id) out.push(rowOf(it.post, platform, rec.requestId));
  return out;
}

export interface CommentRow {
  platform: Platform;
  id: string;
  postId: string | null;
  author: string;
  text: string;
  likes: number | null;
  publishedAt: string | null;
  /** The free labels the API attached, or null when this row came back unlabelled. */
  labels: Record<string, unknown> | null;
  requestId: string | null;
}

export function commentsOf(rec: ResponseRecord): CommentRow[] {
  const platform = platformOf(rec.endpoint);
  const items: any[] = Array.isArray(rec.body?.data?.items) ? rec.body.data.items : [];
  return items
    .filter((it) => it?.comment?.id)
    .map((it) => ({
      platform,
      id: String(it.comment.id),
      postId: str(it.comment.post_id),
      author: String(it.comment.author?.username ?? ""),
      text: String(it.comment.text ?? ""),
      likes: num(it.comment.engagement?.likes),
      publishedAt: str(it.comment.published_at),
      labels: it.computed?.labels ?? null,
      requestId: rec.requestId,
    }));
}

/** Rows deduplicated by platform and id; the first copy wins. */
export function uniqueRows(rows: Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.platform}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
