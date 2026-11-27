// reddit-marketing, what a run hands the render kit: the card, the report, tiles, charts and
// the CSV tables. Every number in the prose comes from a finding in evidence.json; tables and
// quotes carry the rest. Members of Reddit are never named: threads and comments are quoted
// and linked, communities are named.
import { MIN_PEERS, BANDS, describe as describeBreakout } from "../../engine/breakout.ts";
import { Evidence } from "../../engine/evidence.ts";
import type { CardInput, ReportInput, ReportSection } from "../../engine/outputs.ts";
import type { Meta } from "../../engine/rates.ts";
import type { ResponseRecord } from "../../engine/rows.ts";
import type { BarChart, Table, Tile, WorkflowResult } from "../../render/types.ts";
import { WORKFLOW } from "./plan.ts";
import type { RedditInput } from "./plan.ts";
import { LABEL_CUT, OPPORTUNITY_DAYS } from "./read.ts";
import type { Quote, ThreadBreakout } from "./read.ts";
import type { RedditRun } from "./run.ts";

export const REPORT_SECTIONS = [
  "Threads against their community",
  "What people ask and complain about",
  "Where a disclosed reply would help",
  "The communities and their rules",
  "Run next",
  "What won't copy",
];

export const commandOf = (input: Pick<RedditInput, "keyword" | "deep">) => `/${WORKFLOW} "${input.keyword}"${input.deep ? " --deep" : ""}`;
export const rerunOf = (input: Pick<RedditInput, "keyword" | "deep">) => `npx -y socialcrawl@latest ${WORKFLOW} "${input.keyword}"${input.deep ? " --deep" : ""}`;

const n = (x: number) => x.toLocaleString("en-GB");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "unknown");
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const short = (s: string, k: number) => (s.length <= k ? s : `${s.slice(0, k - 1).replace(/\s+\S*$/, "")}…`);
/** Quotes keep the words and drop any member's name a comment mentions. */
const unname = (s: string) => s.replace(/\bu\/[\w-]+/g, "u/(a member)").replace(/@\w+/g, "@(a member)");
const ids = (recs: ResponseRecord[]) => recs.map((r) => r.requestId).filter((x): x is string => typeof x === "string");

const measured = (b: ThreadBreakout[]) => b.filter((x) => x.breakout?.multiple != null).sort((a, z) => (z.breakout!.multiple as number) - (a.breakout!.multiple as number));

export function buildResult(run: RedditRun, meta: Meta, records: (ResponseRecord & { stage?: string; status?: number })[]): WorkflowResult {
  const ok = records.filter((r) => (r.status ?? 200) === 200);
  const ev = new Evidence();
  ev.seeRequests(ids(records));
  // A rules call returns one community: the communities table shows it, not a coverage line.
  const label = (stage: string) => stage.replace(/^baseline:(.+)$/, "baseline r/$1").replace(/^comments:(.+)$/, "comments $1");
  for (const r of ok) if (!(r.stage ?? "").startsWith("rules")) ev.cover(r, label(r.stage ?? r.endpoint));

  const byStage = (s: string) => ok.filter((r) => r.stage === s || (r.stage ?? "").startsWith(`${s}:`));
  const search = byStage("search");
  const baselines = byStage("baseline");
  const commentRecs = byStage("comments");
  const rulesRecs = byStage("rules");

  // F1: what was read
  const communitiesSeen = new Set(run.threads.map((t) => t.row.community?.toLowerCase()).filter(Boolean)).size;
  const kept = run.topicReads.reduce((s, t) => s + t.kept, 0);
  const dropped = run.topicReads.reduce((s, t) => s + t.dropped, 0);
  const f1 = ev.add({ claim: `${plural(run.threads.length, "on-topic thread")} read, in ${plural(communitiesSeen, "community", "communities")}`, confidence: "seen", numbers: { threads: run.threads.length, communities: communitiesSeen, kept, dropped }, requests: ids(search) });

  // F2 and F3: the threads against their community
  const m = measured(run.breakouts);
  const count = (band: string) => run.breakouts.filter((b) => b.breakout?.band === band).length;
  const beat = run.breakouts.filter((b) => b.breakout?.band === "beat");
  const notRead = run.breakouts.filter((b) => b.reason === "community_not_read").length;
  const f2 = ev.add({
    claim: `${plural(m.length, "thread")} measured against ${plural(baselines.length, "community's", "communities'")} top posts of the month; ${n(beat.length)} at 3 times or more`,
    confidence: "seen",
    numbers: { measured: m.length, beat: beat.length, above: count("above"), normal: count("normal"), tooFew: count("too_few"), notRead, threshold: BANDS.beat, aboveFrom: BANDS.above, minPeers: MIN_PEERS, communitiesRead: baselines.length },
    requests: [...new Set([...ids(baselines), ...ids(search)])],
    method: "a thread's score over the median score of its community's top posts of the month posted before it, the thread left out; no number under 8 such posts",
  });
  const lead = m[0] ?? null;
  const f3 = lead
    ? ev.add({
        claim: `The ${lead.breakout!.band === "beat" ? "top" : "closest"} thread: r/${lead.thread.row.community} at ${lead.breakout!.multiple}x its community's median top score of ${n(lead.breakout!.base as number)} over ${lead.breakout!.peers} posts`,
        confidence: "seen",
        numbers: { multiple: lead.breakout!.multiple, base: lead.breakout!.base, peers: lead.breakout!.peers, score: lead.thread.row.likes, monthRank: lead.monthRank },
        requests: lead.breakout!.requestIds,
        rows: [lead.thread.row.id],
      })
    : null;

  // F4: who asks
  const asking = run.threads.filter((t) => t.intent === "asking_for_recommendation").length;
  const promoting = run.threads.filter((t) => t.intent === "promoting").length;
  const f4 = ev.add({ claim: `${n(asking)} of ${plural(run.threads.length, "thread")} ask for a recommendation`, confidence: "inferred", numbers: { asking, threads: run.threads.length, promoting }, requests: ids(search), limitations: ["the intent is the API's label on each thread, a model's reading, not the author's words"] });

  // F5: what the comments say
  const a = run.asks;
  const totalComments = run.commentReads.reduce((s, c) => s + (c.total ?? 0), 0);
  const f5 = ev.add({
    claim: `${plural(a.questions, "question")} and ${plural(a.complaints, "complaint")} in ${n(a.labelled)} labelled comments`,
    confidence: "inferred",
    numbers: { comments: a.comments, labelled: a.labelled, unlabelled: a.unlabelled, questions: a.questions, complaints: a.complaints, purchaseIntent: a.purchaseIntent, positive: a.positive, neutral: a.neutral, negative: a.negative, trees: run.commentReads.length, totalComments },
    requests: ids(commentRecs),
    limitations: a.unlabelled ? [`${n(a.unlabelled)} replies the API did not label are not counted`] : [],
    method: `a comment counts as a question, a complaint or buying intent when the API's probability is ${LABEL_CUT} or more`,
  });

  // F6, F7: replies worth writing, and the rules
  const o = run.opportunities;
  const f6 = ev.add({ claim: `${plural(o.length, "recent thread")} asking for a tool`, confidence: "inferred", numbers: { opportunities: o.length, days: OPPORTUNITY_DAYS }, requests: ids(search), rows: o.map((x) => x.thread.row.id) });
  const listed = run.communities.filter((c) => c.rulesStatus === "listed");
  const withRule = listed.filter((c) => c.promotionRules.length > 0).length;
  const f7 = ev.add({ claim: `${n(withRule)} of ${plural(run.communities.length, "community", "communities")} read limit promotion in their rules`, confidence: "seen", numbers: { communities: run.communities.length, listed: listed.length, withRule, notReported: run.communities.length - listed.length }, requests: ids(rulesRecs) });

  // What could not be verified
  if (a.unlabelled) ev.unknown({ what: "Replies below the top level", why: `${n(a.unlabelled)} replies the API did not label: they are not counted as questions or complaints, and their words are in data/comments.csv` });
  for (const c of run.communities) if (c.rulesStatus !== "listed") ev.unknown({ what: `r/${c.name}: rules not reported by the source, which does not mean there are none`, why: "read them on the community's page before replying", check: `https://www.reddit.com/r/${c.name}/about/rules` });
  for (const b of run.breakouts.filter((x) => x.breakout?.band === "base_too_small"))
    ev.unknown({ what: `r/${b.thread.row.community}: "${short(b.thread.title, 60)}"`, why: describeBreakout(b.breakout!) });
  if (notRead) ev.unknown({ what: "Threads in communities that were not read", why: `${plural(notRead, "thread")} have no multiple: their community's top posts were outside this run's budget` });
  for (const c of run.commentReads) if (c.total !== null && c.returned < c.total) ev.unknown({ what: `Comments under thread ${c.threadId}`, why: `${n(c.returned)} returned of the ${n(c.total)} the thread shows; Reddit's count includes removed comments${c.truncated ? ", and the tree was cut at the page" : ""}` });
  ev.unknown({ what: "Views", why: "Reddit publishes no view count for a thread, so scores and comments are the only reach read" });
  if (run.chosen.length > run.communities.length) ev.unknown({ what: "Communities whose rules were not read", why: run.chosen.filter((c) => !run.communities.some((x) => x.name.toLowerCase() === c.toLowerCase())).map((c) => `r/${c}`).join(", ") });

  // ── The report's sections ────────────────────────────────────────────────
  const link = (title: string, url: string | null) => (url ? `[${cell(short(title, 80))}](${url})` : cell(short(title, 80)));
  const threadRows = m.slice(0, 12).map((b, i) => {
    const r = b.thread.row;
    return `| ${i + 1} | ${link(b.thread.title, r.url)} | r/${r.community} | ${dmy(r.publishedAt)} | ${n(r.likes ?? 0)} | ${n(r.comments ?? 0)} | ${b.breakout!.multiple}x | median ${n(b.breakout!.base as number)} over ${b.breakout!.peers} | ${b.monthRank ?? "not in top"} |`;
  });
  const reasons: [string, number][] = [
    ["Fewer than 8 earlier top posts in the community this month", count("too_few")],
    ["Its community's earlier top posts score too low to compare", count("base_too_small")],
    ["Community's top posts not read in this run", notRead],
  ];
  const s1: ReportSection = {
    title: REPORT_SECTIONS[0],
    body: [
      "Each thread's score against the median score of its community's top posts of the month that came before it, the thread left out. That is a high bar: those are the month's best posts. A multiple of 3 or more is a break-out, 1.5 to 3 is above usual.",
      "",
      threadRows.length ? "| # | Thread | Community | Posted | Score | Comments | Multiple | Against | Rank in the month |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" + threadRows.join("\n") : "No thread could be measured against its community in this run.",
      "",
      "| Not measured | Threads |\n| --- | --- |\n" + reasons.map(([w, k]) => `| ${w} | ${n(k)} |`).join("\n"),
    ].join("\n"),
  };

  const quoteBlock = (title: string, qs: Quote[]) => (qs.length ? [`**${title}**`, "", ...qs.flatMap((q) => [`> ${cell(unname(q.text))} ([link](${q.url ?? ""}), score ${q.likes ?? "unknown"})`, ""])] : []);
  const s2: ReportSection = {
    title: REPORT_SECTIONS[1],
    body: [
      `From the comment trees of ${plural(run.commentReads.length, "thread")}, labelled by the API.`,
      "",
      "| What the comment does | Comments |\n| --- | --- |",
      `| Asks a question | ${n(a.questions)} |`,
      `| Complains | ${n(a.complaints)} |`,
      `| Shows buying intent | ${n(a.purchaseIntent)} |`,
      `| Positive / neutral / negative | ${n(a.positive)} / ${n(a.neutral)} / ${n(a.negative)} |`,
      `| Not labelled (replies) | ${n(a.unlabelled)} |`,
      "",
      ...quoteBlock("Questions, most upvoted first", a.quotes.question),
      ...quoteBlock("Complaints", a.quotes.complaint),
      ...quoteBlock("Buying intent", a.quotes.purchase_intent),
    ].join("\n"),
  };

  const s3: ReportSection = {
    title: REPORT_SECTIONS[2],
    body: [
      "Threads from the last month where someone asks for a tool, the freshest and least answered first. If you reply, do it as yourself and say that you work on it; read the community's rule on promotion first. Nothing is posted for you.",
      "",
      o.length
        ? "| Thread | Community | Asked | Replies | The community's rule |\n| --- | --- | --- | --- | --- |\n" +
          o.map((x) => `| ${link(x.thread.title, x.thread.row.url)} | r/${x.thread.row.community} | ${dmy(x.thread.row.publishedAt)} | ${n(x.thread.row.comments ?? 0)} | ${cell(x.rule)} |`).join("\n")
        : "No thread in the last month asked for a tool like this.",
    ].join("\n"),
  };

  const threadsIn = (name: string) => run.threads.filter((t) => t.row.community?.toLowerCase() === name.toLowerCase()).length;
  const s4: ReportSection = {
    title: REPORT_SECTIONS[3],
    body: run.communities.length
      ? "| Community | Members | Active this week | Threads on the topic | Rule on promotion |\n| --- | --- | --- | --- | --- |\n" +
        run.communities
          .map((c) => {
            const rule = c.rulesStatus !== "listed" ? "rules not reported" : c.promotionRules.length ? c.promotionRules.map((r) => `rule ${r.number}: ${cell(short(r.title, 60))}`).join("; ") : "none among its rules";
            return `| r/${c.name} | ${c.members === null ? "unknown" : n(c.members)} | ${c.weeklyActive === null ? "unknown" : n(c.weeklyActive)} | ${n(threadsIn(c.name))} | ${rule} |`;
          })
          .join("\n")
      : "No community's details were read in this run.",
  };

  const first = o[0] ?? null;
  const next: string[] = [];
  if (first?.thread.row.url) next.push(`| Watch the thread most worth a reply | \`GET /v1/reddit/post/comments?url=${first.thread.row.url}\` (5 credits) | its comment count, now ${n(first.thread.row.comments ?? 0)} |`);
  if (!run.input.deep) next.push(`| Read a year of threads, more communities and comment trees | \`${rerunOf({ ...run.input, deep: true })}\` (prints its price, then runs) | whether the break-outs repeat over a year |`);
  next.push(`| Run this read again in two weeks | \`${rerunOf(run.input)}\` | the threads asking for a tool, now ${n(asking)} |`);
  const s5: ReportSection = { title: REPORT_SECTIONS[4], body: "| Next | Command | Check in 14 days |\n| --- | --- | --- |\n" + next.join("\n") };

  const s6: ReportSection = {
    title: REPORT_SECTIONS[5],
    body: [
      "- A thread's score belongs to its community: what lifts a thread in one community says little about another, so compare within a community only.",
      `- The threads here ask people for advice. A vendor's account posting the same question, or answering without saying who it is, is what these communities' promotion rules forbid [${f7.id}].`,
    ].join("\n"),
  };

  // ── In short ─────────────────────────────────────────────────────────────
  const headline =
    beat.length > 0
      ? `${plural(beat.length, "thread")} beat ${beat.length === 1 ? "its" : "their"} community's usual top post 3 times or more`
      : lead
        ? `No thread beat its community's usual top post 3 times over; the closest: r/${lead.thread.row.community} at ${lead.breakout!.multiple}x`
        : "No thread could be measured against its community in this run";
  const summary = [
    `${headline} [${f2.id}]${f3 ? `[${f3.id}]` : ""}.`,
    `${n(asking)} of ${plural(run.threads.length, "thread")} ask for a recommendation, in ${plural(communitiesSeen, "community", "communities")} [${f4.id}][${f1.id}].`,
    `The comments hold ${plural(a.questions, "question")} and ${plural(a.complaints, "complaint")} among ${n(a.labelled)} labelled [${f5.id}].`,
    `${plural(o.length, "recent thread")} ${o.length === 1 ? "is" : "are"} worth a disclosed reply [${f6.id}].`,
    `${n(withRule)} of the ${plural(run.communities.length, "community", "communities")} read limit promotion in their rules [${f7.id}].`,
  ];

  const report: ReportInput = {
    command: commandOf(run.input),
    skill: WORKFLOW,
    badge: `Reddit · the past ${run.input.deep ? "year" : "month"}'s top threads and the new ones since ${dmy(new Date(run.input.now.getTime() - 7 * 86_400_000).toISOString())} · read ${dmy(meta.generated_at)} · v${meta.version}`,
    summary,
    sections: [s1, s2, s3, s4, s5, s6],
    evidence: ev,
    meta,
    methodNotes: [
      `Topic filter on both searches: "${run.topic}" (relevance=filter). Off-topic rows the filter dropped: ${n(dropped)}; kept: ${n(kept)}.`,
      `A thread's multiple is its score over the median score of its community's top posts of the month posted before it, the thread left out. No number under ${MIN_PEERS} such posts. 3 or more is a break-out; 1.5 to 3 above usual.`,
      `Comment labels are the API's: question, complaint and buying intent at p ${LABEL_CUT} or more; sentiment on five levels, 3 and 4 positive, 0 and 1 negative.`,
      `Threads worth a reply: asked within ${OPPORTUNITY_DAYS} days, labelled as asking for a recommendation, comparing options or switching away (or titled as a question), never promotional ones.`,
      "Members of Reddit are not named; threads and comments are quoted and linked.",
    ],
  };

  // ── The card ─────────────────────────────────────────────────────────────
  const headlines = [
    headline.length <= 110 ? headline : beat.length ? headline : "No thread beat its community's usual top post 3 times over",
    `${n(asking)} of ${plural(run.threads.length, "thread")} ask for a recommendation`,
    `${plural(a.questions, "question")} and ${plural(a.complaints, "complaint")} in ${n(a.labelled)} labelled comments`,
  ];
  const card: CardInput = {
    command: commandOf(run.input),
    skill: WORKFLOW,
    headlines,
    basis: `${plural(run.threads.length, "thread")}, ${plural(run.communities.length, "community", "communities")}, ${plural(run.commentReads.length, "comment tree")}`,
    meta,
    rerun: rerunOf(run.input),
  };

  // ── Tiles, charts, tables ────────────────────────────────────────────────
  const tiles: Tile[] = [
    { label: "Threads read", value: n(run.threads.length), finding: f1.id },
    { label: `Broke out, of ${n(m.length)} measured against their community`, value: n(beat.length), finding: f2.id },
    { label: "Asking for a recommendation", value: `${n(asking)} of ${n(run.threads.length)}`, finding: f4.id },
    { label: `Questions, in ${n(a.labelled)} labelled comments`, value: n(a.questions), finding: f5.id },
  ];
  const charts: BarChart[] = [
    { title: "Threads against their community's usual top post", unit: "x", bars: m.slice(0, 10).map((b) => ({ label: `r/${b.thread.row.community}: ${short(b.thread.title, 48)}`, value: b.breakout!.multiple as number, note: `score ${n(b.thread.row.likes ?? 0)}`, finding: f2.id })) },
    { title: "What the comments say", unit: "comments", bars: [
      { label: "Questions", value: a.questions, finding: f5.id },
      { label: "Complaints", value: a.complaints, finding: f5.id },
      { label: "Buying intent", value: a.purchaseIntent, finding: f5.id },
    ] },
  ];
  const bOf = new Map(run.breakouts.map((b) => [b.thread.row.id, b]));
  const tables: Record<string, Table> = {
    threads: {
      columns: ["id", "url", "community", "title", "score", "comments", "published_at", "intent", "buyer", "multiple", "band", "base", "peers", "month_rank", "found_by", "request_id"],
      rows: run.threads.map((t) => {
        const b = bOf.get(t.row.id);
        return { id: t.row.id, url: t.row.url, community: t.row.community, title: t.title, score: t.row.likes, comments: t.row.comments, published_at: t.row.publishedAt, intent: t.intent, buyer: t.buyer, multiple: b?.breakout?.multiple ?? null, band: b?.breakout?.band ?? b?.reason ?? null, base: b?.breakout?.base ?? null, peers: b?.breakout?.peers ?? null, month_rank: b?.monthRank ?? null, found_by: t.stage, request_id: t.row.requestId };
      }),
    },
    comments: {
      columns: ["id", "thread_id", "depth", "text", "score", "question", "complaint", "purchase_intent", "sentiment", "url", "published_at", "request_id"],
      rows: run.comments.map((c) => ({ id: c.id, thread_id: c.threadId, depth: c.depth, text: c.text, score: c.likes, question: c.labels?.question ?? null, complaint: c.labels?.complaint ?? null, purchase_intent: c.labels?.purchaseIntent ?? null, sentiment: c.labels?.sentiment ?? null, url: c.url, published_at: c.publishedAt, request_id: c.requestId })),
    },
    communities: {
      columns: ["name", "members", "weekly_active", "rules_status", "rules", "promotion_rules", "request_id"],
      rows: run.communities.map((c) => ({ name: c.name, members: c.members, weekly_active: c.weeklyActive, rules_status: c.rulesStatus, rules: c.rules.map((r) => `${r.number}. ${r.text}`).join(" | "), promotion_rules: c.promotionRules.map((r) => r.number).join(" "), request_id: c.requestId })),
    },
    opportunities: {
      columns: ["thread_id", "url", "community", "title", "asked", "age_days", "comments", "intent", "rule", "score"],
      rows: o.map((x) => ({ thread_id: x.thread.row.id, url: x.thread.row.url, community: x.thread.row.community, title: x.thread.title, asked: x.thread.row.publishedAt, age_days: x.ageDays, comments: x.thread.row.comments, intent: x.thread.intent, rule: x.rule, score: x.score })),
    },
  };

  return { card, report, tiles, charts, tables };
}
