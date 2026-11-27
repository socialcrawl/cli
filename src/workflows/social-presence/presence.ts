// /social-presence, pure parts: what makes a match confirmed, and how active an account is.
//
// prism/find-accounts ranks candidates for a name on each platform and judges the best one.
// Its acceptance is a judgment of name and bio; this workflow confirms an account only by a
// link: the official site in the account's website field, the site's domain named on the
// profile, or a link to or from the brand's other accounts. A name, a handle or a bio that
// matches is never enough (study file 26, SR-44), and a fan or parody account never is.
import { median } from "../../engine/breakout.ts";
import type { Row } from "../../engine/rows.ts";

export type Status = "confirmed" | "judged" | "possible" | "none";

export interface MatchEvidence {
  website_match?: boolean | null;
  cross_link?: boolean | null;
  bio_consistent?: boolean | null;
  fan_or_parody?: boolean | null;
  domain_match?: boolean | null;
  domain?: string | null;
}

export interface PlatformAnswer {
  platform: string;
  status?: string;
  candidates?: { handle: string; url?: string | null; followers?: number | null; verified?: boolean | null; display_name?: string | null }[];
  match?: { handle: string | null; level: string; confidence: number; evidence?: MatchEvidence; accepted?: boolean } | null;
}

export interface Verdict {
  status: Status;
  handle: string | null;
  url: string | null;
  followers: number | null;
  verified: boolean | null;
  confidence: number | null;
  /** Each piece of evidence in words, as the report prints it. */
  evidence: string[];
}

export function statusOf(p: PlatformAnswer): Verdict {
  const m = p.match;
  const handle = m?.handle ?? null;
  const cand = (p.candidates ?? []).find((c) => c.handle === handle) ?? null;
  const base = { handle, url: cand?.url ?? null, followers: cand?.followers ?? null, verified: cand?.verified ?? null, confidence: m?.confidence ?? null };
  if (!m || !handle || m.level === "none") return { status: "none", ...base, handle: null, url: null, followers: null, verified: null, evidence: [] };
  const e = m.evidence ?? {};
  const domain = e.domain ?? "the official site";
  const links = [
    e.website_match ? `links to ${domain} in its website field` : "",
    e.domain_match ? `its bio names ${domain}` : "",
    e.cross_link ? "links to or from the brand's other accounts" : "",
  ].filter(Boolean);
  if (links.length && !e.fan_or_parody && m.level !== "uncertain") return { status: "confirmed", ...base, evidence: links };
  if (e.fan_or_parody) return { status: "possible", ...base, evidence: ["judged a fan or parody account"] };
  if (m.accepted || m.level === "same") return { status: "judged", ...base, evidence: ["name and bio judged the same; no link confirms it"] };
  return { status: "possible", ...base, evidence: [`${/^[aeiou]/.test(m.level) ? "an" : "a"} ${m.level} match (${Math.round(m.confidence * 100)}%), with no link`] };
}

/** One page of an account's recent posts, or why it cannot be read. */
export function activityCall(platform: string, handle: string, url: string | null): { endpoint: string; params: Record<string, string> } | { why: string } {
  switch (platform) {
    case "twitter":
    case "x":
      return { endpoint: "twitter/user/tweets", params: { handle: handle.replace(/^@/, "") } };
    case "tiktok":
      return { endpoint: "tiktok/profile/videos", params: { handle: handle.replace(/^@/, "") } };
    case "instagram":
      return { endpoint: "instagram/profile/posts", params: { handle: handle.replace(/^@/, "") } };
    case "youtube":
      return { endpoint: "youtube/channel/videos", params: { handle } };
    case "threads":
      return { endpoint: "threads/user/posts", params: { handle: handle.replace(/^@/, "") } };
    case "linkedin":
      if (url && /\/in\//.test(url)) return { endpoint: "linkedin/profile/posts", params: { url } };
      return { why: "LinkedIn company posts need the company's numeric id, which a name search does not give" };
    default:
      return { why: `no recent-posts read for ${platform}` };
  }
}

export interface Activity {
  posts: number;
  /** YYYY-MM-DD of the newest post read. */
  lastPost: string | null;
  /** Posts in the 30 days before `now`, among those read. */
  last30: number;
  medianViews: number | null;
  medianLikes: number | null;
}

export function activityOf(rows: Row[], now: Date): Activity {
  const dated = rows.filter((r) => r.publishedAt).sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
  const views = rows.map((r) => r.views).filter((v): v is number => v !== null);
  const likes = rows.map((r) => r.likes).filter((v): v is number => v !== null);
  return {
    posts: rows.length,
    lastPost: dated[0]?.publishedAt?.slice(0, 10) ?? null,
    last30: dated.filter((r) => now.getTime() - Date.parse(r.publishedAt!) <= 30 * 86_400_000).length,
    medianViews: views.length ? median(views) : null,
    medianLikes: likes.length ? median(likes) : null,
  };
}

/** A site's host: an optional scheme and www., the domain kept, any path dropped. */
const SITE = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:\/\S*)?$/i;

/**
 * A website written into the name, as an agent may pass "Linear (linear.app)": taken out only when
 * it is in brackets, after a comma, or a link, so a name with a dot in it ("Node.js") stays whole.
 */
export function splitSite(input: string): { name: string; website?: string } {
  const text = input.trim();
  const parts =
    text.match(/^(.+?)\s*\(\s*([^()\s]+)\s*\)$/) ?? text.match(/^(.+?)\s*,\s*(\S+)$/) ?? text.match(/^(.+?)\s+((?:https?:\/\/|www\.)\S+)$/);
  const host = parts ? parts[2].match(SITE) : null;
  if (parts && host && parts[1].trim()) return { name: parts[1].trim(), website: host[1].toLowerCase() };
  return { name: text };
}
