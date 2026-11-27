// socialcrawl social-pulse "<brand or topic>": what changed this week. On-topic posts,
// sentiment, questions and complaints against the week before, what people asked, and the
// posts breaking out against their authors' own earlier posts.
import { FLAG_LABEL } from "../../engine/boosted.ts";
import { MIN_PEERS, describe as describeBreakout } from "../../engine/breakout.ts";
import { Evidence, requestIdsOf } from "../../engine/evidence.ts";
import { rowsOf } from "../../engine/rows.ts";
import type { Platform, Row } from "../../engine/rows.ts";
import { formatNumber } from "../../render/svg.ts";
import type { BarChart, Table, WorkflowResult } from "../../render/types.ts";
import { NAME_FLOOR, whoOf } from "../social-viral/index.ts";
import { FLOORS } from "../social-viral/viral.ts";
import type { ViralItem, ViralPlatform } from "../social-viral/viral.ts";
import type { Workflow, WorkflowArgs } from "../types.ts";
import { changeOf, weeksOf } from "./pulse.ts";
import type { WeekSummary } from "./pulse.ts";
import { DEEP_SCALE, PULSE_SHARE, runPulse } from "./runner.ts";
import type { PulseInput, PulseOutput, WeekRead } from "./runner.ts";

export const SKILL = "social-pulse";
const LABEL: Record<string, string> = { x: "X", twitter: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", reddit: "Reddit", linkedin: "LinkedIn" };
const label = (p: string) => LABEL[p] ?? p;
const n = (x: number) => x.toLocaleString("en-GB");
const pct = (share: number) => `${Math.round(share * 100)}%`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const metricWord = (p: Platform) => (p === "reddit" ? "score" : FLOORS[p as ViralPlatform]?.metric ?? "views");
/** Whose usual reach a post is compared with: on Reddit its community's, elsewhere its author's. */
const whose = (p: Platform) => (p === "reddit" ? "its community's" : "its author's");

function inputOf(args: WorkflowArgs): PulseInput {
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about.trim() : undefined;
  return { topic: args.input, ...(about ? { about } : {}), ...weeksOf({ now: args.now, ...(args.until ? { until: args.until } : {}) }) };
}

const ITEM_COLUMNS = ["platform", "id", "url", "author", "author_followers", "published_at", "views", "likes", "comments", "stance", "intent", "relevance", "text", "request_id"];
// The raw discover items, flattened: every post the run read, kept for the person.
const flatItem = (it: Record<string, any>, requestId: string | null) => ({
  platform: it.platform ?? null,
  id: it.native_id ?? it.id ?? null,
  url: it.url ?? null,
  author: it.author?.username ?? null,
  author_followers: it.author?.followers ?? null,
  published_at: it.published_at ?? null,
  views: it.engagement?.views ?? null,
  likes: it.engagement?.likes ?? null,
  comments: it.engagement?.comments ?? null,
  stance: it.judgments?.stance?.label ?? null,
  intent: it.judgments?.intent?.label ?? null,
  relevance: it.judgments?.relevance?.p ?? null,
  text: it.text ?? null,
  request_id: it.provenance?.request_id ?? requestId,
});
const ROW_COLUMNS = ["platform", "id", "url", "author", "author_followers", "published_at", "views", "likes", "comments", "text", "request_id"];
const flatRow = (r: Row) => ({ platform: r.platform, id: r.id, url: r.url, author: r.author, author_followers: r.authorFollowers, published_at: r.publishedAt, views: r.views, likes: r.likes, comments: r.comments, text: r.text, request_id: r.requestId });

function tables(out: PulseOutput): Record<string, Table> {
  const week = (w: WeekRead) => ({ columns: ITEM_COLUMNS, rows: w.items.map((it) => flatItem(it, w.record?.requestId ?? null)) });
  return {
    posts_this_week: week(out.thisWeek),
    posts_week_before: week(out.before),
    baseline_posts: { columns: ROW_COLUMNS, rows: out.records.filter((r) => r.stage.startsWith("baseline:")).flatMap((r) => rowsOf(r).map(flatRow)) },
  };
}

function changeWords(now: number, before: WeekRead): string {
  if (!before.summary) return "the week before was not read";
  const c = changeOf(now, before.summary.kept);
  if (c.share === null) return "none the week before";
  if (c.share === 0) return `the same as the week before`;
  return `${c.share > 0 ? "up" : "down"} ${pct(Math.abs(c.share))} on ${n(c.before)} the week before`;
}

const UNREAD_WHY: Record<string, (p: string) => string> = {
  budget: (p) => `not measured: ${label(p)}'s share of this run was used up; --deep reads more`,
  planned_not_read: () => "not measured: the run stopped before its author's earlier posts were read",
  not_planned: (p) => (p === "linkedin" ? "not measured: a pulse reads no LinkedIn author's earlier posts (5 credits each); social-viral does" : "not measured: no read of its author's earlier posts could be planned"),
};

type Asks = { question: number; complaint: number; recommendation: number; switching: number };
const many = (count: number, one: string, more: string) => `${n(count)} ${count === 1 ? one : more}`;

/** "9 questions, 1 complaint, 3 recommendations and 1 post about switching this week (…the week before)". */
export function asksLine(now: Asks, was: Asks | null | undefined): string {
  const line = `${many(now.question, "question", "questions")}, ${many(now.complaint, "complaint", "complaints")}, ${many(now.recommendation, "recommendation", "recommendations")} and ${many(now.switching, "post", "posts")} about switching this week`;
  return line + (was ? ` (${n(was.question)}, ${n(was.complaint)}, ${n(was.recommendation)} and ${n(was.switching)} the week before)` : "");
}

export function buildResult(out: PulseOutput, input: PulseInput, deep: boolean): WorkflowResult {
  const who = (r: Row) => whoOf(r, r.authorFollowers ?? out.sizes.get(`${r.platform}:${r.author.toLowerCase()}`) ?? null);
  const named = (r: Row) => r.platform === "reddit" || (r.authorFollowers ?? out.sizes.get(`${r.platform}:${r.author.toLowerCase()}`) ?? 0) >= NAME_FLOOR;
  const ev = new Evidence();
  ev.seeRequests(out.ledger.requestIds());
  for (const rec of out.records) if (rec.stage.endsWith(":read")) ev.cover(rec, rec.stage);
  const now: WeekSummary | null = out.thisWeek.summary;
  const was: WeekSummary | null = out.before.summary;
  const reqs = (w: WeekRead) => (w.record ? requestIdsOf(w.record) : []);
  const both = [...reqs(out.thisWeek), ...reqs(out.before)];
  const kept = now?.kept ?? 0;

  const headline = now ? `${input.topic}: ${n(kept)} on-topic posts this week, ${changeWords(kept, out.before)}` : `${input.topic}: this week could not be read`;
  const f1 = ev.add({
    claim: headline,
    confidence: both.length ? "seen" : "unknown",
    numbers: { kept, collected: now?.collected ?? null, kept_before: was?.kept ?? null, change_share: was ? changeOf(kept, was.kept).share : null },
    requests: both,
    method: "posts the same searches returned and judged on topic, one page a platform, each week",
  });

  const share = (s: WeekSummary | null, k: "positive" | "negative") => (s && s.stanceN >= 10 ? s[k] / s.stanceN : null);
  const sentiment =
    now && now.stanceN >= 10
      ? `${pct(share(now, "positive")!)} positive and ${pct(share(now, "negative")!)} negative of the ${n(now.stanceN)} posts with a stance` +
        (was && was.stanceN >= 10 ? `, against ${pct(share(was, "positive")!)} and ${pct(share(was, "negative")!)} the week before` : "")
      : `Too few posts with a stance this week to give shares (${now?.stanceN ?? 0})`;
  const f2 = ev.add({
    claim: sentiment,
    confidence: reqs(out.thisWeek).length ? "seen" : "unknown",
    numbers: { positive_share: share(now, "positive"), negative_share: share(now, "negative"), stance_n: now?.stanceN ?? null, positive_share_before: share(was, "positive"), negative_share_before: share(was, "negative") },
    requests: reqs(out.thisWeek).length ? both : [],
    method: "each kept post's stance label, judged by SocialCrawl",
  });
  const asks = now ? asksLine(now, was) : "What people asked could not be read";
  const f3 = ev.add({
    claim: asks,
    confidence: reqs(out.thisWeek).length ? "seen" : "unknown",
    numbers: { question: now?.question ?? null, complaint: now?.complaint ?? null, recommendation: now?.recommendation ?? null, switching: now?.switching ?? null, question_before: was?.question ?? null, complaint_before: was?.complaint ?? null, recommendation_before: was?.recommendation ?? null, switching_before: was?.switching ?? null },
    requests: reqs(out.thisWeek).length ? both : [],
    method: "each kept post's intent label, judged by SocialCrawl",
  });

  const viral = out.result.items.filter((i) => i.viral);
  const findingOf = new Map<ViralItem, string>();
  for (const i of viral.slice(0, 5)) {
    const b = i.breakout;
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries({ multiple: b.multiple, value: b.value, base: b.base, peers: b.peers })) if (v !== null) numbers[k] = v;
    const f = ev.add({
      claim: `${label(i.row.platform)}: ${who(i.row)} at ${formatNumber(b.multiple ?? 0)}x ${whose(i.row.platform)} median ${metricWord(i.row.platform)} over ${b.peers} earlier posts`,
      confidence: "seen",
      numbers,
      requests: b.requestIds.length ? b.requestIds : [i.row.requestId ?? ""].filter(Boolean),
      limitations: [b.settling ? "under 48 hours old, so its multiple can still rise" : "", i.flag?.flag ? FLAG_LABEL[i.flag.flag] : ""].filter(Boolean),
    });
    findingOf.set(i, f.id);
  }
  const ref = (i: ViralItem) => (findingOf.has(i) ? ` [${findingOf.get(i)}]` : "");

  // What could not be read.
  for (const [name, w] of [["This week", out.thisWeek], ["The week before", out.before]] as const) {
    if (w.notRead) ev.unknown({ what: `${name} (${dmy(w.window.since)} to ${dmy(w.window.until)})`, why: `not read: ${w.notRead}` });
    if (w.summary?.overflow) ev.unknown({ what: `${n(w.summary.overflow)} more on-topic posts of ${name.toLowerCase()}`, why: "counted in the totals, not listed (the read returns the first 100)" });
  }
  const unread = new Map<string, number>();
  for (const u of out.result.unread) unread.set(`${u.row.platform}|${u.reason}`, (unread.get(`${u.row.platform}|${u.reason}`) ?? 0) + 1);
  for (const [k, c] of unread) {
    const [p, reason] = k.split("|");
    ev.unknown({ what: `${c} ${label(p)} post${c === 1 ? "" : "s"} above the reach floor with no multiple`, why: UNREAD_WHY[reason]?.(p) ?? `not measured: ${reason}` });
  }
  const tooFew = out.result.items.filter((i) => i.breakout.band === "too_few").length;
  if (tooFew) ev.unknown({ what: `${tooFew} post${tooFew === 1 ? "" : "s"} with no multiple`, why: `not measured: their authors had fewer than ${MIN_PEERS} comparable earlier posts` });
  for (const i of out.result.items.filter((x) => x.breakout.band === "base_too_small")) ev.unknown({ what: `${label(i.row.platform)}: ${who(i.row)}`, why: `not measured: ${describeBreakout(i.breakout)}` });
  for (const e of out.errors) ev.unknown({ what: `${e.stage}, ${e.endpoint}`, why: `the API answered ${e.status ?? "an error"}${e.requestId ? ` (${e.requestId})` : ""}: ${e.message}` });

  const summaryLines = [`${headline} [${f1.id}]`, `${sentiment} [${f2.id}]`, `${asks} [${f3.id}]`];
  for (const i of viral.slice(0, 2)) summaryLines.push(`${label(i.row.platform)}: ${who(i.row)} at ${formatNumber(i.breakout.multiple ?? 0)}x ${whose(i.row.platform)} median ${metricWord(i.row.platform)} over ${i.breakout.peers} earlier posts${ref(i)}`);

  const cell = (v: number | null | undefined) => (v === null || v === undefined ? "not read" : n(v));
  const shareCell = (s: WeekSummary | null, k: "positive" | "negative") => (s ? (share(s, k) === null ? "too few" : pct(share(s, k)!)) : "not read");
  const delta = (a: number | null | undefined, b: number | null | undefined) => {
    if (a === null || a === undefined || b === null || b === undefined) return "";
    const c = changeOf(a, b);
    return c.share === null ? "" : `${c.share > 0 ? "+" : ""}${pct(c.share)}`;
  };
  const rows: [string, number | null | undefined, number | null | undefined][] = [
    ["On-topic posts", now?.kept, was?.kept],
    ["Questions", now?.question, was?.question],
    ["Complaints", now?.complaint, was?.complaint],
    ["Recommendations", now?.recommendation, was?.recommendation],
    ["About switching", now?.switching, was?.switching],
    ["Selling something", now?.selling, was?.selling],
  ];
  const weekOnWeek = [
    `This week is ${dmy(input.thisWeek.since)} to ${dmy(input.thisWeek.until)}; the week before, ${dmy(input.before.since)} to ${dmy(input.before.until)}.`,
    "",
    "| | This week | The week before | Change |",
    "| --- | --- | --- | --- |",
    ...rows.map(([name, a, b]) => `| ${name} | ${cell(a)} | ${cell(b)} | ${delta(a, b)} |`),
    `| Positive | ${shareCell(now, "positive")} | ${shareCell(was, "positive")} | |`,
    `| Negative | ${shareCell(now, "negative")} | ${shareCell(was, "negative")} | |`,
  ].join("\n");

  const platforms = [...new Set([...Object.keys(now?.byPlatform ?? {}), ...Object.keys(was?.byPlatform ?? {})])];
  const byPlatform = platforms.length
    ? ["| Platform | This week | The week before |", "| --- | --- | --- |", ...platforms.map((p) => `| ${label(p)} | ${cell(now?.byPlatform[p] ?? 0)} | ${was ? cell(was.byPlatform[p] ?? 0) : "not read"} |`)].join("\n")
    : "No platform returned an on-topic post.";

  const questions = out.thisWeek.items
    .filter((it: any) => it?.judgments?.intent?.label === "question")
    .slice(0, 5)
    .map((it: any) => {
      const row = out.thisWeek.rows.find((r) => r.id === String(it.native_id ?? it.id));
      const text = String(it.text ?? "").replace(/\s+/g, " ").trim();
      const cut = text.length > 240 ? `${text.slice(0, 239)}…` : text;
      return `> ${cut} (${label(String(it.platform))}${row ? `, ${who(row)}` : ""})`;
    });
  const asked = questions.length ? questions.join("\n\n") : "No post this week was labelled a question.";

  const shown = viral.length ? viral.slice(0, 15) : out.result.items.filter((i) => i.breakout.multiple !== null).slice(0, 5);
  const breakouts = shown.length
    ? [
        viral.length ? "Each post is compared with its own author's earlier posts; a break-out is 3x or more." : "No post this week reached 3x its author's usual reach. The closest are below.",
        "",
        "| # | Platform | Post | Multiple | Reach | Compared with |",
        "| --- | --- | --- | --- | --- | --- |",
        ...shown.map((i, k) => {
          const b = i.breakout;
          const post = named(i.row) && i.row.url ? `${who(i.row)}, [post](${i.row.url})` : who(i.row);
          return `| ${k + 1}${ref(i)} | ${label(i.row.platform)} | ${post.replace(/\|/g, "/")} | ${b.multiple === null ? "?" : formatNumber(b.multiple)}x | ${b.value === null ? "?" : n(b.value)} ${metricWord(i.row.platform)} | median ${b.base === null ? "?" : n(Math.round(b.base))} over ${b.peers} posts |`;
        }),
      ].join("\n")
    : "No post this week was above its platform's reach floor with enough earlier posts to compare.";

  const wontCopy = [
    "A week's counts move with one busy thread or video. Read a change together with the posts behind it before acting on it.",
    "Sentiment and intent are labels on each post, judged by SocialCrawl; open the posts in data/posts_this_week.csv to check the ones that matter to you.",
  ].join("\n\n");
  const next = [
    "Read the next week the same way, so the change keeps comparing like with like:",
    "",
    "```bash",
    `socialcrawl social-pulse "${input.topic}"`,
    "```",
    "",
    "See what broke out on the topic on every platform, with more authors measured:",
    "",
    "```bash",
    `socialcrawl social-viral "${input.topic}"`,
    "```",
  ].join("\n");

  const methodNotes = [
    "Each week is one search a platform (X, Reddit, TikTok, Instagram, YouTube, LinkedIn) for the same words, kept when judged on topic. The counts are of those posts, not every post on the platforms, and the change compares the same searches week on week.",
    "Stance (positive, negative, neutral, uncertain) and intent (question, complaint, recommendation, switching) are labels on each kept post. A share is given only from 10 posts with a stance.",
    `A break-out is a post at 3x or more the median of its author's comparable earlier posts, over at least ${MIN_PEERS} of them. Baseline credits per platform: ${Object.entries(PULSE_SHARE).map(([p, v]) => `${label(p)} ${Math.floor(v * (deep ? DEEP_SCALE : 1))}`).join(", ")}.`,
    `Accounts under ${n(NAME_FLOOR)} followers are described, not named.`,
  ];

  const chart: BarChart = {
    title: "On-topic posts this week, by platform",
    unit: "posts",
    bars: Object.entries(now?.byPlatform ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([p, k]) => ({ label: label(p), value: k, finding: f1.id })),
  };
  const c = was ? changeOf(kept, was.kept) : null;
  const short = (s: string) => (s.length > 110 ? `${s.slice(0, 109)}…` : s);
  const meta = out.meta;
  return {
    card: {
      command: `/${SKILL} "${input.topic}"`,
      skill: SKILL,
      headlines: [short(headline), short(sentiment), short(now ? `${n(now.question)} questions and ${n(now.complaint)} complaints this week` : asks)],
      basis: `${n(now?.collected ?? 0)} posts read this week on 6 platforms, ${n(kept)} on topic`,
      meta,
      rerun: `socialcrawl social-pulse "${input.topic}"`,
    },
    report: {
      command: `/${SKILL} "${input.topic}"`,
      skill: SKILL,
      badge: `${dmy(input.thisWeek.since)} to ${dmy(input.thisWeek.until)} against the week before · ${n(now?.collected ?? 0)} posts read this week${deep ? " · deep" : ""} · v${meta.version}`,
      summary: summaryLines,
      sections: [
        { title: "Week on week", body: weekOnWeek },
        { title: "By platform", body: byPlatform },
        { title: "What people asked", body: asked },
        { title: "Posts breaking out", body: breakouts },
        { title: "What won't copy", body: wontCopy },
        { title: "Next", body: next },
      ],
      evidence: ev,
      meta,
      methodNotes,
    },
    tiles: [
      { label: "On-topic posts this week", value: n(kept), finding: f1.id },
      { label: "Against the week before", value: c && c.share !== null ? `${c.share > 0 ? "+" : ""}${pct(c.share)}` : "not compared", finding: f1.id },
      { label: "Positive", value: share(now, "positive") === null ? "too few" : pct(share(now, "positive")!), finding: f2.id },
      { label: "Questions", value: n(now?.question ?? 0), finding: f3.id },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: chart.bars.length ? [chart] : [],
    tables: tables(out),
  };
}

export const workflow: Workflow = {
  name: SKILL,
  summary: "What changed this week about a brand or topic: posts, sentiment, questions, and the posts breaking out",
  usage: 'socialcrawl social-pulse "<brand or topic>" [--about "<what it is>"] [--until YYYY-MM-DD] [--deep]',
  examples: ['socialcrawl social-pulse "Notion"', 'socialcrawl social-pulse "Linear" --about "Linear, the issue tracker for software teams"'],
  defaultBudget: 100,
  deepBudget: 250,
  takesWindow: true,
  options: { about: { type: "string" } },
  slug: (args) => args.input,
  quote(args) {
    const input = inputOf(args);
    const scale = args.deep ? 2 : 1;
    const baselines = Object.values(PULSE_SHARE).reduce((s, v) => s + Math.floor(v * (args.deep ? DEEP_SCALE : 1)), 0);
    return {
      expected: 30 * 2 * scale + baselines,
      max: Math.min(90 * scale + baselines + 10, args.deep ? 250 : 100),
      lines: [
        `This week: ${dmy(input.thisWeek.since)} to ${dmy(input.thisWeek.until)}; the week before: ${dmy(input.before.since)} to ${dmy(input.before.until)}.`,
        `Each week: one search a platform with stance and intent labels, about ${30 * scale} credits; its free quote sets the exact ceiling.`,
        `Break-outs: up to ${baselines} credits of authors' earlier posts, and 1 credit for each account size the search left out.`,
      ],
    };
  },
  async run(session, args) {
    const input = inputOf(args);
    const out = await runPulse(session, input, { deep: args.deep, now: () => args.now, noCache: args.noCache === true });
    return buildResult(out, input, args.deep);
  },
};
