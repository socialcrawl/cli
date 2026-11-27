// /linkedin-marketing, pure parts. LinkedIn is thin: no view counts (posts are compared on
// likes), no labels on comments, and a company's own posts need a numeric id the post search
// does not give (study file 26, SR-38 and SR-39). Each gap is said in the report.
import type { Row } from "../../engine/rows.ts";

/** The least likes a post needs to be measured. One week's search tops out near 40 likes (27/11/2026). */
export const LI_FLOOR = 20;

export const isCompany = (r: Row) => /\/company\//.test(r.authorUrl ?? "");

export interface AuthorCount {
  author: string;
  company: boolean;
  posts: number;
  likes: number;
  followers: number | null;
  url: string | null;
}

/** Posts and likes by author, most posts first. */
export function authorsOf(rows: Row[]): AuthorCount[] {
  const by = new Map<string, AuthorCount>();
  for (const r of rows) {
    if (!r.author) continue;
    const a = by.get(r.author) ?? { author: r.author, company: isCompany(r), posts: 0, likes: 0, followers: r.authorFollowers, url: r.authorUrl };
    a.posts++;
    a.likes += r.likes ?? 0;
    a.followers = a.followers ?? r.authorFollowers;
    by.set(r.author, a);
  }
  return [...by.values()].sort((a, b) => b.posts - a.posts || b.likes - a.likes);
}

/** LinkedIn comments carry no labels, so a question is a comment phrased as one. */
export const isQuestion = (text: string) => /\?(\s|$)/.test(text.trim());

/** The first sentence of a comment that ends in a question mark, so a long comment quotes its question. */
export function questionOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const q = flat.match(/[^.!?]*\?/);
  const sentence = (q ? q[0] : flat).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}

/** Members' original posts in the window, at or above the floor. Company posts cannot be measured. */
export function candidatesOf(rows: Row[], since: string, until: string): { people: Row[]; companies: Row[] } {
  const inWindow = rows.filter((r) => {
    const d = (r.publishedAt ?? "").slice(0, 10);
    return r.kind === "original" && d >= since && d <= until && (r.likes ?? 0) >= LI_FLOOR;
  });
  return { people: inWindow.filter((r) => !isCompany(r)), companies: inWindow.filter(isCompany) };
}
