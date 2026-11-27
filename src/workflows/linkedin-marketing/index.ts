// socialcrawl linkedin-marketing "<keyword>": the LinkedIn posts breaking out on a keyword
// against their authors' own earlier posts, who posts most, and what the comments ask. Best
// effort where LinkedIn is thin, and every gap said.
import { MIN_PEERS, describe as describeBreakout } from "../../engine/breakout.ts";
import { Evidence, requestIdsOf } from "../../engine/evidence.ts";
import { rowsOf } from "../../engine/rows.ts";
import type { Row } from "../../engine/rows.ts";
import { formatNumber } from "../../render/svg.ts";
import type { BarChart, Table, WorkflowResult } from "../../render/types.ts";
import { NAME_FLOOR } from "../social-viral/index.ts";
import type { ViralItem } from "../social-viral/viral.ts";
import type { Workflow, WorkflowArgs } from "../types.ts";
import { LI_FLOOR, authorsOf, isCompany, isQuestion, questionOf } from "./linkedin.ts";
import type { AuthorCount } from "./linkedin.ts";
import { BASELINE_CREDITS, PAGES, runLinkedIn } from "./runner.ts";
import type { LinkedInInput, LinkedInOutput } from "./runner.ts";

export const SKILL = "linkedin-marketing";
const n = (x: number) => x.toLocaleString("en-GB");
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function inputOf(args: WorkflowArgs): LinkedInInput {
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about.trim() : undefined;
  return { topic: args.input, ...(about ? { about } : {}) };
}

/** A company by its name; a member only from 10,000 followers, else described. */
function whoOf(author: string, company: boolean, followers: number | null): string {
  if (company) return author;
  if (followers !== null && followers >= NAME_FLOOR) return author;
  return followers === null ? "a member" : `a member with ${n(followers)} followers`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const who = (r: Row) => whoOf(r.author, isCompany(r), r.authorFollowers);
const whoA = (a: AuthorCount) => whoOf(a.author, a.company, a.followers);

const ROW_COLUMNS = ["id", "url", "author", "author_url", "author_followers", "company", "published_at", "likes", "comments", "text", "request_id"];
const flat = (r: Row) => ({ id: r.id, url: r.url, author: r.author, author_url: r.authorUrl, author_followers: r.authorFollowers, company: isCompany(r), published_at: r.publishedAt, likes: r.likes, comments: r.comments, text: r.text, request_id: r.requestId });

function tables(out: LinkedInOutput): Record<string, Table> {
  return {
    posts: { columns: ROW_COLUMNS, rows: out.rows.map(flat) },
    baseline_posts: { columns: ROW_COLUMNS, rows: out.records.filter((r) => r.stage.startsWith("baseline:")).flatMap((r) => rowsOf(r).map(flat)) },
    comments: {
      columns: ["post_url", "comment_id", "text", "question", "likes", "published_at", "request_id"],
      rows: out.comments.flatMap((c) => c.rows.map((r) => ({ post_url: c.post.url, comment_id: r.id, text: r.text, question: isQuestion(r.text), likes: r.likes, published_at: r.publishedAt, request_id: r.requestId }))),
    },
  };
}

export function buildResult(out: LinkedInOutput, input: LinkedInInput, deep: boolean): WorkflowResult {
  const ev = new Evidence();
  ev.seeRequests(out.ledger.requestIds());
  for (const rec of out.records) if (rec.stage.startsWith("search:") || rec.stage.startsWith("comments:")) ev.cover(rec, rec.stage);
  const searchIds = out.search ? requestIdsOf(out.search) : [];
  const authors = authorsOf(out.rows);
  // Companies and members from 10,000 followers are listed; the other members are summed up.
  const listed = authors.filter((a) => !whoA(a).startsWith("a member"));
  const others = authors.filter((a) => whoA(a).startsWith("a member"));
  const otherPosts = others.reduce((t, a) => t + a.posts, 0);
  const viral = out.result.items.filter((i) => i.viral);
  const period = deep ? "month" : "week";
  const headline = out.search
    ? viral.length
      ? `${viral.length} LinkedIn post${viral.length === 1 ? "" : "s"} broke out this ${period} at 3x ${viral.length === 1 ? "its" : "their"} author's usual likes`
      : `No LinkedIn post broke out this ${period} at 3x its author's usual likes`
    : "LinkedIn could not be searched";
  const f1 = ev.add({
    claim: `${headline}, of ${out.rows.length} posts read from ${authors.length} authors`,
    confidence: searchIds.length ? "seen" : "unknown",
    numbers: { breakouts: viral.length, posts: out.rows.length, authors: authors.length, people_measured: out.people.length, company_posts: out.companies.length, other_members: others.length, other_member_posts: otherPosts, listed_authors: Math.min(listed.length, 10) },
    requests: searchIds,
  });
  const findingOf = new Map<ViralItem, string>();
  for (const i of viral.slice(0, 5)) {
    const b = i.breakout;
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries({ multiple: b.multiple, value: b.value, base: b.base, peers: b.peers })) if (v !== null) numbers[k] = v;
    const f = ev.add({ claim: `${who(i.row)} at ${formatNumber(b.multiple ?? 0)}x their median likes over ${b.peers} earlier posts`, confidence: "seen", numbers, requests: b.requestIds.length ? b.requestIds : searchIds });
    findingOf.set(i, f.id);
  }
  const ref = (i: ViralItem) => (findingOf.has(i) ? ` [${findingOf.get(i)}]` : "");
  const allComments = out.comments.flatMap((c) => c.rows);
  const questions = out.comments.flatMap((c) => c.rows.filter((r) => isQuestion(r.text)).map((r) => ({ r, post: c.post })));
  const commentIds = out.comments.flatMap((c) => (c.record ? requestIdsOf(c.record) : []));
  const f3 = ev.add({
    claim: `${questions.length} of the ${allComments.length} comments read on the ${out.comments.length} most liked posts ${questions.length === 1 ? "is phrased as a question" : "are phrased as questions"}`,
    confidence: commentIds.length ? "inferred" : "unknown",
    numbers: { questions: questions.length, comments: allComments.length, posts: out.comments.length },
    requests: commentIds,
    method: "a comment ending in a question mark; LinkedIn comments carry no labels",
  });

  // What LinkedIn does not give, and what was not read.
  if (out.companies.length) ev.unknown({ what: `${out.companies.length} company post${out.companies.length === 1 ? "" : "s"} above the floor`, why: "not measured: a company's earlier posts need its numeric id, which the post search does not give" });
  const unread = new Map<string, number>();
  for (const u of out.result.unread) unread.set(u.reason, (unread.get(u.reason) ?? 0) + 1);
  for (const [reason, c] of unread) ev.unknown({ what: `${c} member post${c === 1 ? "" : "s"} above the floor with no multiple`, why: reason === "budget" ? "not measured: the run's share for members' earlier posts was used up; --deep reads more" : `not measured: ${reason.replace(/_/g, " ")}` });
  const tooFew = out.result.items.filter((i) => i.breakout.band === "too_few").length;
  if (tooFew) ev.unknown({ what: `${tooFew} member post${tooFew === 1 ? "" : "s"} with no multiple`, why: `not measured: their authors had fewer than ${MIN_PEERS} earlier posts to compare with` });
  for (const i of out.result.items.filter((x) => x.breakout.band === "base_too_small")) ev.unknown({ what: who(i.row), why: `not measured: ${describeBreakout(i.breakout)}` });
  for (const e of out.errors) ev.unknown({ what: `${e.stage}, ${e.endpoint}`, why: `the API answered ${e.status ?? "an error"}${e.requestId ? ` (${e.requestId})` : ""}: ${e.message}` });
  for (const nr of out.notRead) ev.unknown({ what: `${nr.stage}, ${nr.endpoint}`, why: nr.limit === "stage" ? "not sent: this stage's share was used up" : "not sent: this run's credits were used up" });

  const summary = [`${headline} [${f1.id}]`];
  for (const i of viral.slice(0, 3)) summary.push(`${cap(who(i.row))} at ${formatNumber(i.breakout.multiple ?? 0)}x their median likes over ${i.breakout.peers} earlier posts${ref(i)}`);
  summary.push(`${questions.length} of the ${allComments.length} comments read ${questions.length === 1 ? "is phrased as a question" : "are phrased as questions"} [${f3.id}]`);

  const shown = viral.length ? viral.slice(0, 15) : out.result.items.filter((i) => i.breakout.multiple !== null).slice(0, 5);
  const breakouts = [
    `Members' posts with ${LI_FLOOR} likes or more, each against the same member's earlier posts. LinkedIn gives no view counts, so posts are compared on likes.`,
    "",
    ...(shown.length
      ? [
          "| # | Post | Multiple | Likes | Compared with |",
          "| --- | --- | --- | --- | --- |",
          ...shown.map((i, k) => {
            const b = i.breakout;
            const named = !who(i.row).startsWith("a member");
            const post = named && i.row.url ? `${who(i.row)}, [post](${i.row.url})` : who(i.row);
            return `| ${k + 1}${ref(i)} | ${post} | ${b.multiple === null ? "?" : formatNumber(b.multiple)}x | ${b.value === null ? "?" : n(b.value)} | median ${b.base === null ? "?" : n(Math.round(b.base))} over ${b.peers} posts |`;
          }),
        ]
      : ["No member's post was above the floor with enough earlier posts to compare."]),
  ].join("\n");

  const topAuthors = listed.slice(0, 10);
  const othersLine = `${topAuthors.length ? `Besides the ${topAuthors.length} author${topAuthors.length === 1 ? "" : "s"} listed above, ` : ""}${others.length} member${others.length === 1 ? "" : "s"} posted ${otherPosts} post${otherPosts === 1 ? "" : "s"} between them; they are under ${n(NAME_FLOOR)} followers or their follower count was not read, so they are not named here. data/posts.csv lists each post.`;
  const whoMost = authors.length
    ? [
        ...(topAuthors.length ? ["| Author | Kind | Posts | Likes |", "| --- | --- | --- | --- |", ...topAuthors.map((a) => `| ${whoA(a)} | ${a.company ? "company" : "member"} | ${a.posts} | ${n(a.likes)} |`), ""] : []),
        ...(others.length ? [othersLine] : []),
      ]
        .join("\n")
        .trim()
    : "No post was read.";

  const commentsBody = [
    "SocialCrawl reads no labels on LinkedIn comments, so a question here is a comment phrased as one.",
    "",
    ...(questions.length
      ? questions.slice(0, 5).map(({ r, post }) => `> ${questionOf(r.text)} (a comment on ${who(post).startsWith("a member") ? "a member's post" : `a post by ${who(post)}`})`).flatMap((q) => [q, ""])
      : ["No comment read was phrased as a question."]),
  ].join("\n").trim();

  const wontCopy = [
    "A multiple compares a post with its author's own usual likes. A member with a small following can break out with fewer likes than a large account's ordinary post, so copy the format and the opening line, then judge the result against your own earlier posts.",
    "Company pages are counted here but not measured; their reach depends on followers and paid promotion the search does not show.",
  ].join("\n\n");
  const next = [
    "Read the same keyword across every platform:",
    "",
    "```bash",
    `socialcrawl social-viral "${input.topic}"`,
    "```",
    ...(deep ? [] : ["", "Read the month and more members' earlier posts:", "", "```bash", `socialcrawl linkedin-marketing "${input.topic}" --deep`, "```"]),
  ].join("\n");

  const methodNotes = [
    `Searched LinkedIn posts for "${input.topic}" in the past ${period}, ${deep ? PAGES.deep : PAGES.default} pages, kept when judged on topic.`,
    `A break-out is a member's post at 3x or more the median likes of their earlier posts, over at least ${MIN_PEERS} of them, read only for posts with ${LI_FLOOR} likes or more. Earlier posts cost 5 credits a member, up to ${deep ? BASELINE_CREDITS.deep : BASELINE_CREDITS.default} credits a run.`,
    "LinkedIn gives no view counts and no labels on comments, and a company's own posts need a numeric id the search does not give.",
    `LinkedIn's post search gives no follower counts, so a member is described, not named, unless a count of ${n(NAME_FLOOR)} or more was read; companies are named.`,
  ];

  const chart: BarChart = {
    title: "Break-outs by multiple, against each member's earlier posts",
    unit: "x",
    bars: viral.slice(0, 10).map((i) => ({ label: who(i.row), value: i.breakout.multiple ?? 0, note: describeBreakout(i.breakout), finding: findingOf.get(i) })),
  };
  const short = (s: string) => (s.length > 110 ? `${s.slice(0, 109)}…` : s);
  const meta = out.meta;
  const lead = viral[0];
  const busiest = topAuthors[0];
  return {
    card: {
      command: `/${SKILL} "${input.topic}"`,
      skill: SKILL,
      headlines: [
        short(headline),
        ...(lead ? [short(`${cap(who(lead.row))} at ${formatNumber(lead.breakout.multiple ?? 0)}x their usual likes`)] : []),
        short(`${questions.length} of ${allComments.length} comments on the top posts asked a question`),
      ],
      basis: `${n(out.rows.length)} LinkedIn posts read, ${dmy(out.window.since)} to ${dmy(out.window.until)}${busiest ? `; most posts from ${whoA(busiest)}` : ""}`.slice(0, 120),
      meta,
      rerun: `socialcrawl linkedin-marketing "${input.topic}"`,
    },
    report: {
      command: `/${SKILL} "${input.topic}"`,
      skill: SKILL,
      badge: `LinkedIn · ${dmy(out.window.since)} to ${dmy(out.window.until)} · ${n(out.rows.length)} posts read${deep ? " · deep" : ""} · v${meta.version}`,
      summary,
      sections: [
        { title: "Posts breaking out", body: breakouts },
        { title: "Who posts most", body: whoMost },
        { title: "What the comments ask", body: commentsBody },
        { title: "What won't copy", body: wontCopy },
        { title: "Next", body: next },
      ],
      evidence: ev,
      meta,
      methodNotes,
    },
    tiles: [
      { label: "Posts read", value: n(out.rows.length), finding: f1.id },
      { label: "Break-outs at 3x", value: n(viral.length), finding: f1.id },
      { label: "Questions in comments", value: `${questions.length} of ${allComments.length}`, finding: f3.id },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: chart.bars.length ? [chart] : [],
    tables: tables(out),
  };
}

export const workflow: Workflow = {
  name: SKILL,
  summary: "LinkedIn posts breaking out on a keyword against their authors' earlier posts, who posts most, and what the comments ask",
  usage: 'socialcrawl linkedin-marketing "<keyword>" [--about "<what you mean>"] [--deep]',
  examples: ['socialcrawl linkedin-marketing "AI coding tools"'],
  defaultBudget: 100,
  deepBudget: 250,
  options: { about: { type: "string" } },
  slug: (args) => args.input,
  quote(args) {
    const pages = args.deep ? PAGES.deep : PAGES.default;
    const base = args.deep ? BASELINE_CREDITS.deep : BASELINE_CREDITS.default;
    return {
      expected: pages * 6 + base + 10,
      max: Math.min(pages * 13 + base + 10, args.deep ? 250 : 100),
      lines: [`Search: ${pages} pages of LinkedIn posts, about 6 credits a page with the topic filter.`, `Members' earlier posts: up to ${base} credits (5 a member). Comments on the 2 most liked posts: 10 credits.`],
    };
  },
  async run(session, args) {
    const input = inputOf(args);
    const out = await runLinkedIn(session, input, { deep: args.deep, now: () => args.now });
    return buildResult(out, input, args.deep);
  },
};
