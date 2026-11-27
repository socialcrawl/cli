// tiktok-marketing replayed on the live run of 27/11/2026 ("AI coding tools", 17 calls, 40
// credits, first request req-Wqpnij50EtqpBRUO), anonymised: accounts under 10,000 followers
// are aliases. Real response shapes, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ENGINE_SECTIONS, renderCard, renderReport, validateReport } from "../../../src/engine/index.ts";
import { REPORT_SECTIONS } from "../../../src/workflows/_video/report.ts";
import { workflow } from "../../../src/workflows/tiktok-marketing/index.ts";
import { fixturePath } from "../../fixture-path.ts";
import { fakeSession } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

interface Rec {
  stage: string;
  endpoint: string;
  params: Record<string, unknown>;
  at: string;
  body: { data: unknown; pagination?: unknown };
}
const recs: Rec[] = JSON.parse(readFileSync(fixturePath("tiktok-marketing", "live-27-11-2026.json"), "utf8"));
const NOW = new Date(recs[0].at);
const KEYS = ["handle", "url", "sort_by", "cursor", "date_posted"];

/** Each recorded call answers the call whose identifying params match it. */
const routes: Route[] = recs.map((r) => ({
  endpoint: r.endpoint,
  when: (p) => KEYS.every((k) => String(p[k] ?? "") === String(r.params[k] ?? "")),
  data: () => ({ ...(r.body.data as object), ...(r.body.pagination ? { $pagination: r.body.pagination } : {}) }),
}));

async function replay() {
  const { session, kit } = fakeSession(routes, workflow.defaultBudget, NOW);
  const out = await workflow.run(session, { input: "AI coding tools", flags: {}, deep: false, now: NOW });
  return { out, session, kit, md: renderReport(out.report), card: renderCard(out.card) };
}

describe("tiktok-marketing: replay of the live run of 27/11/2026", () => {
  it("makes the same calls the live run made, and no others", async () => {
    const { session, kit } = await replay();
    assert.equal(session.errors.length, 0, JSON.stringify(session.errors.map((e) => `${e.endpoint} ${e.message}`)));
    assert.equal(kit.sent.length, recs.length);
  });

  it("finds the same lead break-out: 1,128,931 views over a median of 2,269 across 11 earlier videos", async () => {
    const { out } = await replay();
    const f = out.report.evidence.findings.find((x) => x.numbers.multiple === 497.55);
    assert.ok(f, "the 498x finding");
    assert.equal(f.numbers.views, 1_128_931);
    assert.equal(f.numbers.base, 2_269);
    assert.equal(f.numbers.peers, 11);
  });

  it("passes the report gate on real rows", async () => {
    const { out, md } = await replay();
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), { requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS });
    assert.deepEqual(v.problems, []);
  });

  it("names no account under 10,000 followers, alias or not", async () => {
    const { md, card } = await replay();
    assert.doesNotMatch(md + card, /@u\d{3}\b|example\.invalid/);
  });
});
