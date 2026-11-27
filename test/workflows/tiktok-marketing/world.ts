// The synthetic TikTok world the runner and report tests share. Hand-checked numbers:
// A1 is 400,000 views over a median of 10,000 (40x); B1 90,000 over 3,000 (30x, a creator
// under 10,000 followers, never named); E1 120,000 over 10,000 (12x); C1 a normal day over
// two pages; D1 under the floor.
import { history, post } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

export const TIKTOK_WORLD_NOW = new Date("2026-11-27T12:00:00Z");
export const ARGS = { input: "AI coding tools", flags: {}, deep: false, now: TIKTOK_WORLD_NOW };

export const A1 = post({ id: "A1", author: "bigco", followers: 50_000, views: 400_000, at: "2026-11-20T15:00:00Z", text: "How to ship an app with Claude in a day #ai", duration: 45, ext: { music_id: "m1", music_title: "original sound - bigco", music_is_original: true, hashtags: ["ai"] } });
export const B1 = post({ id: "B1", author: "smallone", followers: 2_000, views: 90_000, at: "2026-11-18T10:00:00Z", text: 'Comment "AGENT" and I will send the prompt', duration: 20, ext: { music_id: "m2", music_title: "Song", music_is_original: false } });
export const C1 = post({ id: "C1", author: "mid", followers: 30_000, views: 15_000, at: "2026-11-15T09:00:00Z", text: "Claude tips" });
export const D1 = post({ id: "D1", author: "tiny", followers: 500, views: 500, at: "2026-11-25T09:00:00Z" });
export const E1 = post({ id: "E1", author: "bigco", followers: 50_000, views: 120_000, at: "2026-11-10T12:00:00Z", text: "Top 5 AI coding tools" });

export const later = (author: string) => [1, 2, 3, 4, 5].map((d) => post({ id: `${author}-l${d}`, author, views: 9_000, at: `2026-11-2${d}T12:00:00Z` }));
export const vtt = "WEBVTT\n\n00:00:00.100 --> 00:00:01.580\nShip it in a day.\n\n00:00:01.581 --> 00:00:03.221\nHere is how.\n";
export const labelled = (id: string, text: string, q: number) => ({ comment: { id, post_id: "x", text, author: { username: `c${id}` }, engagement: { likes: 5 } }, computed: { labels: { question: { p: q }, purchase_intent: { p: 0.1 }, complaint: { p: 0.1 }, sentiment: { level: 4 } } } });

export function world(over: Route[] = []): Route[] {
  return [
    ...over,
    { endpoint: "tiktok/search", when: (p) => p.sort_by === undefined, data: { items: [A1, B1, C1, D1], relevance: { mode: "filter", rows: 6, kept: 4, dropped: 2 } } },
    { endpoint: "tiktok/search", when: (p) => p.sort_by === "most-liked", data: { items: [A1, E1], relevance: { mode: "filter", rows: 2, kept: 2, dropped: 0 } } },
    { endpoint: "tiktok/profile/videos", when: (p) => p.handle === "bigco", data: { items: [...later("bigco"), ...history("bigco", 20, 10_000, "2026-11-10T00:00:00Z")] } },
    { endpoint: "tiktok/profile/videos", when: (p) => p.handle === "smallone", data: { items: history("smallone", 12, 3_000, "2026-11-18T00:00:00Z") } },
    { endpoint: "tiktok/profile/videos", when: (p) => p.handle === "mid" && p.cursor === undefined, data: { items: history("mid", 5, 14_000, "2026-11-15T00:00:00Z"), $pagination: { has_more: true, next_cursor: "k2" } } },
    { endpoint: "tiktok/profile/videos", when: (p) => p.handle === "mid" && p.cursor === "k2", data: { items: history("mid", 10, 14_000, "2026-11-15T00:00:00Z").slice(5) } },
    { endpoint: "tiktok/post/comments", data: { items: [labelled("1", "Does it work on Windows?", 0.9), labelled("2", "great", 0.1)], labels: { status: "complete", labelled: 2 } } },
    { endpoint: "tiktok/post/transcript", data: { id: "A1", transcript: vtt } },
  ];
}

