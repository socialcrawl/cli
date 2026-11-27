// The break-out method, on hand-computed cases and on the study's recorded responses.
// Run: node --test "examples/open-source/rea-socials/test/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bandOf, blocksOf, cardWorthy, breakoutOf, breakouts, contrast, describe as describeB, median, neighbours, travels, turningPoints } from "../../src/engine/breakout.ts";
import { breakoutWithPage } from "../../src/engine/baseline.ts";
import { rowsOf } from "../../src/engine/rows.ts";
import { RUN_AT, rec, row, series } from "./helpers.ts";

const NOW = new Date("2026-11-26T12:00:00Z");

describe("the multiple", () => {
  it("is views over the median of the 20 posts before it, the post itself left out", () => {
    // Ten earlier posts at 100, 200, ... 1,000 views: the median is (500 + 600) / 2 = 550.
    const earlier = series(10, (i) => (i + 1) * 100);
    const target = row({ id: "t", publishedAt: "2026-11-01T12:00:00.000Z", views: 3000 });
    const b = breakoutOf(target, [...earlier, target], { now: NOW });
    assert.equal(b.base, 550);
    assert.equal(b.peers, 10);
    assert.equal(b.multiple, 5.45); // 3000 / 550 = 5.4545
    assert.equal(b.band, "beat");
    assert.equal(b.peerIds.includes("t"), false);
  });

  it("uses only the latest 20 earlier posts", () => {
    // 25 earlier posts: the first five at 1,000,000 views must not count.
    const earlier = series(25, (i) => (i < 5 ? 1_000_000 : 100));
    const target = row({ id: "t", publishedAt: "2026-11-01T12:00:00.000Z", views: 400 });
    const b = breakoutOf(target, [...earlier, target], { now: NOW });
    assert.equal(b.peers, 20);
    assert.equal(b.base, 100);
    assert.equal(b.multiple, 4);
  });

  it("gives no number under 8 comparable posts", () => {
    const earlier = series(7, () => 100);
    const target = row({ id: "t", publishedAt: "2026-11-01T12:00:00.000Z", views: 10_000 });
    const b = breakoutOf(target, [...earlier, target], { now: NOW });
    assert.equal(b.multiple, null);
    assert.equal(b.band, "too_few");
    assert.equal(describeB(b), "too few posts (7 comparable, 8 needed)");
  });

  it("leaves out replies, reposts, pinned posts, later posts and the other format", () => {
    const earlier = series(8, () => 100);
    const noise = [
      row({ id: "r", kind: "reply", views: 1, publishedAt: "2026-10-30T00:00:00Z" }),
      row({ id: "rt", kind: "repost", views: 1, publishedAt: "2026-10-30T00:00:00Z" }),
      row({ id: "pin", pinned: true, views: 1, publishedAt: "2026-10-30T00:00:00Z" }),
      row({ id: "vid", video: true, views: 1, publishedAt: "2026-10-30T00:00:00Z" }),
      row({ id: "later", views: 1, publishedAt: "2026-11-10T00:00:00Z" }),
      row({ id: "other", author: "someone_else", views: 1, publishedAt: "2026-10-30T00:00:00Z" }),
    ];
    const target = row({ id: "t", publishedAt: "2026-11-01T12:00:00.000Z", views: 300 });
    const b = breakoutOf(target, [...earlier, ...noise, target], { now: NOW });
    assert.equal(b.peers, 8);
    assert.equal(b.multiple, 3);
    assert.equal(b.band, "beat");
  });

  it("drops peers under 48 hours old from a walk's baseline, and marks a young post as still rising", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const earlier = series(8, () => 100);
    const young = [row({ id: "y1", views: 1, publishedAt: "2026-11-02T00:00:00Z" })];
    const target = row({ id: "t", publishedAt: "2026-11-03T06:00:00Z", views: 500 });
    const b = breakoutOf(target, [...earlier, ...young, target], { now });
    assert.equal(b.peers, 8);
    assert.equal(b.base, 100);
    assert.equal(b.settling, true);
    assert.match(describeB(b), /still rising/);
  });

  it("names a Reddit post's base by its score, the count the card shows (live run 5, 26/11/2026)", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const earlier = series(8, () => 100, { platform: "reddit", views: null, likes: 100 });
    const target = row({ platform: "reddit", id: "t", publishedAt: "2026-11-01T06:00:00Z", views: null, likes: 500 });
    const b = breakoutOf(target, [...earlier, target], { now });
    assert.equal(b.metric, "likes");
    assert.equal(describeB(b), "5x its author's median score of 100 over 8 posts");
  });

  it("in discovery mode takes the nearest 20 posts on either side and counts the young ones", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const page = series(8, () => 100, {}, "2026-11-03T12:00:00Z"); // daily, the newest 12 hours old
    const target = row({ id: "t", publishedAt: "2026-10-29T12:00:00Z", views: 900 });
    const b = breakoutOf(target, [target, ...page], { now, mode: "around" });
    assert.equal(b.peers, 8);
    assert.equal(b.youngPeers, 1);
    assert.equal(b.inflatedByYoung, false); // 1 of 8 is not more than a quarter
    assert.equal(b.multiple, 9);
    assert.equal(cardWorthy(b), true);
  });

  it("marks a multiple inflated when more than a quarter of its peers are under 48 hours old, and checks it against its settled peers", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const settled = series(5, () => 1_000, {}, "2026-10-30T12:00:00Z");
    const young = [0, 1, 2].map((i) => row({ id: `y${i}`, views: 100, publishedAt: new Date(now.getTime() - (5 + i) * 3_600_000).toISOString() }));
    const target = row({ id: "t", publishedAt: "2026-10-20T12:00:00Z", views: 9_000 });
    const b = breakoutOf(target, [target, ...settled, ...young], { now, mode: "around" });
    assert.equal(b.peers, 8);
    assert.equal(b.youngPeers, 3);
    assert.equal(b.inflatedByYoung, true);
    assert.equal(b.settledMultiple, 9); // 9,000 over the 5 settled peers at 1,000
    assert.equal(b.settledPeers, 5);
    assert.equal(cardWorthy(b), true); // still 3x or more without the young peers
    assert.match(describeB(b), /3 of 8 comparable posts are under 48 hours old; the multiple may be high/);
    // Below 5 settled peers there is no settled multiple; 9x over its best post still carries it.
    const thin = breakoutOf(target, [target, ...settled.slice(0, 4), ...young, row({ id: "y9", views: 100, publishedAt: new Date(now.getTime() - 3_600_000).toISOString() })], { now, mode: "around" });
    assert.equal(thin.settledMultiple, null);
    assert.equal(thin.overBestPeer, 9);
    assert.equal(cardWorthy(thin), true);
  });

  it("keeps file 18's biggest TikTok break-out on the card: 312.74x, 141.68x over its best comparable post (req 18-188)", () => {
    const target = rowsOf(rec("18-165")).find((r) => r.views === 159_810)!;
    const b = breakoutOf(target, [target, ...rowsOf(rec("18-188"))], { now: RUN_AT, mode: "around" });
    assert.deepEqual(
      { multiple: b.multiple, peers: b.peers, young: b.youngPeers, inflated: b.inflatedByYoung, settledPeers: b.settledPeers, settled: b.settledMultiple, best: b.overBestPeer },
      { multiple: 312.74, peers: 9, young: 5, inflated: true, settledPeers: 4, settled: null, best: 141.68 },
    );
    assert.equal(cardWorthy(b), true);
    assert.match(describeB(b), /141\.68x over its best comparable post/);
  });

  it("keeps an inflated post off the lead when it is not 3x over its settled peers nor over its best post", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const settled = series(5, (i) => (i === 0 ? 400 : 100), {}, "2026-10-30T12:00:00Z");
    const young = [0, 1, 2].map((i) => row({ id: `y${i}`, views: 10, publishedAt: new Date(now.getTime() - (5 + i) * 3_600_000).toISOString() }));
    const target = row({ id: "t", publishedAt: "2026-10-20T12:00:00Z", views: 350 });
    const b = breakoutOf(target, [target, ...settled, ...young], { now, mode: "around" });
    assert.equal(b.band, "beat"); // 350 over a median of 100
    assert.equal(b.settledMultiple, 3.5);
    assert.equal(b.overBestPeer, 0.88);
    assert.equal(cardWorthy(b), true);
    const lower = breakoutOf({ ...target, views: 280 }, [target, ...settled, ...young], { now, mode: "around" });
    assert.equal(lower.multiple, 2.8);
    assert.equal(cardWorthy(lower), false);
  });

  it("bands at 3 and 1.5", () => {
    assert.equal(bandOf(3), "beat");
    assert.equal(bandOf(2.99), "above");
    assert.equal(bandOf(1.5), "above");
    assert.equal(bandOf(1.49), "normal");
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([]), null);
  });
});

describe("a base too small to compare against", () => {
  const NOW = new Date("2026-11-10T12:00:00.000Z");
  const target = (over: Partial<Parameters<typeof row>[0]>) => row({ id: "t", publishedAt: "2026-11-01T12:00:00.000Z", ...over });

  it("gives no multiple when the earlier posts' median is under 100 views", () => {
    const b = breakoutOf(target({ views: 48_642 }), series(11, (i) => [7, 5, 22, 12, 5, 1, 3, 3, 26, 2, 4][i]), { now: NOW });
    assert.equal(b.band, "base_too_small");
    assert.equal(b.multiple, null);
    assert.equal(b.base, 5);
    assert.equal(b.overBestPeer, null);
    assert.equal(b.settledMultiple, null);
    assert.equal(cardWorthy(b), false);
    assert.equal(describeB(b), "its earlier posts had a median of 5 views, too few to compare");
  });

  it("still measures a base of 100 views", () => {
    const b = breakoutOf(target({ views: 1_000 }), series(10, () => 100), { now: NOW });
    assert.equal(b.band, "beat");
    assert.equal(b.multiple, 10);
  });

  it("needs a median of 10 likes over an author's own posts", () => {
    const low = breakoutOf(target({ views: null, likes: 400 }), series(10, () => 0, { views: null, likes: 4 }), { now: NOW, metric: "likes" });
    assert.equal(low.band, "base_too_small");
    const ok = breakoutOf(target({ views: null, likes: 400 }), series(10, () => 0, { views: null, likes: 10 }), { now: NOW, metric: "likes" });
    assert.equal(ok.multiple, 40);
  });

  it("measures a small Reddit community, whose base is the community's posts, from a median score of 2", () => {
    // A score starts at 1, the poster's own vote: a median of 1 means the community's posts draw no other votes.
    const small = breakoutOf(target({ platform: "reddit", views: null, likes: 300 }), series(10, () => 0, { platform: "reddit", views: null, likes: 5 }), { now: NOW, metric: "likes" });
    assert.equal(small.band, "beat");
    assert.equal(small.multiple, 60);
    const dead = breakoutOf(target({ platform: "reddit", views: null, likes: 300 }), series(10, () => 0, { platform: "reddit", views: null, likes: 1 }), { now: NOW, metric: "likes" });
    assert.equal(dead.band, "base_too_small");
    assert.equal(describeB(dead), "its earlier posts had a median score of 1, too few to compare");
  });
});

describe("on the study's recorded responses", () => {
  it("abstains where the API printed 32.99 from two comparable posts (req 21-29)", () => {
    const r = rec("21-29");
    const rows = rowsOf(r);
    const flagged = r.body.data.items.filter((it: any) => it.computed?.vs_creator?.ratio === 32.99);
    assert.equal(flagged.length, 1);
    const target = rows.find((x) => x.id === flagged[0].post.id)!;
    const b = breakoutOf(target, rows, { now: new Date("2026-11-26T14:00:00Z") });
    assert.equal(b.band, "too_few");
    assert.equal(b.multiple, null);
  });

  it("in \"around\" mode reproduces file 18's hand-read TikTok baselines: 511 over 9 videos, 787.5 over 10, 927 over 9", () => {
    // The method file 25 replaced for discovery: kept as a check that "around" mode still does what it says.
    const search = [...rowsOf(rec("18-164")), ...rowsOf(rec("18-165"))];
    const cases: [number, string, number, number][] = [
      [159_810, "18-188", 511, 9],
      [224_178, "18-187", 787.5, 10],
      [86_349, "18-192", 927, 9],
    ];
    for (const [views, page, base, peers] of cases) {
      const target = search.find((r) => r.views === views)!;
      const b = breakoutOf(target, [target, ...rowsOf(rec(page))], { now: RUN_AT, mode: "around" });
      assert.equal(b.base, base, `${views}`);
      assert.equal(b.peers, peers, `${views}`);
      assert.equal(b.band, "beat");
    }
  });

  it("measures before-only, as file 25 did by hand: TikTok 69x, 72x and 18.5x where file 18's newest pages gave 313x, 285x and 240x", () => {
    const now = new Date("2026-11-26T19:40:00Z");
    // The break-out post sits inside reader 25's walk; its numerator is the walk's own count (19:35 UTC).
    const cases: [string, number, number, number, number][] = [
      ["25-46", 160_995, 68.65, 2345, 14],
      ["25-47", 227_202, 71.56, 3175, 9],
      ["25-48", 300_011, 18.53, 16_194, 19],
      ["25-57", 84_130, 83.71, 1005, 17],
    ];
    for (const [q, views, multiple, base, peers] of cases) {
      const page = rowsOf(rec(q));
      const b = breakoutWithPage(page.find((r) => r.views === views)!, page, { now });
      assert.deepEqual({ multiple: b.multiple, base: b.base, peers: b.peers, mode: b.mode }, { multiple, base, peers, mode: "previous" }, q);
    }
    // 23 earlier videos: the engine takes the latest 20 (822 median, 106.74x); file 25 used all 23 (767, 114x).
    const p49 = rowsOf(rec("25-49"));
    assert.equal(breakoutWithPage(p49.find((r) => r.views === 87_744)!, p49, { now }).multiple, 106.74);
  });

  it("baselines X on the originals search ending at the post (file 25: 1,016x over 2,121), text with text", () => {
    const search = [...rowsOf(rec("18-162")), ...rowsOf(rec("18-163"))];
    const t = search.find((r) => r.views === 2_154_622)!;
    const b = breakoutWithPage(t, rowsOf(rec("25-12")), { now: RUN_AT });
    // File 25 counted 15 originals; 2 are videos, which the media-kind split leaves out of a text post's base. The median is the same.
    assert.deepEqual({ multiple: b.multiple, base: b.base, peers: b.peers }, { multiple: 1015.85, base: 2121, peers: 13 });
    // The page ends at the post's minute and holds the post itself, which is dropped by id.
    assert.ok(rowsOf(rec("25-12")).some((r) => r.id === t.id));
    assert.equal(b.peerIds.includes(t.id), false);
  });

  it("marks thin X baselines too few instead of printing file 18's 1,409 (5 originals)", () => {
    const target = [...rowsOf(rec("18-162")), ...rowsOf(rec("18-163"))].find((r) => r.views === 2_154_622)!;
    const b = breakoutOf(target, [target, ...rowsOf(rec("18-175"))], { now: RUN_AT, mode: "around" });
    assert.equal(b.band, "too_few");
  });

  it("codes a 202-row brand timeline: reposts and self-replies never enter a baseline", () => {
    const rows = rowsOf(rec("18-77"));
    const kinds = rows.reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
    assert.deepEqual(kinds, { original: 129, repost: 56, thread_part: 17 });
    const bs = breakouts(rows, { now: RUN_AT });
    assert.equal(bs.length, 129 - rows.filter((r) => r.kind === "original" && r.pinned).length);
    for (const b of bs) for (const id of b.peerIds) assert.equal(rows.find((r) => r.id === id)!.kind, "original");
  });
});

describe("one account's pattern", () => {
  // Posts with a given multiple, daily, the newest on 31/10/2026: contrast reads only the multiple.
  const items = (n: number, over: (i: number) => Partial<ReturnType<typeof row>> = () => ({}), multiple: (i: number) => number = () => 1) =>
    series(n, () => 100, {}, "2026-11-01T00:00:00Z").map((r, i) => {
      const r2 = { ...r, ...over(i) };
      return { row: r2, breakout: { ...breakoutOf(r2, [], { now: NOW }), multiple: multiple(i), band: bandOf(multiple(i)) } };
    });

  it("calls no pattern under 24 settled posts", () => {
    const c = contrast(items(20), {}, { now: NOW });
    assert.deepEqual(c, { called: false, reason: "too_few_posts", posts: 20, needed: 24 });
  });

  it("never compares across platforms", () => {
    const it2 = items(30);
    it2[5] = { ...it2[5], row: { ...it2[5].row, platform: "tiktok" } };
    const c = contrast(it2, {}, { now: NOW });
    assert.equal(c.called, false);
    assert.equal(c.called === false && c.reason, "mixed_platforms");
  });

  it("counts a trait in the top third against the bottom third and lists the unclassified", () => {
    // Every third post is a video at 5x; the rest are text posts at 1x. Thirds of 39 settled posts are 13.
    const it2 = items(39, (i) => ({ video: i % 3 === 0, text: i === 3 ? "" : "x" }), (i) => (i % 3 === 0 ? 5 : 1));
    const c = contrast(it2, { format: (r) => (r.video ? "video" : "text"), hook: (r) => (r.text ? "x" : null) }, { now: NOW });
    assert.equal(c.called, true);
    if (!c.called) return;
    const video = c.traits.find((t) => t.feature === "format" && t.value === "video")!;
    assert.equal(video.finding, true);
    assert.equal(video.top, 13);
    assert.equal(video.bottom, 0);
    assert.equal(video.topShare, 1);
    const text = c.traits.find((t) => t.feature === "format" && t.value === "text")!;
    assert.equal(text.finding, false);
    assert.deepEqual(c.unclassified.hook, ["p3"]);
  });

  it("finds a lasting turning point but not a single hit", () => {
    const lasting = series(30, (i) => (i < 15 ? 100 : 400));
    const tp = turningPoints(lasting, "views");
    assert.equal(tp.length, 1);
    assert.equal(tp[0].direction, "up");
    const oneHit = series(30, (i) => (i === 15 ? 100_000 : 100));
    assert.equal(turningPoints(oneHit, "views").length, 0);
  });

  it("cuts a catalogue into up to ten blocks of three or more, and finds who beats their neighbours", () => {
    assert.equal(blocksOf(series(30, () => 1), "views").length, 10);
    assert.equal(blocksOf(series(12, () => 1), "views").length, 4);
    const rows = series(9, (i) => [100, 900, 100, 100, 100, 100, 100, 100, 100][i]);
    const n = neighbours(rows, "views");
    assert.equal(n.get("p1")!.beats, true);
    assert.equal(n.get("p0")!.beats, false);
  });

  it("says a format travels only when two or more other authors break out with it", () => {
    const mk = (author: string, band: "beat" | "normal") => ({ row: row({ author, video: true }), breakout: { band } as any });
    const t = travels([mk("a", "beat"), mk("b", "beat"), mk("subject", "beat"), mk("c", "normal")], (r) => (r.video ? "video" : "text"), "subject");
    assert.deepEqual(t, [{ format: "video", authors: ["a", "b"], travels: true }]);
    const one = travels([mk("a", "beat"), mk("subject", "beat")], () => "video", "subject");
    assert.equal(one[0].travels, false);
  });
});
