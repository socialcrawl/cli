// The X stages fit the 100 welcome credits, whatever the account. A fake API bills every
// walk the most it may (every page it is allowed, every topic hold kept) and answers the
// timeline with recorded @reatools posts, so every paid stage runs. No key, no network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget, RATES } from "../../../src/engine/rates.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { Session } from "../../../src/kit/record.ts";
import { Tracker } from "../../../src/workflows/social-teardown/tracker.ts";
import { runX, xShares, X_DEFAULTS, X_DEEP } from "../../../src/workflows/social-teardown/x/x.ts";
import { fixturePath } from "../../fixture-path.ts";

const recorded: { stage: string; status: number; body: ApiBody }[] = JSON.parse(readFileSync(fixturePath("social-teardown", "reatools-records.json"), "utf8"));
const profile = recorded.find((r) => r.stage === "profile")!.body;
const timeline = recorded.filter((r) => r.stage === "timeline" && r.status === 200).map((r) => r.body);

function fakeKit(sent: { endpoint: string; params: Params }[]) {
  let seq = 0;
  return {
    async call(endpoint: string, params: Params = {}): Promise<ApiBody> {
      sent.push({ endpoint, params });
      seq++;
      const rate = RATES[endpoint];
      const worst = rate.walks ? Math.min(Number(params.max_credits), Number(params.max_pages) * (rate.page + (params.relevant_to ? rate.topicHold ?? 0 : 0))) : rate.page;
      const data = endpoint === "twitter/profile" ? profile.data : endpoint === "twitter/user/tweets" || /^from:/.test(String(params.query ?? "")) ? timeline[seq % timeline.length].data : { items: [] };
      return { success: true, credits_used: worst, request_id: `req-fake${seq}`, data };
    },
  };
}

const NOW = new Date("2026-11-26T03:00:00Z");
const tracker = (sent: { endpoint: string; params: Params }[], total = 100) =>
  new Tracker(new Session({ dir: mkdtempSync(path.join(tmpdir(), "sc-x-")), kit: fakeKit(sent), budget: new Budget(total), skill: "social-teardown", version: "0.1.0" }));

describe("the X stages inside their budget", () => {
  it("never spend more than 100 credits at the default, and send max_pages with every walk", async () => {
    const sent: { endpoint: string; params: Params }[] = [];
    const t = tracker(sent);
    await runX(t, "@reatools", { ...X_DEFAULTS, now: NOW }, 100);
    assert.ok(t.spent <= 100, `spent ${t.spent}`);
    assert.ok(t.spent >= 50, `spent only ${t.spent}: the stages did not run`);
    for (const s of sent) if (RATES[s.endpoint].walks) assert.equal(typeof s.params.max_pages, "number", `${s.endpoint} without max_pages`);
    const stages = new Set(t.records.map((x) => x.stage.split(":")[0]));
    for (const st of ["profile", "timeline", "retweeters", "replies"]) assert.ok(stages.has(st), `${st} did not run`);
    assert.ok(sent.filter((s) => s.endpoint === "twitter/tweet/replies").every((s) => s.params.label === "sentiment,question,purchase_intent,complaint"));
    assert.equal(sent.filter((s) => s.endpoint === "prism/launch-echo").length, 0);
    assert.ok(sent.filter((s) => s.endpoint === "twitter/tweet/transcript").length <= 1);
  });

  it("stop the timeline at its share and say older months were not read", async () => {
    const t = tracker([]);
    await runX(t, "@reatools", { ...X_DEFAULTS, months: 24, now: NOW }, 100);
    const timelineSpent = t.records.filter((x) => x.stage === "timeline").reduce((s, x) => s + x.creditsUsed, 0);
    assert.ok(timelineSpent <= xShares(100).timeline, `timeline ${timelineSpent}`);
    assert.ok(t.limits.some((l) => l.stage === "timeline" && /older months were not read/.test(l.reason)));
  });

  it("scale every share with the account's budget, so two accounts share 100 credits", async () => {
    const t = tracker([], 50);
    await runX(t, "@reatools", { ...X_DEFAULTS, now: NOW }, 50);
    assert.ok(t.spent <= 50, `spent ${t.spent}`);
    assert.equal(xShares(50).timeline, Math.floor(xShares(100).timeline / 2));
  });

  it("give the early quotes and the first hours more than one page a post, and leave Reddit to deep runs", () => {
    const s = xShares(100);
    assert.ok(s.quotes >= 12 && s.squad >= 8, `quotes ${s.quotes}, first hours ${s.squad}`);
    assert.equal(X_DEFAULTS.reddit, false);
    assert.equal(X_DEEP.reddit, true);
    assert.equal(Object.entries(s).filter(([k]) => k !== "echo").reduce((t, [, v]) => t + v, 0), 100);
  });

  it("read deeper on --deep: more posts, more pages, quotes and first hours on every depth post", async () => {
    const sent: { endpoint: string; params: Params }[] = [];
    const t = tracker(sent, 600);
    await runX(t, "@reatools", { ...X_DEEP, now: NOW }, 600);
    assert.ok(t.spent <= 600);
    assert.ok(X_DEEP.depth > X_DEFAULTS.depth && X_DEEP.rtPages > X_DEFAULTS.rtPages);
    assert.equal(X_DEEP.months, 0, "deep reads from the join date");
  });
});
