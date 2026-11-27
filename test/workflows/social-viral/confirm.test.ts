// The author cap per platform (the engine's planBaselines `confirm`, default DEFAULT_CONFIRM) passed
// through social-viral's shared planner and reader, so a deep run can measure more authors. An
// omitted cap keeps the default for every caller (social-viral, social-pulse, linkedin-marketing).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CONFIRM } from "../../../src/engine/index.ts";
import { readBaselines } from "../../../src/workflows/social-viral/runner.ts";
import { planViralBaselines } from "../../../src/workflows/social-viral/viral.ts";
import type { ViralPlatform } from "../../../src/workflows/social-viral/viral.ts";
import { row } from "../../engine/helpers.ts";
import { fakeSession } from "../_video/fake-kit.ts";

const twenty = Array.from({ length: 20 }, (_, k) => row({ id: `t${k}`, author: `a${k}`, authorFollowers: 20_000, views: 50_000 + k, publishedAt: "2026-11-24T10:00:00Z" }));
const shares: Record<ViralPlatform, number> = { x: 100, tiktok: 0, instagram: 0, youtube: 0, reddit: 0, linkedin: 0 };
const xSteps = (plans: ReturnType<typeof planViralBaselines>) => plans.find((p) => p.platform === "x")!.steps.length;

describe("/social-viral: the author cap", () => {
  it("plans the engine's default number of authors when no cap is given", () => {
    assert.equal(DEFAULT_CONFIRM, 12);
    assert.equal(xSteps(planViralBaselines(twenty, shares)), DEFAULT_CONFIRM);
  });

  it("plans up to the cap a caller gives for a platform", () => {
    assert.equal(xSteps(planViralBaselines(twenty, shares, { x: 30 })), 20);
    assert.equal(xSteps(planViralBaselines(twenty, shares, { x: 5 })), 5);
    assert.equal(xSteps(planViralBaselines(twenty, shares, { tiktok: 30 })), DEFAULT_CONFIRM, "a cap for another platform leaves X alone");
  });

  it("readBaselines passes the cap through to the reads it makes", async () => {
    const { kit, session } = fakeSession([{ endpoint: "twitter/search/tweets", data: { items: [] } }], 200);
    const now = new Date("2026-11-27T12:00:00Z");
    await readBaselines(session, twenty, shares, () => now, { confirm: { x: 30 } });
    assert.equal(new Set(kit.sent.map((x) => String(x.params.query ?? "")).filter((q) => q.startsWith("from:")).map((q) => q.split(" ")[0])).size, 20);
  });
});
