// /linkedin-marketing against a fake API: the search walks its pages with max_pages, people's
// posts are measured against their earlier posts, companies are counted but not measured, the
// comments are read for questions, and a whole run passes the engine's validator.
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
import { LI_FLOOR, authorsOf, isQuestion, questionOf } from "../../../src/workflows/linkedin-marketing/linkedin.ts";
import { workflow } from "../../../src/workflows/linkedin-marketing/index.ts";
import { rowsOf } from "../../../src/engine/rows.ts";
import { commentsPage, profilePage, searchPage } from "./fake.ts";

const NOW = new Date("2026-11-27T10:00:00Z");
const POSTS = [
  { id: "1", author: "dev-lead", likes: 300, date: "2026-11-25" },
  { id: "2", author: "small-poster", likes: 12, date: "2026-11-24" },
  { id: "3", author: "acme-tools", type: "company" as const, likes: 400, date: "2026-11-23" },
  { id: "4", author: "acme-tools", type: "company" as const, likes: 90, date: "2026-11-22" },
  { id: "5", author: "big-voice", likes: 60, followers: 45_000, date: "2026-11-26" },
];

function liApi() {
  const calls: { path: string; params: Params }[] = [];
  return {
    calls,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      calls.push({ path: p, params });
      if (p === "linkedin/search/posts") return searchPage(POSTS, "req-li-search", false);
      if (p === "linkedin/profile/posts") return profilePage(String(params.url).match(/\/in\/([^/]+)/)![1], 20);
      if (p === "linkedin/post/comments") return commentsPage(["How does it handle a large repo?", "Great write-up", "Is there a free tier?"], `req-li-comments-${calls.length}`);
      throw new ApiError(404, { success: false, error: { type: "NOT_FOUND", message: `no answer for ${p}` }, request_id: `req-nf${calls.length}` });
    },
    async balance(): Promise<ApiBody> {
      return { success: true, data: { balance: 500 }, credits_used: 0, request_id: "req-balance" };
    },
  };
}

async function runOnce(api = liApi()) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sc-li-"));
  const out: string[] = [];
  const err: string[] = [];
  const code = await runWorkflow({ workflow, args: { input: "AI coding tools", flags: {}, deep: false, now: NOW }, opts: { plan: false, yes: false, open: false, json: false, noCache: false }, kit: api, cwd, out: (l) => out.push(l), err: (l) => err.push(l) });
  const dir = path.join(cwd, "socialcrawl-runs", "linkedin-marketing-ai-coding-tools-2026-11-27");
  return { code, out, err, api, read: (f: string) => readFileSync(path.join(dir, f), "utf8") };
}

describe("linkedin-marketing: pure parts", () => {
  const rows = rowsOf({ endpoint: "linkedin/search/posts", requestId: "r", body: searchPage(POSTS, "r") as never });
  it("counts posts and likes by author, companies apart from people", () => {
    const a = authorsOf(rows);
    assert.deepEqual(a[0], { author: "acme-tools", company: true, posts: 2, likes: 490, followers: null, url: "https://www.linkedin.com/company/acme-tools/" });
    assert.equal(a.find((x) => x.author === "dev-lead")!.company, false);
  });
  it("reads a comment as a question by its wording, not a label", () => {
    assert.equal(isQuestion("Is there a free tier?"), true);
    assert.equal(isQuestion("Great write-up"), false);
    assert.equal(LI_FLOOR, 20);
  });
  it("quotes the question itself from a long comment", () => {
    const long = "Any agent still needs a spec. ".repeat(12) + "No question. Can it fill in the blanks for a vague ticket? Thanks";
    assert.equal(questionOf(long), "Can it fill in the blanks for a vague ticket?");
    assert.equal(questionOf("Is there a free tier?"), "Is there a free tier?");
  });
});

describe("linkedin-marketing: the calls", () => {
  it("searches the week with the topic filter and max_pages, then measures people only, then reads comments", async () => {
    const r = await runOnce();
    assert.equal(r.code, EXIT.ok, r.err.join("\n"));
    const search = r.api.calls.find((c) => c.path === "linkedin/search/posts")!;
    assert.equal(search.params.date_posted, "past_week");
    assert.equal(search.params.relevance, "filter");
    assert.equal(search.params.max_pages, 3);
    const profiles = r.api.calls.filter((c) => c.path === "linkedin/profile/posts").map((c) => c.params.url);
    assert.ok(profiles.includes("https://www.linkedin.com/in/dev-lead/"));
    assert.ok(!profiles.some((u) => /small-poster|company/.test(String(u))), "no member under the floor, no company");
    for (const c of r.api.calls.filter((x) => x.path === "linkedin/profile/posts")) assert.equal(c.params.relevant_to, undefined);
    assert.equal(r.api.calls.filter((c) => c.path === "linkedin/post/comments").length, 2);
  });
});

describe("linkedin-marketing: a whole run", () => {
  it("writes a report the engine's validator passes", async () => {
    const r = await runOnce();
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    const v = validateReport(r.read("report.md"), ev, {
      requiredSections: ["In short", "Posts breaking out", "Who posts most", "What the comments ask", "What won't copy", "Next", ...ENGINE_SECTIONS],
      summarySection: "In short",
      engineSections: ENGINE_SECTIONS,
      allowNumbers: [1.5, 3, 8, 20, 10_000],
    });
    assert.deepEqual(v.problems, []);
  });

  it("measures a member's post against their earlier posts", async () => {
    assert.match((await runOnce()).read("report.md"), /15x their median likes over 10 earlier posts/);
  });

  it("names companies and members over 10,000 followers only, and quotes comment questions without names", async () => {
    const r = await runOnce();
    const md = r.read("report.md") + r.read("card.svg");
    assert.ok(md.includes("acme-tools"));
    assert.ok(md.includes("big-voice"));
    assert.ok(!md.includes("dev-lead"));
    assert.ok(!md.includes("commenter0"));
    assert.ok(md.includes("How does it handle a large repo?"));
  });

  it("lists companies and named members, and sums up the other members in one line", async () => {
    const md = (await runOnce()).read("report.md");
    const most = md.split("## Who posts most")[1].split("## ")[0];
    assert.ok(most.includes("| acme-tools | company | 2 | 490 |"), most);
    assert.ok(most.includes("| big-voice | member | 1 | 60 |"), most);
    assert.ok(!most.includes("| a member"), most);
    assert.match(most, /Besides the 2 authors listed above, 2 members posted 2 posts between them/);
  });

  it("says '1 of the N comments is phrased as a question' in the singular", async () => {
    const api = liApi();
    const base = api.call;
    let n = 0;
    api.call = async (p: string, params: Params = {}) => (p === "linkedin/post/comments" ? commentsPage(n++ === 0 ? ["Is it free?", "Nice"] : ["Agreed"], `req-c${n}`) : base(p, params));
    const md = (await runOnce(api)).read("report.md");
    assert.match(md, /1 of the 3 comments read is phrased as a question/);
  });

  it("calls a member with no follower count 'a member', starts each summary line with a capital, and says why members go unnamed", async () => {
    const md = (await runOnce()).read("report.md");
    const summary = md.split("## In short")[1].split("## ")[0];
    for (const line of summary.split("\n").filter((l) => /^\d+\. /.test(l))) assert.match(line, /^\d+\. [A-Z0-9]/, line);
    assert.match(summary, /A member at 15x their median likes over 10 earlier posts/);
    assert.ok(!md.includes("whose follower count was not read"));
    assert.match(md, /\(a comment on a member's post\)/);
    assert.match(md, /LinkedIn's post search gives no follower counts/);
  });

  it("says '1 LinkedIn post broke out at 3x its author's usual likes' in the singular", async () => {
    const api = liApi();
    const base = api.call;
    api.call = async (p: string, params: Params = {}) => (p === "linkedin/profile/posts" && String(params.url).includes("big-voice") ? profilePage("big-voice", 60) : base(p, params));
    const md = (await runOnce(api)).read("report.md");
    assert.match(md, /1 LinkedIn post broke out this week at 3x its author's usual likes/);
  });

  it("quotes a long comment's question, not its opening", async () => {
    const api = liApi();
    const base = api.call;
    const long = "Any agent still needs a spec. ".repeat(12) + "Can it fill in the blanks for a vague ticket?";
    api.call = async (p: string, params: Params = {}) => (p === "linkedin/post/comments" ? commentsPage([long], "req-long") : base(p, params));
    const md = (await runOnce(api)).read("report.md");
    assert.match(md, /^> Can it fill in the blanks for a vague ticket\? \(a comment on/m);
  });

  it("says plainly what LinkedIn does not give", async () => {
    const r = await runOnce();
    const ev = JSON.parse(r.read("evidence.json")) as EvidenceJson;
    const whys = ev.unverified.map((u) => `${u.what}: ${u.why}`).join("\n");
    assert.match(whys, /company/i);
    assert.match(whys, /numeric id/);
    assert.match(r.read("report.md"), /LinkedIn gives no view counts/);
    assert.match(r.read("report.md"), /no labels on LinkedIn comments/);
  });

  it("stays inside 100 credits and answers in 12 lines or fewer", async () => {
    const r = await runOnce();
    assert.ok(JSON.parse(r.read("run.json")).credits <= 100);
    assert.ok(r.out.length <= 12, r.out.join("\n"));
  });
});
