// A small run with hand-checked numbers, for the render tests.
import { Evidence } from "../../src/engine/evidence.ts";
import type { Meta } from "../../src/engine/rates.ts";
import type { CallRecord } from "../../src/kit/record.ts";
import type { RunOutput } from "../../src/render/types.ts";

export const META: Meta = { skill: "social-viral", version: "0.1.0", credits: 59, calls: 31, seconds: 84.2, date: "27/11/2026", generated_at: "2026-11-27T10:00:00.000Z" };

export function sampleRecords(): CallRecord[] {
  return [1, 2].map((i) => ({
    seq: i,
    stage: i === 1 ? "search:x" : "baseline:x",
    endpoint: i === 1 ? "twitter/search/tweets" : "twitter/user/tweets",
    params: { query: "ai coding tools", max_pages: 1, max_credits: 5 },
    status: 200,
    requestId: `req-${i}`,
    walkRequestIds: [],
    creditsUsed: i,
    at: "2026-11-27T10:00:00.000Z",
    body: { success: true, data: { items: [] }, credits_used: i, request_id: `req-${i}` },
  }));
}

export function sampleRun(): RunOutput {
  const evidence = new Evidence();
  evidence.seeRequests(["req-1", "req-2"]);
  evidence.add({ claim: "A post by Acme reached 41x its author's usual views", confidence: "seen", numbers: { multiple: 41 }, requests: ["req-1", "req-2"] });
  evidence.add({ claim: "TikTok led with 3 of the top 5", confidence: "inferred", numbers: { count: 3 }, requests: ["req-1"] });
  evidence.unknown({ what: "LinkedIn views", why: "LinkedIn gives no view count" });
  return {
    card: {
      command: '/social-viral "AI coding tools"',
      skill: "social-viral",
      headlines: ["Acme's post reached 41x its usual views", "TikTok led with 3 of the top 5 break-outs"],
      basis: "534 posts read on 6 platforms",
      meta: META,
      rerun: 'socialcrawl social-viral "AI coding tools"',
    },
    report: {
      command: '/social-viral "AI coding tools"',
      skill: "social-viral",
      badge: "6 platforms · 20/11/2026 to 27/11/2026 · 534 posts read · v0.1.0",
      summary: ["Acme's post reached 41x its usual views [F1]", "TikTok led with 3 of the top 5 [F2]"],
      sections: [
        { title: "The break-outs", body: "| Post | Multiple |\n| --- | --- |\n| Acme | 41x |\n| Globex | 12x |\n\nRead the **top** one first." },
      ],
      evidence,
      meta: META,
      methodNotes: ["A break-out is a post's views over the median of its author's 20 earlier posts."],
    },
    tiles: [
      { label: "Posts read", value: "534", finding: "F1" },
      { label: "Credits", value: "59" },
    ],
    charts: [{ title: "Break-out multiple", unit: "x", bars: [{ label: "Acme <b>", value: 41, finding: "F1" }, { label: "Globex", value: 12 }] }],
    tables: {
      posts: { columns: ["platform", "author", "multiple"], rows: [{ platform: "x", author: "acme", multiple: 41 }, { platform: "tiktok", author: "globex", multiple: 12 }] },
    },
    records: sampleRecords(),
    run: {
      workflow: "social-viral",
      version: "0.1.0",
      inputs: { topic: "AI coding tools" },
      stages: [{ name: "search", calls: 1, credits: 1 }, { name: "baseline", calls: 1, credits: 2 }],
      credits: 59,
      calls: 31,
      seconds: 84.2,
      startedAt: "2026-11-27T09:58:36.000Z",
      notRead: [{ stage: "baseline:linkedin", endpoint: "linkedin/profile/posts", reason: "budget" }],
      errors: [],
    },
  };
}
