// The whole workflow through the harness's contract: quote() spends nothing, run() reads
// every account inside one budget against a fake API, and what it returns passes the
// engine's report gate. No key, no network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget, RATES } from "../../../src/engine/rates.ts";
import { renderReport } from "../../../src/engine/outputs.ts";
import { validateReport } from "../../../src/engine/validate.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import type { CallRecord } from "../../../src/kit/record.ts";
import { Session } from "../../../src/kit/record.ts";
import type { WorkflowArgs } from "../../../src/workflows/types.ts";
import { workflow, lastValidation } from "../../../src/workflows/social-teardown/index.ts";
import { fixturePath } from "../../fixture-path.ts";

const x: CallRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "reatools-records.json"), "utf8"));
const other: CallRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "notion-records.json"), "utf8"));

function fakeKit(sent: { endpoint: string; params: Params }[]) {
  let seq = 0;
  return {
    async call(endpoint: string, params: Params = {}): Promise<ApiBody> {
      sent.push({ endpoint, params });
      seq++;
      const pick = endpoint.startsWith("twitter/") ? x.find((r) => r.endpoint === endpoint || (endpoint === "twitter/search/tweets" && r.endpoint === "twitter/user/tweets" && /^from:/.test(String(params.query)))) : other.find((r) => r.endpoint === endpoint);
      if (!pick || pick.status !== 200) throw new ApiError(404, { success: false, request_id: `req-err${seq}`, error: { type: "RESOURCE_NOT_FOUND", message: "not found" } } as ApiBody);
      const rate = RATES[endpoint];
      const worst = rate.walks ? Math.min(Number(params.max_credits), Number(params.max_pages) * (rate.page + (params.relevant_to ? rate.topicHold ?? 0 : 0))) : rate.page;
      return { success: true, credits_used: worst, request_id: `req-run${seq}`, data: pick.body.data } as ApiBody;
    },
  };
}

const NOW = new Date("2026-11-27T00:00:00Z");
const args = (input: string, deep = false): WorkflowArgs => ({ input, flags: {}, deep, now: NOW });
function session(total: number, sent: { endpoint: string; params: Params }[]) {
  return new Session({ dir: mkdtempSync(path.join(tmpdir(), "sc-run-")), kit: fakeKit(sent), budget: new Budget(total), skill: "social-teardown", version: "0.1.0", now: () => NOW });
}

describe("the social-teardown workflow", () => {
  it("states its contract: a name, a default run inside the welcome credits, a deep run that costs more", () => {
    assert.equal(workflow.name, "social-teardown");
    assert.ok(workflow.defaultBudget <= 100);
    assert.ok(workflow.deepBudget > workflow.defaultBudget);
    assert.ok(workflow.examples.length >= 2);
  });

  it("quotes for free, with one line per account", async () => {
    const q = await workflow.quote(args("@reatools tiktok:notionhq"));
    assert.ok(q.max <= workflow.defaultBudget);
    assert.ok(q.expected > 0 && q.expected <= q.max);
    assert.equal(q.lines.filter((l) => /@reatools|notionhq/.test(l)).length, 2);
  });

  it("expects what a default run spends: the live @treg_ai run spent 83 of 100", async () => {
    const q = await workflow.quote(args("@treg_ai"));
    assert.ok(q.expected >= 60 && q.expected <= 100, `expected ${q.expected}`);
  });

  it("says how long a run takes, as measured: about 4 minutes by default, about 20 with --deep", async () => {
    const d = await workflow.quote(args("@notionhq"));
    const deep = await workflow.quote(args("@notionhq", true));
    // The note prints after the price on every run; lines print only with --plan.
    assert.match(d.note ?? "", /about 4 to 5 minutes/);
    assert.match(deep.note ?? "", /about 20 minutes/);
    assert.ok(deep.expected >= 400 && deep.expected <= 520, `deep expected ${deep.expected}; measured 438`);
  });

  it("refuses input it cannot read before spending anything", async () => {
    await assert.rejects(async () => workflow.quote(args("myspace:tom")), /platform/);
  });

  it("reads one X account inside 100 credits, and its report passes the gate", async () => {
    const sent: { endpoint: string; params: Params }[] = [];
    const s = session(100, sent);
    const res = await workflow.run(s, args("@reatools"));
    assert.ok(s.budget.spent <= 100, `spent ${s.budget.spent}`);
    for (const c of sent) if (RATES[c.endpoint]?.walks) assert.equal(typeof c.params.max_pages, "number");
    assert.ok(res.tables.posts.rows.length > 0);
    assert.deepEqual(lastValidation()?.problems ?? [], []);
    assert.match(renderReport(res.report), /## Who carried the top posts/);
  });

  it("splits one budget across several handles of one brand", async () => {
    const sent: { endpoint: string; params: Params }[] = [];
    const s = session(100, sent);
    const res = await workflow.run(s, args("@reatools tiktok:notionhq"));
    assert.ok(s.budget.spent <= 100);
    assert.ok(sent.some((c) => c.endpoint.startsWith("twitter/")) && sent.some((c) => c.endpoint.startsWith("tiktok/")));
    assert.ok(res.report.sections.some((sec) => sec.title === "Across the accounts"));
    const v = validateReport(renderReport(res.report), res.report.evidence.toJSON(res.report.meta), lastValidation()!.options);
    assert.deepEqual(v.problems, []);
  });

  it("keeps an API error as a line in What we could not verify", async () => {
    const s = session(100, []);
    const res = await workflow.run(s, args("tiktok:notionhq"));
    assert.match(renderReport(res.report), /404/);
  });

  it("hands what one account left unspent to the next", async () => {
    const sent: { endpoint: string; params: Params }[] = [];
    const s = session(100, sent);
    await workflow.run(s, args("threads:notionhq @reatools"));
    // Threads spends a few of its 50; X's timeline share is then 42% of about 97, not of 50.
    const xTimeline = s.records.filter((r) => r.stage === "timeline" && r.endpoint.startsWith("twitter/")).reduce((t, r) => t + r.creditsUsed, 0);
    assert.ok(xTimeline > 30, `X's timeline spent ${xTimeline}`);
  });
});
