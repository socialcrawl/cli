// The stages for one account on TikTok, Instagram, YouTube, LinkedIn, Reddit or Threads,
// against a fake API that answers from recorded @notionhq calls and bills every walk the most
// it may. No key, no network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget, RATES } from "../../../src/engine/rates.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import type { CallRecord } from "../../../src/kit/record.ts";
import { Session } from "../../../src/kit/record.ts";
import { ACCOUNT_DEEP, ACCOUNT_DEFAULTS, runAccount } from "../../../src/workflows/social-teardown/account.ts";
import { parseTarget } from "../../../src/workflows/social-teardown/targets.ts";
import { Tracker } from "../../../src/workflows/social-teardown/tracker.ts";
import { fixturePath } from "../../fixture-path.ts";

const recs: CallRecord[] = JSON.parse(readFileSync(fixturePath("social-teardown", "notion-records.json"), "utf8"));

function fakeKit(sent: { endpoint: string; params: Params }[], opts: { hasMore?: boolean } = {}) {
  let seq = 0;
  return {
    async call(endpoint: string, params: Params = {}): Promise<ApiBody> {
      sent.push({ endpoint, params });
      seq++;
      const r = recs.find((x) => x.endpoint === endpoint);
      if (!r || r.status !== 200) throw new ApiError(404, { success: false, request_id: `req-err${seq}`, error: { type: "RESOURCE_NOT_FOUND", message: "not found" } } as ApiBody);
      const rate = RATES[endpoint];
      const worst = rate.walks ? Math.min(Number(params.max_credits), Number(params.max_pages) * rate.page) : rate.page;
      const data = JSON.parse(JSON.stringify(r.body.data));
      if (opts.hasMore && data.walk) data.next_cursor = `cur${seq}`;
      return { success: true, credits_used: worst, request_id: `req-fake${seq}`, data, pagination: { has_more: Boolean(opts.hasMore) } } as ApiBody;
    },
  };
}

const NOW = new Date("2026-11-27T00:00:00Z");
function setup(total: number, kitOpts = {}) {
  const sent: { endpoint: string; params: Params }[] = [];
  const t = new Tracker(new Session({ dir: mkdtempSync(path.join(tmpdir(), "sc-acct-")), kit: fakeKit(sent, kitOpts), budget: new Budget(total), skill: "social-teardown", version: "0.1.0" }));
  return { sent, t };
}

describe("one account's stages", () => {
  it("read the profile, the timeline, then comments and words on the top posts, inside 100 credits", async () => {
    const { sent, t } = setup(100);
    const out = await runAccount(t, parseTarget("tiktok:notionhq"), { ...ACCOUNT_DEFAULTS, now: NOW }, 100);
    assert.ok(t.spent <= 100, `spent ${t.spent}`);
    assert.equal(sent[0].endpoint, "tiktok/profile");
    assert.equal(sent[1].endpoint, "tiktok/profile/videos");
    for (const s of sent) if (RATES[s.endpoint].walks) assert.equal(typeof s.params.max_pages, "number", `${s.endpoint} without max_pages`);
    assert.ok(sent.some((s) => s.endpoint === "tiktok/post/comments"), "comments read");
    assert.ok(out.depth.length >= 1 && out.depth.length <= ACCOUNT_DEFAULTS.depth);
    assert.ok(out.records.every((r) => r.meta.account === "tiktok:notionhq"));
  });

  it("keep a failed transcript as an error and go on", async () => {
    const { t } = setup(100);
    const out = await runAccount(t, parseTarget("tiktok:notionhq"), { ...ACCOUNT_DEFAULTS, now: NOW }, 100);
    const tr = out.records.filter((r) => r.endpoint === "tiktok/post/transcript");
    assert.ok(tr.length >= 1 && tr.every((r) => r.status === 404));
  });

  it("ask for a LinkedIn company's posts with the id its profile answer gives", async () => {
    const { sent, t } = setup(100);
    await runAccount(t, parseTarget("https://www.linkedin.com/company/notionhq/"), { ...ACCOUNT_DEFAULTS, now: NOW }, 100);
    assert.equal(sent.find((s) => s.endpoint === "linkedin/company/posts")?.params.company_id, "30898036");
  });

  it("say what was not read when the account's budget is small", async () => {
    const { t } = setup(6);
    await runAccount(t, parseTarget("ig:notionhq"), { ...ACCOUNT_DEFAULTS, now: NOW }, 6);
    assert.ok(t.spent <= 6);
    assert.ok(t.limits.length >= 1, "a stage says it stopped");
  });

  it("follow the cursor on a deep run while the timeline's share lasts", async () => {
    const { sent, t } = setup(300, { hasMore: true });
    await runAccount(t, parseTarget("tiktok:notionhq"), { ...ACCOUNT_DEEP, now: NOW }, 300);
    const walks = sent.filter((s) => s.endpoint === "tiktok/profile/videos");
    assert.ok(walks.length >= 2, `${walks.length} timeline reads`);
    assert.ok(walks.slice(1).every((w) => typeof w.params.cursor === "string"));
    assert.ok(t.spent <= 300);
  });

  it("read Threads' one window without max_pages", async () => {
    const { sent, t } = setup(100);
    await runAccount(t, parseTarget("threads:notionhq"), { ...ACCOUNT_DEFAULTS, now: NOW }, 100);
    assert.equal(sent.find((s) => s.endpoint === "threads/user/posts")?.params.max_pages, undefined);
  });
});
