// What a teardown hands the render kit: the card, the report (summary first, then the
// sections, each line a finding with its request ids), tiles, charts and the CSVs.
//
// Trust rules, enforced here and checked by the engine's report gate:
//   - accounts are named only when they are the subject or have more than 10,000 followers;
//     everyone else is described ("an account with 2,300 followers") or counted;
//   - timing and repetition are described as what was seen, never as a scheme: no "ring",
//     "squad", "bot" or "paid" beside an account;
//   - every number a sentence states is in evidence.json, with the request it came from.
import type { Breakout } from "../../engine/breakout.ts";
import { Evidence } from "../../engine/evidence.ts";
import type { Confidence } from "../../engine/evidence.ts";
import type { CardInput, ReportSection } from "../../engine/outputs.ts";
import { ENGINE_SECTIONS } from "../../engine/outputs.ts";
import type { Meta } from "../../engine/rates.ts";
import { statedNumbers } from "../../engine/validate.ts";
import type { ValidateOptions } from "../../engine/validate.ts";
import type { WorkflowResult } from "../../render/types.ts";
import type { AccountAnalysis } from "./analyse.ts";
import type { Limit, TaggedRecord } from "./tracker.ts";
import type { XAccount } from "./x-account.ts";
import { hookOf } from "./x/codebook.ts";

export const WORKFLOW = "social-teardown";
export const BIG = 10_000;

export const REQUIRED_SECTIONS = [
  "The account",
  "What carried it",
  "What the top posts share",
  "When it posts",
  "Launches",
  "Who carried the top posts",
  "What people ask",
  "Words",
  "Where it sends people",
  "What won't copy",
  "Next plays",
];

/** Numbers the method states in its own words (thresholds, windows), allowed without a finding. */
export const METHOD_NUMBERS = [1.5, 2, 3, 8, 10, 14, 20, 24, 30, 48, 100, BIG];

const PLATFORM_NAME: Record<string, string> = { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", reddit: "Reddit", threads: "Threads" };

const n = (x: number | null | undefined) => (x === null || x === undefined ? "unknown" : x.toLocaleString("en-GB"));
const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "unknown");
const pct = (x: number) => Math.round(x * 100);
const cut = (s: string, k: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > k ? `${t.slice(0, k - 1)}…` : t;
};
const esc = (s: string) => s.replace(/\|/g, "\\|");

/** The subject, a company or a large account by handle; anyone else described by size. */
export function who(handle: string, followers: number | null, subject = false): string {
  const h = handle.replace(/^@/, "");
  if (subject || (followers !== null && followers > BIG)) return `@${h}`;
  return followers === null ? "an account of unknown size" : `an account with ${n(followers)} followers`;
}

function table(head: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return "";
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map((c) => esc(String(c))).join(" | ")} |`)].join("\n");
}

export interface BuildInput {
  /** As the person typed it, for the card's title. */
  command: string;
  inputs: string[];
  accounts: AccountAnalysis[];
  x: XAccount[];
  /** Every call of the run, tagged by account: "How this was read" lists each read. */
  records: TaggedRecord[];
  limits: Limit[];
  errors: { stage: string; endpoint: string; status: number | null; message: string; requestId: string | null }[];
  meta: Meta;
  deep: boolean;
  now: Date;
}

export interface Built {
  result: WorkflowResult;
  evidence: Evidence;
  validateOptions: ValidateOptions;
  /** Up to five lines for the terminal, each a finding. */
  terminal: string[];
}

export function buildResult(input: BuildInput): Built {
  const ev = new Evidence();
  const label = (a: AccountAnalysis) => `@${a.handle} on ${PLATFORM_NAME[a.platform] ?? a.platform}`;
  const many = input.accounts.length > 1;
  const recById = new Map(input.records.filter((r) => r.requestId).map((r) => [r.requestId as string, r]));
  /** True when a read reached the start of its window: the walk ended, with no page left. */
  const reachedStart = (id: string | null) => {
    const r = id ? recById.get(id) : undefined;
    if (!r) return true;
    const d: any = r.body.data ?? {};
    const more = Boolean((r.body as any).pagination?.has_more ?? d.next_cursor);
    return d.walk?.stopped ? d.walk.stopped === "end" && !more : !more;
  };
  const windowOf = (id: string | null, key: "window" | "minutes", fallback: string) => (id ? recById.get(id)?.meta[key] : undefined) ?? fallback;
  const subjects = new Set(input.accounts.map((a) => a.handle.toLowerCase()));
  const named = (h: string, followers: number | null) => who(h, followers, subjects.has(h.replace(/^@/, "").toLowerCase()));

  /** A finding: every number in the claim goes into evidence.json, with the requests it came from. */
  function cite(claim: string, confidence: Confidence, requests: (string | null | undefined)[], limitations: string[] = []): string {
    const reqs = [...new Set(requests.filter((x): x is string => typeof x === "string" && x.length > 0))];
    const numbers: Record<string, number | null> = {};
    statedNumbers(claim).forEach((x, i) => (numbers[`n${i + 1}`] = x.value));
    claim = singular(claim);
    const f = ev.add({ claim, confidence: reqs.length || confidence === "unknown" ? confidence : "unknown", numbers, requests: reqs, limitations: reqs.length || confidence === "unknown" ? limitations : [...limitations, "no request id was kept for this read"] });
    return `${claim} [${f.id}]`;
  }

  // Coverage of every read, from the API's own walk blocks: "read 200 rows on 4 pages, back to 01/09/2026".
  // Reads that return rows; a transcript or a repository answer is one object, not rows.
  const READS = new Set(["timeline", "comments", "replies", "retweeters", "quotes", "squad", "reddit"]);
  for (const r of input.records) if (r.status === 200 && READS.has(r.stage)) ev.cover(r, many ? `${r.meta.account ?? ""} ${r.stage}`.trim() : r.stage);

  const sections: ReportSection[] = [];
  const per = (title: string, body: (a: AccountAnalysis) => string[]) => {
    const parts: string[] = [];
    for (const a of input.accounts) {
      const lines = body(a).filter((l) => l !== "");
      if (!lines.length) continue;
      if (many) parts.push(`### ${label(a)}`, "");
      parts.push(...lines.flatMap((l) => [l, ""]));
    }
    sections.push({ title, body: parts.join("\n").trim() || "Nothing to report from the posts read." });
  };
  const xOf = (a: AccountAnalysis) => input.x.find((x) => x.account.account === a.account) ?? null;
  const metricWord = (a: AccountAnalysis) => (a.metric === "views" ? "views" : a.platform === "reddit" ? "points" : "likes");
  const firstLine = (text: string) => cut(text.split("\n")[0] ?? "", 70);

  // ── The account
  const summary: string[] = [];
  const headlines: string[] = [];
  per("The account", (a) => {
    const p = a.profile;
    const lines = [
      cite(`${label(a)} has ${n(p.followers)} followers${p.posts !== null ? ` and ${n(p.posts)} posts on its profile` : ""}${p.joined ? `; joined ${dmy(p.joined)}` : ""}.`, "seen", [a.profileRequest]),
      (() => {
        const xa = xOf(a);
        const all = xa ? xa.coded.length : a.posts.length + a.others;
        const of = a.ofTotal !== null ? ` of the ${n(a.ofTotal)} on its profile` : "";
        return all > a.posts.length
          ? cite(`This run read ${n(all)} posts${of}, from ${dmy(a.first)} to ${dmy(a.last)}; ${n(a.posts.length)} of them are its own posts and the rest ${xa ? "quote posts, replies and reposts" : "other people's posts in its feed"}.`, "seen", a.timelineRequests)
          : cite(`This run read ${n(a.posts.length)} posts${of}, from ${dmy(a.first)} to ${dmy(a.last)}.`, "seen", a.timelineRequests);
      })(),
    ];
    if (a.others) lines.push(cite(`Its feed also showed ${n(a.others)} posts by other people (staff or members it reshared); they are counted, not named, and left out of every multiple.`, "seen", a.timelineRequests));
    return lines;
  });

  // ── What carried it
  per("What carried it", (a) => {
    const mw = metricWord(a);
    if (!a.posts.length) return [cite(`No post of ${label(a)} was read, so nothing can be said about what carried it.`, "unknown", [])];
    const lines: string[] = [];
    if (a.outliers.length) {
      const top = a.outliers[0];
      const lagging = a.unusual.some((u) => u.row.id === top.row.id);
      const line = cite(`The biggest break-out is the ${top.row.video ? "video" : "post"} of ${dmy(top.row.publishedAt)}: ${n(top.breakout.value)} ${mw}, ${multipleWords(top.breakout, mw)}${lagging ? "; it has few likes for its views and may have been promoted (below)" : ""}.`, "seen", [top.row.requestId, ...top.breakout.requestIds]);
      lines.push(line);
      if (summary.length < 5) summary.push(`${many ? `${label(a)}: ` : ""}${line}`);
      headlines.push(cut(`${many ? `${label(a)}: ` : ""}one ${top.row.video ? "video" : "post"} did ${top.breakout.multiple}x its usual ${mw}${lagging ? ", with few likes for its views" : ""}`, 110));
      if (a.outlierShare !== null) {
        const share = cite(`${n(a.outliers.length)} of the ${n(a.posts.length)} posts read broke out (3 times or more their earlier posts' median); together they carry ${pct(a.outlierShare)}% of the ${mw} of all the posts read.`, "inferred", a.timelineRequests);
        lines.push(share);
        if (summary.length < 5) summary.push(`${many ? `${label(a)}: ` : ""}${share}`);
        if (headlines.length < 3) headlines.push(cut(`${many ? `${label(a)}: ` : ""}${n(a.outliers.length)} posts carry ${pct(a.outlierShare)}% of the ${mw}`, 110));
      }
      lines.push(table(["Date", mw[0].toUpperCase() + mw.slice(1), "Times its median", "Earlier posts compared", "Format", "First line", "Request"], a.outliers.slice(0, 10).map((o) => [dmy(o.row.publishedAt), n(o.breakout.value), `${o.breakout.multiple}x`, o.breakout.peers, o.row.video ? `video${o.row.durationSeconds ? ` ${Math.round(o.row.durationSeconds)} s` : ""}` : "post", o.row.url ? `[${firstLine(o.row.text) || "(no text)"}](${o.row.url})` : firstLine(o.row.text), o.row.requestId ?? ""])));
    } else {
      const line = cite(`None of the ${n(a.posts.length)} posts read reached 3 times its earlier posts' median ${mw}; the median post had ${n(a.medianMetric)}.`, "inferred", a.timelineRequests);
      lines.push(line);
      if (summary.length < 5) summary.push(`${many ? `${label(a)}: ` : ""}${line}`);
    }
    const vids = a.posts.filter((r) => r.video);
    const rest = a.posts.filter((r) => !r.video);
    const sum = (rs: typeof a.posts) => rs.reduce((t, r) => t + ((a.metric === "views" ? r.views : r.likes) ?? 0), 0);
    // Only where the other posts carry the metric too (Instagram photos count no views).
    const counted = (rs: typeof a.posts) => rs.filter((r) => (a.metric === "views" ? r.views : r.likes) !== null).length;
    if (counted(vids) >= 3 && counted(rest) >= 3 && sum(a.posts) > 0) {
      const med = (rs: typeof a.posts) => {
        const v = rs.map((r) => (a.metric === "views" ? r.views : r.likes)).filter((x): x is number => x !== null).sort((p, q) => p - q);
        return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
      };
      const share = sum(vids) / sum(a.posts);
      const line = cite(`${n(vids.length)} videos carry ${pct(share)}% of the ${mw} of the ${n(a.posts.length)} posts read; the median video had ${n(med(vids))} against ${n(med(rest))} for the other posts.`, "inferred", a.timelineRequests);
      lines.push(line);
      if (summary.length < 5) summary.push(`${many ? `${label(a)}: ` : ""}${line}`);
      if (headlines.length < 3 && share >= 0.5) headlines.push(cut(`${many ? `${label(a)}: ` : ""}${n(vids.length)} of ${n(a.posts.length)} posts are videos; they carry ${pct(share)}% of the ${mw}`, 110));
    }
    for (const u of a.unusual.slice(0, 3)) lines.push(cite(`The ${u.row.video ? "video" : "post"} of ${dmy(u.row.publishedAt)} has ${u.perThousand} likes per 1,000 views against the account's median of ${u.accountMedian}: views far ahead of likes, so it may have been promoted. Inferred from the counts; an advert is not visible in public data.`, "inferred", [u.row.requestId]));
    if (a.baseTooSmall) lines.push(cite(`${n(a.baseTooSmall)} posts have no multiple: their earlier posts had too few views to compare (a median under 100 views, or under 10 likes where the platform counts no views).`, "seen", a.timelineRequests));
    const xq = xOf(a);
    if (xq) {
      const quotes = xq.coded.filter((c) => c.kind === "quote");
      const own = quotes.filter((c) => c.quoted_author.toLowerCase() === a.handle.toLowerCase()).length;
      if (quotes.length) lines.push(cite(`${n(quotes.length)} of its own posts quote another post, ${n(own)} of them its own; the quoted accounts are listed in data/x-coded.csv, not named here.`, "seen", [...new Set(quotes.map((c) => c.request_no))]));
    }
    if (a.tooFew) lines.push(cite(`${n(a.tooFew)} posts have no multiple: fewer than 8 comparable posts came before them in the read.`, "seen", a.timelineRequests));
    return lines;
  });

  // ── What the top posts share
  per("What the top posts share", (a) => {
    const c = a.contrast;
    const lines: string[] = [];
    if (!c.called) {
      lines.push(cite(c.reason === "too_few_posts" ? `No pattern is called: ${n(c.posts)} posts are old enough to compare, and the method needs 24, so the top third and the bottom third would be too small.` : "No pattern is called across two platforms.", "unknown", a.timelineRequests));
    } else {
      const found = c.traits.filter(strongTrait).slice(0, 4);
      if (!found.length) lines.push(cite(`Across ${n(c.posts)} posts, no trait is more common in the top third than in the bottom third often enough to call (4 top posts at least).`, "inferred", a.timelineRequests));
      for (const t of found) {
        const line = cite(`Posts that ${traitWords(t.feature, t.value)}: ${t.top} of the top third against ${t.bottom} of the bottom third (${pct(t.topShare)}% against ${pct(t.bottomShare)}%).`, "inferred", a.timelineRequests);
        lines.push(line);
        if (headlines.length < 3 && !TIMING.has(t.feature)) headlines.push(cut(`${many ? `${label(a)}: top` : "Top"} posts ${traitWords(t.feature, t.value)} more often (${pct(t.topShare)}% vs ${pct(t.bottomShare)}%)`, 110));
      }
    }
    const groups = a.byLength.filter((g) => g.n >= 3);
    if (groups.length > 1) lines.push(table(["Length", "Posts", `Median ${metricWord(a)}`], groups.map((g) => [g.key, g.n, n(g.median)])));
    return lines;
  });

  // ── When it posts
  per("When it posts", (a) => {
    if (!a.hours.length) return [];
    const h = a.hours[0];
    const d = a.weekdays[0];
    const lines = [cite(`The busiest hour is ${h.key}:00 UTC (${h.n} of ${a.posts.length} posts) and the busiest day ${DAY[d.key] ?? d.key} (${d.n} posts).`, "seen", a.timelineRequests)];
    if (a.gapDays !== null) lines.push(cite(`The median gap between two posts is ${a.gapDays} days.`, "seen", a.timelineRequests));
    return lines;
  });

  // ── Launches
  per("Launches", (a) => {
    const xa = xOf(a);
    if (xa) {
      const L = xa.x.launches;
      if (!L.length) return [cite(`No launch was found: no own post names a repository, skill or try-URL and announces it.`, "inferred", a.timelineRequests)];
      const lines = [cite(`${n(L.length)} launches found among the posts read (each groups the posts naming the same repository, skill or try-URL, with the self-replies under them).`, "inferred", a.timelineRequests)];
      const hours = new Map<number, number>();
      for (const l of L) {
        const hh = xa.coded.find((c) => c.post_id === l.mainPost)?.hour_utc;
        if (hh !== undefined) hours.set(hh, (hours.get(hh) ?? 0) + 1);
      }
      const best = [...hours.entries()].sort((p, q) => q[1] - p[1])[0];
      if (best && L.length >= 3) lines.push(cite(`${best[1]} of ${L.length} launch posts went out in the ${String(best[0]).padStart(2, "0")}:00 UTC hour.`, "seen", L.map((l) => xa.coded.find((c) => c.post_id === l.mainPost)?.request_no)));
      for (const l of L.filter((x) => x.announceDays.length >= 2)) lines.push(cite(`${l.artefactName} was announced on ${l.announceDays.length} different days (${l.announceDays.map(dmy).join(", ")}): a relaunch.`, "seen", l.posts.map((id) => xa.coded.find((c) => c.post_id === id)?.request_no)));
      lines.push(table(["Launch", "Date", "Thing", "Main post views", "Posts", "Views of all its posts"], L.slice(0, 15).map((l) => [l.id, dmy(l.launchDate), l.artefactName, n(l.mainViews), l.posts.length, n(l.clusterViews)])));
      return lines;
    }
    const launches = a.posts.filter((r) => /^(introducing|just_shipped|i_built)$/.test(hookOfRow(r)));
    if (!launches.length) return [cite(`No post read opens like a launch ("Introducing", "We just shipped", "I built").`, "inferred", a.timelineRequests)];
    return [cite(`${n(launches.length)} posts open like a launch ("Introducing", "We just shipped", "I built"); dated ${launches.slice(-5).map((r) => dmy(r.publishedAt)).join(", ")}.`, "inferred", launches.map((r) => r.requestId))];
  });

  // ── Who carried the top posts
  per("Who carried the top posts", (a) => {
    const xa = xOf(a);
    const lines: string[] = [];
    if (xa) {
      const x = xa.x;
      for (const amp of x.amplifiers.slice(0, 6)) lines.push(cite(`Post ${amp.postId}: ${n(amp.count)} reposters read${amp.complete ? " (all of them)" : " (the first pages)"}, ${n(amp.over10k)} with more than 10,000 followers, median ${n(amp.medianFollowers)} followers.`, "seen", [amp.requestId]));
      if (x.amplifiers.length >= 2) {
        const big = x.repeatAmplifiers.filter((r) => r.followers > BIG);
        lines.push(cite(`${n(x.repeatAmplifiers.length)} accounts reposted two or more of the ${x.amplifiers.length} posts read; ${n(big.length)} of them have more than 10,000 followers${big.length ? `: ${big.slice(0, 5).map((r) => `@${r.handle}`).join(", ")}` : ""}.`, "seen", x.amplifiers.map((p) => p.requestId)));
      }
      for (const q of x.quotes.slice(0, 6)) {
        const win = windowOf(q.requestId, "window", "3h").replace(/h$/, "");
        const span = `its first ${win === "1" ? "hour" : `${win} hours`}`;
        if (reachedStart(q.requestId) || q.firstMinutes === null || q.firstMinutes <= 1) lines.push(cite(`Post ${q.postId}: ${n(q.count)} quote posts in ${span}${q.firstMinutes !== null ? `, the first after ${q.firstMinutes} minutes` : ""}, median ${n(q.medianFollowers3h)} followers among them.`, "seen", [q.requestId]));
        else lines.push(cite(`Post ${q.postId}: ${n(q.count)} quote posts read from ${span}, all from ${q.firstMinutes} minutes on; the search reads newest first and stopped there, so ${q.firstMinutes === 1 ? "the first minute was" : `the first ${q.firstMinutes} minutes were`} not read.`, "seen", [q.requestId]));
      }
      if (x.quotes.length >= 2) {
        const big = x.repeatQuoters.filter((r) => r.followers > BIG);
        lines.push(cite(`${n(x.repeatQuoters.length)} accounts quoted two or more of the ${x.quotes.length} posts read in their first hours; ${n(big.length)} have more than 10,000 followers${big.length ? `: ${big.slice(0, 5).map((r) => `@${r.handle}`).join(", ")}` : ""}.`, "seen", x.quotes.map((q) => q.requestId)));
      }
      for (const s of x.squads) {
        const span = Number(windowOf(s.requestId, "minutes", "120"));
        const earliest = s.accounts.length ? Math.min(...s.accounts.map((y) => y.minutes)) : null;
        const firsts = s.accounts.filter((y) => y.minutes >= 0).slice(0, 3).map((y) => `${named(y.handle, y.followers)} after ${y.minutes} minutes`).join(", ") || "none";
        if (reachedStart(s.requestId) || earliest === null || earliest <= 0) lines.push(cite(`Launch ${s.launch}: ${n(s.within30)} other accounts posted about it within 30 minutes of the launch post and ${n(s.within120)} within ${span} minutes; the first: ${firsts}.`, "seen", [s.requestId]));
        else lines.push(cite(`Launch ${s.launch}: ${n(s.accounts.length)} other accounts posted about it in the part of the window read, which reached back to ${earliest} minutes after the launch post; the search reads newest first and stopped there, so ${earliest === 1 ? "the first minute was" : `the first ${earliest} minutes were`} not read.`, "seen", [s.requestId]));
      }
      if (x.squads.length >= 2) lines.push(cite(`${n(x.repeatSquad.length)} accounts posted about two or more of the ${x.squads.length} launches read, in the windows read around them. This shows timing, not whether anyone arranged it.`, "inferred", x.squads.map((s) => s.requestId)));
      if (x.replies.length >= 2) {
        const big = x.replyRing.filter((r) => (r.followers ?? 0) > BIG);
        lines.push(cite(`${n(x.replyRing.length)} accounts replied under two or more of the ${x.replies.length} posts whose replies were read${big.length ? `; the larger ones: ${big.slice(0, 5).map((r) => `@${r.handle}`).join(", ")}` : ""}.`, "seen", x.replies.map((r) => r.requestId)));
      }
      if (x.teamCandidates.length) lines.push(cite(`The account reposts ${x.teamCandidates.length} accounts three times or more (the most: ${x.teamCandidates[0].retweets} times); accounts a brand reposts that often are usually its team. Their handles are in data/reposted.csv.`, "inferred", a.timelineRequests));
      for (const r of x.replies.filter((y) => y.gate)) lines.push(cite(`Post ${r.postId} asks for a word in the replies: "${r.gate!.word}" is ${pct(r.gate!.share)}% of the ${r.count} replies read.`, "seen", [r.requestId]));
      if (!lines.length) lines.push(cite("No reposter, quote or reply page was read in this run.", "unknown", []));
      return lines;
    }
    const tagging = a.outliers.filter((o) => /@[\w.]{2,}/.test(o.row.text)).length;
    if (a.outliers.length) lines.push(cite(`${n(tagging)} of the ${n(a.outliers.length)} posts that broke out tag another account in their text; the platform does not show who shared them.`, "seen", a.outliers.map((o) => o.row.requestId)));
    else lines.push(cite(`${PLATFORM_NAME[a.platform]} does not show who shared a post, and no post broke out to look at.`, "unknown", []));
    if (a.others) lines.push(cite(`The page also showed ${n(a.others)} posts written by other people; their reach is theirs, not the page's.`, "seen", a.timelineRequests));
    return lines;
  });

  // ── What people ask
  per("What people ask", (a) => {
    if (!a.comments.length) return [cite("No comments were read in this run.", "unknown", [])];
    const lines: string[] = [];
    for (const c of a.comments.slice(0, 6)) {
      const shares = Object.entries(c.shares).filter(([, v]) => v !== null).map(([k, v]) => `${k.replace(/_/g, " ")} ${pct(v as number)}%`);
      lines.push(cite(`Post ${c.postId}: ${n(c.read)} comments read${c.of !== null ? ` of ${n(c.of)}` : ""}; the API's labels: ${shares.join(", ") || "none returned"}${c.ownReplies ? `; the account itself replied ${c.ownReplies} times` : ""}.`, "seen", [c.requestId]));
      for (const r of c.receipts.slice(0, 2)) lines.push(`> ${r.label.replace(/_/g, " ")}: "${r.text}"`);
    }
    if (a.comments.length >= 2 && !xOf(a)) lines.push(cite(`${n(a.repeatCommenters)} accounts commented under two or more of the ${a.comments.length} posts read; they are counted, not named.`, "seen", a.comments.map((c) => c.requestId)));
    return lines;
  });

  // ── Words
  per("Words", (a) => {
    if (!a.words.length) return [cite("No transcript was read in this run.", "unknown", [])];
    const caveat = "on music-only videos the transcript lane has returned words that were never spoken; check a surprising opening by ear";
    return a.words.map((w) =>
      w.opening
        ? cite(`${w.kind === "screen_text" ? "On screen" : "Spoken"}, post ${w.postId}: ${w.words} words, opening "${cut(w.opening, 120)}".`, "seen", [w.requestId], w.kind === "transcript" && a.platform !== "x" ? [caveat] : [])
        : cite(`Post ${w.postId}: no ${w.kind === "screen_text" ? "on-screen text" : "transcript"} (${w.reason}).`, "unknown", [w.requestId]),
    );
  });

  // ── Where it sends people
  per("Where it sends people", (a) => {
    if (!a.links.length) return [cite(`No link out was found in the bio or the ${n(a.posts.length)} posts read.`, "seen", [a.profileRequest, ...a.timelineRequests])];
    const top = a.links.slice(0, 6);
    return [
      cite(`It links out to ${n(a.links.length)} domains; the most: ${top.map((l) => `${l.domain} (${l.bio ? "bio" : ""}${l.bio && l.posts ? ", " : ""}${l.posts ? `${l.posts} posts` : ""})`).join("; ")}.`, "seen", [a.profileRequest, ...a.timelineRequests]),
    ];
  });

  // ── Across the accounts
  if (many) {
    const rows = input.accounts.map((a) => [label(a), n(a.profile.followers), n(a.posts.length), n(a.medianMetric), metricWord(a), a.outliers.length, a.outliers[0]?.breakout.multiple ? `${a.outliers[0].breakout.multiple}x` : ""]);
    const lead = input.accounts.slice().sort((p, q) => (q.outliers[0]?.breakout.value ?? 0) - (p.outliers[0]?.breakout.value ?? 0))[0];
    const lines = [table(["Account", "Followers", "Posts read", "Median", "of", "Broke out", "Biggest multiple"], rows)];
    if (lead.outliers.length) lines.push(cite(`The biggest single post of all the accounts read is ${label(lead)}'s, with ${n(lead.outliers[0].breakout.value)} ${metricWord(lead)}.`, "seen", [lead.outliers[0].row.requestId]));
    const days = new Map<string, string[]>();
    for (const a of input.accounts) for (const o of a.outliers) {
      const d = (o.row.publishedAt ?? "").slice(0, 10);
      days.set(d, [...(days.get(d) ?? []), a.account]);
    }
    const shared = [...days.entries()].filter(([, v]) => new Set(v).size >= 2);
    lines.push(cite(shared.length ? `${shared.length} days carry a break-out on two or more of the accounts (${shared.slice(0, 3).map(([d]) => dmy(d)).join(", ")}).` : "No two accounts broke out on the same day: their best posts went out on different days.", "inferred", input.accounts.flatMap((a) => a.timelineRequests)));
    sections.push({ title: "Across the accounts", body: lines.join("\n\n") });
  }

  // ── What won't copy
  per("What won't copy", (a) => {
    const lines = [cite(`Reach starts from an audience: ${label(a)} has ${n(a.profile.followers)} followers, so a smaller account copying its format should compare against its own median, not these ${metricWord(a)}.`, "inferred", [a.profileRequest])];
    const xa = xOf(a);
    if (xa && xa.x.repeatAmplifiers.length) lines.push(cite(`${n(xa.x.repeatAmplifiers.length)} accounts repost its top posts again and again; a format copied without such a group of reposters starts colder.`, "inferred", xa.x.amplifiers.map((p) => p.requestId)));
    lines.push("Paid promotion, if any, does not show in public data: an advert's views count as views here.");
    return lines;
  });

  // ── Next plays
  const plays: string[] = [];
  const cmd = (s: string) => `\`npx -y socialcrawl@latest ${s}\``;
  for (const a of input.accounts.slice(0, 3)) {
    const target = a.platform === "x" ? `@${a.handle}` : a.platform === "linkedin" ? `"${a.profile.url ?? a.handle}"` : `${a.platform}:${a.handle}`;
    plays.push(cite(`Read ${label(a)} again in 14 days with ${cmd(`social-teardown ${target}`)} and check whether its median ${metricWord(a)} per post moved from ${n(a.medianMetric)}.`, "seen", a.timelineRequests));
    // video-teardown reads one video, so the play points at the biggest video that broke out.
    const topVideo = a.outliers.find((o) => o.row.video && o.row.url);
    if (topVideo) plays.push(cite(`Take apart its biggest break-out video frame by frame with ${cmd(`video-teardown ${topVideo.row.url}`)}; then post one in the same shape and check after 14 days whether it beats your own median by 3 times.`, "seen", [topVideo.row.requestId]));
    const trait = a.contrast.called ? a.contrast.traits.find((t) => strongTrait(t) && !TIMING.has(t.feature)) : undefined;
    if (trait) plays.push(cite(`Its top posts ${traitWords(trait.feature, trait.value)} more often than its bottom ones: try that on your next posts, and after 14 days run ${cmd("social-teardown <your handle>")} to see whether yours with it beat yours without.`, "inferred", a.timelineRequests));
  }
  sections.push({ title: "Next plays", body: plays.map((p, i) => `${i + 1}. ${p}`).join("\n") });

  // ── What this run could not see
  for (const l of input.limits) ev.unknown({ what: `${l.stage} (${l.endpoint})`, why: l.reason });
  // A video with no captions is a fact the Words section states, not a gap in the read.
  for (const e of input.errors.filter((x) => !/no captions/i.test(x.message))) ev.unknown({ what: `${e.stage} (${e.endpoint})`, why: `${e.status ?? "no status"}: ${firstSentence(e.message)}${e.requestId ? ` (${e.requestId})` : ""}` });
  for (const xa of input.x) {
    const unseen = xa.coded.filter((c) => c.quote_unseen).length;
    if (unseen) ev.unknown({ what: `${n(unseen)} text-only posts of @${xa.account.handle} may be quote posts`, why: "the API returns no quoted post on X rows yet, so what they quote and whom is unseen", check: "open the post on X" });
    const hours = [...new Set(input.records.filter((r) => r.stage === "quotes" && r.meta.account === xa.account.account).map((r) => r.meta.window))].filter(Boolean).join(" and ") || "none";
    ev.unknown({ what: `Quote posts after the window read (${hours})`, why: "there is no quote list; the run searches quoted_tweet_id: inside that window only" });
    ev.unknown({ what: "Follower growth over time", why: "the profile gives today's count only" });
  }
  ev.unknown({ what: "Why a post carried", why: "a count never shows a cause: \"this video had 40 times the views\" is seen, \"because it was a video\" is inferred" });

  // Every sentence's sections are ordered: the required ones, with "Across the accounts" before "What won't copy".
  const order = [...REQUIRED_SECTIONS.slice(0, 9), "Across the accounts", ...REQUIRED_SECTIONS.slice(9)];
  sections.sort((p, q) => order.indexOf(p.title) - order.indexOf(q.title));

  if (!summary.length) summary.push(cite("No post was read, so there is nothing to summarise.", "unknown", []));
  if (!headlines.length) headlines.push(cut(`${input.accounts.map(label).join(", ")}: no post broke out in the posts read`, 110));

  // Every post read: on X the replies and reposts too, elsewhere the other people's posts in the feed.
  const postsRead = input.accounts.reduce((t, a) => t + (xOf(a)?.coded.length ?? a.posts.length + a.others), 0);
  const badge = `${input.accounts.map(label).join(" · ")} · ${n(postsRead)} posts read · ${input.deep ? "deep" : "default"} run · v${input.meta.version}`;
  const card: CardInput = {
    command: input.command,
    skill: WORKFLOW,
    headlines: headlines.slice(0, 3).map((h) => h.charAt(0).toUpperCase() + h.slice(1)),
    basis: `${n(postsRead)} posts read on ${input.accounts.length} account${input.accounts.length === 1 ? "" : "s"}`,
    meta: input.meta,
    rerun: `npx -y socialcrawl@latest ${WORKFLOW} ${JSON.stringify(input.inputs.join(" "))}`,
  };

  const methodNotes = [
    "The break-out multiple is the engine's: a post's views (likes where the platform counts no views, points on Reddit) over the median of the author's 20 earlier comparable posts, videos with videos; no multiple under 8 such posts; 3 times or more is a break-out, 1.5 times above usual.",
    "Top against bottom: the top third by multiple against the bottom third, posts 10 days old or more, called only with 24 such posts and only when 4 or more top posts share the trait.",
    "Comment shares are the API's own free labels; quoted comments carry no name.",
    "Accounts are named only when they are the subject or have more than 10,000 followers; everyone else is counted or described.",
    "The investigation method is adapted from REA, Reverse Engineer Anything (github.com/morluto/rea, MIT, Copyright (c) 2026 morluto): every claim says whether it was seen, inferred or unknown and cites the request it came from.",
  ];

  // Tiles and charts
  const lead = input.accounts[0];
  const tiles = [
    { label: "Posts read", value: `${n(postsRead)}${input.accounts.length === 1 && lead?.ofTotal !== null && lead ? ` of ${n(lead.ofTotal)}` : ""}` },
    { label: "Broke out", value: n(input.accounts.reduce((s, a) => s + a.outliers.length, 0)) },
    { label: "Followers", value: input.accounts.length === 1 ? n(lead?.profile.followers) : `${input.accounts.length} accounts` },
    { label: "Credits", value: n(input.meta.credits) },
  ];
  const charts = input.accounts
    .filter((a) => a.outliers.length)
    .map((a) => ({ title: `${label(a)}: the posts that broke out, times their earlier posts' median`, unit: "x", bars: a.outliers.slice(0, 8).map((o) => ({ label: `${dmy(o.row.publishedAt)} ${firstLine(o.row.text).slice(0, 30)}`, value: o.breakout.multiple ?? 0, note: `${n(o.breakout.value)} ${metricWord(a)}` })) }));
  for (const a of input.accounts) {
    const g = a.byLength.filter((x) => x.n >= 3 && x.median !== null);
    if (g.length > 1) charts.push({ title: `${label(a)}: median ${metricWord(a)} by length`, unit: "", bars: g.map((x) => ({ label: x.key, value: x.median as number, note: `${x.n} posts` })) });
  }

  // Tables: every post read, the comments read, and the accounts an X brand reposts.
  const postRows = input.accounts.flatMap((a) =>
    a.posts.map((r) => ({ account: a.account, platform: a.platform, post_id: r.id, url: r.url ?? "", published_at: r.publishedAt ?? "", text: r.text, video: r.video, duration_seconds: r.durationSeconds ?? "", views: r.views ?? "", likes: r.likes ?? "", comments: r.comments ?? "", shares: r.shares ?? "", saves: r.saves ?? "", multiple: a.multiples[r.id] ?? "", first_line: hookOfRow(r), request_id: r.requestId ?? "" })),
  );
  const tables: WorkflowResult["tables"] = {
    posts: { columns: ["account", "platform", "post_id", "url", "published_at", "text", "video", "duration_seconds", "views", "likes", "comments", "shares", "saves", "multiple", "first_line", "request_id"], rows: postRows },
  };
  const commentRows = input.accounts.flatMap((a) => a.comments.map((c) => ({ account: a.account, post_id: c.postId, read: c.read, of: c.of ?? "", question: c.shares.question ?? "", purchase_intent: c.shares.purchase_intent ?? "", complaint: c.shares.complaint ?? "", request_id: c.requestId ?? "" })));
  if (commentRows.length) tables.comments = { columns: ["account", "post_id", "read", "of", "question", "purchase_intent", "complaint", "request_id"], rows: commentRows };
  const reposted = input.x.flatMap((xa) => xa.x.teamCandidates.map((t) => ({ account: xa.account.account, reposts: t.handle, times: t.retweets })));
  if (reposted.length) tables.reposted = { columns: ["account", "reposts", "times"], rows: reposted };
  const xposts = input.x.flatMap((xa) => xa.coded.map((c) => ({ ...c })));
  if (xposts.length) tables["x-coded"] = { columns: Object.keys(xposts[0]), rows: xposts };

  const allRequests = new Set<string>();
  for (const f of ev.findings) for (const r of f.requests) allRequests.add(r);
  // Every call the run made, failed ones included, so a request id the report names resolves.
  for (const r of input.records) if (r.requestId) allRequests.add(r.requestId);
  for (const e of input.errors) if (e.requestId) allRequests.add(e.requestId);
  ev.seeRequests(allRequests);

  const result: WorkflowResult = {
    card,
    report: { command: input.command, skill: WORKFLOW, badge, summary, sections, evidence: ev, meta: input.meta, methodNotes },
    tiles,
    charts,
    tables,
  };
  const validateOptions: ValidateOptions = {
    requiredSections: REQUIRED_SECTIONS,
    summarySection: "In short",
    playbookSection: "Next plays",
    engineSections: ENGINE_SECTIONS,
    allowNumbers: [...METHOD_NUMBERS, input.meta.credits, input.meta.calls, postsRead],
  };
  return { result, evidence: ev, validateOptions, terminal: summary.slice(0, 5) };
}

/** "69.5 times the median views of its 20 earlier posts (1,135)", with the engine's cautions. */
function multipleWords(b: Breakout, mw: string): string {
  const notes = [b.settling ? "still rising" : null, b.inflatedByYoung ? `${b.youngPeers} of the earlier posts are under 48 hours old, so the multiple may be high` : null].filter(Boolean);
  return `${b.multiple} times the median ${mw} of its ${b.peers} earlier comparable posts (${n(b.base)})${notes.length ? `; ${notes.join("; ")}` : ""}`;
}

const DAY: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

/** "1 accounts" is "1 account"; "replied 1 times" is "replied once". */
export function singular(s: string): string {
  return s
    .replace(/(?<![\d.,])1 times\b/g, "once")
    .replace(/(?<![\d.,])1 (account|post|launch|domain|comment|reposter|quote post|day|minute|word|reply)(e?s)\b/g, "1 $1")
    .replace(/(?<![\d.,])1 (posts|replies) (read|found)/g, (_m, w, v) => `1 ${w === "replies" ? "reply" : "post"} ${v}`)
    .replace(/(?<![\d.,])\b1 (of them )?have\b/g, "1 $1has");
}

const FIRST_LINE: Record<string, string> = { introducing: "an \"Introducing\"", just_shipped: "a \"just shipped\"", i_built: "an \"I built\"", milestone: "a milestone", free_offer: "a free offer", how_to: "a how-to", result_claim: "a result", comparison: "a comparison", hiring_team: "a hiring line", question: "a question", meme_humour: "a joke", other: "something else" };

/** A trait as a plain phrase: "link out", "run under 15 s", "open with a question". */
export function traitWords(feature: string, value: string): string {
  switch (feature) {
    case "links out":
      return value === "yes" ? "link out" : "carry no link";
    case "tags an account":
      return value === "yes" ? "tag an account" : "tag no account";
    case "length":
      return value === "not a video" ? "are not videos" : `run ${value}`;
    case "first line":
      return `open with ${FIRST_LINE[value] ?? value}`;
    case "weekday (UTC)":
      return `go out on ${DAY[value] ?? value}`;
    case "hour band (UTC)":
      return `go out between ${value.replace(" to ", ":00 and ")}:59 UTC`;
    default:
      return `${feature}: ${value}`;
  }
}

/** A trait the top third has 15 points more often than the bottom third, on 4 or more top posts. */
const strongTrait = (t: { finding: boolean; topShare: number; bottomShare: number }) => t.finding && t.topShare - t.bottomShare >= 0.15;
/** Features about timing: shown, never offered as a play. */
const TIMING = new Set(["weekday (UTC)", "hour band (UTC)"]);

/** The first sentence of an API message: what went wrong, without the advice after it. */
export function firstSentence(s: string): string {
  return (s.split(/(?<=[.!?])\s/)[0] ?? s).trim();
}

const hookOfRow = (r: { text: string }) => hookOf(r.text);
