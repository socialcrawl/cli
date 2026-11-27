// x-marketing: a keyword in; out, the X posts breaking out over the window against their authors'
// earlier originals, who carried the top ones (retweeters, quotes), the boosted flag on both of its
// conditions, what the replies ask, what will not copy and what to try next.
import { BANDS, BIG_FOLLOWERS, Evidence, FLAG_LABEL, MIN_PEERS, rateOf } from "../../engine/index.ts";
import type { CardInput, Meta, ReportInput, Row } from "../../engine/index.ts";
import type { Session } from "../../kit/record.ts";
import type { Table, WorkflowResult } from "../../render/types.ts";
import type { Workflow, WorkflowArgs, WorkflowQuote } from "../types.ts";
import { ASK_CLASSES, ASK_LABEL } from "../_video/comments.ts";
import { hookOf, hookType, hourUtc } from "../_video/features.ts";
import { accountLabel, mayName, NAME_MIN_FOLLOWERS } from "../_video/naming.ts";
import { times } from "../_video/report.ts";
import { dmy, windowOf } from "../_video/window.ts";
import type { ViralItem } from "../social-viral/viral.ts";
import { DEPTH, FLOOR_VIEWS, SHARES, runX } from "./run.ts";
import type { XRun } from "./run.ts";

export const REPORT_SECTIONS = ["What broke out", "Who carried them", "What the break-outs did", "What the replies ask", "What will not copy", "Next plays"];
const n = (x: number) => x.toLocaleString("en-GB");
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const plural = (k: number, w: string) => `${w}${k === 1 ? "" : "s"}`;

/** An X post's traits: video, a link, its length, its hook, its hour. */
function xTraits(r: Row): Record<string, string | null> {
  const chars = r.text.replace(/https?:\/\/\S+/g, "").trim().length;
  const h = hourUtc(r);
  return {
    format: r.video ? "video" : "text",
    link: /https?:\/\/|\bt\.co\//.test(r.text) ? "a link" : "no link",
    length: chars < 100 ? "under 100 characters" : chars <= 280 ? "100 to 280 characters" : "over 280 characters",
    hook: hookType(r.text),
    "hour (UTC)": h === null ? null : `${String(Math.floor(h / 6) * 6).padStart(2, "0")}:00 to ${String(Math.floor(h / 6) * 6 + 5).padStart(2, "0")}:59`,
  };
}

function xResult(run: XRun, session: Session, quoteDeep: WorkflowQuote): WorkflowResult {
  const meta: Meta = session.meta();
  const ev = new Evidence();
  ev.seeRequests(session.ledger.requestIds());
  const span = run.window.allTime ? `all time to ${dmy(run.window.until)}` : `${dmy(run.window.since)} to ${dmy(run.window.until)}`;
  const label = (r: Row) => accountLabel({ platform: "x", handle: r.author || null, followers: r.authorFollowers });
  const linkOf = (r: Row) => (mayName(r.authorFollowers) && r.url ? r.url : "in data/posts.csv");
  for (const rec of session.records) if (rec.status === 200) ev.cover(rec, rec.stage);

  const items = run.result.items;
  const measured = items.filter((i) => i.breakout.multiple !== null);
  const viral = measured.filter((i) => i.viral).sort((a, b) => (b.breakout.multiple ?? 0) - (a.breakout.multiple ?? 0));
  const rest = measured.filter((i) => !i.viral);
  const boosted = items.filter((i) => i.flag?.flag === "likely_boosted");
  const unusual = items.filter((i) => i.flag?.flag === "unusual_engagement" && i.breakout.band === "beat");
  const searchIds = run.searches.map((r) => r.requestId).filter((x): x is string => Boolean(x));

  const F1 = ev.add({
    claim: `${viral.length} of ${measured.length} X posts with a baseline reached ${BANDS.beat} times or more their author's usual views.`,
    confidence: "seen",
    numbers: { breakouts: viral.length, measured: measured.length, candidates: run.candidates.rows.length, read: run.candidates.read, outside: run.candidates.outsideWindow, boosted: boosted.length, beat: BANDS.beat, minPeers: MIN_PEERS, nameMin: NAME_MIN_FOLLOWERS, floor: FLOOR_VIEWS, small: viral.filter((i) => !mayName(i.row.authorFollowers)).length, unread: run.result.unread.length },
    requests: searchIds.length ? searchIds : [...session.ledger.requestIds()].slice(0, 1),
    method: `views over the median of the author's ${MIN_PEERS} to 20 originals published before the post`,
  });
  const itemF = new Map<string, string>();
  for (const i of viral.slice(0, 10)) itemF.set(i.row.id, ev.add({ claim: `${label(i.row)}: ${i.line}.`, confidence: "seen", numbers: { views: i.breakout.value, base: i.breakout.base, peers: i.breakout.peers, multiple: i.breakout.multiple, followers: i.row.authorFollowers }, requests: i.breakout.requestIds, rows: [i.row.id] }).id);

  const amp = new Map(run.amplifiers.map((a) => [a.postId, a]));
  const quo = new Map(run.quotes.map((q) => [q.postId, q]));
  const carried = viral.filter((i) => amp.has(i.row.id) || quo.has(i.row.id));
  const FC = carried.length
    ? ev.add({
        claim: "Who carried the top break-outs: their retweeters read, and the quotes the quote search found.",
        confidence: "seen",
        numbers: Object.fromEntries(carried.flatMap((i) => [[`${i.row.id} retweeters`, amp.get(i.row.id)?.read ?? null], [`${i.row.id} big`, amp.get(i.row.id)?.big ?? null], [`${i.row.id} quotes`, quo.get(i.row.id)?.found ?? null], [`${i.row.id} first`, quo.get(i.row.id)?.firstMinutes ?? null]]).filter(([, v]) => v !== null)),
        requests: [...run.amplifiers.map((a) => a.requestId), ...run.quotes.map((q) => q.requestId)].filter((x): x is string => Boolean(x)),
        limitations: ["the quote search finds about two thirds of a post's quotes"],
      })
    : null;

  const feats = ["format", "link", "length", "hook", "hour (UTC)"];
  const counts: { trait: string; value: string; v: number; r: number }[] = [];
  for (const f of feats) {
    const values = new Set(measured.map((i) => xTraits(i.row)[f]).filter((x): x is string => x !== null));
    for (const value of values) counts.push({ trait: f, value, v: viral.filter((i) => xTraits(i.row)[f] === value).length, r: rest.filter((i) => xTraits(i.row)[f] === value).length });
  }
  counts.sort((a, b) => b.v - a.v || a.r - b.r);
  // The trait that most sets the break-outs apart: shared by two or more, and more common among them
  // than among the rest. A trait every post has says nothing about what broke out.
  const share = (k: number, of: number) => (of ? k / of : 0);
  const lift = (c: { v: number; r: number }) => share(c.v, viral.length) - share(c.r, rest.length);
  const topTrait = counts.filter((c) => c.trait !== "hour (UTC)" && c.v >= 2 && lift(c) > 0).sort((a, b) => lift(b) - lift(a) || b.v - a.v)[0] ?? null;
  const FT = ev.add({ claim: topTrait ? `${topTrait.v} of ${viral.length} break-outs share ${topTrait.trait}: \`${topTrait.value}\`, against ${topTrait.r} of ${rest.length} of the rest.` : "No trait is more common among the break-outs than among the rest.", confidence: "seen", numbers: { shared: topTrait?.v ?? 0, breakouts: viral.length, restShared: topTrait?.r ?? 0, rest: rest.length }, requests: searchIds.slice(0, 2).length ? searchIds.slice(0, 2) : F1.requests, limitations: ["counts, not a pattern: a pattern needs 24 settled posts on one account"] });
  const asks = run.asks;
  const FA = asks.read ? ev.add({ claim: `${asks.read} replies read on the top break-outs; ${asks.labelled} labelled.`, confidence: "seen", numbers: { read: asks.read, labelled: asks.labelled, questions: asks.classes.question.count, buying: asks.classes.purchase_intent.count, complaints: asks.classes.complaint.count, posts: run.replies.length }, requests: asks.requestIds }) : null;

  ev.unknown({ what: "Every quote of a post", why: "the quote search (quoted_tweet_id:) finds about two thirds of them until SOC-01 ships" });
  ev.unknown({ what: "Whether a post was paid for", why: "X publishes no ad flag here; a post is only marked likely boosted (inferred), on two numbers together" });
  if (run.candidates.outsideWindow && !run.window.allTime) ev.unknown({ what: `${n(run.candidates.outsideWindow)} ${plural(run.candidates.outsideWindow, "post")} published outside ${span}`, why: "outside the window this run reads", check: `socialcrawl x-marketing "${run.query}" --since 2000-01-01 (all time)` });
  if (run.candidates.belowFloor) ev.unknown({ what: `${n(run.candidates.belowFloor)} ${plural(run.candidates.belowFloor, "post")} under ${n(FLOOR_VIEWS)} views`, why: "under the floor, so not measured" });
  const too = items.filter((i) => i.breakout.band === "too_few").length;
  if (too) ev.unknown({ what: `${n(too)} ${plural(too, "post")} with too few earlier originals`, why: `fewer than ${MIN_PEERS} originals before the post on the pages read` });
  const small = items.filter((i) => i.breakout.band === "base_too_small").length;
  if (small) ev.unknown({ what: `${n(small)} ${plural(small, "post")} whose author's earlier originals had a median under 100 views`, why: "too small a base for a multiple" });
  const reasons = new Map<string, number>();
  for (const u of run.result.unread) reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1);
  const WHY: Record<string, string> = {
    below_top_n: `past the ${run.authorCap} authors whose posts drew the most views per follower, the most a ${run.deep ? "deep" : "default"} run reads`,
    budget: "the stage's share of the budget ran out",
    planned_not_read: "the stage's share of the budget ran out",
    no_id: "the post carries no author to read",
    no_method: "no baseline method for the platform",
  };
  for (const [r, k] of reasons) ev.unknown({ what: `${n(k)} ${plural(k, "candidate")} with no baseline`, why: WHY[r] ?? r, ...(r === "below_top_n" && run.deep ? {} : { check: `socialcrawl x-marketing "${run.query}" --deep` }) });
  for (const e of session.errors) ev.unknown({ what: `${e.stage} failed`, why: `${e.status ?? "no status"} ${e.message}`.trim() });

  const sections: ReportInput["sections"] = [];
  sections.push({
    title: "What broke out",
    body: [
      viral.length ? `Each post is measured against its author's originals published before it; ${viral.length} of ${measured.length} reached ${BANDS.beat} times or more [${F1.id}].` : `None of the ${measured.length} posts with a baseline reached ${BANDS.beat} times its author's usual views [${F1.id}].`,
      viral.length ? "\n" + table(["#", "Account", "Published", "× its usual views", "Views", "Baseline", "Hook", "Link"], viral.slice(0, 10).map((i, k) => [String(k + 1), label(i.row), i.row.publishedAt ? dmy(i.row.publishedAt) : "unknown", times(i.breakout.multiple), n(i.breakout.value ?? 0), `median of ${n(Math.round(i.breakout.base ?? 0))} views over ${i.breakout.peers} earlier originals`, hookOf(i.row.text) ?? "", linkOf(i.row).startsWith("http") ? `[open on X](${linkOf(i.row)})` : linkOf(i.row)])) : "",
      [...boosted, ...unusual].length ? "\n" + table(["Account", "Flag", "Why"], [...boosted, ...unusual].map((i) => [label(i.row), FLAG_LABEL[i.flag!.flag!], i.flag!.reasons.join("; ")])) : "",
    ].join("\n"),
  });
  sections.push({
    title: "Who carried them",
    body: FC
      ? [
          `Retweeters read and quotes found for the top break-outs; the quote search finds about two thirds of a post's quotes [${FC.id}].`,
          "",
          table(["Post", "Retweeters read", `Of them, ${n(BIG_FOLLOWERS)} followers or more`, "Named retweeters", "Quotes found", "First quote after", "Named quoters"], carried.map((i) => {
            const a = amp.get(i.row.id);
            const q = quo.get(i.row.id);
            return [`${label(i.row)}, ${i.row.publishedAt ? dmy(i.row.publishedAt) : "date unknown"}`, a ? n(a.read) : "not read", a ? n(a.big) : "not read", a?.bigAccounts.slice(0, 3).map((x) => `@${x.handle}`).join(", ") || "none", q ? n(q.found) : "not read", q?.firstMinutes != null ? `${n(q.firstMinutes)} min` : "-", q?.bigQuoters.slice(0, 3).map((x) => `@${x.handle}`).join(", ") || "none"];
          })),
        ].join("\n")
      : "No break-out, so no retweeters or quotes were read.",
  });
  sections.push({
    title: "What the break-outs did",
    body: [
      counts.length ? table(["Trait", "Value", `Break-outs (of ${viral.length})`, `The rest (of ${rest.length})`], counts.slice(0, 14).map((c) => [c.trait, c.value, String(c.v), String(c.r)])) : "No post was measured.",
      "",
      `These are counts, not a pattern: a pattern needs 24 settled posts on one account to compare the top third with the bottom third [${FT.id}].`,
    ].join("\n"),
  });
  sections.push({
    title: "What the replies ask",
    body: FA ? [`Replies to the top break-outs, labelled by the API; replies are not filtered for the topic [${FA.id}].`, "", table(["Kind", "Replies", "Most liked"], ASK_CLASSES.map((k) => [ASK_LABEL[k], String(asks.classes[k].count), asks.classes[k].quotes.map((q) => `"${q.text}"`).join(" · ") || "none"]))].join("\n") : "No replies were read in this run.",
  });
  const wont: string[][] = [];
  const big = viral.filter((i) => (i.row.authorFollowers ?? 0) >= 100_000).length;
  if (big) wont.push([`Reach from an audience of ${n(100_000)} or more`, String(big), "a large audience lifts a post before its content does"]);
  if (boosted.length) wont.push(["Reach that may not be organic (likely boosted, inferred)", String(boosted.length), "few likes per view and many large retweeters together; it is left out of the break-outs"]);
  if (unusual.length) wont.push(["Engagement that looks unusual (inferred)", String(unusual.length), "few likes per view, retweeters not read or not large"]);
  sections.push({ title: "What will not copy", body: wont.length ? table(["What", "Posts", "Why it may not copy"], wont) : `No break-out here rests on a large audience or a flagged engagement pattern [${F1.id}].` });
  const lead = viral[0] ?? null;
  const cmd = (rest2: string) => `\`npx -y socialcrawl@latest ${rest2}\``;
  const plays: string[][] = [[`Read deeper: more pages of posts, up to ${DEPTH.deep.authors} authors, retweeters and quotes on more posts, more replies`, cmd(`x-marketing "${run.query}" --deep`), `free quote first: about ${quoteDeep.expected} credits, at most ${quoteDeep.max}`]];
  if (lead) {
    const where = linkOf(lead.row).startsWith("http") ? linkOf(lead.row) : "<the first link in data/posts.csv>";
    plays.push([`Track the top break-out (${label(lead.row)})`, cmd(`post-tracker ${where}`), `its views in 14 days against ${n(lead.row.views ?? 0)} today`]);
    if (mayName(lead.row.authorFollowers)) plays.push([`Read how its author grows`, cmd(`social-teardown @${lead.row.author}`), "the posts that carried the account"]);
  }
  sections.push({ title: "Next plays", body: table(["Play", "Command", "What to check"], plays) });

  const summary: string[] = [viral.length ? `${viral.length} of ${measured.length} X posts with a baseline broke out at ${BANDS.beat} times or more ${viral.length === 1 ? "its" : "their"} author's usual views, out of ${run.candidates.rows.length} candidates above the floor [${F1.id}].` : `No X post broke out: none of the ${measured.length} with a baseline reached ${BANDS.beat} times its author's usual views [${F1.id}].`];
  if (lead) summary.push(`The largest: ${label(lead.row)}, ${times(lead.breakout.multiple)} over ${lead.breakout.peers} earlier originals [${itemF.get(lead.row.id)}].`);
  if (boosted.length) summary.push(`${boosted.length} ${plural(boosted.length, "post")} with few likes per view and many large retweeters ${boosted.length === 1 ? "is" : "are"} marked likely boosted (inferred) and left out [${F1.id}].`);
  if (topTrait) summary.push(`${topTrait.v} of ${viral.length} break-outs share ${topTrait.trait}: \`${topTrait.value}\`, against ${topTrait.r} of ${rest.length} of the other posts measured [${FT.id}].`);
  if (FA) summary.push(`${asks.classes.question.count} ${plural(asks.classes.question.count, "question")} and ${asks.classes.complaint.count} ${plural(asks.classes.complaint.count, "complaint")} in ${asks.read} ${asks.read === 1 ? "reply" : "replies"} read [${FA.id}].`);

  const fit = (s: string) => (s.length <= 110 ? s : s.slice(0, 109).replace(/\s+\S*$/, "") + "…");
  const card: CardInput = {
    command: `/x-marketing "${run.query}"`,
    skill: "x-marketing",
    headlines: [
      fit(viral.length ? `${viral.length} X ${plural(viral.length, "post")} broke out at ${BANDS.beat}x or more ${viral.length === 1 ? "its" : "their"} author's usual views, of ${measured.length} measured` : `No X post reached ${BANDS.beat}x its author's usual views (${measured.length} measured)`),
      ...(lead ? [fit(`Top: ${label(lead.row)}, ${times(lead.breakout.multiple)} over ${lead.breakout.peers} earlier originals`)] : []),
      ...(topTrait ? [fit(`${topTrait.v} of ${viral.length} break-outs share ${topTrait.trait}: "${topTrait.value}"`)] : []),
    ].slice(0, 3),
    basis: `${n(run.candidates.read)} posts read, ${run.window.allTime ? "all time" : `${dmy(run.window.since).slice(0, 5)} to ${dmy(run.window.until)}`}, ${n(measured.length)} measured`,
    meta,
    rerun: `npx -y socialcrawl@latest x-marketing "${run.query}"`,
  };
  const report: ReportInput = {
    command: card.command,
    skill: "x-marketing",
    badge: `X · ${span} · topic filter: \`${run.topic}\` · ${run.candidates.read} posts read · ${run.deep ? "deep" : "default"} run`,
    summary,
    sections,
    evidence: ev,
    meta,
    methodNotes: [
      `A break-out is a post at ${BANDS.beat} times or more the median views of its author's ${MIN_PEERS} to 20 originals published before it, read with one search that ends at the post's minute; under ${MIN_PEERS} such posts, or a median under 100 views, no multiple is given.`,
      "A post is marked likely boosted (inferred) only when both hold: under 1.5 likes per 1,000 views, and more than 12% of the retweeters read above 10,000 followers. It is then never called a break-out. With few likes per view alone it is marked unusual engagement (inferred) and kept.",
      `This ${run.deep ? "deep" : "default"} run read the earlier posts of at most ${run.authorCap} authors (${run.deep ? `a default run reads ${DEPTH.default.authors}` : `--deep reads up to ${DEPTH.deep.authors}`}), those whose posts drew the most views per follower; the other candidates are counted under what could not be verified.`,
      `Accounts under ${n(NAME_MIN_FOLLOWERS)} followers are described, not named or linked; data/posts.csv keeps every row.`,
    ],
  };
  const byId = new Map(items.map((i) => [i.row.id, i]));
  const posts = run.allRows.map((r) => {
    const i = byId.get(r.id);
    return { id: r.id, url: r.url, author: r.author, followers: r.authorFollowers, published_at: r.publishedAt, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, video: r.video, text: r.text, multiple: i?.breakout.multiple ?? null, band: i?.breakout.band ?? null, base: i?.breakout.base ?? null, peers: i?.breakout.peers ?? null, flag: i?.flag?.flag ?? null, request_id: r.requestId };
  });
  const tables: Record<string, Table> = {
    posts: { columns: posts.length ? Object.keys(posts[0]) : ["id"], rows: posts },
    amplifiers: { columns: ["post_id", "retweeters_read", "over_10000", "request_id"], rows: run.amplifiers.map((a) => ({ post_id: a.postId, retweeters_read: a.read, over_10000: a.big, request_id: a.requestId })) },
    quotes: { columns: ["post_id", "found", "first_minutes", "request_id"], rows: run.quotes.map((q) => ({ post_id: q.postId, found: q.found, first_minutes: q.firstMinutes, request_id: q.requestId })) },
  };
  return {
    card,
    report,
    tiles: [
      { label: "Posts read", value: n(run.candidates.read) },
      { label: "Measured", value: n(measured.length) },
      { label: "Break-outs", value: `${viral.length} of ${measured.length}`, finding: F1.id },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: viral.length ? [{ title: "Break-outs against their author's usual views", unit: "x", bars: viral.slice(0, 10).map((i: ViralItem) => ({ label: label(i.row), value: i.breakout.multiple ?? 0, note: `${n(i.breakout.value ?? 0)} views`, finding: itemF.get(i.row.id) })) }] : [],
    tables,
  };
}

function xQuote(args: WorkflowArgs): WorkflowQuote {
  const sh = args.deep ? SHARES.deep : SHARES.default;
  const d = args.deep ? DEPTH.deep : DEPTH.default;
  const r = rateOf("twitter/search/tweets");
  const pages = d.topPages + d.latestPages;
  const lines: string[] = [];
  let expected = 0;
  let max = 0;
  const stage = (name: string, e: number, m: number, share: number) => {
    const mm = Math.min(m, share);
    const ee = Math.min(e, mm);
    expected += ee;
    max += mm;
    lines.push(`${name}: about ${ee} credits (at most ${mm})`);
  };
  stage("search", pages * (r.page + 1), pages * (r.page + (r.topicHold ?? 0)), sh.search);
  stage("baselines", Math.round(sh.baselines * 0.7), sh.baselines, sh.baselines);
  stage("amplifiers", d.amplified * d.retweeterPages, (d.amplified + 2) * d.retweeterPages, sh.amplifiers);
  stage("quotes", d.quoted, d.quoted, sh.quotes);
  stage("replies", d.replied * d.replyPages, d.replied * d.replyPages, sh.replies);
  lines.push(`Total: about ${expected} credits, at most ${max}.`);
  void windowOf;
  return { expected, max, lines };
}

export const workflow: Workflow = {
  name: "x-marketing",
  summary: "The X posts breaking out on a keyword, against each author's own earlier originals: who carried them, what the replies ask.",
  usage: 'socialcrawl x-marketing "<keyword>" [--about "<one line on the topic>"] [--since YYYY-MM-DD --until YYYY-MM-DD] [--deep]',
  examples: ['socialcrawl x-marketing "AI coding tools"', 'socialcrawl x-marketing "headless CMS" --about "content management systems for developers"', 'socialcrawl x-marketing "vector databases" --deep'],
  defaultBudget: 60,
  deepBudget: 200,
  takesWindow: true,
  options: { about: { type: "string" } },
  quote: xQuote,
  async run(session, args) {
    const run = await runX(session, args);
    return xResult(run, session, xQuote({ ...args, deep: true }));
  },
};
