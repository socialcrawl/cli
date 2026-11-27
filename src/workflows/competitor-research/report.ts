// competitor-research as the render kit takes it. Prose states only numbers held in findings;
// tables carry the rest. Accounts under 10,000 followers are described, Reddit members never
// named (their community is), and every share is stated as a share of the posts read.
import { BANDS, Evidence } from "../../engine/index.ts";
import type { CardInput, Meta, ReportInput, Row } from "../../engine/index.ts";
import type { Session } from "../../kit/record.ts";
import type { Table, WorkflowResult } from "../../render/types.ts";
import { ASK_CLASSES } from "../_video/comments.ts";
import { accountLabel, mayName, NAME_MIN_FOLLOWERS } from "../_video/naming.ts";
import { times } from "../_video/report.ts";
import { dmy } from "../_video/window.ts";
import { clashesOf, usualOf } from "./plan.ts";
import type { Best, CompetitorRun } from "./run.ts";

export const REPORT_SECTIONS = ["Share of voice", "Each brand's best posts", "What each audience asks", "Ads", "Next plays"];
const LABEL: Record<string, string> = { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", reddit: "Reddit", linkedin: "LinkedIn" };
const n = (x: number) => x.toLocaleString("en-GB");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

export function competitorResult(run: CompetitorRun, session: Session, quoteDeep: { expected: number; max: number }): WorkflowResult {
  const meta: Meta = session.meta();
  const ev = new Evidence();
  ev.seeRequests(session.ledger.requestIds());
  const span = run.window.allTime ? `all time to ${dmy(run.window.until)}` : `${dmy(run.window.since)} to ${dmy(run.window.until)}`;
  const followersOf = (r: Row) => run.followers.get(`${r.platform}:${r.author.toLowerCase()}`) ?? r.authorFollowers ?? null;
  const label = (r: Row) => (r.platform === "reddit" ? `a post in r/${r.community ?? "unknown"}` : accountLabel({ platform: r.platform, handle: r.author || null, followers: followersOf(r) }));
  const linkOf = (r: Row) => (r.platform === "reddit" || mayName(followersOf(r)) ? (r.url ?? "") : "in data/posts.csv");

  for (const m of run.mentions) if (m.record) ev.cover(m.record, m.record.stage);
  const mentionIds = run.mentions.map((m) => m.record?.requestId).filter((x): x is string => Boolean(x));

  // Leaders by posts read, per platform (a tie leads nobody).
  const leaders = run.share.map((p) => {
    const sorted = [...p.brands].sort((a, b) => b.posts - a.posts);
    return { platform: p.platform, leader: sorted[0].posts > (sorted[1]?.posts ?? 0) ? sorted[0].brand : null };
  });
  const leadCount = new Map<string, number>();
  for (const l of leaders) if (l.leader) leadCount.set(l.leader, (leadCount.get(l.leader) ?? 0) + 1);
  const top = [...leadCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const F1 = ev.add({
    claim: top ? `${top[0]} had the most posts read on ${top[1]} of ${run.share.length} platforms.` : "No brand led the posts read on any platform.",
    confidence: "seen",
    numbers: { led: top?.[1] ?? 0, platforms: run.share.length, posts: run.rows.length, outside: run.outsideWindow, brands: run.brands.length },
    requests: mentionIds.length ? mentionIds : [...session.ledger.requestIds()].slice(0, 1),
    limitations: ["shares are among the posts each search returned and the topic filter kept, not of everything said"],
  });

  const measured = run.best.filter((b) => b.breakout?.multiple != null);
  const lead = [...measured].sort((a, b) => (b.breakout!.multiple ?? 0) - (a.breakout!.multiple ?? 0))[0] ?? null;
  const bestFinding = new Map<Best, string>();
  for (const b of measured) {
    const f = ev.add({
      claim: `${b.brand}, ${LABEL[b.row.platform]}: ${label(b.row)}, ${b.line}.`,
      confidence: "seen",
      numbers: { multiple: b.breakout!.multiple, base: b.breakout!.base, peers: b.breakout!.peers, reach: b.breakout!.value, followers: followersOf(b.row) },
      requests: b.breakout!.requestIds,
      rows: [b.row.id],
    });
    bestFinding.set(b, f.id);
  }

  const askNumbers: Record<string, number> = {};
  for (const [brand, a] of run.asks) {
    askNumbers[`${brand} read`] = a.read;
    for (const k of ASK_CLASSES) askNumbers[`${brand} ${k}`] = a.classes[k].count;
  }
  const askIds = [...run.asks.values()].flatMap((a) => a.requestIds);
  const mostComplaints = [...run.asks.entries()].filter(([, a]) => a.read > 0).sort((a, b) => b[1].classes.complaint.count - a[1].classes.complaint.count)[0] ?? null;
  const FA = askIds.length
    ? ev.add({ claim: "Questions, buying signals and complaints in the comments of each brand's best posts.", confidence: "seen", numbers: askNumbers, requests: askIds })
    : null;

  // Unverified
  ev.unknown({ what: "Posts the topic filter misjudged", why: "the filter keeps posts it judges to be about each brand; it can keep an off-topic post or drop a real one, so read the posts in data/posts.csv before quoting a share" });
  for (const c of clashesOf(run.share)) ev.unknown({ what: `Whether ${c.brand}'s ${LABEL[c.platform]} posts are about the brand: ${Math.round(c.reachShare * 100)}% of the reach from ${Math.round(c.postShare * 100)}% of the posts`, why: "a name that is also a common word can pass the filter, and so can one viral post; read them in data/posts.csv before quoting the share" });
  if (!run.about) ev.unknown({ what: "No category was given (--about)", why: "each brand was judged as a product compared with the others, so a brand whose name is also a common word can keep posts about another meaning", check: `socialcrawl competitor-research "${run.brands.join(", ")}" --about "<their category>"` });
  if (run.outsideWindow && !run.window.allTime) ev.unknown({ what: `${n(run.outsideWindow)} posts published outside ${span}`, why: "outside the window this run reads", check: `socialcrawl competitor-research "${run.brands.join(", ")}" --since 2000-01-01 (all time)` });
  for (const brand of run.brands)
    for (const p of run.share) if ((p.brands.find((b) => b.brand === brand)?.posts ?? 0) === 0) ev.unknown({ what: `${brand} on ${LABEL[p.platform]}`, why: "no post kept: the search found none about the brand in the window, which is not proof of none" });
  for (const b of run.best) if (!b.breakout || b.breakout.multiple === null) ev.unknown({ what: `${b.brand}'s best ${LABEL[b.row.platform]} post`, why: b.line });
  if (!run.deep) ev.unknown({ what: "Ads", why: "a default run does not read the ad library", check: `socialcrawl competitor-research "${run.brands.join(", ")}" --deep` });
  for (const e of session.errors) ev.unknown({ what: `${e.stage} failed`, why: `${e.status ?? "no status"} ${e.message}`.trim() });

  // Sections
  const sections: ReportInput["sections"] = [];
  sections.push({
    title: "Share of voice",
    body: [
      `Shares are among the posts each search returned for each brand's name and the topic filter kept, over ${span}, not shares of everything said [${F1.id}].`,
      "",
      table(
        ["Platform", "Brand", "Posts", "Share of posts", "Reach", "Share of reach", "Held by its largest post"],
        run.share.flatMap((p) => p.brands.map((b) => [LABEL[p.platform], b.brand, n(b.posts), pct(b.postShare), `${n(b.reach)} ${p.metric}`, pct(b.reachShare), b.posts ? pct(b.topPostShare) : "-"])),
      ),
    ].join("\n"),
  });
  sections.push({
    title: "Each brand's best posts",
    body: run.best.length
      ? [
          `Each brand's most-reached post per platform, against its author's earlier posts (on Reddit, its community's); ${BANDS.beat} times or more is a break-out.`,
          "",
          table(
            ["Brand", "Platform", "Account", "Published", "× its usual reach", "Reach", "Baseline", "Link"],
            run.best.map((b) => [b.brand, LABEL[b.row.platform], label(b.row), b.row.publishedAt ? dmy(b.row.publishedAt) : "unknown", b.breakout?.multiple != null ? times(b.breakout.multiple) : "not measured", n((b.row.platform === "reddit" ? b.row.likes : b.row.views) ?? 0), b.breakout?.base != null ? `median of ${n(Math.round(b.breakout.base))} over ${b.breakout.peers} earlier posts` : b.line, linkOf(b.row)]),
          ),
        ].join("\n")
      : "No brand had a post kept by its search in the window.",
  });
  sections.push({
    title: "What each audience asks",
    body: FA
      ? [
          `Comments on each brand's best posts, labelled by the API [${FA.id}].`,
          "",
          table(
            ["Brand", "Comments read", "Questions", "Buying signals", "Complaints", "Most liked question", "Most liked complaint"],
            run.brands.map((brand) => {
              const a = run.asks.get(brand)!;
              return [brand, n(a.read), n(a.classes.question.count), n(a.classes.purchase_intent.count), n(a.classes.complaint.count), a.classes.question.quotes[0] ? `"${a.classes.question.quotes[0].text}"` : "none", a.classes.complaint.quotes[0] ? `"${a.classes.complaint.quotes[0].text}"` : "none"];
            }),
          ),
        ].join("\n")
      : "No comments were read in this run.",
  });
  sections.push({
    title: "Ads",
    body: !run.deep
      ? "Not read in a default run. A deep run reads the TikTok ad library for each brand and keeps only ads whose advertiser is the brand itself."
      : table(["Brand", "Own ads found", "Other advertisers' ads left out", "Request"], run.ads.map((a) => [a.brand, n(a.own.length), n(a.others), a.requestId ?? ""])),
  });
  const cmd = (rest: string) => `\`npx -y socialcrawl@latest ${rest}\``;
  const aboutFlag = run.about ? ` --about "${run.about}"` : "";
  const plays: string[][] = [];
  if (!run.about) plays.push(["Name the category, for a sharper filter", cmd(`competitor-research "${run.brands.join(", ")}" --about "<their category>"`), "each brand's share once other meanings of its name are dropped"]);
  plays.push([`Read deeper: two pages, Instagram, Reddit threads and ads`, cmd(`competitor-research "${run.brands.join(", ")}"${aboutFlag} --deep`), `free quote first: about ${quoteDeep.expected} credits, at most ${quoteDeep.max}`]);
  if (top) plays.push([`See what works on TikTok for the leader, ${top[0]}`, cmd(`tiktok-marketing "${top[0]}"`), "its break-outs, hooks and comments"]);
  if (lead) {
    const where = linkOf(lead.row).startsWith("http") ? linkOf(lead.row) : "<the link in data/posts.csv>";
    plays.push([`Track the top break-out (${lead.brand} on ${LABEL[lead.row.platform]})`, cmd(`post-tracker ${where}`), `its reach in 14 days against ${n(lead.breakout?.value ?? 0)} today`]);
  }
  sections.push({ title: "Next plays", body: table(["Play", "Command", "What to check"], plays) });

  // Summary
  const summary: string[] = [];
  summary.push(top ? `${top[0]} had the most posts read on ${top[1]} of ${run.share.length} platforms [${F1.id}].` : `No brand led the posts read on any platform [${F1.id}].`);
  if (lead) summary.push(`The largest break-out: ${lead.brand} on ${LABEL[lead.row.platform]}, ${times(lead.breakout!.multiple)} ${usualOf(lead.row.platform)} [${bestFinding.get(lead)}].`);
  if (FA && mostComplaints) summary.push(`${mostComplaints[0]}'s audience left the most complaints: ${mostComplaints[1].classes.complaint.count} in ${mostComplaints[1].read} comments read [${FA.id}].`);
  if (run.outsideWindow) summary.push(`${run.outsideWindow} ${run.outsideWindow === 1 ? "post" : "posts"} outside the window were left out [${F1.id}].`);

  const fit = (s: string) => (s.length <= 110 ? s : s.slice(0, 109).replace(/\s+\S*$/, "") + "…");
  const headlines = [
    fit(top ? `${top[0]} had the most posts on ${top[1]} of ${run.share.length} platforms` : `No brand led on any platform`),
    ...(lead ? [fit(`Top break-out: ${lead.brand} on ${LABEL[lead.row.platform]}, ${times(lead.breakout!.multiple)} ${usualOf(lead.row.platform)}`)] : []),
    ...(FA && mostComplaints && mostComplaints[1].classes.complaint.count > 0 ? [fit(`Most complaints: ${mostComplaints[0]}, ${mostComplaints[1].classes.complaint.count} in ${mostComplaints[1].read} comments`)] : []),
  ].slice(0, 3);
  const card: CardInput = {
    command: `/competitor-research "${run.brands.join(", ")}"`,
    skill: "competitor-research",
    headlines,
    basis: `${n(run.rows.length)} posts read on ${run.share.length} platforms, ${span}`,
    meta,
    rerun: `npx -y socialcrawl@latest competitor-research "${run.brands.join(", ")}"${run.about ? ` --about "${run.about}"` : ""}`,
  };
  const report: ReportInput = {
    command: card.command,
    skill: "competitor-research",
    badge: `${span} · ${run.brands.join(", ")}${run.about ? ` · in \`${run.about}\`` : ""} · ${run.deep ? "deep" : "default"} run`,
    summary,
    sections,
    evidence: ev,
    meta,
    methodNotes: [
      run.about
        ? `Filter: each brand in \`${run.about}\`. It is searched on each platform with the topic filter set to the brand and that category, so a brand whose name is a common word counts only posts judged to be about it.`
        : `Filter: each brand as a product compared with the others (${run.brands.join(", ")}), since no category was given. A brand whose name is also a common word can keep some posts about another meaning; --about names the category for a sharper filter.`,
      "A best post's multiple is its reach over the median of its author's comparable posts published before it (on Reddit, its community's posts of the month); under 8 such posts no multiple is given.",
      `Accounts under ${n(NAME_MIN_FOLLOWERS)} followers, or whose size was not read, are described, not named or linked; Reddit members are never named.`,
    ],
  };

  const posts = run.rows.map(({ brand, row }) => ({ brand, platform: row.platform, id: row.id, url: row.url, author: row.author, followers: row.authorFollowers, community: row.community, published_at: row.publishedAt, views: row.views, likes: row.likes, comments: row.comments, text: row.text, request_id: row.requestId }));
  const shareRows = run.share.flatMap((p) => p.brands.map((b) => ({ platform: p.platform, metric: p.metric, brand: b.brand, posts: b.posts, post_share: b.postShare, reach: b.reach, reach_share: b.reachShare, largest_post_share: b.topPostShare })));
  const tables: Record<string, Table> = {
    posts: { columns: posts.length ? Object.keys(posts[0]) : ["brand"], rows: posts },
    share: { columns: ["platform", "metric", "brand", "posts", "post_share", "reach", "reach_share", "largest_post_share"], rows: shareRows },
  };
  return {
    card,
    report,
    tiles: [
      { label: "Brands", value: n(run.brands.length) },
      { label: "Posts read", value: n(run.rows.length), finding: F1.id },
      { label: "Platforms", value: n(run.share.length) },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: run.share.map((p) => ({ title: `${LABEL[p.platform]}: share of posts read`, unit: "%", bars: p.brands.map((b) => ({ label: b.brand, value: Math.round(b.postShare * 100), finding: F1.id })) })),
    tables,
  };
}
