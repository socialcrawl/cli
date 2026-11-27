// Synthetic LinkedIn answers in the shape the API returned on 27/11/2026 (reqs
// req-9GvJSpevngGFdIZN, req-He6zccP6SYCBfdhX), with made-up members, companies and text.
import type { ApiBody } from "../../../src/kit/kit.ts";

export interface FakePost {
  id: string;
  author: string;
  type?: "user" | "company";
  likes: number;
  followers?: number | null;
  date: string;
  text?: string;
}

export function post(p: FakePost) {
  const company = p.type === "company";
  return {
    post: {
      id: p.id,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${p.id}`,
      content: { text: p.text ?? `A post about AI coding tools by ${p.author}` },
      author: { username: p.author, display_name: p.author },
      engagement: { likes: p.likes, comments: 3 },
      published_at: `${p.date}T09:00:00.000Z`,
      ext: { author_type: company ? "company" : "user", author_url: company ? `https://www.linkedin.com/company/${p.author}/` : `https://www.linkedin.com/in/${p.author}/`, author_followers: p.followers ?? null },
    },
  };
}

export function searchPage(posts: FakePost[], requestId: string, hasMore = true): ApiBody {
  return { success: true, data: { items: posts.map(post), walk: { pages: 1, stopped: "max_pages", request_ids: [requestId] } }, pagination: { has_more: hasMore }, credits_used: 6, request_id: requestId };
}

/** Ten earlier posts by one member at `likes` likes each, before 20/11/2026. */
export function profilePage(author: string, likes: number): ApiBody {
  const items = Array.from({ length: 10 }, (_, i) => post({ id: `${author}-old${i}`, author, likes, date: new Date(Date.parse("2026-11-19T00:00:00Z") - i * 86_400_000).toISOString().slice(0, 10) }));
  return { success: true, data: { items }, credits_used: 5, request_id: `req-profile-${author}` };
}

export function commentsPage(texts: string[], requestId: string): ApiBody {
  const items = texts.map((t, i) => ({ comment: { id: `c${i}`, text: t, author: { username: `commenter${i}` }, engagement: { likes: 1 }, published_at: "2026-11-26T10:00:00.000Z" } }));
  return { success: true, data: { items }, credits_used: 5, request_id: requestId };
}
