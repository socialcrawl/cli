// A synthetic prism/find-accounts answer in the shape the API returned on 27/11/2026
// (req-5a15MqYTZ8lVbuHD), for a made-up brand: no real account is stored.
import type { ApiBody } from "../../../src/kit/kit.ts";

type Evidence = { website_match: boolean | null; cross_link: boolean | null; bio_consistent: boolean | null; fan_or_parody: boolean | null; domain_match: boolean | null };
const ev = (o: Partial<Evidence> = {}): Evidence & { domain: string; domain_source: string | null } => ({
  website_match: false, cross_link: false, bio_consistent: false, fan_or_parody: false, domain_match: false, domain: "acmenotes.example", domain_source: null, ...o,
});

export function platform(name: string, handle: string | null, level: string, confidence: number, evidence: Partial<Evidence>, followers: number | null, accepted: boolean) {
  const url = handle ? `https://example.invalid/${name}/${handle.replace(/^@/, "")}` : null;
  return {
    platform: name,
    status: "ok",
    candidates: handle ? [{ rank: 1, handle, display_name: "Acme Notes", url, followers, verified: null, bio_excerpt: "Notes for teams", choice_probability: confidence }] : [],
    match: { handle: level === "none" ? null : handle, level, confidence, basis: "judged", evidence: ev(evidence), match_confidence: confidence, accepted },
  };
}

export function findBody(platforms: ReturnType<typeof platform>[], requestId = "req-find"): ApiBody {
  return {
    success: true,
    data: { name: "Acme Notes", type: "company", platforms, items: [], match_confidence_floor: 0.6, notice: "Candidate accounts ranked from public search results, for human review." },
    credits_used: 21,
    request_id: requestId,
  };
}

/** The Linear probe's pattern on a made-up brand: two linked, one judged without a link, one possible, one uncertain, one none. */
export const ACME = findBody([
  platform("linkedin", "acmenotes", "same", 0.96, { cross_link: true, domain_match: true, bio_consistent: true }, null, true),
  platform("twitter", "acmenotes", "same", 0.97, { website_match: true, cross_link: true, domain_match: true, bio_consistent: true }, 120_000, true),
  platform("youtube", "@acmenotes", "same", 0.94, { bio_consistent: true }, 15_700, true),
  platform("threads", "acme_notes", "possible", 0.72, {}, null, false),
  platform("instagram", "acme______", "uncertain", 0.39, {}, 800, false),
  platform("tiktok", null, "none", 0.86, {}, null, false),
]);

/** Twelve recent posts by one account, the newest `daysAgo[0]` days before 27/11/2026. */
export function postsPage(handle: string, daysAgo: number[], views = 2_000): ApiBody {
  const items = daysAgo.map((d, i) => ({
    post: { id: `${handle}-${i}`, author: { username: handle }, published_at: new Date(Date.parse("2026-11-27T10:00:00Z") - d * 86_400_000).toISOString(), engagement: { views, likes: 40 }, content: { text: "a post" } },
  }));
  return { success: true, data: { items }, credits_used: 1, request_id: `req-posts-${handle}` };
}
