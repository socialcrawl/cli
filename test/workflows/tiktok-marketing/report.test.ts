// What a tiktok-marketing run hands the render kit: the card, the report (which must pass the
// engine's report gate), the evidence, the tiles, the charts and the raw-data tables. Every
// account under 10,000 followers is described, never named or linked.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_SECTIONS, renderCard, renderReport, validateReport } from "../../../src/engine/index.ts";
import { REPORT_SECTIONS, times } from "../../../src/workflows/_video/report.ts";
import { workflow } from "../../../src/workflows/tiktok-marketing/index.ts";
import { fakeSession, post } from "../_video/fake-kit.ts";
import { A1, ARGS, B1, labelled, world } from "./world.ts";

async function result(budget = 60) {
  const { session } = fakeSession(world(), budget);
  const out = await workflow.run(session, ARGS);
  return { out, session, md: renderReport(out.report), card: renderCard(out.card) };
}

describe("tiktok-marketing: the workflow", () => {
  it("is a workflow the CLI can list, quote and run", async () => {
    assert.equal(workflow.name, "tiktok-marketing");
    assert.ok(workflow.defaultBudget <= 100);
    const q = await workflow.quote(ARGS);
    assert.ok(q.max <= workflow.defaultBudget, `default max ${q.max}`);
    assert.ok(q.expected > 0 && q.expected <= q.max);
    const deep = await workflow.quote({ ...ARGS, deep: true });
    assert.ok(deep.max > q.max && deep.max <= workflow.deepBudget);
  });
});

describe("tiktok-marketing: the report", () => {
  it("passes the report gate: sections in order, every summary line cited, every number from the evidence", async () => {
    const { out, md } = await result();
    const v = validateReport(md, out.report.evidence.toJSON(out.report.meta), {
      requiredSections: ["In short", ...REPORT_SECTIONS, ...ENGINE_SECTIONS],
      summarySection: "In short",
      engineSections: ENGINE_SECTIONS,
    });
    assert.deepEqual(v.problems, []);
  });

  it("leads with the break-outs, largest first, with the baseline behind each", async () => {
    const { md } = await result();
    const first = md.indexOf("@bigco");
    assert.ok(first > 0);
    assert.match(md, /40x/);
    assert.ok(md.includes("| × its usual views |"), "the column says what the multiple is of");
    assert.match(md, /median of 10,000 views over 20 earlier videos, 21\/10 to 09\/11\/2026/, "the baseline's dates, so a reader can judge it");
  });

  it("describes an account under 10,000 followers and never names or links it", async () => {
    const { out, md, card } = await result();
    const shown = [md, card, JSON.stringify(out.tiles ?? []), JSON.stringify(out.charts ?? [])].join("\n");
    assert.doesNotMatch(shown, /smallone/);
    assert.doesNotMatch(shown, new RegExp(B1.post.url.replace(/[.?]/g, "\\$&")));
    assert.match(md, /a creator with 2,000 followers/);
  });

  it("leads its trait line with what a person can make (length, hook, sound) before the posting hour", async () => {
    const { out, md } = await result();
    assert.match(out.card.headlines[2] ?? "", /length "30 to 60 s"/);
    assert.doesNotMatch(md, /\| comment gate \| no \|/, "only gated posts are a trait worth a row");
    assert.match(md, /1 break-out came from an account under 10,000 followers/);
  });

  it("prints an em dash in quoted text as a spaced hyphen", async () => {
    const dashed = world().map((r) => (r.endpoint === "tiktok/post/comments" ? { ...r, data: { items: [labelled("9", "Is it free—or paid?", 0.9)], labels: { status: "complete", labelled: 1 } } } : r));
    const { session } = fakeSession(dashed);
    const md = renderReport((await workflow.run(session, ARGS)).report);
    assert.doesNotMatch(md, /—/);
    assert.match(md, /Is it free - or paid\?/);
  });

  it("states the window in its first line and dates every break-out", async () => {
    const { md } = await result();
    const first = md.split("\n").find((l, i) => i > 0 && l.trim());
    assert.match(first ?? "", /^TikTok · 29\/10\/2026 to 27\/11\/2026 · /);
    assert.ok(md.includes("| Published |"), "a Published column");
    assert.match(md, /\| @bigco \| 20\/11\/2026 \|/);
  });

  it("counts the posts outside the window and gives the all-time command", async () => {
    const OLD = post({ id: "O1", author: "oldie", followers: 40_000, views: 900_000, at: "2026-09-01T12:00:00Z" });
    const routes = world().map((r) => (r.endpoint === "tiktok/search" && r.when?.({}, undefined) ? { ...r, data: { items: [A1, B1, OLD] } } : r));
    const { session } = fakeSession(routes);
    const md = renderReport((await workflow.run(session, ARGS)).report);
    assert.match(md, /1 video published outside 29\/10\/2026 to 27\/11\/2026/);
    assert.match(md, /--since 2000-01-01/);
  });

  it("says what it could not read, with the reason", async () => {
    const { md } = await result();
    assert.match(md, /no list of who shared/i);
    assert.match(md, /D1|under the reach floor|below the floor/);
  });

  it("ends with next plays as commands, and what will not copy", async () => {
    const { md } = await result();
    assert.match(md, /`npx -y socialcrawl@latest tiktok-marketing "AI coding tools" --deep`/);
    assert.match(md, /in 14 days/);
    assert.match(md, /comment/i, "the comment-gated break-out is named as a trait that will not copy");
  });

  it("cites only requests the run made", async () => {
    const { out, session } = await result();
    const made = session.ledger.requestIds();
    for (const f of out.report.evidence.findings) for (const r of f.requests) assert.ok(made.has(r), `${f.id} cites ${r}`);
    assert.ok(out.report.evidence.coverage.length >= 5, "searches, baselines and comments are covered");
  });
});

describe("tiktok-marketing: numbers as printed", () => {
  it("prints a multiple whole from 10x up and to one decimal below", () => {
    assert.equal(times(878.92), "879x");
    assert.equal(times(12), "12x");
    assert.equal(times(3.44), "3.4x");
    assert.equal(times(null), "no multiple");
  });
});

describe("tiktok-marketing: the card and the data", () => {
  it("is titled with the command and fits one screen", async () => {
    const { out, card } = await result();
    assert.equal(out.card.command, '/tiktok-marketing "AI coding tools"');
    assert.ok(out.card.headlines.length >= 1 && out.card.headlines.length <= 3);
    for (const h of out.card.headlines) assert.ok(h.length <= 110, h);
    assert.equal(out.card.headlines[0], "3 videos broke out at 3x or more their creator's usual views (4 of 4 measured)");
    assert.match(card, /Read with SocialCrawl \/tiktok-marketing/);
    assert.equal(out.card.basis, "5 videos read, 29/10 to 27/11/2026, 4 measured", "the card says when, since it travels without its report");
    assert.equal(out.card.rerun, 'npx -y socialcrawl@latest tiktok-marketing "AI coding tools"');
  });

  it("keeps every row read as data", async () => {
    const { out } = await result();
    assert.deepEqual(Object.keys(out.tables).sort(), ["baselines", "comments", "posts", "transcripts"]);
    assert.equal(out.tables.posts.rows.length, 5, "every search row, one copy each");
    const a1 = out.tables.posts.rows.find((r) => r.id === "A1");
    assert.equal(a1?.multiple, 40);
    assert.equal(a1?.url, A1.post.url, "the person's own data keeps the link");
    assert.ok(out.tables.baselines.rows.length >= 47);
    assert.equal(out.tables.comments.rows.length, 6);
  });

  it("shows tiles and a chart of the break-outs", async () => {
    const { out } = await result();
    assert.ok((out.tiles ?? []).some((t) => t.label === "Break-outs" && t.value === "3 of 4"));
    const chart = (out.charts ?? [])[0];
    assert.equal(chart.unit, "x");
    assert.equal(chart.bars[0].value, 40);
  });

  it("says so plainly when nothing broke out", async () => {
    const { session } = fakeSession(world().filter((r) => !(r.endpoint === "tiktok/search")).concat([{ endpoint: "tiktok/search", data: { items: [] } }]));
    const out = await workflow.run(session, ARGS);
    assert.match(out.card.headlines[0], /No video/);
  });
});
