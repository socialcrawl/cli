// The evidence contract, the report gate, and the card and report, on a run built from the
// recorded /social-viral responses of study file 18.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { breakoutWithPage } from "../../src/engine/baseline.ts";
import { describe as describeB } from "../../src/engine/breakout.ts";
import { digest, Evidence, requestIdsOf } from "../../src/engine/evidence.ts";
import { ENGINE_SECTIONS, renderCard, renderCardSvg, renderReport, toCsv, writeRun } from "../../src/engine/outputs.ts";
import { CostLedger, metaBlock } from "../../src/engine/rates.ts";
import { rowsOf } from "../../src/engine/rows.ts";
import { statedNumbers, validateReport } from "../../src/engine/validate.ts";
import { RUN_AT, rec } from "./helpers.ts";

/** A small honest run: the TikTok search, one baseline page, one finding. */
function run() {
  const search = rec("18-164");
  const search2 = rec("18-165");
  const page = rec("25-46");
  const ledger = new CostLedger();
  for (const [stage, r] of [["search", search], ["search", search2], ["baselines", page]] as const) ledger.add({ stage, endpoint: r.endpoint, requestId: r.requestId, credits: r.creditsUsed ?? 0, status: 200 });
  const ev = new Evidence();
  ev.seeRequests(ledger.requestIds());
  ev.cover(search, "search");
  ev.cover(search2, "search");
  ev.cover(page, "baselines");
  // The post inside reader 25's walk, measured against the videos before it (file 25: 69x).
  const target = rowsOf(page).find((r) => r.views === 160_995)!;
  const b = breakoutWithPage(target, rowsOf(page), { now: new Date("2026-11-26T19:40:00Z") });
  const f = ev.add({
    claim: `A TikTok video broke out at ${describeB(b)}`,
    confidence: "seen",
    numbers: { views: b.value, base: b.base, peers: b.peers, multiple: b.multiple, saves: null },
    requests: b.requestIds,
    rows: [b.id],
    method: "views over the median of the author's comparable posts on one timeline page, the post left out",
  });
  ev.unknown({ what: "Retweeters", why: "TikTok publishes no list of who reposted a video" });
  const meta = metaBlock({ skill: "social-viral", version: "0.1.0", ledger, startedAt: new Date("2026-11-26T12:14:00Z"), now: new Date("2026-11-26T12:15:00Z") });
  return { ev, f, b, meta, ledger };
}

describe("the evidence contract", () => {
  it("numbers each finding, cites its requests and marks a null count unknown, not zero", () => {
    const { ev, f } = run();
    assert.equal(f.id, "F1");
    assert.deepEqual(f.requests, [rec("25-46").requestId]);
    assert.deepEqual(f.limitations, ["saves: unknown, not zero"]);
    assert.equal(ev.toJSON().findings[0].numbers.saves, null);
  });

  it("refuses a seen finding with no request id", () => {
    assert.throws(() => new Evidence().add({ claim: "Videos carry the views", confidence: "seen", numbers: {}, requests: [] }), /no request id/);
    assert.doesNotThrow(() => new Evidence().add({ claim: "Reach on LinkedIn", confidence: "unknown", numbers: { views: null }, requests: [] }));
  });

  it("computes coverage from the API's own blocks: read 30 rows, kept 20, dropped 10 off topic (req 18-164)", () => {
    const { ev } = run();
    const c = ev.coverage[0];
    assert.deepEqual({ read: c.rowsRead, kept: c.rowsKept, dropped: c.dropped }, { read: 30, kept: 20, dropped: [{ reason: "off topic", count: 10 }] });
    assert.match(c.line, /^search, tiktok\/search: read 30 rows, kept 20, back to \d{2}\/\d{2}\/2026; dropped 10 off topic$/);
  });

  it("counts a walk's pages and duplicates (req 18-77)", () => {
    const c = new Evidence().cover(rec("18-77"), "timeline");
    assert.equal(c.pages, 15);
    assert.equal(c.stopped, "max_pages");
    assert.match(c.line, /on 15 pages.*\(stopped: max pages\); dropped 1 duplicates/);
    assert.equal(c.requests.length, 16); // the call's own id plus each page's
  });

  it("digests a response and collects every request id of a walk", () => {
    assert.match(digest({ a: 1 }), /^sha256:[0-9a-f]{16}$/);
    assert.deepEqual(requestIdsOf({ requestId: "req-a", walkRequestIds: ["req-a", "req-b"] }), ["req-a", "req-b"]);
  });
});

describe("the report gate", () => {
  const body = (f: string) => `${f}\n`;
  const base = () => {
    const { ev, f, b, meta } = run();
    const report = renderReport({
      command: `/social-viral "AI coding tools" --week`,
      skill: "social-viral",
      badge: "TikTok · 19/11/2026 to 26/11/2026 · v0.1.0",
      summary: [`One video beat its author's usual reach ${b.multiple} times [${f.id}].`],
      sections: [{ title: "What broke out", body: body(`The video drew ${(b.value as number).toLocaleString("en-GB")} views against a median of ${b.base} [${f.id}].`) }],
      evidence: ev,
      meta,
      methodNotes: ["A multiple needs 8 comparable posts; 3 times or more is a break-out."],
    });
    return { ev, report, meta };
  };
  const opts = { requiredSections: ["In short", "What broke out", ...ENGINE_SECTIONS], summarySection: "In short", engineSections: ENGINE_SECTIONS };

  it("passes an honest report", () => {
    const { ev, report, meta } = base();
    const v = validateReport(report, ev.toJSON(meta), opts);
    assert.deepEqual(v.problems, []);
    assert.equal(v.ok, true);
  });

  it("fails a number the engine did not compute", () => {
    const { ev, report, meta } = base();
    const v = validateReport(report.replace("drew 160,995 views", "drew 200,000 views"), ev.toJSON(meta), opts);
    assert.deepEqual(v.problems.map((p) => [p.code, p.detail]), [["number_not_in_evidence", "200,000"]]);
  });

  it("fails an unresolved citation or request id, a missing section and an uncited summary line", () => {
    const { ev, report, meta } = base();
    const bad = report.replace("[F1].\n\n## What broke out", "[F9].\n- Short videos win.\n\n## What else").concat("\nSee req-NotARealId.\n");
    const codes = validateReport(bad, ev.toJSON(meta), opts).problems.map((p) => p.code);
    assert.ok(codes.includes("unresolved_citation"));
    assert.ok(codes.includes("unresolved_request"));
    assert.ok(codes.includes("missing_section"));
    assert.ok(codes.includes("summary_uncited"));
  });

  it("fails an accusation beside a named account, a spend figure and a banned token", () => {
    const { ev, report, meta } = base();
    const bad = report.replace("## What broke out", "@someone ran a bot network on it.\nThey spent $5,000 on ads.\nData from acmescraper.\nA reply said the connector fails for @bot.\n\n## What broke out");
    const codes = validateReport(bad, ev.toJSON(meta), { ...opts, bannedTokens: ["acmescraper"], allowNumbers: [5000] }).problems.map((p) => p.code);
    assert.deepEqual(codes.sort(), ["accusation", "banned_token", "spend_figure"]);
  });

  it("fails a playbook where fewer than 80% of five or more steps cite evidence", () => {
    const { ev, report, meta } = base();
    const steps = ["1. Post videos [F1]", "2. Open with a claim [F1]", "3. Post at noon [F1]", "4. Reply to everyone", "5. Use a hook"].join("\n");
    const bad = report.replace("## How this was read", `## Playbook\n\n${steps}\n\n## How this was read`);
    const p = validateReport(bad, ev.toJSON(meta), { ...opts, playbookSection: "Playbook", allowNumbers: [1, 2, 3, 4, 5] }).problems;
    assert.deepEqual(p.map((x) => [x.code, x.detail]), [["playbook_uncited", "3 of 5 steps cite evidence; 80% needed"]]);
  });

  it("reads stated numbers but not dates, times, ids, handles, versions or list markers", () => {
    assert.deepEqual(statedNumbers("2. On 26/11/2026 at 11:00 @user42 (req-abc123, [F3]) v0.1.0 drew 1,234 views, 12.5% of 3x"), [
      { value: 1234, decimals: 0, raw: "1,234" },
      { value: 12.5, decimals: 1, raw: "12.5" },
      { value: 3, decimals: 0, raw: "3" },
    ]);
  });
});

describe("card and files", () => {
  const card = () => {
    const { meta } = run();
    return { command: `/social-viral "AI coding tools" --week`, skill: "social-viral", headlines: ["7 TikTok videos broke out at 3 times or more their author's usual reach"], basis: "81 posts on 6 platforms", meta, rerun: `npx socialcrawl social-viral "AI coding tools" --week` };
  };

  it("titles the card with the command and foots it with the skill, the credits and the date", () => {
    const md = renderCard(card());
    const lines = md.trim().split("\n");
    assert.equal(lines[0], `**/social-viral "AI coding tools" --week**`);
    assert.match(md, /Read with SocialCrawl \/social-viral · 9 credits · 26\/11\/2026/);
    assert.match(md, /Run it yourself: npx socialcrawl social-viral/);
    assert.ok(lines.length <= 9);
  });

  it("refuses a card that would not fit one screen", () => {
    assert.throws(() => renderCard({ ...card(), headlines: ["a", "b", "c", "d"] }), /at most 3/);
    assert.throws(() => renderCard({ ...card(), headlines: ["x".repeat(111)] }), /over 110/);
  });

  it("draws the card as an escaped 1200 × 630 image", () => {
    const svg = renderCardSvg({ ...card(), headlines: ["<b> & \"quoted\""] });
    assert.match(svg, /width="1200" height="630"/);
    assert.match(svg, /&lt;b&gt; &amp; &quot;quoted&quot;/);
  });

  it("writes card.md, card.svg, report.md, evidence.json and CSVs with one line per row", () => {
    const { ev, meta } = run();
    const dir = mkdtempSync(path.join(tmpdir(), "engine-run-"));
    const csv = toCsv([{ id: "1", text: "line one\nline two, with \"quotes\"" }], ["id", "text"]);
    assert.equal(csv, `id,text\n1,"line one\\nline two, with ""quotes"""\n`);
    const files = writeRun(dir, { card: card(), report: { command: "/x", skill: "social-viral", badge: "b", summary: ["s [F1]"], sections: [], evidence: ev, meta, methodNotes: [] }, csv: { "posts.csv": csv } });
    assert.deepEqual(files.map((f) => path.basename(f)), ["card.md", "card.svg", "report.md", "evidence.json", "posts.csv"]);
    const json = JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8"));
    assert.equal(json.version, 1);
    assert.equal(json.meta.credits, 9);
    assert.equal(json.unverified[0].what, "Retweeters");
  });
});
