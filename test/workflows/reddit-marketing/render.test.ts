// reddit-marketing, what a run hands the render kit: the card, the report, tiles, charts and
// the CSV tables. The report must pass the engine's own gate (every number from evidence.json,
// every summary line cited, no accusation), and no member of Reddit is ever named.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CARD_MAX_CHARS, CARD_MAX_HEADLINES, ENGINE_SECTIONS, renderCard, renderReport } from "../../../src/engine/outputs.ts";
import { validateReport } from "../../../src/engine/validate.ts";
import { REPORT_SECTIONS, buildResult } from "../../../src/workflows/reddit-marketing/render.ts";
import { runReddit } from "../../../src/workflows/reddit-marketing/run.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import { IN, fakeApi, memberNames, session } from "./fake.ts";

async function result() {
  const s = session(fakeApi());
  const run = await runReddit(s, IN);
  return { s, run, out: buildResult(run, s.meta(), s.records) };
}

describe("the card", () => {
  it("is titled with the command, holds at most three short headlines and ends with the cost", async () => {
    const { s, out } = await result();
    assert.equal(out.card.command, '/reddit-marketing "headless CMS"');
    assert.ok(out.card.headlines.length >= 1 && out.card.headlines.length <= CARD_MAX_HEADLINES);
    for (const h of out.card.headlines) assert.ok(h.length <= CARD_MAX_CHARS, h);
    assert.match(renderCard(out.card), new RegExp(`Read with SocialCrawl /reddit-marketing · ${s.ledger.credits} credits`));
  });

  it("says plainly when no thread beat its community, and names the closest", async () => {
    const { out } = await result();
    assert.match(out.card.headlines[0], /^No thread beat its community's usual top post 3 times over; the closest: r\/nextjs at 2\.8x/);
    assert.ok(!/viral/i.test(renderCard(out.card)));
  });

  it("counts the threads asking for a recommendation", async () => {
    const { out } = await result();
    assert.ok(out.card.headlines.some((h) => /^8 of 29 threads ask for a recommendation/.test(h)), out.card.headlines.join(" | "));
  });
});

describe("the report", () => {
  it("passes the engine's report gate", async () => {
    const { out } = await result();
    const md = renderReport(out.report);
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), {
      requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS],
      summarySection: "In short",
      engineSections: ENGINE_SECTIONS,
    });
    assert.deepEqual(v.problems, []);
  });

  it("never promises a confirmation step: a run prints its price, then runs", async () => {
    const { out } = await result();
    assert.ok(!/\b(asks? (?:first|before)|confirm)/i.test(renderReport(out.report)));
  });

  it("states the window in its first line and dates every thread it ranks", async () => {
    const { out } = await result();
    assert.match(out.report.badge, /the past month's top threads and the new ones since 20\/11\/2026/);
    const md = renderReport(out.report);
    assert.match(md, /\| # \| Thread \| Community \| Posted \| Score \|/);
    assert.match(md, /\| 1 \| [^|]+ \| r\/nextjs \| 24\/11\/2026 \| 28 \|/);
  });

  it("lists a thread whose community scores too low to compare as not measured, never ranked", async () => {
    const s = session(fakeApi());
    const run = await runReddit(s, IN);
    const b = run.breakouts.find((x) => x.thread.row.id === "t029")!;
    b.breakout = { ...b.breakout!, band: "base_too_small", multiple: null, base: 1 };
    const out = buildResult(run, s.meta(), s.records);
    const md = renderReport(out.report);
    assert.match(md, /\| Its community's earlier top posts score too low to compare \| 1 \|/);
    assert.match(md, /too few to compare/);
    assert.ok(!/\| r\/cms \| 11\/11\/2026 \| 5 \|/.test(md), "it is not in the ranked table");
  });

  it("tells a community whose rules the API did not return from one the run never tried", async () => {
    // Live, 27/11/2026 12:10 UTC: three subreddit/details reads answered 504 after 60 s.
    const api = fakeApi();
    const real = api.call;
    api.call = async (p, params = {}) => {
      if (p === "reddit/subreddit/details" && params.subreddit === "nextjs") {
        api.calls.push({ path: p, params });
        throw new ApiError(504, { success: false });
      }
      return real(p, params);
    };
    const s = session(api);
    const run = await runReddit(s, IN);
    const md = renderReport(buildResult(run, s.meta(), s.records).report);
    assert.match(md, /r\/nextjs: the API did not return its rules in this run; read them on the community's page before replying/);
    assert.match(md, /- Rules of r\/nextjs: the API answered 504/);
    assert.match(md, /r\/CloudFlare: rules not read in this run/, "a community never tried keeps its own line");
  });

  it("cites only requests the run made", async () => {
    const { s, out } = await result();
    const made = new Set(s.records.map((r) => r.requestId));
    for (const f of out.report.evidence.findings) for (const r of f.requests) assert.ok(made.has(r), `${f.id} cites ${r}`);
  });

  it("never names a member of Reddit, in the card or the report", async () => {
    const { out } = await result();
    const text = renderCard(out.card) + renderReport(out.report);
    for (const name of memberNames()) assert.ok(!text.includes(name), name);
  });

  it("puts each community's promotion rule beside the threads worth a reply", async () => {
    const { out } = await result();
    const md = renderReport(out.report);
    assert.match(md, /r\/nextjs rule 4: No posts shilling your product/);
    assert.match(md, /say that you work on it/);
  });

  it("says what it could not read: unlabelled replies and communities whose rules were not reported", async () => {
    const { out } = await result();
    const md = renderReport(out.report);
    assert.match(md, /replies the API did not label/);
    assert.match(md, /r\/cms: rules not reported by the source, which does not mean there are none/);
  });

  it("cuts long quotes and rules at a word, with an ellipsis", async () => {
    const { out } = await result();
    const md = renderReport(out.report);
    for (const l of md.split("\n").filter((x) => x.startsWith("> "))) assert.match(l, /(?:[.!?)"…]|\w) \(\[link\]/, l.slice(0, 80));
    assert.ok(!/ jus \|/.test(md));
    assert.match(md, /r\/astrojs rule 3: No Spamming\. Sharing helpful[^|]*…/);
  });

  it("names the community or thread on each coverage line, and leaves the rules calls to the communities table", async () => {
    const { out } = await result();
    const lines = out.report.evidence.coverage.map((c) => c.line);
    assert.ok(lines.some((l) => l.startsWith("baseline r/webdev,")), lines.join("\n"));
    assert.ok(lines.some((l) => /^comments t050,/.test(l)));
    assert.ok(!lines.some((l) => l.includes("subreddit/details")));
  });
});

describe("the data and the visuals", () => {
  it("keeps every thread and every comment read as CSV rows, comments without their authors", async () => {
    const { run, out } = await result();
    assert.equal(out.tables.threads.rows.length, run.threads.length);
    assert.equal(out.tables.comments.rows.length, run.comments.length);
    for (const c of ["id", "community", "score", "comments", "multiple", "band", "peers", "month_rank", "intent", "url"]) assert.ok(out.tables.threads.columns.includes(c), c);
    assert.ok(!out.tables.comments.columns.includes("author"));
    assert.equal(out.tables.communities.rows.length, run.communities.length);
  });

  it("gives tiles that link to their findings and a chart of the measured multiples", async () => {
    const { out } = await result();
    const ids = new Set(out.report.evidence.findings.map((f) => f.id));
    assert.ok(out.tiles && out.tiles.length >= 3);
    for (const t of out.tiles!) if (t.finding) assert.ok(ids.has(t.finding), t.label);
    for (const t of out.tiles!) assert.ok(t.value.length <= 8, `tile value "${t.value}" wraps`);
    const chart = out.charts?.find((c) => c.unit === "x");
    assert.ok(chart && chart.bars.length > 0);
    assert.equal(chart!.bars[0].value, 2.8);
  });
});
