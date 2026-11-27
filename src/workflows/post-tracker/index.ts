// post-tracker: a post link in; out, its numbers now, against its author's usual reach, and its
// curve across every reading taken so far (each run adds one; --every and --times take several).
import { Evidence } from "../../engine/index.ts";
import type { CardInput, Meta, ReportInput } from "../../engine/index.ts";
import type { Session } from "../../kit/record.ts";
import type { WorkflowResult } from "../../render/types.ts";
import type { Workflow, WorkflowArgs, WorkflowQuote } from "../types.ts";
import { accountLabel, mayName } from "../_video/naming.ts";
import { times } from "../_video/report.ts";
import { dmy } from "../_video/window.ts";
import { postOf, trackPost } from "./track.ts";
import type { Reading, Tracked } from "./track.ts";

export const REPORT_SECTIONS = ["Now", "Against its author's usual reach", "Over time", "Next plays"];
const LABEL: Record<string, string> = { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", reddit: "Reddit" };
const n = (x: number | null) => (x === null ? "unknown" : x.toLocaleString("en-GB"));
const when = (iso: string) => `${dmy(iso)} ${iso.slice(11, 16)} UTC`;
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

function trackerResult(t: Tracked, session: Session, args: WorkflowArgs): WorkflowResult {
  const meta: Meta = session.meta();
  const ev = new Evidence();
  ev.seeRequests(session.ledger.requestIds());
  const h = t.history;
  const metric = t.baseline?.metric ?? (t.readings.at(-1)!.views !== null ? "views" : "likes");
  const unit = h.platform === "reddit" ? "score" : metric;
  const value = (r: Reading) => (metric === "views" ? r.views : r.likes);
  const last = t.readings.at(-1)!;
  const first = t.readings[0];
  const who = h.platform === "reddit" ? "a Reddit post" : accountLabel({ platform: h.platform, handle: h.author || null, followers: h.authorFollowers });
  const usual = h.platform === "reddit" ? "its community's usual score" : `its author's usual ${unit}`;
  const named = h.platform !== "reddit" && mayName(h.authorFollowers);
  const readIds = t.readings.map((r) => r.requestId).filter((x): x is string => Boolean(x));

  const F1 = ev.add({
    claim: `${who}: ${n(value(last))} ${unit} at ${when(last.at)}.`,
    confidence: "seen",
    numbers: { value: value(last), likes: last.likes, comments: last.comments, shares: last.shares, quotes: last.quotes, readings: t.readings.length, followers: h.authorFollowers },
    requests: last.requestId ? [last.requestId] : readIds.slice(-1),
  });
  const F2 = t.baseline
    ? ev.add({
        claim: t.multiple !== null ? `${times(t.multiple)} ${usual}: a median of ${n(t.baseline.median)} over ${t.baseline.peers} earlier posts.` : `Too few earlier posts to compare: ${t.baseline.peers} found, 8 needed.`,
        confidence: "seen",
        numbers: { multiple: t.multiple, median: t.baseline.median, peers: t.baseline.peers, needed: 8, breakout: 3 },
        requests: t.baseline.requestIds.length ? t.baseline.requestIds : F1.requests,
      })
    : null;
  const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
  // The span between the first and last reading, in the unit a reader would say it in.
  const [spanCount, spanUnit] = hours < 1 ? [Math.round(hours * 60), "minute"] : hours < 48 ? [Math.round(hours), "hour"] : [Math.round(hours / 24), "day"];
  const spanText = `${spanCount} ${spanUnit}${spanCount === 1 ? "" : "s"}`;
  const F3 =
    t.readings.length > 1
      ? ev.add({
          claim: `${n(t.gainPerHour)} ${unit} an hour from ${when(first.at)} to ${when(last.at)}.`,
          confidence: "seen",
          numbers: { gain: t.gainPerHour, total: (value(last) ?? 0) - (value(first) ?? 0), span: spanCount, hours: Math.round(hours * 10) / 10, readings: t.readings.length, first: value(first), last: value(last) },
          requests: readIds,
        })
      : null;

  if (!t.baseline) ev.unknown({ what: `${usual[0].toUpperCase()}${usual.slice(1)}`, why: "the earlier posts could not be read (no author id on the post, or the read failed)" });
  if (t.taken < t.asked) ev.unknown({ what: `${t.asked - t.taken} of ${t.asked} readings asked for`, why: "not taken: the budget or the API stopped the run" });
  if (h.platform !== "x") ev.unknown({ what: "Quotes", why: `${LABEL[h.platform]} publishes no quote count` });
  ev.unknown({ what: "Why it moved", why: "readings show how a post's numbers change, not what caused the change" });

  const sections: ReportInput["sections"] = [
    {
      title: "Now",
      body: [
        `${who} on ${LABEL[h.platform]}, published ${h.publishedAt ? dmy(h.publishedAt) : "on an unknown date"} [${F1.id}].`,
        "",
        table(["Read at", unit[0].toUpperCase() + unit.slice(1), "Likes", "Comments", "Shares", "Quotes"], [[when(last.at), n(value(last)), n(last.likes), n(last.comments), n(last.shares), n(last.quotes)]]),
      ].join("\n"),
    },
    {
      title: "Against its author's usual reach",
      body: F2
        ? t.multiple !== null
          ? `Now at ${times(t.multiple)} ${usual}, a median of ${n(t.baseline!.median)} ${unit} over ${t.baseline!.peers} earlier posts${t.baseline!.from ? ` from ${dmy(t.baseline!.from)} to ${dmy(t.baseline!.to!)}` : ""}; 3 times or more is a break-out [${F2.id}].`
          : `No multiple: ${t.baseline!.peers} comparable earlier posts were on the pages read, and 8 are needed [${F2.id}].`
        : "Not read: see What we could not verify.",
    },
    {
      title: "Over time",
      body: [
        F3 ? `${n(t.gainPerHour)} ${unit} an hour across ${t.readings.length} readings [${F3.id}].` : `One reading so far. Run the same command again later and each run adds a reading here [${F1.id}].`,
        "",
        table(["Read at", unit[0].toUpperCase() + unit.slice(1), "Likes", "Comments", "Request"], t.readings.map((r) => [when(r.at), n(value(r)), n(r.likes), n(r.comments), r.requestId ?? ""])),
      ].join("\n"),
    },
    {
      title: "Next plays",
      body: table(
        ["Play", "Command", "What to check"],
        [
          ["Read it again later: each run adds a reading", `\`npx -y socialcrawl@latest post-tracker ${h.url}\``, "the gain an hour since this reading"],
          ["Six readings an hour apart, in one run", `\`npx -y socialcrawl@latest post-tracker ${h.url} --every 60 --times 6\``, "whether the gain an hour holds or fades"],
          ["Take it apart shot by shot", `\`npx -y socialcrawl@latest video-teardown ${h.url}\``, "its structure, words and comments"],
        ],
      ),
    },
  ];

  const summary = [`${who}: ${n(value(last))} ${unit} now [${F1.id}].`];
  if (F2) summary.push(t.multiple !== null ? `That is ${times(t.multiple)} ${usual} [${F2.id}].` : `Too few earlier posts to compare it with [${F2.id}].`);
  if (F3) summary.push(`It gained ${n((value(last) ?? 0) - (value(first) ?? 0))} ${unit} in ${spanText} across ${t.readings.length} readings, about ${n(t.gainPerHour)} an hour [${F3.id}].`);

  const fit = (s: string) => (s.length <= 110 ? s : s.slice(0, 109).replace(/\s+\S*$/, "") + "…");
  const headlines = [
    fit(t.multiple !== null ? `${n(value(last))} ${unit}, ${times(t.multiple)} ${usual}` : `${n(value(last))} ${unit} now`),
    ...(F3 ? [fit(`+${n((value(last) ?? 0) - (value(first) ?? 0))} ${unit} in ${spanText}, about ${n(t.gainPerHour)} an hour`)] : []),
  ];
  const card: CardInput = {
    command: `/post-tracker ${named ? h.url : `(${LABEL[h.platform]} post)`}`,
    skill: "post-tracker",
    headlines,
    basis: `${LABEL[h.platform]} post, read ${t.readings.length} ${t.readings.length === 1 ? "time" : "times"}, last ${dmy(last.at)}`,
    meta,
    rerun: `npx -y socialcrawl@latest post-tracker <the post link>`,
  };
  const report: ReportInput = {
    command: card.command,
    skill: "post-tracker",
    badge: `${LABEL[h.platform]} · ${t.readings.length} ${t.readings.length === 1 ? "reading" : "readings"} from ${dmy(first.at)} to ${dmy(last.at)}${named ? ` · ${h.url}` : ""}`,
    summary,
    sections,
    evidence: ev,
    meta,
    methodNotes: [
      "Each run reads the post once (or --times readings, --every minutes apart) and adds the reading to socialcrawl-runs/post-tracker-history/, so later runs build the curve.",
      "The author's usual reach is the median of their 8 to 20 comparable posts published before this one, read on the first run and kept; on Reddit it is the community's month of top posts.",
      "An author under 10,000 followers, or whose size is unknown, is described, not named, and their post is not linked in the report.",
    ],
  };
  void args;
  return {
    card,
    report,
    tiles: [
      { label: unit[0].toUpperCase() + unit.slice(1), value: n(value(last)), finding: F1.id },
      { label: "× usual", value: t.multiple !== null ? times(t.multiple) : "unknown", ...(F2 ? { finding: F2.id } : {}) },
      { label: "Readings", value: n(t.readings.length) },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: [{ title: `${unit[0].toUpperCase() + unit.slice(1)} at each reading`, unit, bars: t.readings.map((r) => ({ label: when(r.at), value: value(r) ?? 0 })) }],
    tables: {
      readings: { columns: ["at", "views", "likes", "comments", "shares", "saves", "quotes", "request_id"], rows: t.readings.map((r) => ({ at: r.at, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, quotes: r.quotes, request_id: r.requestId })) },
    },
  };
}

function trackerQuote(args: WorkflowArgs): WorkflowQuote {
  const timesN = Math.min(48, Math.max(1, Math.floor(Number(args.flags.times ?? 1)) || 1));
  let platform = "x";
  try {
    platform = postOf(args.input).platform;
  } catch {
    /* the run reports the bad link */
  }
  const baseline = platform === "tiktok" ? 3 : platform === "instagram" ? 2 : 1;
  const expected = timesN + baseline;
  return { expected, max: expected + timesN, lines: [`readings: ${timesN} × about 1 credit`, `the author's baseline, first run only: up to ${baseline}`, `Total: about ${expected} credits, at most ${expected + timesN}.`] };
}

export const workflow: Workflow = {
  name: "post-tracker",
  summary: "One post's views, likes, comments and quotes read now and on every later run, against its author's usual reach, with a chart.",
  usage: "socialcrawl post-tracker <post link> [--every <minutes> --times <n>]",
  examples: ["socialcrawl post-tracker https://x.com/<account>/status/<id>", "socialcrawl post-tracker https://www.tiktok.com/@<account>/video/<id> --every 60 --times 6"],
  defaultBudget: 10,
  deepBudget: 60,
  options: { every: { type: "string" }, times: { type: "string" } },
  slug: (args) => {
    try {
      const r = postOf(args.input);
      return `${r.platform}-${r.id}`;
    } catch {
      return "post";
    }
  },
  quote: trackerQuote,
  async run(session, args) {
    const t = await trackPost(session, args);
    return trackerResult(t, session, args);
  },
};

export { trackerResult };
