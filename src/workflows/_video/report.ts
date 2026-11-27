// A video-platform marketing run as the render kit takes it: the card, the report (summary
// first, each line citing its finding; then the sections below; then the engine's own "How
// this was read", "What we could not verify" and "Method notes"), the evidence, the tiles, the
// charts and every row read as a table. Numbers in prose come only from findings; accounts
// under 10,000 followers are described, never named or linked.
import { BANDS, FLAG_LABEL, MIN_BASE, MIN_PEERS, PATTERN_MIN_POSTS, commentsOf, contrast, Evidence } from "../../engine/index.ts";
import type { CardInput, Meta, ReportInput, Row } from "../../engine/index.ts";
import type { Session } from "../../kit/record.ts";
import type { Table, WorkflowResult } from "../../render/types.ts";
import type { WorkflowArgs } from "../types.ts";
import { ASK_CLASSES, ASK_LABEL } from "./comments.ts";
import { hookOf, hourUtc, traitsOf } from "./features.ts";
import { accountLabel, mayName, NAME_MIN_FOLLOWERS } from "./naming.ts";
import { dmy } from "./window.ts";
import type { VideoItem, VideoRun } from "./run.ts";
import type { VideoSpec } from "./spec.ts";

export const REPORT_SECTIONS = [
  "What broke out",
  "What the break-outs did",
  "Sounds and hashtags",
  "What the comments ask",
  "What was said aloud",
  "Accounts to watch",
  "What will not copy",
  "Next plays",
];

/** An audience this large carries reach a smaller account cannot borrow. */
export const BIG_AUDIENCE = 100_000;
export const CHECK_DAYS = 14;
const TOP_ROWS = 10;

const n = (x: number) => x.toLocaleString("en-GB");

/** A multiple as printed: whole from 10x up, one decimal below. */
export function times(m: number | null): string {
  if (m === null) return "no multiple";
  return m >= 10 ? `${Math.round(m)}x` : `${Math.round(m * 10) / 10}x`;
}
// Quoted captions and comments keep their words; an em dash is printed as a spaced hyphen.
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const plural = (k: number, word: string) => `${word}${k === 1 ? "" : "s"}`;

export function videoResult(spec: VideoSpec, run: VideoRun, session: Session, args: WorkflowArgs, quoteDeep: { expected: number; max: number }): WorkflowResult {
  const meta: Meta = session.meta();
  const ev = new Evidence();
  ev.seeRequests(session.ledger.requestIds());
  const P = spec.postNoun;
  const A = spec.accountNoun;

  const followersOf = (r: Row) => run.followers.get(spec.groupKey(r)) ?? r.authorFollowers ?? null;
  const label = (r: Row) => accountLabel({ platform: r.platform, handle: r.author || null, followers: followersOf(r) });
  const named = (r: Row) => mayName(followersOf(r)) && Boolean(r.author);
  const linkOf = (r: Row) => (named(r) && r.url ? r.url : "in data/posts.csv");

  // Measured means given a multiple: a post with too few earlier posts on the pages read is counted apart.
  const measured = run.items.filter((i) => i.breakout.multiple !== null);
  const viral = measured.filter((i) => i.viral);
  const rest = measured.filter((i) => !i.viral);
  const searchIds = run.searches.map((r) => r.requestId).filter((x): x is string => x !== null);
  const baselineIds = run.baselines.flatMap((b) => b.records.map((r) => r.requestId)).filter((x): x is string => x !== null);
  const smallViral = viral.filter((i) => !named(i.row)).length;

  // The dates a baseline covers: an old base under a new hit reads differently from last week's.
  const published = new Map<string, string>();
  for (const b of run.baselines) for (const r of b.rows) if (r.publishedAt) published.set(r.id, r.publishedAt);
  const spanOf = (i: VideoItem) => {
    const d = i.breakout.peerIds.map((id) => published.get(id)).filter((x): x is string => Boolean(x)).sort();
    if (!d.length) return "";
    const [a, b] = [dmy(d[0]), dmy(d[d.length - 1])];
    return a.slice(6) === b.slice(6) ? `, ${a.slice(0, 5)} to ${b}` : `, ${a} to ${b}`;
  };

  // ── Coverage ──
  for (const r of run.searches) ev.cover(r, r.stage);
  for (const b of run.baselines) for (const r of b.records) ev.cover(r, r.stage);
  for (const r of run.comments) ev.cover(r, r.stage);

  // ── Findings ──
  const F1 = ev.add({
    claim: `${viral.length} of ${measured.length} ${P}s with a baseline reached ${BANDS.beat} times or more their ${A}'s usual views.`,
    confidence: "seen",
    numbers: { breakouts: viral.length, measured: measured.length, read: run.candidates.read, candidates: run.candidates.rows.length, unread: run.unread.length, small: smallViral, beat: BANDS.beat, minPeers: MIN_PEERS, nameMin: NAME_MIN_FOLLOWERS, floor: spec.floorViews },
    requests: [...searchIds, ...baselineIds].length ? [...searchIds, ...baselineIds] : [...session.ledger.requestIds()].slice(0, 1),
    method: `views over the median of the ${A}'s ${MIN_PEERS} to 20 comparable ${P}s published before it`,
  });
  const itemFinding = new Map<string, string>();
  for (const i of viral.slice(0, TOP_ROWS)) {
    const f = ev.add({
      claim: `${label(i.row)}: ${i.line}.`,
      confidence: "seen",
      numbers: { views: i.breakout.value, base: i.breakout.base, peers: i.breakout.peers, multiple: i.breakout.multiple, followers: followersOf(i.row) },
      requests: i.breakout.requestIds,
      rows: [i.row.id],
      limitations: i.breakout.settling ? [`still rising: under 48 hours old when read`] : [],
    });
    itemFinding.set(i.row.id, f.id);
  }

  // Traits among the break-outs and the rest.
  type Count = { trait: string; value: string; v: number; r: number };
  const counts: Count[] = [];
  const features: Record<string, (r: Row) => string | null> = {
    length: (r) => traitsOf(r).length,
    hook: (r) => traitsOf(r).hook,
    sound: (r) => traitsOf(r).sound,
    "comment gate": (r) => traitsOf(r).gated,
    "hour (UTC)": (r) => {
      const h = hourUtc(r);
      return h === null ? null : `${String(Math.floor(h / 6) * 6).padStart(2, "0")}:00 to ${String(Math.floor(h / 6) * 6 + 5).padStart(2, "0")}:59`;
    },
  };
  for (const [trait, fn] of Object.entries(features)) {
    const values = new Set(measured.map((i) => fn(i.row)).filter((x): x is string => x !== null));
    for (const value of values) {
      // An ungated post is the ordinary case: only the gate itself is worth a row.
      if (trait === "comment gate" && value === "no") continue;
      counts.push({ trait, value, v: viral.filter((i) => fn(i.row) === value).length, r: rest.filter((i) => fn(i.row) === value).length });
    }
  }
  counts.sort((a, b) => b.v - a.v || a.r - b.r || a.trait.localeCompare(b.trait));
  // The trait a summary leads with: what a person can make (length, hook, sound) before when they post.
  const LEAD = ["length", "hook", "sound", "hour (UTC)"];
  const topTrait = LEAD.map((t) => counts.find((c) => c.trait === t && c.v >= 2)).find((c) => c !== undefined) ?? null;
  const pattern = contrast(measured.map((i) => ({ row: i.row, breakout: i.breakout })), features, { now: args.now, minAuthors: 2 });
  const FT = ev.add({
    claim: topTrait ? `${topTrait.v} of ${viral.length} break-outs share the ${topTrait.trait} \`${topTrait.value}\`, against ${topTrait.r} of ${rest.length} of the rest.` : "No trait is shared by two or more break-outs.",
    confidence: "seen",
    numbers: { shared: topTrait?.v ?? 0, breakouts: viral.length, restShared: topTrait?.r ?? 0, rest: rest.length, settled: pattern.posts, needed: pattern.called ? pattern.posts : pattern.needed },
    requests: [...searchIds].slice(0, 3).length ? searchIds.slice(0, 3) : F1.requests.slice(0, 1),
    limitations: pattern.called ? [] : [`too few ${P}s to call a pattern: ${pattern.posts} settled with a multiple, ${PATTERN_MIN_POSTS} needed`],
  });

  const asks = run.asks;
  const FC = asks.read
    ? ev.add({
        claim: `${asks.read} comments read on ${run.comments.length} ${P}s; ${asks.labelled} labelled.`,
        confidence: "seen",
        numbers: { read: asks.read, posts: run.comments.length, labelled: asks.labelled, unlabelled: asks.unlabelled, questions: asks.classes.question.count, buying: asks.classes.purchase_intent.count, complaints: asks.classes.complaint.count, positive: asks.positive, negative: asks.negative },
        requests: asks.requestIds,
        limitations: asks.unlabelled ? [`${asks.unlabelled} comments came back unlabelled and are not counted in any class`] : [],
      })
    : null;

  const big = viral.filter((i) => (followersOf(i.row) ?? 0) >= BIG_AUDIENCE);
  const gated = viral.filter((i) => traitsOf(i.row).gated === "yes");
  const flagged = measured.filter((i) => i.flag?.flag);

  // ── Unverified ──
  ev.unknown({ what: `Who shared each ${P}`, why: `${spec.label} has no list of who shared a ${P}, so amplifiers are not read` });
  const span = `${dmy(run.window.since)} to ${dmy(run.window.until)}`;
  if (run.candidates.outsideWindow && !run.window.allTime)
    ev.unknown({ what: `${n(run.candidates.outsideWindow)} ${plural(run.candidates.outsideWindow, P)} published outside ${span}`, why: "older posts are outside the window this run reads", check: `socialcrawl ${spec.workflow} "${run.query}" --since 2000-01-01 (all time)` });
  if (run.candidates.belowFloor) ev.unknown({ what: `${n(run.candidates.belowFloor)} ${plural(run.candidates.belowFloor, P)} under the reach floor`, why: `under ${n(spec.floorViews)} views, so not measured` });
  if (run.candidates.noViews) ev.unknown({ what: `${n(run.candidates.noViews)} ${plural(run.candidates.noViews, P)} with no view count`, why: "the platform returned none; unknown, not zero" });
  const reasons: Record<string, string> = { below_top_n: `outside the ${A}s chosen for a baseline at this depth`, budget: "the stage's share of the budget ran out", error: "the baseline read failed (kept in responses.jsonl)", no_id: `the row has no ${A} id to read` };
  const byReason = new Map<string, number>();
  for (const u of run.unread) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
  for (const [r, k] of byReason) ev.unknown({ what: `${n(k)} ${plural(k, "candidate")} with no baseline`, why: reasons[r] ?? r, check: "socialcrawl " + spec.workflow + ` "${run.query}" --deep` });
  const tooFew = run.items.filter((i) => i.breakout.band === "too_few").length;
  const smallBase = run.items.filter((i) => i.breakout.band === "base_too_small").length;
  if (smallBase) ev.unknown({ what: `${n(smallBase)} ${plural(smallBase, P)} whose ${A}'s earlier ${P}s had a median under ${n(MIN_BASE.views)} views`, why: "too small a base for a multiple: a quiet or new account's first hit is not a break-out against its own past" });
  if (tooFew) ev.unknown({ what: `${n(tooFew)} ${plural(tooFew, P)} with too few earlier ${P}s`, why: `fewer than ${MIN_PEERS} comparable ${P}s before it on the pages read, so no multiple is given` });
  for (const g of asks.gaps) ev.unknown({ what: `${n(g.unlabelled)} comments unlabelled (${g.endpoint})`, why: g.skipReason ? `labels ${g.status}: ${g.skipReason}` : `labels ${g.status ?? "missing"}` });
  for (const e of session.errors) ev.unknown({ what: `${e.stage} failed`, why: `${e.status ?? "no status"} ${e.message}`.trim() });

  // ── Sections ──
  const sections: ReportInput["sections"] = [];
  const brokeRows = viral.slice(0, TOP_ROWS).map((i, k) => [
    String(k + 1),
    label(i.row),
    i.row.publishedAt ? dmy(i.row.publishedAt) : "unknown",
    times(i.breakout.multiple),
    n(i.breakout.value ?? 0),
    `median of ${n(Math.round(i.breakout.base ?? 0))} views over ${i.breakout.peers} earlier ${P}s${spanOf(i)}${i.breakout.settling ? ", still rising" : ""}`,
    traitsOf(i.row).length ?? "unknown",
    hookOf(i.row.text) ?? "",
    linkOf(i.row),
  ]);
  sections.push({
    title: "What broke out",
    body: [
      viral.length
        ? `Each ${P} is measured against its ${A}'s own ${P}s published before it; ${viral.length} of ${measured.length} reached ${BANDS.beat} times or more [${F1.id}].`
        : measured.length
          ? `None of the ${measured.length} ${P}s with a baseline reached ${BANDS.beat} times its ${A}'s usual views [${F1.id}].`
          : `No ${P} could be measured: the searches found no candidate above the floor with a baseline [${F1.id}].`,
      brokeRows.length ? "\n" + table(["#", "Account", "Published", "× its usual views", "Views", "Baseline", "Length", "Hook", "Link"], brokeRows) : "",
      flagged.length ? "\n" + flagged.map((i) => `- ${label(i.row)}: ${FLAG_LABEL[i.flag!.flag!]} [${itemFinding.get(i.row.id) ?? F1.id}].`).join("\n") : "",
    ].join("\n"),
  });

  sections.push({
    title: "What the break-outs did",
    body: [
      counts.length ? table(["Trait", "Value", `Break-outs (of ${viral.length})`, `The rest (of ${rest.length})`], counts.slice(0, 16).map((c) => [c.trait, c.value, String(c.v), String(c.r)])) : `No ${P} was measured, so no trait is counted.`,
      "",
      pattern.called
        ? `Top third against bottom third over ${pattern.posts} settled ${P}s: ${pattern.traits.filter((t) => t.finding).map((t) => `${t.feature} \`${t.value}\``).join(", ") || "no trait separates them"} [${FT.id}].`
        : `These are counts, not a pattern: ${pattern.posts} settled ${plural(pattern.posts, P)} ${pattern.posts === 1 ? "carries" : "carry"} a multiple and ${pattern.needed} are needed to compare the top third with the bottom third [${FT.id}].`,
    ].join("\n"),
  });

  const soundRows = new Map<string, { kind: string; all: number; v: number }>();
  for (const i of measured) {
    const s = i.row.sound;
    if (!s) continue;
    const key = s.original ? "a creator's own sound" : (s.title ?? s.id ?? "unknown sound");
    const e = soundRows.get(key) ?? { kind: s.original ? "own" : "licensed", all: 0, v: 0 };
    e.all++;
    if (i.viral) e.v++;
    soundRows.set(key, e);
  }
  const tags = new Map<string, { v: number; r: number }>();
  for (const i of measured) for (const h of new Set(i.row.hashtags ?? [])) {
    const e = tags.get(h) ?? { v: 0, r: 0 };
    i.viral ? e.v++ : e.r++;
    tags.set(h, e);
  }
  sections.push({
    title: "Sounds and hashtags",
    body: [
      soundRows.size
        ? table(["Sound", "Kind", `${cap(P)}s measured`, "Break-outs"], [...soundRows.entries()].sort((a, b) => b[1].v - a[1].v || b[1].all - a[1].all).slice(0, 8).map(([k, e]) => [k, e.kind, String(e.all), String(e.v)]))
        : `${spec.label} rows read here carry no sound.`,
      "",
      tags.size ? table(["Hashtag", "Break-outs", "The rest"], [...tags.entries()].sort((a, b) => b[1].v - a[1].v || b[1].r - a[1].r).slice(0, 10).map(([h, e]) => [`#${h}`, String(e.v), String(e.r)])) : "No hashtags on the measured rows.",
    ].join("\n"),
  });

  sections.push({
    title: "What the comments ask",
    body: FC
      ? [
          `Comments read on the top ${P}s, labelled by the API [${FC.id}].`,
          "",
          table(["Kind", "Comments", "Most liked"], ASK_CLASSES.map((k) => [ASK_LABEL[k], String(asks.classes[k].count), asks.classes[k].quotes.map((q) => `"${q.text}"`).join(" · ") || "none"])),
        ].join("\n")
      : `No comments were read in this run.`,
  });

  const tRows = run.transcripts.map((t) => {
    const row = run.items.find((i) => i.row.id === t.rowId)?.row ?? run.candidates.rows.find((r) => r.id === t.rowId);
    const words = t.text.split(/\s+/).slice(0, 40).join(" ");
    return [row ? label(row) : t.rowId, `"${words}${t.text.split(/\s+/).length > 40 ? " …" : ""}"`];
  });
  sections.push({ title: "What was said aloud", body: tRows.length ? table([cap(P), "First words"], tRows) : `No transcript was read in this run.` });

  const accounts = new Map<string, { row: Row; best: number; k: number }>();
  for (const i of viral) {
    if (!named(i.row)) continue;
    const k = spec.groupKey(i.row);
    const e = accounts.get(k) ?? { row: i.row, best: 0, k: 0 };
    e.best = Math.max(e.best, i.breakout.multiple ?? 0);
    e.k++;
    accounts.set(k, e);
  }
  sections.push({
    title: "Accounts to watch",
    body: [
      accounts.size ? table(["Account", "Followers", "Best multiple", "Break-outs"], [...accounts.values()].sort((a, b) => b.best - a.best).map((e) => [label(e.row), n(followersOf(e.row) ?? 0), times(e.best), String(e.k)])) : `No break-out came from an account of ${n(NAME_MIN_FOLLOWERS)} followers or more.`,
      smallViral
        ? `\n${smallViral} ${smallViral === 1 ? "break-out came from an account" : "break-outs came from accounts"} under ${n(NAME_MIN_FOLLOWERS)} followers or of unknown size; ${smallViral === 1 ? "it is" : "they are"} described here and listed in data/posts.csv [${F1.id}].`
        : "",
    ].join("\n"),
  });

  const wont: string[][] = [];
  if (big.length) wont.push([`Reach from an audience of ${n(BIG_AUDIENCE)} or more`, String(big.length), "a large audience lifts a post before its content does"]);
  if (gated.length) wont.push(["A reward gated behind a comment", String(gated.length), "it buys comments, and platforms treat engagement bait as spam"]);
  const licensed = viral.filter((i) => traitsOf(i.row).sound === "licensed").length;
  if (licensed) wont.push(["A licensed sound that is trending now", String(licensed), "a trending sound can be stale within weeks"]);
  if (flagged.length) wont.push(["Engagement that looks unusual (inferred)", String(flagged.length), "likes per view far from the run's median"]);
  sections.push({
    title: "What will not copy",
    body: wont.length ? table(["What", "Break-outs", "Why it may not copy"], wont) : `No break-out here rests on a large audience, a comment gate, a trending sound or unusual engagement [${F1.id}].`,
  });

  const cmd = (rest: string) => `\`npx -y socialcrawl@latest ${rest}\``;
  const lead = viral[0] ?? null;
  const plays: string[][] = [];
  plays.push([`Read deeper: more searches, more ${A}s, more comments`, cmd(`${spec.workflow} "${run.query}" --deep`), `free quote first: about ${quoteDeep.expected} credits, at most ${quoteDeep.max}`]);
  if (lead) {
    const where = named(lead.row) && lead.row.url ? lead.row.url : "<the first link in data/posts.csv>";
    plays.push([`Track the top break-out (${label(lead.row)})`, cmd(`post-tracker ${where}`), `its views in ${CHECK_DAYS} days against ${n(lead.row.views ?? 0)} today`]);
    plays.push(["Take it apart shot by shot", cmd(`video-teardown ${where}`), "what is on screen and said, its words, sound and comments"]);
  }
  if (topTrait) plays.push([`Post your own ${P} with the ${topTrait.trait} \`${topTrait.value}\``, "-", `in ${CHECK_DAYS} days, whether it reached ${BANDS.beat} times your own median views`]);
  sections.push({ title: "Next plays", body: table(["Play", "Command", `What to check`], plays) });

  // ── Summary ──
  const summary: string[] = [];
  summary.push(
    viral.length
      ? `${viral.length} of ${measured.length} ${P}s with a baseline broke out at ${BANDS.beat} times or more ${viral.length === 1 ? "its" : "their"} ${A}'s usual views, out of ${run.candidates.rows.length} candidates above the floor [${F1.id}].`
      : `No ${P} broke out: none of the ${measured.length} with a baseline reached ${BANDS.beat} times its ${A}'s usual views [${F1.id}].`,
  );
  if (lead) summary.push(`The largest: ${label(lead.row)}, ${times(lead.breakout.multiple)} over ${lead.breakout.peers} earlier ${P}s [${itemFinding.get(lead.row.id)}].`);
  if (topTrait) summary.push(`${topTrait.v} of ${viral.length} break-outs share the ${topTrait.trait} \`${topTrait.value}\` [${FT.id}].`);
  if (FC) summary.push(`${asks.classes.question.count} questions and ${asks.classes.complaint.count} complaints in ${asks.read} comments read [${FC.id}].`);
  if (run.unread.length) summary.push(`${run.unread.length} ${run.unread.length === 1 ? "candidate" : "candidates"} had no baseline read; see What we could not verify [${F1.id}].`);

  const card: CardInput = {
    command: `/${spec.workflow} "${run.query}"`,
    skill: spec.workflow,
    headlines: cardHeadlines(spec, run, viral, label, asks.classes.question.count, topTrait),
    basis: `${n(run.candidates.read)} ${P}s read, ${run.window.allTime ? "all time" : `${run.window.since.slice(0, 4) === run.window.until.slice(0, 4) ? dmy(run.window.since).slice(0, 5) : dmy(run.window.since)} to ${dmy(run.window.until)}`}, ${n(measured.length)} measured`,
    meta,
    rerun: `npx -y socialcrawl@latest ${spec.workflow} "${run.query}"`,
  };

  const report: ReportInput = {
    command: card.command,
    skill: spec.workflow,
    badge: `${spec.label} · ${run.window.allTime ? `all time to ${dmy(run.window.until)}` : `${dmy(run.window.since)} to ${dmy(run.window.until)}`} · topic filter: \`${run.topic}\` · ${run.candidates.read} ${P}s read · ${run.deep ? "deep" : "default"} run`,
    summary,
    sections,
    evidence: ev,
    meta,
    methodNotes: [
      `A break-out is a ${P} at ${BANDS.beat} times or more the median views of its ${A}'s ${MIN_PEERS} to 20 comparable ${P}s published before it; under ${MIN_PEERS} such ${P}s no multiple is given.`,
      `Candidates are original ${P}s at or above ${n(spec.floorViews)} views from the topic-filtered searches; ${spec.preRank === "views_per_follower" ? "views over followers" : "views"} decides which ${A}s are read first.`,
      `Every search sends the topic filter; no baseline does. Comment labels are sent explicitly and counted at p of 0.5 or more.`,
      `Accounts under ${n(NAME_MIN_FOLLOWERS)} followers, or whose size was not read, are described, not named or linked; data/posts.csv keeps every row.`,
    ],
  };

  const bars = viral.slice(0, TOP_ROWS).map((i) => ({ label: label(i.row), value: i.breakout.multiple ?? 0, note: `${n(i.breakout.value ?? 0)} views`, finding: itemFinding.get(i.row.id) }));

  return {
    card,
    report,
    tiles: [
      { label: `${cap(P)}s read`, value: n(run.candidates.read) },
      { label: "Measured", value: n(measured.length) },
      { label: "Break-outs", value: `${viral.length} of ${measured.length}`, finding: F1.id },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: bars.length ? [{ title: `Break-outs against their ${A}'s usual views`, unit: "x", bars }] : [],
    tables: tablesOf(run),
  };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function cardHeadlines(spec: VideoSpec, run: VideoRun, viral: VideoItem[], label: (r: Row) => string, questions: number, topTrait: { trait: string; value: string; v: number } | null): string[] {
  const P = spec.postNoun;
  const fit = (s: string) => (s.length <= 110 ? s : s.slice(0, 109).replace(/\s+\S*$/, "") + "…");
  const out: string[] = [];
  if (viral.length) out.push(fit(`${viral.length} ${plural(viral.length, P)} broke out at ${BANDS.beat}x or more ${viral.length === 1 ? "its" : "their"} ${spec.accountNoun}'s usual views (${run.items.filter((i) => i.breakout.multiple !== null).length} of ${run.candidates.rows.length} measured)`));
  else out.push(fit(`No ${P} reached ${BANDS.beat}x its ${spec.accountNoun}'s usual views (${run.items.filter((i) => i.breakout.multiple !== null).length} measured)`));
  const lead = viral[0];
  if (lead) out.push(fit(`Top: ${label(lead.row)}, ${times(lead.breakout.multiple)} over ${lead.breakout.peers} earlier ${P}s`));
  if (topTrait) out.push(fit(`${topTrait.v} of ${viral.length} break-outs share the ${topTrait.trait} "${topTrait.value}"`));
  else if (run.asks.read) out.push(fit(`${questions} questions in ${run.asks.read} comments read`));
  return out.slice(0, 3);
}

function tablesOf(run: VideoRun): Record<string, Table> {
  const byId = new Map(run.items.map((i) => [i.row.id, i]));
  const rowOut = (r: Row) => {
    const i = byId.get(r.id);
    return {
      platform: r.platform,
      id: r.id,
      url: r.url,
      author: r.author,
      followers: r.authorFollowers ?? run.followers.get(r.author.toLowerCase()) ?? null,
      published_at: r.publishedAt,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      saves: r.saves,
      duration_s: r.durationSeconds,
      format: r.format ?? null,
      text: r.text,
      hashtags: (r.hashtags ?? []).join(" "),
      sound: r.sound?.title ?? null,
      sound_original: r.sound?.original ?? null,
      multiple: i?.breakout.multiple ?? null,
      band: i?.breakout.band ?? null,
      base: i?.breakout.base ?? null,
      peers: i?.breakout.peers ?? null,
      request_id: r.requestId,
    };
  };
  const posts = run.allRows.map(rowOut);
  const comments = run.comments.flatMap((rec) =>
    commentsOf(rec).map((c) => ({
      post_url: String(rec.params.url ?? ""),
      comment_id: c.id,
      author: c.author,
      text: c.text,
      likes: c.likes,
      published_at: c.publishedAt,
      question_p: (c.labels as any)?.question?.p ?? null,
      purchase_intent_p: (c.labels as any)?.purchase_intent?.p ?? null,
      complaint_p: (c.labels as any)?.complaint?.p ?? null,
      sentiment_level: (c.labels as any)?.sentiment?.level ?? null,
      request_id: c.requestId,
    })),
  );
  const cols = (rows: Record<string, unknown>[], fallback: string[]) => (rows.length ? Object.keys(rows[0]) : fallback);
  const baselines = run.baselines.flatMap((b) => b.rows.map((r) => ({ baseline: b.key, ...rowOut(r) })));
  const transcripts = run.transcripts.map((t) => ({ post_id: t.rowId, text: t.text, request_id: t.requestId }));
  return {
    posts: { columns: cols(posts, ["id"]), rows: posts },
    baselines: { columns: cols(baselines, ["baseline"]), rows: baselines },
    comments: { columns: cols(comments, ["comment_id"]), rows: comments },
    transcripts: { columns: ["post_id", "text", "request_id"], rows: transcripts },
  };
}
