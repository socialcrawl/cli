// socialcrawl social-presence "<name>": a person's or brand's accounts across platforms, each
// with the evidence for the match, and how active each is. An account is confirmed only by a
// link; a match of name, handle or bio alone is reported as a judgment, never as a fact.
import { UsageError } from "../../args.ts";
import { Evidence, requestIdsOf } from "../../engine/evidence.ts";
import { rowsOf } from "../../engine/rows.ts";
import type { BarChart, Table, WorkflowResult } from "../../render/types.ts";
import { NAME_FLOOR } from "../social-viral/index.ts";
import type { Workflow, WorkflowArgs } from "../types.ts";
import { PRESENCE_PLATFORMS, runPresence } from "./runner.ts";
import type { AccountRead, PresenceInput, PresenceOutput } from "./runner.ts";

export const SKILL = "social-presence";
const LABEL: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok", twitter: "X", x: "X", threads: "Threads", youtube: "YouTube" };
const label = (p: string) => LABEL[p] ?? p;
const n = (x: number) => x.toLocaleString("en-GB");
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const STATUS_WORDS = { confirmed: "confirmed by a link", judged: "judged the same, not linked", possible: "possible, not linked", none: "none found" } as const;

function inputOf(args: WorkflowArgs): PresenceInput {
  const type = typeof args.flags.type === "string" ? args.flags.type : "company";
  if (type !== "company" && type !== "person") throw new UsageError('--type takes "company" or "person".');
  const website = typeof args.flags.website === "string" && args.flags.website.trim() ? args.flags.website.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined;
  return { name: args.input, type, ...(website ? { website } : {}) };
}

/** The account as the report names it: a confirmed one by its handle; any other only from 10,000 followers or a verified badge, since a name search can find a namesake. */
function nameOf(a: AccountRead): string {
  if (!a.handle) return "none";
  const handle = a.platform === "linkedin" || a.handle.startsWith("@") ? a.handle : `@${a.handle}`;
  if (a.status === "confirmed") return handle;
  if (a.verified || (a.followers ?? 0) >= NAME_FLOOR) return handle;
  return a.followers === null ? "an account of unknown size" : `an account with ${n(a.followers)} followers`;
}

function tables(out: PresenceOutput): Record<string, Table> {
  return {
    accounts: {
      columns: ["platform", "handle", "url", "status", "evidence", "followers", "confidence", "last_post", "posts_last_30_days", "posts_read", "median_views", "median_likes"],
      rows: out.accounts.map((a) => ({
        platform: a.platform,
        handle: a.handle,
        url: a.url,
        status: a.status,
        evidence: a.evidence.join("; "),
        followers: a.followers,
        confidence: a.confidence,
        last_post: a.activity?.lastPost ?? null,
        posts_last_30_days: a.activity?.last30 ?? null,
        posts_read: a.activity?.posts ?? null,
        median_views: a.activity?.medianViews ?? null,
        median_likes: a.activity?.medianLikes ?? null,
      })),
    },
    candidates: { columns: ["platform", "rank", "handle", "url", "followers", "probability"], rows: out.candidates },
    recent_posts: {
      columns: ["platform", "id", "url", "published_at", "views", "likes", "comments", "text", "request_id"],
      rows: out.records.filter((r) => r.stage.startsWith("activity:")).flatMap((r) => rowsOf(r).map((x) => ({ platform: x.platform, id: x.id, url: x.url, published_at: x.publishedAt, views: x.views, likes: x.likes, comments: x.comments, text: x.text, request_id: x.requestId }))),
    },
  };
}

export function buildResult(out: PresenceOutput, input: PresenceInput): WorkflowResult {
  const ev = new Evidence();
  ev.seeRequests(out.ledger.requestIds());
  const findIds = out.find ? requestIdsOf(out.find) : [];
  const count = (s: AccountRead["status"]) => out.accounts.filter((a) => a.status === s).length;
  const [confirmed, judged, possible, none] = [count("confirmed"), count("judged"), count("possible"), count("none")];
  const searched = PRESENCE_PLATFORMS.split(",").length;
  const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? "" : "s"}`;
  const headline = out.find
    ? `${input.name}: ${plural(confirmed, "account")} confirmed by a link, ${judged} judged the same without a link`
    : `${input.name}: not searched`;
  const f1 = ev.add({
    claim: out.find ? `${headline}, ${possible} possible, ${none} platform${none === 1 ? "" : "s"} with none found, of ${searched} searched` : headline,
    confidence: findIds.length ? "seen" : "unknown",
    numbers: { confirmed, judged, possible, none, searched },
    requests: findIds,
    method: "confirmed only by a link: the website field, the site's domain on the profile, or a link between the accounts",
  });

  const ref = new Map<AccountRead, string>();
  for (const a of out.accounts.filter((x) => x.status === "confirmed" || x.status === "judged")) {
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries({ followers: a.followers, posts_last_30_days: a.activity?.last30 ?? null, posts_read: a.activity?.posts ?? null })) if (v !== null && v !== undefined) numbers[k] = v;
    const f = ev.add({
      claim: `${label(a.platform)}: ${nameOf(a)}, ${STATUS_WORDS[a.status]}`,
      confidence: a.status === "confirmed" ? "seen" : "inferred",
      numbers,
      requests: [...findIds, ...(a.activityRequest ? [a.activityRequest] : [])],
      limitations: a.status === "judged" ? ["no link confirms it; check the account yourself before relying on it"] : [],
    });
    ref.set(a, f.id);
  }
  const cite = (a: AccountRead) => (ref.has(a) ? ` [${ref.get(a)}]` : "");

  if (out.notSearched) ev.unknown({ what: `The search for "${input.name}"`, why: `not searched: ${out.notSearched}` });
  for (const a of out.accounts) {
    if (a.activityNotRead) ev.unknown({ what: `${label(a.platform)}: recent posts of ${nameOf(a)}`, why: `not read: ${a.activityNotRead}` });
    if (a.status === "none") ev.unknown({ what: `${label(a.platform)}: no account found`, why: "the search's candidates were judged not to match the name" });
  }
  for (const e of out.errors) ev.unknown({ what: `${e.stage}, ${e.endpoint}`, why: `the API answered ${e.status ?? "an error"}${e.requestId ? ` (${e.requestId})` : ""}: ${e.message}` });

  const summary = [`${headline} [${f1.id}]`];
  for (const a of out.accounts.filter((x) => ref.has(x)).slice(0, 4)) summary.push(`${label(a.platform)}: ${nameOf(a)}, ${STATUS_WORDS[a.status]}${cite(a)}`);

  const accountsBody = [
    ...(out.find && confirmed === 0 ? ["No account is confirmed by a link. The accounts below are judgments on public profiles; check each one yourself before relying on it.", ""] : []),
    ...(out.find ? [] : ["The name was not searched; the report lists why under What we could not verify."]),
    ...(out.accounts.length
      ? [
          "| Platform | Account | Status | Evidence | Followers |",
          "| --- | --- | --- | --- | --- |",
          ...out.accounts.map((a) => `| ${label(a.platform)}${cite(a)} | ${nameOf(a)} | ${STATUS_WORDS[a.status]} | ${a.evidence.join("; ") || "none"} | ${a.followers === null ? "?" : n(a.followers)} |`),
        ]
      : []),
  ].join("\n");

  const read = out.accounts.filter((a) => a.activity);
  const activityBody = read.length
    ? [
        "From one page of each account's most recent posts.",
        "",
        "| Account | Last post | Posts in the last 30 days | Posts read | Median views | Median likes |",
        "| --- | --- | --- | --- | --- | --- |",
        ...read.map((a) => {
          const x = a.activity!;
          return `| ${label(a.platform)} ${nameOf(a)} | ${x.lastPost ? dmy(x.lastPost) : "?"} | ${x.last30} | ${x.posts} | ${x.medianViews === null ? "?" : n(Math.round(x.medianViews))} | ${x.medianLikes === null ? "?" : n(Math.round(x.medianLikes))} |`;
        }),
      ].join("\n")
    : "No account's recent posts were read.";

  const wontCopy = [
    "A match is a judgment on public profiles, made for your review. An account confirmed by a link is the brand's own by that link; one judged the same without a link may be a namesake, a fan or an old account.",
    ...(out.notice ? [`The search's own notice: ${out.notice}`] : []),
  ].join("\n\n");
  const lead = out.accounts.find((a) => a.status === "confirmed" && a.platform === "twitter") ?? out.accounts.find((a) => a.status === "confirmed");
  const next = [
    ...(input.website ? [] : ["Give the official site, so an account linking to it is confirmed:", "", "```bash", `socialcrawl social-presence "${input.name}" --website <domain>`, "```", ""]),
    "Follow what is said about the name, week on week:",
    "",
    "```bash",
    `socialcrawl social-pulse "${input.name}"`,
    "```",
    ...(lead?.handle ? ["", "Take a confirmed account apart:", "", "```bash", `socialcrawl social-teardown "${nameOf(lead)}"`, "```"] : []),
  ].join("\n");

  const methodNotes = [
    `Searched ${PRESENCE_PLATFORMS.split(",").map(label).join(", ")} for "${input.name}" as a ${input.type}${input.website ? `, with the website ${input.website}` : ""}; up to 5 candidates a platform were ranked and the best judged.`,
    "Confirmed means a link ties the account to the subject: the official site in its website field, the site's domain on its profile, or a link to or from its other accounts. A matching name, handle or bio alone is reported as judged, not confirmed; a fan or parody account is never confirmed.",
    `An unconfirmed account under ${n(NAME_FLOOR)} followers is described, not named.`,
    "Activity is one page of each confirmed or judged account's most recent posts.",
  ];

  const chart: BarChart = {
    title: "Posts in the last 30 days, by account",
    unit: "posts",
    bars: read.map((a) => ({ label: `${label(a.platform)} ${nameOf(a)}`, value: a.activity!.last30, finding: ref.get(a) })),
  };
  const confirmedList = out.accounts.filter((a) => a.status === "confirmed").map((a) => `${label(a.platform)} ${nameOf(a)}`).join(", ");
  const busiest = [...read].sort((a, b) => b.activity!.last30 - a.activity!.last30)[0];
  const short = (s: string) => (s.length > 110 ? `${s.slice(0, 109)}…` : s);
  const meta = out.meta;
  return {
    card: {
      command: `/${SKILL} "${input.name}"`,
      skill: SKILL,
      headlines: [
        short(headline),
        short(confirmedList ? `Confirmed: ${confirmedList}` : "No account is confirmed by a link"),
        ...(busiest ? [short(`Most active: ${label(busiest.platform)}, ${plural(busiest.activity!.last30, "post")} in the last 30 days`)] : []),
      ],
      basis: `${searched} platforms searched${input.website ? `, website ${input.website}` : ""}`,
      meta,
      rerun: `socialcrawl social-presence "${input.name}"${input.website ? ` --website ${input.website}` : ""}`,
    },
    report: {
      command: `/${SKILL} "${input.name}"`,
      skill: SKILL,
      badge: `${input.type} · ${searched} platforms${input.website ? ` · ${input.website}` : ""} · v${meta.version}`,
      summary,
      sections: [
        { title: "The accounts", body: accountsBody },
        { title: "Activity", body: activityBody },
        { title: "What won't copy", body: wontCopy },
        { title: "Next", body: next },
      ],
      evidence: ev,
      meta,
      methodNotes,
    },
    tiles: [
      { label: "Confirmed by a link", value: n(confirmed), finding: f1.id },
      { label: "Judged, not linked", value: n(judged), finding: f1.id },
      { label: "Possible", value: n(possible), finding: f1.id },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: chart.bars.length ? [chart] : [],
    tables: tables(out),
  };
}

export const workflow: Workflow = {
  name: SKILL,
  summary: "A person's or brand's accounts across platforms, each with the evidence for the match, and how active each is",
  usage: 'socialcrawl social-presence "<name>" [--website <domain>] [--type company|person]',
  examples: ['socialcrawl social-presence "Linear" --website linear.app', 'socialcrawl social-presence "Jane Doe" --type person'],
  defaultBudget: 100,
  deepBudget: 100,
  options: { website: { type: "string" }, type: { type: "string" } },
  slug: (args) => args.input,
  quote(args) {
    const input = inputOf(args);
    const find = input.type === "company" ? 21 : 8;
    return {
      expected: find + 3,
      max: Math.min(33 + 10, 100),
      lines: [`The search: about ${find} credits (${input.type}), priced for free before it runs.`, "Recent posts: 1 credit for each confirmed or judged account (5 for a LinkedIn person)."],
    };
  },
  async run(session, args) {
    const input = inputOf(args);
    const out = await runPresence(session, input, () => args.now);
    return buildResult(out, input);
  },
};
