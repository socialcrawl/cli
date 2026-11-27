// /social-viral as the CLI runs it: the quote, who may be named, and a whole run through the
// harness against the recorded API of study file 18, checked with the engine's validator.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ENGINE_SECTIONS } from "../../../src/engine/outputs.ts";
import { rowsOf } from "../../../src/engine/rows.ts";
import type { EvidenceJson } from "../../../src/engine/evidence.ts";
import { validateReport } from "../../../src/engine/validate.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { EXIT, runWorkflow } from "../../../src/run.ts";
import { NAME_FLOOR, followersOf, whoOf, workflow } from "../../../src/workflows/social-viral/index.ts";
import { RUN_AT, records, row } from "../../engine/helpers.ts";

const ARGS = { input: "AI coding tools", flags: { about: "AI coding tools and AI coding assistants for software developers" }, deep: false, since: "2026-11-19", until: "2026-11-26", now: RUN_AT };

function recordedApi() {
  const calls: { path: string; params: Params }[] = [];
  const ID_KEYS = ["handle", "channelId", "subreddit", "url", "query", "date_posted", "uploadDate"];
  return {
    calls,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      calls.push({ path: p, params });
      const hit = records.find((r) => r.endpoint === p && ID_KEYS.every((k) => params[k] === undefined || r.params[k] === undefined || String(r.params[k]) === String(params[k])));
      if (!hit) throw new ApiError(404, { success: false, error: { type: "NOT_FOUND", message: `no recorded response for ${p}` }, request_id: `req-nf${calls.length}` });
      return { ...(hit.body as ApiBody), request_id: hit.requestId ?? hit.study_req };
    },
    async balance(): Promise<ApiBody> {
      return { success: true, data: { balance: 500 }, credits_used: 0, request_id: "req-balance" };
    },
  };
}

async function runOnce() {
  const cwd = mkdtempSync(path.join(tmpdir(), "sc-viral-run-"));
  const out: string[] = [];
  const err: string[] = [];
  const api = recordedApi();
  const code = await runWorkflow({ workflow, args: ARGS, opts: { plan: false, yes: false, open: false, json: false, noCache: false }, kit: api, cwd, out: (l) => out.push(l), err: (l) => err.push(l) });
  const dir = path.join(cwd, "socialcrawl-runs", "social-viral-ai-coding-tools-2026-11-26");
  const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
  return { code, out, err, api, dir, read };
}

describe("social-viral: the workflow", () => {
  it("is named for the command and takes a window", () => {
    assert.equal(workflow.name, "social-viral");
    assert.equal(workflow.takesWindow, true);
    assert.ok(workflow.defaultBudget <= 100);
  });

  it("quotes a default run inside the 100 welcome credits, and a deep run above it", async () => {
    const q = await workflow.quote(ARGS);
    assert.ok(q.expected > 0 && q.expected <= q.max);
    assert.ok(q.max <= 100, `max ${q.max}`);
    const deep = await workflow.quote({ ...ARGS, deep: true });
    assert.ok(deep.max > q.max);
    assert.ok(deep.max <= workflow.deepBudget);
  });

  it("defaults the window to the 7 days before today", async () => {
    const q = await workflow.quote({ ...ARGS, since: undefined, until: undefined });
    assert.ok(q.lines.some((l) => l.includes("19/11/2026 to 26/11/2026")), q.lines.join("\n"));
  });
});

describe("whoOf: who a report may name", () => {
  it("names an account of 10,000 followers or more", () => {
    assert.equal(NAME_FLOOR, 10_000);
    assert.equal(whoOf(row({ author: "bigco", authorFollowers: 25_000 })), "@bigco");
  });
  it("describes a smaller account instead", () => {
    assert.equal(whoOf(row({ author: "someone", authorFollowers: 2_300 })), "an account with 2,300 followers");
    assert.equal(whoOf(row({ author: "someone", authorFollowers: null })), "an account of unknown size");
  });
  it("uses a follower count read elsewhere in the run when the row has none", () => {
    assert.equal(whoOf(row({ author: "bigco", authorFollowers: null }), 25_000), "@bigco");
    assert.equal(whoOf(row({ author: "someone", authorFollowers: null }), 900), "an account with 900 followers");
  });

  it("reads the largest follower count of each author across every response", () => {
    const m = followersOf([
      { endpoint: "tiktok/search", requestId: "r1", body: { data: { items: [{ post: { id: "1", author: { username: "acme" }, ext: { author_followers: 12_000 } } }] } } },
      { endpoint: "tiktok/profile/videos", requestId: "r2", body: { data: { items: [{ post: { id: "2", author: { username: "acme" }, ext: { author_followers: 15_000 } } }] } } },
    ]);
    assert.equal(m.get("tiktok:acme"), 15_000);
  });

  it("names the community of a Reddit post, not its poster", () => {
    assert.equal(whoOf(row({ platform: "reddit", author: "someone", authorFollowers: null, community: "programming" })), "a post in r/programming");
  });
});

describe("social-viral: a whole run on the recorded responses", () => {
  it("exits 0 and writes every file", async () => {
    const r = await runOnce();
    assert.equal(r.code, EXIT.ok, r.err.join("\n"));
    for (const f of ["report.html", "report.md", "card.svg", "evidence.json", "run.json", "responses.jsonl", "data/posts.csv", "data/search_posts.csv", "data/baseline_posts.csv"]) assert.ok(readFileSync(path.join(r.dir, f)).length > 0, f);
  });

  it("writes a report the engine's validator passes: citations resolve, numbers come from evidence, nobody accused", async () => {
    const r = await runOnce();
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    const v = validateReport(r.read("report.md"), ev, {
      requiredSections: ["In short", "The break-outs", "By platform", "What won't copy", "Next", ...ENGINE_SECTIONS],
      summarySection: "In short",
      engineSections: ENGINE_SECTIONS,
      allowNumbers: [1.5, 3, 7, 8, 14, 20, 48, 10_000],
    });
    assert.deepEqual(v.problems, []);
  });

  it("prints multiples to one decimal under 100 and whole above, and medians whole", async () => {
    const r = await runOnce();
    const md = r.read("report.md");
    assert.ok(!/\d\.\d{2}x/.test(md), "a multiple with two decimals");
    assert.ok(!/median [\d,]+\.\d/.test(md), "a median with a decimal");
  });

  it("counts only accounts known to be under 10,000 followers as small", async () => {
    const r = await runOnce();
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    const small = ev.findings[0].numbers.small_breakouts;
    const md = r.read("report.md");
    if (small) assert.ok(md.includes(`${small} of the`));
    assert.ok(!md.includes("possibly boosted") || md.includes("likely boosted"));
  });

  it("never names an account under 10,000 followers on the card or in the report", async () => {
    const r = await runOnce();
    const small = new Set<string>();
    for (const rec of records) for (const x of rowsOf(rec)) if (x.author && x.platform !== "reddit" && (x.authorFollowers ?? 0) < NAME_FLOOR) small.add(x.author);
    assert.ok(small.size > 0);
    const shown = r.read("report.md") + r.read("card.svg");
    for (const name of small) assert.ok(!new RegExp(`@${name}\\b`).test(shown), `named @${name}`);
  });

  it("keeps the raw rows: every candidate in posts.csv, every search row in search_posts.csv", async () => {
    const r = await runOnce();
    const run = JSON.parse(r.read("run.json"));
    const lines = (f: string) => r.read(f).trim().split("\n").length - 1;
    assert.ok(lines("data/posts.csv") > 0);
    assert.ok(lines("data/search_posts.csv") >= lines("data/posts.csv"));
    assert.ok(run.credits <= 100);
  });

  it("answers in the terminal in 12 lines or fewer, leading with the count", async () => {
    const r = await runOnce();
    assert.ok(r.out.length <= 12, r.out.join("\n"));
    assert.match(r.out[0], /broke out|No post broke out/);
  });
});
