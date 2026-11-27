// Synthetic prism/discover answers in the shape the API returned on 27/11/2026 (req
// req-nedOdIgDevelrNhL), with made-up accounts and text: no real person's post is stored.
import type { ApiBody } from "../../../src/kit/kit.ts";

export interface FakeItem {
  platform: string;
  id: string;
  author: string;
  followers?: number | null;
  views?: number | null;
  likes?: number | null;
  publishedAt: string;
  intent?: string;
  stance?: string | null;
  text?: string;
  mediaType?: string;
}

export function item(f: FakeItem) {
  return {
    id: `${f.platform}:${f.id}`,
    native_id: f.id,
    platform: f.platform,
    record_type: "post",
    url: `https://example.invalid/${f.platform}/${f.id}`,
    published_at: f.publishedAt,
    in_window: true,
    text: f.text ?? `A post about Acme Notes from ${f.author}`,
    media_type: f.mediaType ?? (["tiktok", "youtube"].includes(f.platform) ? "video" : "text"),
    engagement: { likes: f.likes ?? 10, comments: 1, views: f.views ?? 1000, shares: null },
    author: { username: f.author, key: `${f.platform}:${f.author}`, verified: null, followers: f.followers ?? null, account_kind: null },
    judgments: { relevance: { p: 0.9 }, intent: { label: f.intent ?? "none", confidence: 0.8 }, stance: { label: f.stance ?? null, confidence: 0.8 } },
    provenance: { endpoint: "prism/discover", request_id: "req-row", captured_at: "2026-11-27T10:00:00Z" },
  };
}

export function summary(o: { collected: number; kept: number; positive: number; negative: number; neutral?: number; uncertain?: number; question: number; complaint?: number; recommendation?: number; switching?: number; byPlatform: Record<string, number> }) {
  const n = o.positive + o.negative + (o.neutral ?? 0) + (o.uncertain ?? 0);
  return {
    basis: "sampled_pool",
    rows: { base: "returned_rows", collected: o.collected, kept: o.kept },
    kept: { base: "kept_rows", delivered: Math.min(o.kept, 100), overflow: Math.max(0, o.kept - 100) },
    intent: { base: "kept_rows", question: o.question, complaint: o.complaint ?? 0, recommendation: o.recommendation ?? 0, switching: o.switching ?? 0, none: 0 },
    stance: { base: "kept_rows", positive: o.positive, negative: o.negative, neutral: o.neutral ?? 0, uncertain: o.uncertain ?? 0, n, too_few: n < 10 },
    by_platform: Object.fromEntries(Object.entries(o.byPlatform).map(([p, k]) => [p, { kept: { base: "kept_rows", delivered: k } }])),
  };
}

export function discoverBody(items: ReturnType<typeof item>[], s: ReturnType<typeof summary>, credits: number, requestId: string): ApiBody {
  return { success: true, data: { items, summary: s, run: { status: "completed", credits: { spent: credits } } }, credits_used: credits, request_id: requestId };
}

/** A dry run's answer: the least max_credits the server accepts for the same request. */
export function dryRunBody(minMaxCredits: number): ApiBody {
  return { success: true, data: { valid: true, estimate: { kind: "estimate", expected_min: 6, expected_max: minMaxCredits * 4, min_max_credits: minMaxCredits } }, credits_used: 0, request_id: "req-dry" };
}
