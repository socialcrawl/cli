// REA-Socials: the post codebook. Pure functions, no calls, no credits.
//
// Every post of an account is coded with the same columns, so that two accounts
// can be compared and a second person can check the coding. The rules are plain
// text patterns on the post itself; they are a first pass, not a verdict, and
// the report says so. Columns follow the study codebook (02-codebook.md).
//
// Help: socialcrawl@ridio.io. Licence: MIT.

import { breakouts } from "../../../engine/breakout.ts";
import type { Row } from "../../../engine/rows.ts";

/** One X post as the API returns it, flattened. */
export interface XPost {
  id: string;
  url: string;
  createdUtc: string;
  text: string;
  author: string;
  authorFollowers: number | null;
  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  mediaTypes: string[];
  videoSeconds: number | null;
  inReplyToUser: string | null;
  inReplyToId: string | null;
  conversationId: string | null;
  retweetOf: { id: string; author: string; text: string } | null;
  articleUrl: string | null;
  /** The post this one quotes (ext.quoted_post, read since 27/11/2026), or null. */
  quoted: { id: string; author: string } | null;
  /** True when the row carries the quoted-post field at all; older rows do not. */
  quotedRead: boolean;
  requestId: string;
}

export type Kind = "original" | "thread_head" | "thread_part" | "self_reply_link" | "reply_other" | "quote" | "retweet";

export interface CodedPost {
  account: string;
  post_id: string;
  url: string;
  created_utc: string;
  weekday_utc: string;
  hour_utc: number;
  kind: Kind;
  /** A text post on a row with no quoted-post field: it may be a quote post nobody can see. */
  quote_unseen: boolean;
  /** The quoted post's author and id, for a quote post. */
  quoted_author: string;
  quoted_id: string;
  format: string;
  video_seconds: number | null;
  text: string;
  chars: number;
  hook: string;
  body_shape: string;
  artefact: string;
  artefact_name: string;
  offer_free: string;
  cta: string;
  gated: string;
  partner_tag: string;
  mentions: string;
  links: string;
  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  bookmark_per_like: number | null;
  repost_per_like: number | null;
  reply_per_like: number | null;
  outlier_x: number | null;
  launch_id: string;
  topic_tags: string;
  tone: string;
  reply_sample_read: string;
  transcript_read: string;
  request_no: string;
  /** Not a codebook column: the thread this post belongs to, used to join self-replies to their launch. */
  conversation_id: string | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

/** The API row (`data.items[].post`) as an XPost. */
export function toXPost(post: any, requestId: string): XPost {
  const e = post.engagement ?? {};
  const x = post.ext ?? {};
  const rt = x.retweeted_post;
  return {
    id: String(post.id),
    url: post.url,
    createdUtc: post.published_at,
    text: post.content?.text ?? "",
    author: post.author?.username ?? "",
    authorFollowers: x.author_followers ?? null,
    views: e.views ?? null,
    likes: e.likes ?? null,
    reposts: e.shares ?? null,
    replies: e.comments ?? null,
    quotes: x.quote_count ?? null,
    bookmarks: e.saves ?? null,
    mediaTypes: (x.media ?? []).map((m: any) => String(m.type ?? "")),
    videoSeconds: post.content?.duration_seconds ?? null,
    inReplyToUser: x.in_reply_to_username ?? null,
    inReplyToId: x.in_reply_to_id ?? null,
    conversationId: x.conversation_id ?? null,
    retweetOf: rt ? { id: String(rt.id), author: rt.author?.username ?? "", text: rt.text ?? "" } : null,
    articleUrl: x.article_url ?? null,
    quoted: x.quoted_post?.id ? { id: String(x.quoted_post.id), author: String(x.quoted_post.author?.username ?? "") } : null,
    quotedRead: Object.prototype.hasOwnProperty.call(x, "quoted_post"),
    requestId,
  };
}

export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""));
}

export function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const isXLink = (d: string) => d === "x.com" || d === "twitter.com" || d === "t.co" || d === "pbs.twimg.com";

function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return Math.round((a / b) * 1000) / 1000;
}

const lc = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'");

/** First lines that open a launch: "Introducing X", "Today, we're introducing X", "Meet X", "This is X for Y". */
const LAUNCH_LEAD = /^(today,?\s+)?(we'?re|we are|i'?m)\s+(introducing|launching|releasing)\b|^meet\s+\S|^this is\s+.{2,40}\s+for\s+\S|^say hello to\b/;

/** The launched thing's name from a launch first line: "Today we're introducing Claude for sales." -> "Claude for sales". */
export function launchNameOf(text: string): string {
  const first = (text.trim().split("\n")[0] ?? "").trim().replace(/[‘’]/g, "'");
  const m = first.match(/^(?:today,?\s+)?(?:(?:we'?re|we are|i'?m)\s+)?(?:introducing|launching|releasing|meet|say hello to|this is)\s+(?:the\s+)?(.+?)(?:[.!:]|\s+-\s+|$)/i);
  return m ? m[1].replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim().slice(0, 60) : "";
}

/** The first-line type, from the codebook's hook list. */
export function hookOf(text: string): string {
  const first = lc(text.trim().split("\n")[0] ?? "");
  const all = lc(text);
  if (/^introducing\b/.test(first) || LAUNCH_LEAD.test(first)) return "introducing";
  if (/^(we|i)\s+(just\s+)?(shipped|launched)\b/.test(first) || /\b(just shipped|launching|now live|is live|is now live)\b/.test(first)) return "just_shipped";
  if (/^(i|we)\s+(just\s+)?(built|made|created|wrote|open[- ]sourced)\b/.test(first)) return "i_built";
  if (/\b(\d[\d,.]*\s?k?)\s+(stars|users|followers|signups|customers|downloads)\b|\b(mrr|arr)\b/.test(first)) return "milestone";
  if (/^(free|open[- ]?source(d)?|giving away)\b/.test(first) || /\b100% free\b/.test(first)) return "free_offer";
  if (/^how to\b|^here'?s how\b/.test(first) || /^\s*(step 1|1[.)])/m.test(all)) return "how_to";
  if (/\b\d+(\.\d+)?x\b|\b\d[\d,.]*\s?(k|m)?\s?(views|leads|clicks|revenue)\b|\$\d/.test(first)) return "result_claim";
  if (/\bvs\.?\b|\bbetter than\b|\binstead of\b/.test(first)) return "comparison";
  if (/\b(hiring|join (our|the) team)\b/.test(first)) return "hiring_team";
  if (/\?\s*$/.test(first)) return "question";
  if (/(😂|🤣|\blol\b|\blmao\b)/.test(first)) return "meme_humour";
  return "other";
}

export function bodyShapeOf(text: string, kind: Kind): string {
  if (kind === "thread_head") return "thread";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return "single_line";
  if (lines.filter((l) => /^\d+[.)]/.test(l)).length >= 2) return "numbered_steps";
  if (lines.filter((l) => /^([-•→✅▪️*]|\p{Extended_Pictographic})/u.test(l)).length >= 2) return "bullet_list";
  return "paragraphs";
}

export function formatOf(p: XPost, links: string[]): string {
  if (p.articleUrl) return "article";
  if (p.mediaTypes.some((t) => t === "video")) return "video";
  if (p.mediaTypes.some((t) => t === "animated_gif" || t === "gif")) return "gif";
  const images = p.mediaTypes.filter((t) => t === "image" || t === "photo").length;
  if (images > 1) return "images_multi";
  if (images === 1) return "image";
  if (links.some((u) => !isXLink(domainOf(u)))) return "link_card";
  return "text";
}

/** GitHub paths that are not repositories. */
const GITHUB_RESERVED = new Set(["topics", "orgs", "sponsors", "features", "marketplace", "collections", "settings", "search", "trending", "explore", "login", "about", "pricing", "enterprise", "apps", "users", "issues", "pulls", "notifications"]);

/** "owner/repo" from a GitHub link, or "" for a GitHub page that is not a repository. */
export function repoOf(u: string): string {
  const m = u.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (!m || GITHUB_RESERVED.has(m[1].toLowerCase())) return "";
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

export function artefactOf(text: string, links: string[]): { artefact: string; name: string } {
  const t = lc(text);
  const repo = links.map(repoOf).find(Boolean);
  const repoName = repo ? repo.replace(/\.git$/, "") : "";
  const slashSkill = text.match(/(?:^|\s)\/([a-z0-9][a-z0-9-]{1,40})\s+skill\b/i)?.[1];
  const namedSkill = text.match(/\b([A-Za-z0-9][\w-]{1,40})\s+skill\b/)?.[1];
  const tryUrl = links.find((u) => !isXLink(domainOf(u)) && !/github\.com/.test(u))?.replace(/[?#].*$/, "");
  const name = repoName || (slashSkill ? `/${slashSkill}` : "") || (tryUrl ? tryUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "");
  if (/\bskills?\b|skill\.md|skills add\b/.test(t)) return { artefact: "agent_skill", name: name || namedSkill || "" };
  if (/\bmcp\b/.test(t)) return { artefact: "mcp_server", name };
  if (/\bnpx\s|\bnpm i(nstall)?\b|\bpip install\b|\bbrew install\b|\bcli\b/.test(t)) return { artefact: "cli", name };
  if (repoName) return { artefact: "oss_repo", name };
  if (/\b(template|prompts?)\b/.test(t)) return { artefact: "template_prompt", name };
  if (/\bdataset\b/.test(t)) return { artefact: "dataset", name };
  if (/\b(free credits|free trial|credits)\b/.test(t)) return { artefact: "credits_or_trial", name };
  if (tryUrl) return { artefact: "other", name };
  const launched = LAUNCH_LEAD.test(lc(text.trim().split("\n")[0] ?? "")) || /^introducing\b/i.test(text.trim());
  if (launched) return { artefact: "paid_product", name: launchNameOf(text) };
  return { artefact: "none", name: "" };
}

export function ctaOf(text: string, links: string[]): string {
  const t = lc(text);
  if (/\bcomment\b[^.\n]{0,60}\b(to get|and i'?ll|i'?ll send|i will send|for the link|to receive)\b/.test(t)) return "comment_to_get";
  if (/\b(rt|repost|retweet)\b[^.\n]{0,40}\b(to get|and i'?ll|i'?ll send)\b/.test(t)) return "rt_to_get";
  if (/\bfollow\b[^.\n]{0,40}\b(to get|and i'?ll|so i can dm)\b/.test(t)) return "follow_to_get";
  if (/(👇|⬇️|\blink below\b|\bin the replies\b|\bin replies\b|\bfirst reply\b|\blink in (the )?(reply|comments)\b|\brepo link below\b)/.test(t)) return "link_below";
  if (/\b(star (it|the repo|us)|give (it|us) a star|⭐ the repo)\b/.test(t)) return "star_repo";
  if (/\bdiscord\b/.test(t)) return "join_discord";
  if (/\bwaitlist\b/.test(t)) return "waitlist";
  if (/\bdm me\b|\bdms? (are )?open\b/.test(t)) return "dm";
  if (/\btry (it|this|now)?\s*(at|here|free)?\b/.test(t) && links.some((u) => !isXLink(domainOf(u)))) return "try_url";
  if (links.some((u) => !isXLink(domainOf(u)))) return "link_inline";
  return "none";
}

export function offerOf(text: string, artefact: string): string {
  const t = lc(text);
  if (/\b(free|open[- ]source|mit licen[cs]ed?|no signup|no card)\b/.test(t) || artefact === "oss_repo") return "yes";
  if (/\b(credits|trial|\$\d|pricing|per (call|month)|plans?)\b/.test(t)) return "freemium";
  return "no";
}

export function toneOf(text: string, hook: string): string {
  const t = lc(text);
  if (/(😂|🤣|\blol\b|\blmao\b)/.test(t)) return "humour";
  if (/(🔥|🚀|🤯|!!|\binsane\b|\bcrazy\b|\bwild\b|\bgame[- ]?changer\b|\bdangerous\b|\bf\*?ck)/.test(t)) return "hype";
  if (/\b(unpopular opinion|hot take|nobody talks about|is dead|is over)\b/.test(t)) return "contrarian";
  if (hook === "how_to") return "educational";
  if (/^(i|we|today i|just)\b/.test(t.trim())) return "casual_founder";
  return "plain_technical";
}

function partnersOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:powered by|with|partnered with|built with|in partnership with|x)\s+@(\w{1,15})/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

function mentionsOf(text: string): string[] {
  return [...new Set((text.match(/@(\w{1,15})/g) ?? []).map((m) => m.slice(1).toLowerCase()))];
}

export function kindOf(p: XPost, handle: string, selfThreadHeads: Set<string>): Kind {
  const me = handle.toLowerCase();
  if (p.retweetOf || /^RT @\w{1,15}:/.test(p.text)) return "retweet";
  if (p.inReplyToUser && p.inReplyToUser.toLowerCase() === me) {
    const outside = urlsIn(p.text).filter((u) => !isXLink(domainOf(u)));
    const words = p.text.replace(URL_RE, "").trim();
    if (outside.length > 0 && (words.length <= 140 || /\b(link|repo|here|below|try it)\b/i.test(words))) return "self_reply_link";
    return "thread_part";
  }
  if (p.inReplyToUser) return "reply_other";
  if (p.quoted) return "quote";
  if (selfThreadHeads.has(p.id)) return "thread_head";
  return "original";
}

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Codebook outlier_x: the engine's break-out multiple (src/engine/breakout.ts). Views over
 * the median of the account's 20 previous comparable posts: originals and thread heads
 * only, videos with videos and the rest with the rest, the post itself left out; blank
 * under 8 such posts. Peers under 48 hours older than the newest post read are left out
 * (their views are still moving), which keeps a re-render of a kept run identical.
 */
export function outlierX(coded: CodedPost[]): Map<string, number> {
  const rows: Row[] = coded.map((c) => ({
    platform: "x",
    id: c.post_id,
    url: null,
    author: c.account ?? "",
    authorFollowers: null,
    authorUrl: null,
    channelId: null,
    community: null,
    text: "",
    publishedAt: c.created_utc,
    views: c.views,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    durationSeconds: c.video_seconds ?? null,
    video: c.format === "video",
    pinned: false,
    kind: c.kind === "original" || c.kind === "thread_head" ? "original" : "reply",
    requestId: null,
  }));
  const newest = rows.reduce((m, r) => Math.max(m, Date.parse(r.publishedAt ?? "") || 0), 0);
  const out = new Map<string, number>();
  for (const b of breakouts(rows, { now: new Date(newest), mode: "previous" })) if (b.multiple !== null) out.set(b.id, b.multiple);
  return out;
}

/** Code every post of one account. Rows of other authors (retweets are kept as the account's own row) are dropped. */
export function codePosts(posts: XPost[], handle: string): CodedPost[] {
  const me = handle.toLowerCase();
  const ownIds = new Set(posts.filter((p) => p.author.toLowerCase() === me).map((p) => p.id));
  // Search rows carry in_reply_to_id but often no in_reply_to_username. Work the parent out:
  // one of the account's own posts (or its own thread) means a self-reply; a leading @name
  // means a reply to that account; otherwise it is a reply to someone unknown.
  const own = posts
    .filter((p) => p.author.toLowerCase() === me)
    .map((p): XPost => {
      if (!p.inReplyToId || p.inReplyToUser) return p;
      // The parent's author decides when the parent is known (one of the account's own posts).
      if (ownIds.has(p.inReplyToId)) return { ...p, inReplyToUser: handle };
      // Parent unknown: X writes a leading @name when the reply is addressed to another account,
      // so such a reply is to someone else even under the account's own thread. Only a reply with
      // no leading @ falls back to the author of the conversation root (codebase-3c's rule, 26/11/2026).
      const lead = p.text.match(/^@(\w{1,15})\b/)?.[1];
      if (lead && lead.toLowerCase() !== me) return { ...p, inReplyToUser: lead };
      const self = p.conversationId !== null && ownIds.has(p.conversationId);
      return { ...p, inReplyToUser: self ? handle : "(unknown)" };
    });
  const byId = new Map<string, XPost>();
  for (const p of own) byId.set(p.id, p);
  // A thread head is an original that the account continues with a self-reply
  // that is more than a link carrier (codebook: thread_part).
  const heads = new Set<string>();
  for (const p of own) {
    if (p.conversationId && p.conversationId !== p.id && byId.has(p.conversationId) && kindOf(p, handle, heads) === "thread_part") heads.add(p.conversationId);
  }
  const coded = [...byId.values()].map((p): CodedPost => {
    const links = urlsIn(p.text);
    const kind = kindOf(p, handle, heads);
    const format = formatOf(p, links);
    const hook = hookOf(p.text);
    const { artefact, name } = artefactOf(p.text, links);
    const cta = ctaOf(p.text, links);
    const d = new Date(p.createdUtc);
    return {
      account: me,
      post_id: p.id,
      url: p.url,
      created_utc: d.toISOString(),
      weekday_utc: WEEKDAYS[d.getUTCDay()],
      hour_utc: d.getUTCHours(),
      kind,
      quote_unseen: (kind === "original" || kind === "thread_head") && format === "text" && !p.quotedRead,
      quoted_author: p.quoted?.author ?? "",
      quoted_id: p.quoted?.id ?? "",
      format,
      video_seconds: format === "video" ? p.videoSeconds : null,
      text: p.text,
      chars: [...p.text].length,
      hook,
      body_shape: bodyShapeOf(p.text, kind),
      artefact,
      artefact_name: name,
      offer_free: offerOf(p.text, artefact),
      cta,
      gated: ["comment_to_get", "rt_to_get", "follow_to_get"].includes(cta) ? "yes" : "no",
      partner_tag: partnersOf(p.text).join(";") || "none",
      mentions: mentionsOf(p.text).join(";"),
      links: [...new Set([...links, ...(p.articleUrl ? [p.articleUrl] : [])].map(domainOf).filter(Boolean))].join(";"),
      views: p.views,
      likes: p.likes,
      reposts: p.reposts,
      replies: p.replies,
      quotes: p.quotes,
      bookmarks: p.bookmarks,
      bookmark_per_like: ratio(p.bookmarks, p.likes),
      repost_per_like: ratio(p.reposts, p.likes),
      reply_per_like: ratio(p.replies, p.likes),
      outlier_x: null,
      launch_id: "",
      topic_tags: "",
      tone: toneOf(p.text, hook),
      reply_sample_read: "no",
      transcript_read: "no",
      request_no: p.requestId,
      conversation_id: p.conversationId,
    };
  });
  const ox = outlierX(coded);
  for (const c of coded) c.outlier_x = ox.get(c.post_id) ?? null;
  return coded.sort((a, b) => a.created_utc.localeCompare(b.created_utc));
}

export const CSV_COLUMNS: (keyof CodedPost)[] = [
  "account", "post_id", "url", "created_utc", "weekday_utc", "hour_utc", "kind", "quote_unseen", "quoted_author", "quoted_id", "format", "video_seconds",
  "text", "chars", "hook", "body_shape", "artefact", "artefact_name", "offer_free", "cta", "gated", "partner_tag", "mentions",
  "links", "views", "likes", "reposts", "replies", "quotes", "bookmarks", "bookmark_per_like", "repost_per_like",
  "reply_per_like", "outlier_x", "launch_id", "topic_tags", "tone", "reply_sample_read", "transcript_read", "request_no",
];

export function toCsv(rows: CodedPost[], readUtc: string): string {
  const cell = (v: unknown) => {
    // Newlines in any form (\r\n, \n, a bare \r, and the Unicode line and paragraph separators) become a
    // literal "\n", so every post is one CSV line.
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v.replace(/\r\n|[\r\n\u2028\u2029\u0085]/g, "\\n") : String(v);
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [...CSV_COLUMNS, "read_utc"].join(",");
  return [head, ...rows.map((r) => [...CSV_COLUMNS.map((k) => cell(r[k])), cell(readUtc)].join(","))].join("\n") + "\n";
}
