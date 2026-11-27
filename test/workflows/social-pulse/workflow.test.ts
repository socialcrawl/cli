// /social-pulse against a fake API: the order of calls, max_credits from the free quote, the
// week before skipped when it no longer fits, a break-out measured, and a whole run through
// the harness checked with the engine's validator.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { EvidenceJson } from "../../../src/engine/evidence.ts";
import { ENGINE_SECTIONS } from "../../../src/engine/outputs.ts";
import { validateReport } from "../../../src/engine/validate.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { EXIT, runWorkflow } from "../../../src/run.ts";
import { workflow } from "../../../src/workflows/social-pulse/index.ts";
import { discoverBody, dryRunBody, item, summary } from "./fake.ts";

const NOW = new Date("2026-11-27T10:00:00Z");
const THIS = { since: "2026-11-21", until: "2026-11-27" };

const thisWeek = [
  item({ platform: "tiktok", id: "t1", author: "bigtok", followers: 50_000, views: 60_000, likes: 4_000, publishedAt: "2026-11-25T10:00:00.000Z", stance: "positive" }),
  item({ platform: "twitter", id: "x1", author: "smallx", followers: 800, views: 20_000, likes: 90, publishedAt: "2026-11-24T10:00:00.000Z", intent: "question", stance: "uncertain", text: "Does Acme Notes sync offline? Asking before I switch" }),
  item({ platform: "reddit", id: "r1", author: "redditor1", views: null, likes: 450, publishedAt: "2026-11-23T10:00:00.000Z", intent: "question", text: "Which notes app handles 10k pages without lag?" }),
  item({ platform: "youtube", id: "y1", author: "ytchan", followers: null, views: 15_000, likes: 500, publishedAt: "2026-11-22T10:00:00.000Z", intent: "complaint", stance: "negative" }),
];
const before = [item({ platform: "tiktok", id: "t0", author: "bigtok", followers: 50_000, views: 900, publishedAt: "2026-11-16T10:00:00.000Z" })];
const SUMMARY_THIS = summary({ collected: 180, kept: 40, positive: 20, negative: 5, neutral: 10, question: 4, complaint: 2, recommendation: 3, switching: 1, byPlatform: { tiktok: 12, twitter: 10, reddit: 8, youtube: 10 } });
const SUMMARY_BEFORE = summary({ collected: 170, kept: 25, positive: 10, negative: 8, neutral: 5, question: 1, complaint: 1, byPlatform: { tiktok: 9, twitter: 8, reddit: 8 } });

/** Twelve earlier TikTok videos by `handle` at 1,000 views each, all before the candidate. */
function tiktokPage(handle: string): ApiBody {
  const items = Array.from({ length: 12 }, (_, i) => ({
    post: { id: `old${i}`, author: { username: handle }, published_at: new Date(Date.parse("2026-11-20T10:00:00Z") - i * 86_400_000).toISOString(), engagement: { views: 1_000, likes: 50 }, content: { text: "earlier video" } },
  }));
  return { success: true, data: { items }, credits_used: 1, request_id: `req-base-${handle}` };
}

function pulseApi(o: { minMax?: number; beforeMinMax?: number; balance?: number } = {}) {
  const calls: { path: string; params: Params }[] = [];
  return {
    calls,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      calls.push({ path: p, params });
      const isThis = params.since === THIS.since;
      if (p === "prism/discover") {
        if (params.dry_run === "true") return dryRunBody(isThis ? (o.minMax ?? 52) : (o.beforeMinMax ?? o.minMax ?? 52));
        return isThis ? discoverBody(thisWeek, SUMMARY_THIS, 28, "req-this-week") : discoverBody(before, SUMMARY_BEFORE, 24, "req-week-before");
      }
      if (p === "tiktok/profile/videos") return tiktokPage(String(params.handle));
      throw new ApiError(404, { success: false, error: { type: "NOT_FOUND", message: `no answer for ${p}` }, request_id: `req-nf${calls.length}` });
    },
    async balance(): Promise<ApiBody> {
      return { success: true, data: { balance: o.balance ?? 500 }, credits_used: 0, request_id: "req-balance" };
    },
  };
}

async function runOnce(api = pulseApi(), opts: { budget?: number } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sc-pulse-"));
  const out: string[] = [];
  const err: string[] = [];
  const code = await runWorkflow({
    workflow,
    args: { input: "Acme Notes", flags: {}, deep: false, now: NOW },
    opts: { plan: false, yes: false, open: false, json: false, noCache: false, ...opts },
    kit: api,
    cwd,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  const dir = path.join(cwd, "socialcrawl-runs", "social-pulse-acme-notes-2026-11-27");
  return { code, out, err, api, read: (f: string) => readFileSync(path.join(dir, f), "utf8") };
}

describe("social-pulse: the calls", () => {
  it("quotes each week for free, then reads it with the least max_credits the quote allows", async () => {
    const r = await runOnce(pulseApi({ minMax: 52 }));
    assert.equal(r.code, EXIT.ok, r.err.join("\n"));
    const discover = r.api.calls.filter((c) => c.path === "prism/discover");
    assert.deepEqual(discover.map((c) => [c.params.since, c.params.dry_run ?? null, c.params.max_credits ?? null]), [
      ["2026-11-21", "true", null],
      ["2026-11-21", null, 52],
      ["2026-11-14", "true", null],
      ["2026-11-14", null, 52],
    ]);
    for (const c of discover) assert.equal(c.params.label, "stance,intent");
  });

  it("skips the week before when its quote no longer fits, and says so", async () => {
    const r = await runOnce(pulseApi({ minMax: 52, beforeMinMax: 90 }));
    assert.equal(r.code, EXIT.ok, r.err.join("\n"));
    assert.equal(r.api.calls.filter((c) => c.path === "prism/discover" && c.params.since === "2026-11-14" && !c.params.dry_run).length, 0);
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    assert.ok(ev.unverified.some((u) => /week before/.test(u.what) && /90 credits/.test(u.why)), JSON.stringify(ev.unverified));
  });

  it("reads each break-out candidate's earlier posts, never topic-filtered", async () => {
    const r = await runOnce();
    const base = r.api.calls.filter((c) => c.path === "tiktok/profile/videos");
    assert.ok(base.length > 0);
    for (const c of base) assert.equal(c.params.relevant_to, undefined);
  });
});

describe("social-pulse: a whole run", () => {
  it("writes a report the engine's validator passes", async () => {
    const r = await runOnce();
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    const v = validateReport(r.read("report.md"), ev, {
      requiredSections: ["In short", "Week on week", "By platform", "What people asked", "Posts breaking out", "What won't copy", "Next", ...ENGINE_SECTIONS],
      summarySection: "In short",
      engineSections: ENGINE_SECTIONS,
      allowNumbers: [1.5, 3, 7, 8, 10_000],
    });
    assert.deepEqual(v.problems, []);
  });

  it("compares this week with the week before: posts, sentiment and questions", async () => {
    const md = (await runOnce()).read("report.md");
    assert.match(md, /40 on-topic posts this week, up 60% on 25 the week before/);
    assert.match(md, /57% positive and 14% negative/);
    assert.match(md, /4 questions/);
    assert.ok(md.includes("| Selling something | 0 | 0 |"), md);
  });

  it("measures a break-out against its author's earlier posts and names an account over 10,000 followers", async () => {
    const md = (await runOnce()).read("report.md");
    assert.match(md, /@bigtok/);
    assert.match(md, /60x/);
  });

  it("quotes what people asked, and never names an account under 10,000 followers", async () => {
    const r = await runOnce();
    const shown = r.read("report.md") + r.read("card.svg");
    assert.ok(shown.includes("Does Acme Notes sync offline?"));
    assert.ok(!/@smallx\b/.test(shown));
    assert.ok(!/@redditor1\b/.test(shown));
  });

  it("keeps every post read as CSV, and stays inside 100 credits", async () => {
    const r = await runOnce();
    assert.equal(r.read("data/posts_this_week.csv").trim().split("\n").length - 1, 4);
    assert.equal(r.read("data/posts_week_before.csv").trim().split("\n").length - 1, 1);
    assert.ok(JSON.parse(r.read("run.json")).credits <= 100);
  });

  it("answers in 12 lines or fewer", async () => {
    const r = await runOnce();
    assert.ok(r.out.length <= 12, r.out.join("\n"));
    assert.match(r.out[0], /Acme Notes/);
  });

  it("quotes a default run inside 100 credits", async () => {
    const q = await workflow.quote({ input: "Acme Notes", flags: {}, deep: false, now: NOW });
    assert.ok(q.max <= 100);
    assert.ok(q.lines.some((l) => l.includes("21/11/2026 to 27/11/2026")));
  });
});
