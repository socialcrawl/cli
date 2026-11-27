// instagram-marketing against a fake API: the undated reel search (a dated one carries no
// views, file 26 SR-40), two profile pages per creator, a follower read only for the
// break-outs' authors (search rows carry no follower count), and the naming rule on its result.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderCard, renderReport } from "../../../src/engine/index.ts";
import { runVideo } from "../../../src/workflows/_video/run.ts";
import { workflow } from "../../../src/workflows/instagram-marketing/index.ts";
import { INSTAGRAM } from "../../../src/workflows/instagram-marketing/spec.ts";
import { fakeSession, history, post } from "../_video/fake-kit.ts";
import type { Route } from "../_video/fake-kit.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const ARGS = { input: "AI coding tools", flags: {}, deep: false, now: NOW };
const reel = (o: Parameters<typeof post>[0]) => {
  const p = post({ ...o, url: `https://www.instagram.com/reel/${o.id}/`, ext: { media_type: "video", ...(o.ext ?? {}) } });
  return p;
};
const R1 = reel({ id: "R1", author: "bigbrand", views: 500_000, at: "2026-11-20T15:00:00Z", text: "7 FREE Claude Code Skills You NEED" });
const R2 = reel({ id: "R2", author: "smalldev", views: 60_000, at: "2026-11-19T10:00:00Z", text: 'Comment "AGENT" for the guide' });
const R3 = reel({ id: "R3", author: "steady", views: 20_000, at: "2026-11-18T10:00:00Z" });

function world(): Route[] {
  return [
    { endpoint: "instagram/search/reels", data: { items: [R1, R2, R3], relevance: { mode: "filter", rows: 3, kept: 3, dropped: 0 } } },
    { endpoint: "instagram/profile/reels", when: (p) => p.handle === "bigbrand", data: { items: history("bigbrand", 20, 10_000, "2026-11-20T00:00:00Z", { ext: { media_type: "video", music_id: "a1", music: { id: "a1", track_title: "Licensed Song" } } }) } },
    { endpoint: "instagram/profile/reels", when: (p) => p.handle === "smalldev", data: { items: history("smalldev", 12, 2_000, "2026-11-19T00:00:00Z", { ext: { media_type: "video" } }) } },
    { endpoint: "instagram/profile/reels", when: (p) => p.handle === "steady", data: { items: history("steady", 12, 19_000, "2026-11-18T00:00:00Z", { ext: { media_type: "video" } }) } },
    { endpoint: "instagram/post/comments", data: { items: [{ comment: { id: "c1", text: "Where do I get this?", author: { username: "x" }, engagement: { likes: 3 } }, computed: { labels: { question: { p: 0.9 }, purchase_intent: { p: 0.8 }, complaint: { p: 0 }, sentiment: { level: 4 } } } }], labels: { status: "complete", labelled: 1 } } },
    { endpoint: "instagram/media/transcript", data: { transcripts: [{ id: "R1", text: "Here are seven skills." }] } },
    { endpoint: "instagram/profile", when: (p) => p.handle === "bigbrand", data: { author: { username: "bigbrand", followers: 250_000 } } },
    { endpoint: "instagram/profile", when: (p) => p.handle === "smalldev", data: { author: { username: "smalldev", followers: 3_100 } } },
  ];
}

describe("instagram-marketing: the run", () => {
  it("searches reels without a date window, so the rows carry views", async () => {
    const { kit, session } = fakeSession(world());
    await runVideo(session, INSTAGRAM, ARGS);
    const searches = kit.sent.filter((s) => s.endpoint === "instagram/search/reels");
    assert.ok(searches.length >= 1);
    for (const s of searches) {
      assert.equal(s.params.date_posted, undefined);
      assert.equal(s.params.relevance, "filter");
      assert.ok(Number(s.params.max_pages) >= 1);
    }
  });

  it("reads two profile pages per creator and measures each reel against the reels before it", async () => {
    const { kit, session } = fakeSession(world());
    const run = await runVideo(session, INSTAGRAM, ARGS);
    for (const s of kit.sent.filter((x) => x.endpoint === "instagram/profile/reels")) {
      assert.equal(Number(s.params.max_pages), 2);
      assert.equal(s.params.judgments, "off");
    }
    const by = new Map(run.items.map((i) => [i.row.id, i]));
    assert.equal(by.get("R1")?.breakout.multiple, 50);
    assert.equal(by.get("R2")?.breakout.multiple, 30);
    assert.equal(by.get("R3")?.viral, false);
  });

  it("reads follower counts for the most viewed creators first, then baselines the best views over followers first", async () => {
    const { kit, session } = fakeSession(world());
    await runVideo(session, { ...INSTAGRAM, confirm: { default: 1, deep: 1 } }, ARGS);
    const firstProfile = kit.sent.findIndex((s) => s.endpoint === "instagram/profile");
    const firstBaseline = kit.sent.findIndex((s) => s.endpoint === "instagram/profile/reels");
    assert.ok(firstProfile >= 0 && firstProfile < firstBaseline, "followers before baselines");
    const read = kit.sent.filter((s) => s.endpoint === "instagram/profile/reels").map((s) => s.params.handle);
    assert.deepEqual(read, ["smalldev"], "60,000 views on 3,100 followers before 500,000 on 250,000");
  });

  it("reads each creator's followers once, and names only the large one", async () => {
    const { kit, session } = fakeSession(world());
    const out = await workflow.run(session, ARGS);
    const profiles = kit.sent.filter((s) => s.endpoint === "instagram/profile").map((s) => s.params.handle);
    assert.equal(new Set(profiles).size, profiles.length, "no creator read twice");
    const md = renderReport(out.report) + renderCard(out.card);
    assert.match(md, /@bigbrand/);
    assert.doesNotMatch(md, /smalldev/);
    assert.match(md, /a creator with 3,100 followers/);
    assert.match(md, /Here are seven skills/);
    assert.ok(session.ledger.credits <= workflow.defaultBudget);
  });

  it("counts as measured only the reels that got a multiple, and says how many had too few earlier reels", async () => {
    // A reel from 01/11: the creator's 24 newest reels all came after it, so none is earlier.
    const R4 = reel({ id: "R4", author: "oldtimer", views: 500_000, at: "2026-11-01T10:00:00Z" });
    const routes = world().map((r) => (r.endpoint === "instagram/search/reels" ? { ...r, data: { items: [R1, R2, R3, R4] } } : r));
    routes.push({ endpoint: "instagram/profile/reels", when: (p) => p.handle === "oldtimer", data: { items: history("oldtimer", 24, 9_000, "2026-11-26T00:00:00Z", { ext: { media_type: "video" } }) } });
    routes.push({ endpoint: "instagram/profile", when: (p) => p.handle === "oldtimer", data: { author: { username: "oldtimer", followers: 1_000 } } });
    const { session } = fakeSession(routes);
    const out = await workflow.run(session, ARGS);
    assert.equal(out.card.headlines[0], "2 reels broke out at 3x or more their creator's usual views (3 of 4 measured)");
    assert.match(renderReport(out.report), /1 reel with too few earlier reels/);
  });

  it("reads creators of recent reels first: an old reel's earlier reels are out of reach of the newest pages", async () => {
    const R4 = reel({ id: "R4", author: "oldtimer", views: 500_000, at: "2026-06-01T10:00:00Z" });
    const routes = world().map((r) => (r.endpoint === "instagram/search/reels" ? { ...r, data: { items: [R1, R2, R3, R4] } } : r));
    routes.push({ endpoint: "instagram/profile", when: (p) => p.handle === "oldtimer", data: { author: { username: "oldtimer", followers: 1_000 } } });
    const { kit, session } = fakeSession(routes);
    // All time, so the old reel is a candidate at all.
    await runVideo(session, { ...INSTAGRAM, confirm: { default: 1, deep: 1 } }, { ...ARGS, since: "2000-01-01" });
    const read = kit.sent.filter((s) => s.endpoint === "instagram/profile/reels").map((s) => s.params.handle);
    assert.deepEqual(read, ["smalldev"], "500 views per follower, but six months old, so read after the recent ones");
  });

  it("walks back page by page until a busy creator's baseline holds 8 reels before the candidate", async () => {
    // One reel a day: the 24 newest reach 03/11, the next two pages 6 reels each (to 28/10, then 22/10).
    const day = (d: number) => new Date(Date.parse("2026-11-27T09:00:00Z") - d * 86_400_000).toISOString();
    const busy = (from: number, n: number) => Array.from({ length: n }, (_, i) => reel({ id: `b${from + i}`, author: "busy", views: 4_000, at: day(from + i) }));
    const R5 = reel({ id: "R5", author: "busy", views: 80_000, at: "2026-10-30T12:00:00Z" });
    const routes: Route[] = [
      { endpoint: "instagram/search/reels", data: { items: [R5] } },
      { endpoint: "instagram/profile", data: { author: { username: "busy", followers: 2_000 } } },
      { endpoint: "instagram/profile/reels", when: (p) => p.cursor === undefined, data: { items: busy(1, 24), $pagination: { has_more: true, next_cursor: "k1" } } },
      { endpoint: "instagram/profile/reels", when: (p) => p.cursor === "k1", data: { items: busy(25, 6), $pagination: { has_more: true, next_cursor: "k2" } } },
      { endpoint: "instagram/profile/reels", when: (p) => p.cursor === "k2", data: { items: busy(31, 6), $pagination: { has_more: true, next_cursor: "k3" } } },
    ];
    const { kit, session } = fakeSession(routes);
    const run = await runVideo(session, INSTAGRAM, ARGS);
    const cursors = kit.sent.filter((s) => s.endpoint === "instagram/profile/reels").map((s) => s.params.cursor ?? "start");
    assert.deepEqual(cursors, ["start", "k1", "k2"], "stops once the baseline is enough");
    const b = run.items.find((i) => i.row.id === "R5")?.breakout;
    assert.equal(b?.multiple, 20, "80,000 over a median of 4,000");
    assert.ok((b?.peers ?? 0) >= 8);
  });

  it("takes a reel's music from its own row on the creator's reel list, since search rows carry none", async () => {
    const own = reel({ id: "R1", author: "bigbrand", views: 500_000, at: "2026-11-20T15:00:00Z", ext: { music_id: "m9", music: { id: "m9", track_title: "Viral Song" } } });
    const routes = world().map((r) => (r.endpoint === "instagram/profile/reels" && r.when?.({ handle: "bigbrand" }, undefined) ? { ...r, data: { items: [own, ...(r.data as { items: unknown[] }).items] } } : r));
    const { session } = fakeSession(routes);
    const run = await runVideo(session, INSTAGRAM, ARGS);
    assert.deepEqual(run.items.find((i) => i.row.id === "R1")?.row.sound, { id: "m9", title: "Viral Song", original: null });
    assert.equal(run.items.find((i) => i.row.id === "R1")?.breakout.multiple, 50, "the reel itself is still left out of its own baseline");
  });

  it("cuts the undated search to the window by default, and searches the dated surface with views on --deep", async () => {
    const { kit, session } = fakeSession(world(), 250);
    await runVideo(session, INSTAGRAM, { ...ARGS, deep: true });
    const deep = kit.sent.find((s) => s.endpoint === "instagram/search/reels" && s.params.date_posted !== undefined);
    assert.equal(deep?.params.date_posted, "last-month");
    assert.equal(deep?.params.include, "engagement", "a dated search carries no views without it (SR-40)");
    const R6 = reel({ id: "R6", author: "lastyear", views: 700_000, at: "2025-12-01T10:00:00Z" });
    const routes = world().map((r) => (r.endpoint === "instagram/search/reels" ? { ...r, data: { items: [R1, R2, R3, R6] } } : r));
    const d = fakeSession(routes);
    const run = await runVideo(d.session, INSTAGRAM, ARGS);
    assert.equal(run.candidates.outsideWindow, 1);
  });

  it("reads the size of a break-out's creator before describing it", async () => {
    // Three break-outs whose creators were not among the most viewed: each is read after ranking.
    const spec = { ...INSTAGRAM, names: { ...INSTAGRAM.names!, preRead: { default: 0, deep: 0 } } };
    const { kit, session } = fakeSession(world());
    const out = await (await import("../../../src/workflows/_video/workflow.ts")).videoWorkflow(spec, { summary: "", examples: [] }).run(session, ARGS);
    assert.deepEqual(kit.sent.filter((s) => s.endpoint === "instagram/profile").map((s) => s.params.handle).sort(), ["bigbrand", "smalldev"]);
    assert.doesNotMatch(renderReport(out.report), /a creator of unknown size/);
  });

  it("says '1 candidate had' when one went unread", async () => {
    const spec = { ...INSTAGRAM, confirm: { default: 2, deep: 2 } };
    const { session } = fakeSession(world());
    const out = await (await import("../../../src/workflows/_video/workflow.ts")).videoWorkflow(spec, { summary: "", examples: [] }).run(session, ARGS);
    assert.ok(out.report.summary.some((l) => l.startsWith("1 candidate had no baseline read")), JSON.stringify(out.report.summary));
  });

  it("says 'its' for a single break-out", async () => {
    const one = world().map((r) => (r.endpoint === "instagram/search/reels" ? { ...r, data: { items: [R1, R3] } } : r));
    const { session } = fakeSession(one);
    const out = await workflow.run(session, ARGS);
    assert.match(out.card.headlines[0], /^1 reel broke out at 3x or more its creator's usual views/);
    assert.match(out.report.summary[0], /^1 of 2 reels with a baseline broke out at 3 times or more its creator's/);
  });

  it("quotes a default run inside its budget", async () => {
    const q = await workflow.quote(ARGS);
    assert.ok(q.max <= workflow.defaultBudget, `max ${q.max}`);
  });
});
