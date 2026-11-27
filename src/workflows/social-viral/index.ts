// socialcrawl social-viral "<topic>": the posts that broke out this week on X, TikTok,
// Instagram, YouTube, Reddit and LinkedIn, each against its own author's earlier posts.
// The method is the engine's (viral.ts plans and ranks, runner.ts sends); this file turns a
// run into the report, the card, the evidence and the tables.
import { UsageError } from "../../args.ts";
import { FLAG_LABEL } from "../../engine/boosted.ts";
import { describe as describeBreakout, MIN_PEERS } from "../../engine/breakout.ts";
import { Evidence, requestIdsOf } from "../../engine/evidence.ts";
import { quoteLines } from "../../engine/rates.ts";
import { rowsOf } from "../../engine/rows.ts";
import type { Platform, ResponseRecord, Row } from "../../engine/rows.ts";
import type { CallRecord } from "../../kit/record.ts";
import { formatNumber } from "../../render/svg.ts";
import type { BarChart, Table, WorkflowResult } from "../../render/types.ts";
import type { Workflow, WorkflowArgs } from "../types.ts";
import { runViral } from "./runner.ts";
import type { ViralRunOutput } from "./runner.ts";
import { BASELINE_SHARE, DATA_VENDOR_SUBJECT, FLOORS, SKILL, VIRAL_PLATFORMS, defaultPlanCredits } from "./viral.ts";
import type { PlanInput, ViralItem, ViralPlatform } from "./viral.ts";

/** Accounts below this many followers are described in the report and on the card, never named. */
export const NAME_FLOOR = 10_000;
const DEEP_SHARE_SCALE = 2.5;
const RETWEETERS = { default: 2, deep: 5 };

const LABEL: Record<ViralPlatform, string> = { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", reddit: "Reddit", linkedin: "LinkedIn" };
const label = (p: Platform) => LABEL[p as ViralPlatform] ?? p;
const n = (x: number) => x.toLocaleString("en-GB");
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const metricWord = (p: Platform) => (p === "reddit" ? "score" : FLOORS[p as ViralPlatform]?.metric ?? "views");

/** A multiple or a median as the report prints it: one decimal under 100, whole above. */
const fm = (x: number) => formatNumber(x);

/**
 * How the report refers to a post's author: a name only from 10,000 followers. `known` is
 * the author's follower count read elsewhere in the run, for rows that carry none.
 */
export function whoOf(r: Row, known: number | null = null): string {
  if (r.platform === "reddit") return r.community ? `a post in r/${r.community}` : "a Reddit post";
  const f = r.authorFollowers ?? known;
  if (f === null) return "an account of unknown size";
  if (f < NAME_FLOOR) return `an account with ${n(f)} followers`;
  return r.platform === "linkedin" ? r.author : `@${r.author}`;
}

/** The largest follower count read for each author ("tiktok:acme"), across every response of the run. */
export function followersOf(records: ResponseRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const rec of records)
    for (const r of rowsOf(rec)) {
      if (r.authorFollowers === null || !r.author) continue;
      const k = `${r.platform}:${r.author.toLowerCase()}`;
      m.set(k, Math.max(m.get(k) ?? 0, r.authorFollowers));
    }
  return m;
}

function windowOf(args: WorkflowArgs): { since: string; until: string } {
  const until = args.until ?? args.now.toISOString().slice(0, 10);
  const since = args.since ?? new Date(Date.parse(until) - 7 * 86_400_000).toISOString().slice(0, 10);
  return { since, until };
}

function inputOf(args: WorkflowArgs): PlanInput {
  const raw = typeof args.flags.platforms === "string" ? args.flags.platforms : "";
  const platforms = raw ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined;
  for (const p of platforms ?? []) if (!VIRAL_PLATFORMS.includes(p as ViralPlatform)) throw new UsageError(`--platforms takes ${VIRAL_PLATFORMS.join(", ")}; "${p}" is not one.`);
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about.trim() : undefined;
  return { topic: args.input, ...(about ? { about } : {}), ...windowOf(args), ...(platforms ? { platforms: platforms as ViralPlatform[] } : {}) };
}

const ROW_COLUMNS = ["platform", "id", "url", "author", "author_followers", "channel_id", "community", "published_at", "views", "likes", "comments", "shares", "saves", "duration_seconds", "video", "kind", "text", "request_id"];
const flat = (r: Row): Record<string, unknown> => ({
  platform: r.platform,
  id: r.id,
  url: r.url,
  author: r.author,
  author_followers: r.authorFollowers,
  channel_id: r.channelId,
  community: r.community,
  published_at: r.publishedAt,
  views: r.views,
  likes: r.likes,
  comments: r.comments,
  shares: r.shares,
  saves: r.saves,
  duration_seconds: r.durationSeconds,
  video: r.video,
  kind: r.kind,
  text: r.text,
  request_id: r.requestId,
});

function tables(out: ViralRunOutput): Record<string, Table> {
  const byId = new Map(out.result.items.map((i) => [`${i.row.platform}:${i.row.id}`, i]));
  const unread = new Map(out.result.unread.map((u) => [`${u.row.platform}:${u.row.id}`, u.reason]));
  const rowsAt = (prefix: string) => out.records.filter((r) => r.stage.startsWith(prefix)).flatMap((r) => rowsOf(r).map(flat));
  return {
    posts: {
      columns: [...ROW_COLUMNS, "metric", "base", "peers", "multiple", "settled_multiple", "over_best_peer", "band", "viral", "card_worthy", "flag", "not_read_reason"],
      rows: out.candidates.rows.map((r) => {
        const i = byId.get(`${r.platform}:${r.id}`);
        const b = i?.breakout;
        return {
          ...flat(r),
          metric: b?.metric ?? FLOORS[r.platform as ViralPlatform]?.metric ?? null,
          base: b?.base ?? null,
          peers: b?.peers ?? null,
          multiple: b?.multiple ?? null,
          settled_multiple: b?.settledMultiple ?? null,
          over_best_peer: b?.overBestPeer ?? null,
          band: b?.band ?? null,
          viral: i?.viral ?? false,
          card_worthy: i?.cardWorthy ?? false,
          flag: i?.flag?.flag ?? null,
          not_read_reason: unread.get(`${r.platform}:${r.id}`) ?? null,
        };
      }),
    },
    search_posts: { columns: ROW_COLUMNS, rows: rowsAt("search:") },
    baseline_posts: { columns: ROW_COLUMNS, rows: rowsAt("baseline:") },
  };
}

const UNREAD_WHY: Record<string, string> = {
  budget: "the run's budget did not reach its author's earlier posts",
  planned_not_read: "the run's budget or the API stopped before its author's earlier posts were read",
  not_planned: "no baseline call was planned for it",
};

/** The report, the card, the evidence and the tables of one run. */
export function buildResult(out: ViralRunOutput, input: PlanInput, deep: boolean): WorkflowResult {
  const known = followersOf(out.records);
  const followers = (r: Row) => r.authorFollowers ?? known.get(`${r.platform}:${r.author.toLowerCase()}`) ?? null;
  const who = (r: Row) => whoOf(r, followers(r));
  const named = (r: Row) => r.platform === "reddit" || (followers(r) ?? 0) >= NAME_FLOOR;
  const ev = new Evidence();
  ev.seeRequests(out.ledger.requestIds());
  for (const rec of out.records) ev.cover(rec, rec.stage);
  const platforms = input.platforms ?? VIRAL_PLATFORMS;
  const viral = out.result.items.filter((i) => i.viral);
  const hit = VIRAL_PLATFORMS.filter((p) => out.result.byPlatform[p].viral > 0);
  const floor = out.candidates.rows.length;
  const smallViral = viral.filter((i) => {
    const f = followers(i.row);
    return i.row.platform !== "reddit" && f !== null && f < NAME_FLOOR;
  }).length;
  const searchIds = [...new Set(out.records.filter((r: CallRecord) => r.stage.startsWith("search:")).flatMap(requestIdsOf))];
  const headline = viral.length
    ? `${viral.length} post${viral.length === 1 ? "" : "s"} broke out at 3x their author's usual reach, on ${hit.length} platform${hit.length === 1 ? "" : "s"}`
    : `No post broke out at 3x this week, of ${floor} above the reach floor`;
  const f1 = ev.add({
    claim: viral.length ? `${headline}, out of ${floor} above the reach floor` : headline,
    confidence: searchIds.length ? "seen" : "unknown",
    numbers: { breakouts: viral.length, platforms: hit.length, searched: platforms.length, candidates: floor, read: out.candidates.read, small_breakouts: smallViral },
    requests: searchIds,
    method: "a post's metric over the median of its author's comparable earlier posts",
  });

  const lead = viral.slice(0, 10);
  const findingOf = new Map<ViralItem, string>();
  for (const i of lead) {
    const b = i.breakout;
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries({ multiple: b.multiple, value: b.value, base: b.base, peers: b.peers, settled_multiple: b.settledMultiple, over_best_peer: b.overBestPeer })) if (v !== null) numbers[k] = v;
    const notes = [b.settling ? "under 48 hours old, so its multiple can still rise" : "", b.inflatedByYoung ? "young posts in its base may raise the multiple" : "", i.flag?.flag ? FLAG_LABEL[i.flag.flag] : ""].filter(Boolean);
    const f = ev.add({
      claim: `${label(i.row.platform)}: ${who(i.row)} at ${fm(b.multiple ?? 0)}x its author's median ${metricWord(i.row.platform)} over ${b.peers} earlier posts`,
      confidence: "seen",
      numbers,
      requests: b.requestIds.length ? b.requestIds : [i.row.requestId ?? ""].filter(Boolean),
      limitations: notes,
    });
    findingOf.set(i, f.id);
  }

  // What was not read, and why.
  const unreadBy = new Map<string, number>();
  for (const u of out.result.unread) unreadBy.set(`${u.row.platform}|${u.reason}`, (unreadBy.get(`${u.row.platform}|${u.reason}`) ?? 0) + 1);
  for (const [k, count] of unreadBy) {
    const [p, reason] = k.split("|");
    ev.unknown({ what: `${count} ${label(p as Platform)} candidate${count === 1 ? "" : "s"} with no multiple`, why: UNREAD_WHY[reason] ?? reason, check: deep ? undefined : "run again with --deep" });
  }
  const tooFew = out.result.items.filter((i) => i.breakout.band === "too_few").length;
  if (tooFew) ev.unknown({ what: `${tooFew} post${tooFew === 1 ? "" : "s"} with no multiple`, why: `their authors had fewer than ${MIN_PEERS} comparable earlier posts to compare with` });
  for (const e of out.errors) ev.unknown({ what: `${e.stage}, ${e.endpoint}`, why: `the API answered ${e.status ?? "an error"}${e.requestId ? ` (${e.requestId})` : ""}: ${e.message}` });
  for (const nr of out.notRead) {
    ev.unknown({
      what: `${nr.stage}, ${nr.endpoint}`,
      why: nr.limit === "stage" ? "not sent: this platform's share of the budget was spent" : "not sent: the run's budget had run out",
      ...(deep ? {} : { check: "a --deep run gives each platform a larger share" }),
    });
  }

  const ref = (i: ViralItem) => (findingOf.has(i) ? ` [${findingOf.get(i)}]` : "");
  const summary = [`${headline} [${f1.id}]`];
  for (const i of lead.slice(0, 4)) {
    const b = i.breakout;
    summary.push(`${label(i.row.platform)}: ${who(i.row)} at ${fm(b.multiple ?? 0)}x its author's median ${metricWord(i.row.platform)} over ${b.peers} earlier posts${ref(i)}`);
  }

  // Sections.
  const shown = viral.length ? viral.slice(0, 20) : out.result.items.filter((i) => i.breakout.multiple !== null).slice(0, 5);
  const tableRows = shown.map((i, k) => {
    const b = i.breakout;
    const post = named(i.row) && i.row.url ? `${who(i.row)}, [post](${i.row.url})` : who(i.row);
    const note = [i.flag?.flag ? FLAG_LABEL[i.flag.flag] : "", b.settling ? "still rising" : "", b.inflatedByYoung ? "young posts in its base" : ""].filter(Boolean).join("; ");
    return `| ${k + 1}${ref(i)} | ${label(i.row.platform)} | ${post.replace(/\|/g, "/")} | ${b.multiple === null ? "?" : fm(b.multiple)}x | ${b.value === null ? "?" : n(b.value)} ${metricWord(i.row.platform)} | median ${b.base === null ? "?" : n(Math.round(b.base))} over ${b.peers} posts | ${note} |`;
  });
  const breakouts = [
    viral.length
      ? "Each post is compared with its own author's earlier posts; a break-out is 3x or more."
      : "No post reached 3x its author's usual reach. The closest posts are below.",
    "",
    "| # | Platform | Post | Multiple | Reach | Compared with | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...tableRows,
  ].join("\n");

  const searchRows = new Map<string, number>();
  for (const r of out.records.filter((x) => x.stage.startsWith("search:"))) for (const row of rowsOf(r)) searchRows.set(row.platform, (searchRows.get(row.platform) ?? 0) + 1);
  const byPlatform = [
    "| Platform | Read in the search | Above the reach floor | Compared with earlier posts | Break-outs |",
    "| --- | --- | --- | --- | --- |",
    ...platforms.map((p) => {
      const s = out.result.byPlatform[p];
      return `| ${LABEL[p]} | ${searchRows.get(p) ?? 0} | ${s.candidates} | ${s.withBaseline} | ${s.viral} |`;
    }),
  ].join("\n");

  const wontCopy = [
    "A multiple compares a post with its author's usual reach, so it says nothing about how the same post would do on your account. Copy the format and the hook, then judge the result against your own earlier posts.",
    ...(smallViral ? [`${smallViral} of the ${viral.length} break-outs came from accounts under 10,000 followers, where a small usual reach makes a high multiple easier [${f1.id}].`] : []),
    ...(viral.some((i) => i.flag?.flag) ? ["A post with a flag in the Note column may owe part of its reach to something other than the post itself."] : []),
  ].join("\n\n");

  const leader = lead[0];
  const next = [
    "Read the same topic again in 14 days to see which of these held:",
    "",
    "```bash",
    `socialcrawl social-viral "${input.topic}"`,
    "```",
    ...(leader ? ["", `Then check whether the leading post still stands at ${fm(leader.breakout.multiple ?? 0)}x its author's usual reach${ref(leader)}.`] : []),
    ...(deep ? [] : ["", "Read more authors and pages with a deep run, quoted for free before it starts:", "", "```bash", `socialcrawl social-viral "${input.topic}" --deep`, "```"]),
    ...(leader && named(leader.row) && leader.row.platform !== "reddit"
      ? ["", "Take the leading account apart:", "", "```bash", `socialcrawl social-teardown "${leader.row.platform === "linkedin" ? leader.row.author : "@" + leader.row.author}"`, "```"]
      : []),
  ].join("\n");

  const methodNotes = [
    `A break-out is a post at 3x or more the median of its author's comparable earlier posts (the ${20} before it, videos with videos), over at least ${MIN_PEERS} of them; 1.5x is above usual. The post itself is left out of its own base.`,
    `Who is read: ${platforms.map((p) => `${LABEL[p]} from ${n(FLOORS[p].min)} ${FLOORS[p].note}`).join("; ")}.`,
    "On Reddit a post's score is compared with its community's usual score.",
    `Posts about data APIs, scraping services or data vendors are left out, ours included (${out.candidates.excludedSubject} this run).`,
    `Searches use each platform's own week where a date range is refused; ${out.candidates.outsideWindow} rows outside ${dmy(input.since)} to ${dmy(input.until)} were dropped, and ${out.candidates.notOriginal} replies and reposts.`,
    `Accounts under ${n(NAME_FLOOR)} followers are described, not named. A post that may be boosted is flagged and not counted as a break-out.`,
    `Baseline credits per platform: ${platforms.map((p) => `${LABEL[p]} ${Math.floor(BASELINE_SHARE[p] * (deep ? DEEP_SHARE_SCALE : 1))}`).join(", ")}.`,
  ];

  const command = `/${SKILL} "${input.topic}"`;
  const cardLines = lead.filter((i) => i.cardWorthy).slice(0, 2).map((i) => {
    const line = `${label(i.row.platform)}: ${who(i.row)} at ${fm(i.breakout.multiple ?? 0)}x its author's usual ${metricWord(i.row.platform)}`;
    return line.length > 110 ? line.slice(0, 109) + "…" : line;
  });
  const chart: BarChart = {
    title: "Break-outs by multiple, against each author's earlier posts",
    unit: "x",
    bars: lead.map((i) => ({ label: `${label(i.row.platform)} · ${who(i.row)}`, value: i.breakout.multiple ?? 0, note: describeBreakout(i.breakout), finding: findingOf.get(i) })),
  };
  const meta = out.meta;
  return {
    card: {
      command,
      skill: SKILL,
      headlines: [headline, ...cardLines],
      basis: `${n(out.candidates.read)} posts read on ${platforms.length} platforms, ${n(floor)} above the reach floor`,
      meta,
      rerun: `socialcrawl social-viral "${input.topic}"`,
    },
    report: {
      command,
      skill: SKILL,
      badge: `${platforms.length} platforms · ${dmy(input.since)} to ${dmy(input.until)} · ${n(out.candidates.read)} posts read${deep ? " · deep" : ""} · v${meta.version}`,
      summary,
      sections: [
        { title: "The break-outs", body: breakouts },
        { title: "By platform", body: byPlatform },
        { title: "What won't copy", body: wontCopy },
        { title: "Next", body: next },
      ],
      evidence: ev,
      meta,
      methodNotes,
    },
    tiles: [
      { label: "Posts read", value: n(out.candidates.read), finding: f1.id },
      { label: "Above the reach floor", value: n(floor), finding: f1.id },
      { label: "Break-outs at 3x", value: n(viral.length), finding: f1.id },
      { label: "Platforms with one", value: `${hit.length} of ${platforms.length}` },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: lead.length ? [chart] : [],
    tables: tables(out),
  };
}

export const workflow: Workflow = {
  name: SKILL,
  summary: "The posts that broke out this week on a topic, each against its author's own earlier posts",
  usage: 'socialcrawl social-viral "<topic>" [--about "<fuller sentence>"] [--platforms x,tiktok,...] [--since YYYY-MM-DD --until YYYY-MM-DD] [--deep]',
  examples: ['socialcrawl social-viral "AI coding tools"', 'socialcrawl social-viral "running shoes" --platforms tiktok,instagram,youtube'],
  defaultBudget: 100,
  deepBudget: 250,
  takesWindow: true,
  options: {
    about: { type: "string" },
    platforms: { type: "string" },
  },
  slug: (args) => args.input,
  quote(args) {
    const input = inputOf(args);
    const p = defaultPlanCredits(input);
    const scale = args.deep ? DEEP_SHARE_SCALE : 1;
    const baselines = (input.platforms ?? VIRAL_PLATFORMS).reduce((s, x) => s + Math.floor(BASELINE_SHARE[x] * scale), 0);
    const retweeters = args.deep ? RETWEETERS.deep : RETWEETERS.default;
    return {
      expected: p.search.expected + baselines,
      max: p.ceiling + baselines + retweeters,
      lines: [`Window: ${dmy(input.since)} to ${dmy(input.until)}`, ...quoteLines(p.search), `Baselines: up to ${baselines} credits. Retweeter pages: up to ${retweeters}.`],
    };
  },
  async run(session, args) {
    const input = inputOf(args);
    const out = await runViral(session, input, {
      now: () => args.now,
      retweeterPosts: args.deep ? RETWEETERS.deep : RETWEETERS.default,
      shareScale: args.deep ? DEEP_SHARE_SCALE : 1,
    });
    return buildResult(out, input, args.deep);
  },
};
