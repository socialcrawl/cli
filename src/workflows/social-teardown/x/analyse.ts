// REA-Socials: everything after the calls. Pure: it reads kept records, never the network.
//
// The evidence model is borrowed from REA (github.com/morluto/rea, MIT):
// "Every conclusion must distinguish observations, inferences, and unknowns.
// Cite Evidence IDs, preserve limitations and incomplete coverage"
// (.agents/skills/reverse-engineer-anything/SKILL.md). Here an observation is a
// number the API returned, cited by its request id; an inference is a pattern
// computed from those numbers, with its sample size; an unknown is something
// the run could not see, with the reason.
import { clusterMoves, leadingChannel, windowLift } from "../../../engine/lift.ts";
import type { Cluster, LeadingChannel, Lift } from "../../../engine/lift.ts";
import { median } from "./codebook.ts";
import type { CodedPost } from "./codebook.ts";
import type { TaggedRecord as CallRecord } from "../tracker.ts";

export interface Launch {
  id: string;
  artefact: string;
  artefactName: string;
  artefactUrl: string;
  launchDate: string;
  mainPost: string;
  mainViews: number | null;
  posts: string[];
  teasePosts: string[];
  followUps: string[];
  clusterViews: number;
  videoSeconds: number | null;
  /** Distinct days on which an own post introduced or announced this artefact. */
  announceDays: string[];
}

const OWN_TOP = (c: CodedPost) => c.kind === "original" || c.kind === "thread_head";
const LAUNCH_HOOKS = new Set(["introducing", "just_shipped", "i_built", "free_offer"]);

/**
 * Does this post announce the thing it links? A launch hook on the first line,
 * "Introducing" in the first three lines ("ChatGPT can now run your GTM / Introducing
 * the Treg ChatGPT plugin"), or a video that carries a try-URL.
 */
function announces(c: CodedPost): boolean {
  if (LAUNCH_HOOKS.has(c.hook)) return true;
  if (/\bintroducing\b/i.test(c.text.split("\n").slice(0, 3).join(" "))) return true;
  return c.format === "video";
}
/** One key per artefact, so "/people-search", "treg.to/people-search" and a relaunch of either land in the same launch. */
const keyOf = (name: string) => {
  const parts = name.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? "").replace(/\s+/g, " ").trim();
};

/**
 * A launch is one artefact made public and pushed: every own post that names
 * the same repository, skill or try-URL, plus the self-replies in the same
 * conversation (the "repo link below" reply). Retweets of others are left out.
 */
export function clusterLaunches(coded: CodedPost[], handle: string): Launch[] {
  const own = coded.filter((c) => c.kind !== "retweet" && c.kind !== "reply_other");
  const groups = new Map<string, CodedPost[]>();
  for (const c of own.filter(OWN_TOP)) {
    if (!c.artefact_name || c.artefact === "none") continue;
    // A bare link to a site, a booking page or a partner is not a launch unless the post announces something.
    if ((c.artefact === "other" || c.artefact === "credits_or_trial") && !announces(c)) continue;
    const k = keyOf(c.artefact_name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const launches: Launch[] = [];
  for (const posts of groups.values()) {
    const main = posts.slice().sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
    const mainTime = main.created_utc;
    launches.push({
      id: "",
      artefact: main.artefact,
      artefactName: main.artefact_name,
      artefactUrl: main.artefact_name.includes("/") && !main.artefact_name.startsWith("/") ? (main.artefact_name.includes(".") ? `https://${main.artefact_name}` : `https://github.com/${main.artefact_name}`) : "",
      launchDate: main.created_utc.slice(0, 10),
      mainPost: main.post_id,
      mainViews: main.views,
      posts: posts.map((p) => p.post_id),
      teasePosts: posts.filter((p) => p.created_utc < mainTime && p.post_id !== main.post_id).map((p) => p.post_id),
      followUps: posts.filter((p) => p.created_utc > mainTime).map((p) => p.post_id),
      clusterViews: posts.reduce((s, p) => s + (p.views ?? 0), 0),
      videoSeconds: main.video_seconds,
      announceDays: [...new Set(posts.filter((p) => p.hook === "introducing" || p.hook === "just_shipped").map((p) => p.created_utc.slice(0, 10)))].sort(),
    });
  }
  // Self-replies under a launch post (the "repo link below" reply) join that launch.
  for (const c of own.filter((x) => x.kind === "self_reply_link" || x.kind === "thread_part")) {
    const l = launches.find((x) => c.conversation_id !== null && x.posts.includes(c.conversation_id));
    if (l && !l.posts.includes(c.post_id)) {
      l.posts.push(c.post_id);
      l.followUps.push(c.post_id);
      l.clusterViews += c.views ?? 0;
    }
  }
  launches.sort((a, b) => a.launchDate.localeCompare(b.launchDate));
  launches.forEach((l, i) => (l.id = `${handle.toLowerCase()}-L${String(i + 1).padStart(2, "0")}`));
  for (const l of launches) for (const id of l.posts) {
    const c = coded.find((x) => x.post_id === id);
    if (c) c.launch_id = l.id;
  }
  return launches;
}

/** The posts worth the paid depth stages: the top originals by views, then each top launch's main post. */
export function depthSet(coded: CodedPost[], launches: Launch[], n: number): string[] {
  const top = coded.filter(OWN_TOP).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, n).map((c) => c.post_id);
  const mains = launches.slice().sort((a, b) => (b.mainViews ?? 0) - (a.mainViews ?? 0)).slice(0, Math.ceil(n / 2)).map((l) => l.mainPost);
  return [...new Set([...top, ...mains])];
}

export interface Evidence {
  id: string;
  type: "observed" | "inferred" | "unknown";
  claim: string;
  requests: string[];
}

export class Ledger {
  items: Evidence[] = [];
  add(type: Evidence["type"], claim: string, requests: (string | null | undefined)[] = []): string {
    const id = `E${String(this.items.length + 1).padStart(2, "0")}`;
    this.items.push({ id, type, claim, requests: [...new Set(requests.filter((x): x is string => Boolean(x)))] });
    return id;
  }
}

export interface Amplifiers {
  postId: string;
  count: number;
  over10k: number;
  medianFollowers: number | null;
  top: { handle: string; followers: number }[];
  complete: boolean;
  requestId: string | null;
}

export function amplifiersOf(rec: CallRecord): Amplifiers {
  const items: any[] = (rec.body.data as any)?.items ?? [];
  const accts = items.map((i) => i.author ?? i).filter((a) => a?.username);
  const fol = accts.map((a) => Number(a.followers ?? 0));
  return {
    postId: rec.meta.post_id,
    count: accts.length,
    over10k: fol.filter((f) => f > 10_000).length,
    medianFollowers: median(fol),
    top: accts.map((a) => ({ handle: String(a.username), followers: Number(a.followers ?? 0) })).sort((a, b) => b.followers - a.followers).slice(0, 10),
    complete: (rec.body as any).pagination?.has_more === false,
    requestId: rec.requestId,
  };
}

export interface ReplyRead {
  postId: string;
  count: number;
  shares: Record<string, number | null>;
  receipts: Record<string, string[]>;
  selfLinks: string[];
  /** A comment-a-word gate: one short reply text that makes up more than 30% of the replies read. */
  gate: { word: string; share: number } | null;
  requestId: string | null;
}

/** Strip the leading @mentions of a reply, so a quote does not name an ordinary replier. */
const unname = (t: string) => t.replace(/^(@\w+\s+)+/, "").replace(/\s+/g, " ").trim().slice(0, 140);

export function repliesOf(rec: CallRecord, handle: string): ReplyRead {
  const d: any = rec.body.data ?? {};
  const items: any[] = d.items ?? [];
  const own = new Set(items.map((i) => i.comment ?? i).filter((c) => String(c.author?.username ?? "").toLowerCase() === handle.toLowerCase()).map((c) => unname(String(c.text ?? ""))));
  const shares: Record<string, number | null> = {};
  const receipts: Record<string, string[]> = {};
  for (const [k, v] of Object.entries<any>(d.label_share?.presets ?? {})) {
    shares[k] = typeof v?.share === "number" ? v.share : null;
    receipts[k] = (v?.receipts ?? []).map((x: any) => unname(String(x.text ?? ""))).filter((t: string) => !own.has(t)).slice(0, 3);
  }
  const selfLinks = items
    .map((i) => i.comment ?? i)
    .filter((c) => String(c.author?.username ?? "").toLowerCase() === handle.toLowerCase())
    .map((c) => String(c.text ?? ""))
    .filter((t) => /https?:\/\//.test(t))
    .slice(0, 3);
  const words = new Map<string, number>();
  const others = items.map((i) => i.comment ?? i).filter((c) => String(c.author?.username ?? "").toLowerCase() !== handle.toLowerCase());
  for (const c of others) {
    // Every @mention goes first: a reply that only tags accounts carries no word.
    const t = String(c.text ?? "").replace(/@\w+/g, " ").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
    if (t && t.split(/\s+/).length <= 2) words.set(t, (words.get(t) ?? 0) + 1);
  }
  const topWord = [...words.entries()].sort((x, y) => y[1] - x[1])[0];
  const gate = topWord && others.length >= 10 && topWord[1] / others.length > 0.3 ? { word: topWord[0], share: Math.round((topWord[1] / others.length) * 100) / 100 } : null;
  return { postId: rec.meta.post_id, count: items.length, shares, receipts, selfLinks, gate, requestId: rec.requestId };
}

export interface Analysis {
  handle: string;
  profile: any;
  coded: CodedPost[];
  launches: Launch[];
  amplifiers: Amplifiers[];
  repeatAmplifiers: { handle: string; posts: number; followers: number }[];
  replies: ReplyRead[];
  transcripts: { postId: string; text: string | null; seconds: number | null; status: number; requestId: string | null }[];
  repos: { repo: string; stars: number | null; forks: number | null; created: string | null; pushed: string | null; requestId: string | null }[];
  reddit: { query: string; threads: { date: string; subreddit: string; score: number; comments: number; title: string; url: string }[]; requestId: string | null }[];
  byFormat: { key: string; n: number; medianViews: number | null }[];
  byHook: { key: string; n: number; medianViews: number | null }[];
  byArtefact: { key: string; n: number; medianViews: number | null }[];
  byWeekday: { key: string; n: number; medianViews: number | null }[];
  byHour: { key: string; n: number; medianViews: number | null }[];
  squads: { postId: string; launch: string; within30: number; within120: number; accounts: { handle: string; followers: number; minutes: number }[]; requestId: string | null }[];
  repeatSquad: { handle: string; launches: number; followers: number }[];
  replyRing: { handle: string; posts: number; followers: number | null }[];
  echoes: { postId: string; launch: string; summary: Record<string, unknown>; requestId: string | null; status: number }[];
  quotes: { postId: string; count: number; within3h: number; firstMinutes: number | null; medianFollowers3h: number | null; quoteViews: number; postViews: number | null; top: { handle: string; followers: number; minutes: number }[]; requestId: string | null }[];
  repeatQuoters: { handle: string; posts: number; followers: number }[];
  teamCandidates: { handle: string; retweets: number }[];
  recycled: { template: string; posts: string[] }[];
  ledger: Ledger;
  credits: number;
  calls: number;
  window: { first: string | null; last: string | null };
  /** Launch clusters (moves within 42 days) and each one's lift in views per post, or why there is none. */
  lift: { cluster: Cluster; lift: Lift }[];
  /** Which channel leads growth: always refused on one X account under 18 months or 6 moves. */
  leading: LeadingChannel;
}

function groupMedian(rows: CodedPost[], key: (c: CodedPost) => string): { key: string; n: number; medianViews: number | null }[] {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    if (r.views !== null) m.get(k)!.push(r.views);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, n: v.length, medianViews: median(v) })).sort((a, b) => b.n - a.n);
}

export function analyseX(records: CallRecord[], coded: CodedPost[], handleIn: string): Analysis {
  const handle = handleIn.replace(/^@/, "").toLowerCase();
  const ledger = new Ledger();
  const profRec = records.find((r) => r.stage === "profile" && r.status === 200);
  const profile: any = (profRec?.body.data as any)?.author ?? null;
  const launches = clusterLaunches(coded, handle);
  const originals = coded.filter(OWN_TOP);
  const timelineIds = records.filter((r) => r.stage === "timeline").map((r) => r.requestId);

  if (profile) ledger.add("observed", `@${profile.username} has ${profile.followers?.toLocaleString("en-GB")} followers and ${profile.posts_count?.toLocaleString("en-GB")} posts; joined ${profile.joined_at}.`, [profRec!.requestId]);
  const first = coded[0]?.created_utc ?? null;
  const last = coded[coded.length - 1]?.created_utc ?? null;
  const kinds = groupMedian(coded, (c) => c.kind);
  ledger.add("observed", `${coded.length} posts read from ${first?.slice(0, 10)} to ${last?.slice(0, 10)}: ${kinds.map((k) => `${k.n} ${k.key}`).join(", ")}.`, timelineIds);

  for (const c of originals.filter((c) => (c.outlier_x ?? 0) >= 3).sort((a, b) => (b.outlier_x ?? 0) - (a.outlier_x ?? 0)).slice(0, 10)) {
    ledger.add("observed", `Post ${c.post_id} (${c.created_utc.slice(0, 10)}, ${c.format}, hook ${c.hook}) had ${c.views?.toLocaleString("en-GB")} views, ${c.outlier_x} times the median of the account's previous 20 originals.`, [c.request_no]);
  }

  const byFormat = groupMedian(originals, (c) => c.format);
  const byHook = groupMedian(originals, (c) => c.hook);
  const byArtefact = groupMedian(originals, (c) => c.artefact);
  const byWeekday = groupMedian(originals, (c) => c.weekday_utc);
  const byHour = groupMedian(originals, (c) => String(c.hour_utc).padStart(2, "0"));
  const best = byFormat.filter((f) => f.n >= 5).sort((a, b) => (b.medianViews ?? 0) - (a.medianViews ?? 0))[0];
  const base = median(originals.map((c) => c.views ?? 0));
  if (best && base) ledger.add("inferred", `Format ${best.key} has the highest median views among formats with 5 or more originals: ${best.medianViews?.toLocaleString("en-GB")} against ${base.toLocaleString("en-GB")} for all ${originals.length} originals (n=${best.n}).`, timelineIds);
  const launchRate = originals.length ? Math.round((originals.filter((c) => c.launch_id).length / originals.length) * 100) : 0;
  ledger.add("inferred", `${launches.length} launches found; ${launchRate}% of originals push a named artefact (repository, skill, tool or try-URL).`, timelineIds);
  const quoteUnseen = originals.filter((c) => c.quote_unseen).length;
  if (quoteUnseen) ledger.add("unknown", `${quoteUnseen} text-only originals may be quote posts: the API returns no quoted-post field, so the quoted content and its author are unseen.`, timelineIds);

  const amplifiers = records.filter((r) => r.stage === "retweeters" && r.status === 200).map(amplifiersOf);
  const seen = new Map<string, { posts: Set<string>; followers: number }>();
  for (const r of records.filter((r) => r.stage === "retweeters" && r.status === 200)) {
    for (const i of ((r.body.data as any)?.items ?? []) as any[]) {
      const a = i.author ?? i;
      const h = String(a?.username ?? "").toLowerCase();
      if (!h) continue;
      if (!seen.has(h)) seen.set(h, { posts: new Set(), followers: Number(a.followers ?? 0) });
      seen.get(h)!.posts.add(r.meta.post_id);
    }
  }
  const repeatAmplifiers = [...seen.entries()].filter(([, v]) => v.posts.size >= 2).map(([h, v]) => ({ handle: h, posts: v.posts.size, followers: v.followers })).sort((a, b) => b.posts - a.posts || b.followers - a.followers);
  for (const a of amplifiers) {
    ledger.add("observed", `Post ${a.postId}: ${a.count} retweeters read${a.complete ? " (all of them)" : " (first pages only)"}, ${a.over10k} with more than 10,000 followers, median ${a.medianFollowers?.toLocaleString("en-GB")} followers.`, [a.requestId]);
  }
  if (amplifiers.length >= 2) {
    const big = repeatAmplifiers.filter((r) => r.followers > 10_000).length;
    ledger.add("inferred", `${repeatAmplifiers.length} accounts retweeted two or more of the ${amplifiers.length} posts read (${big} of them with more than 10,000 followers): a repeat amplifier network.`, amplifiers.map((a) => a.requestId));
  }
  ledger.add("unknown", "Quote posts of this account's posts cannot be listed: the API has no quote-tweet list endpoint, only each post's quote count.", []);
  ledger.add("unknown", "Follower growth over time is not available: the profile gives today's count only.", []);

  const replies = records.filter((r) => r.stage === "replies" && r.status === 200).map((r) => repliesOf(r, handle));
  for (const rp of replies) {
    const parts = Object.entries(rp.shares).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${Math.round((v as number) * 100)}%`);
    ledger.add("observed", `Post ${rp.postId}: ${rp.count} replies read; labelled shares ${parts.join(", ") || "not returned"}.`, [rp.requestId]);
  }

  const transcripts = records.filter((r) => r.stage === "transcript").map((r) => ({
    postId: r.meta.post_id,
    text: (r.body.data as any)?.transcript ?? null,
    seconds: (r.body.data as any)?.duration_seconds ?? null,
    status: r.status,
    requestId: r.requestId,
  }));
  for (const t of transcripts) {
    if (t.text) ledger.add("observed", `Video ${t.postId} (${Math.round(t.seconds ?? 0)} s) opens: "${t.text.split(/(?<=[.!?])\s/)[0].slice(0, 160)}"`, [t.requestId]);
    else ledger.add("unknown", `Video ${t.postId} has no transcript (no speech, or captions not published).`, [t.requestId]);
  }
  for (const c of coded) {
    if (replies.some((r) => r.postId === c.post_id)) c.reply_sample_read = "yes";
    if (transcripts.some((t) => t.postId === c.post_id && t.text)) c.transcript_read = "yes";
  }

  const repos = records.filter((r) => r.stage === "github").map((r) => {
    const x: any = (r.body.data as any)?.author?.ext ?? {};
    return { repo: r.meta.repo, stars: x.stars ?? null, forks: x.forks ?? null, created: (r.body.data as any)?.author?.joined_at ?? null, pushed: x.pushed_at ?? null, requestId: r.requestId };
  });
  for (const g of repos.filter((g) => g.stars !== null)) ledger.add("observed", `github.com/${g.repo}: ${g.stars?.toLocaleString("en-GB")} stars, ${g.forks?.toLocaleString("en-GB")} forks, created ${g.created?.slice(0, 10)}.`, [g.requestId]);
  if (repos.length) ledger.add("unknown", "Stars by day are not available, so stars gained in the 7 days after a launch cannot be measured; only today's total is.", []);

  const reddit = records.filter((r) => r.stage === "reddit").map((r) => ({
    query: r.meta.query,
    requestId: r.requestId,
    threads: (((r.body.data as any)?.items ?? []) as any[]).map((i) => {
      const p = i.post ?? i;
      return { date: String(p.published_at ?? "").slice(0, 10), subreddit: p.ext?.subreddit ?? "", score: p.engagement?.likes ?? 0, comments: p.engagement?.comments ?? 0, title: p.ext?.title ?? p.content?.text ?? "", url: p.url };
    }).filter((t) => (t.title + " " + t.url).toLowerCase().includes(r.meta.query.toLowerCase())).sort((a, b) => b.score - a.score),
  }));
  for (const rd of reddit) ledger.add("observed", `Reddit, "${rd.query}": ${rd.threads.length} threads in the past year name it${rd.threads[0] ? `; the largest is r/${rd.threads[0].subreddit} with ${rd.threads[0].score} points` : ""}.`, [rd.requestId]);

  // Where the views come from: videos, and launch videos in particular.
  const totalViews = originals.reduce((s, c) => s + (c.views ?? 0), 0);
  const videoViews = originals.filter((c) => c.format === "video").reduce((s, c) => s + (c.views ?? 0), 0);
  // Every video original that belongs to a launch, relaunches included.
  const launchVideos = originals.filter((c) => c.format === "video" && c.launch_id);
  const launchVideoViews = launchVideos.reduce((s, c) => s + (c.views ?? 0), 0);
  if (totalViews > 0) {
    ledger.add("inferred", `${originals.filter((c) => c.format === "video").length} video originals carry ${Math.round((videoViews / totalViews) * 1000) / 10}% of the views of all ${originals.length} originals; the ${launchVideos.length} launch videos (relaunches included) carry ${Math.round((launchVideoViews / totalViews) * 1000) / 10}%.`, timelineIds);
  }
  // The launch template: the hour the main posts go out.
  if (launches.length >= 3) {
    const hours = new Map<number, number>();
    for (const l of launches) {
      const h = coded.find((c) => c.post_id === l.mainPost)?.hour_utc;
      if (h !== undefined) hours.set(h, (hours.get(h) ?? 0) + 1);
    }
    const [h, k] = [...hours.entries()].sort((a, b) => b[1] - a[1])[0];
    ledger.add("inferred", `${k} of ${launches.length} launch posts went out in the ${String(h).padStart(2, "0")}:00 UTC hour.`, timelineIds);
  }
  for (const l of launches.filter((l) => l.announceDays.length >= 2)) {
    ledger.add("observed", `${l.artefactName} was announced on ${l.announceDays.length} different days (${l.announceDays.join(", ")}): a relaunch.`, l.posts.map((id) => coded.find((c) => c.post_id === id)?.request_no));
  }

  // Accounts posting in a launch's first hours: other accounts naming the handle or the launch's domain right after a launch post.
  const squads = records.filter((r) => r.stage === "squad" && r.status === 200).map((r) => {
    const t0 = new Date(coded.find((c) => c.post_id === r.meta.post_id)?.created_utc ?? 0).getTime();
    const needles = [`@${handle}`, ...(r.params.query ? String(r.params.query).match(/"([^"]+)"/g) ?? [] : []).map((q) => q.replace(/"/g, "").toLowerCase())];
    // X search also matches display names: keep only rows whose own text names the handle or the launch domain.
    const rowsIn = (((r.body.data as any)?.items ?? []) as any[])
      .map((i) => i.post ?? i)
      .filter((p) => String(p.author?.username ?? "").toLowerCase() !== handle)
      .filter((p) => needles.some((nd) => String(p.content?.text ?? "").toLowerCase().includes(nd)));
    const accounts = rowsIn
      .map((p) => ({ handle: String(p.author?.username ?? "").toLowerCase(), followers: Number(p.ext?.author_followers ?? 0), minutes: Math.round((new Date(p.published_at).getTime() - t0) / 60000) }))
      .filter((a) => a.minutes >= -60);
    const firstSeen = new Map<string, { handle: string; followers: number; minutes: number }>();
    for (const a of accounts.sort((x, y) => x.minutes - y.minutes)) if (!firstSeen.has(a.handle)) firstSeen.set(a.handle, a);
    const uniq = [...firstSeen.values()];
    return {
      postId: r.meta.post_id,
      launch: r.meta.launch,
      within30: uniq.filter((a) => a.minutes >= 0 && a.minutes <= 30).length,
      within120: uniq.filter((a) => a.minutes >= 0 && a.minutes <= 120).length,
      accounts: uniq,
      requestId: r.requestId,
    };
  });
  const squadSeen = new Map<string, { launches: Set<string>; followers: number }>();
  for (const sq of squads) {
    for (const a of sq.accounts.filter((a) => a.minutes >= 0 && a.minutes <= 120)) {
      if (!squadSeen.has(a.handle)) squadSeen.set(a.handle, { launches: new Set(), followers: a.followers });
      squadSeen.get(a.handle)!.launches.add(sq.postId);
    }
  }
  const repeatSquad = [...squadSeen.entries()]
    .filter(([, v]) => v.launches.size >= 2)
    .map(([h, v]) => ({ handle: h, launches: v.launches.size, followers: v.followers }))
    .sort((a, b) => b.launches - a.launches || b.followers - a.followers);
  for (const sq of squads) ledger.add("observed", `Launch ${sq.launch}: ${sq.within30} other accounts posted about it within 30 minutes of the launch post, ${sq.within120} within 2 hours.`, [sq.requestId]);
  if (squads.length >= 2) ledger.add("inferred", `${repeatSquad.length} accounts posted about two or more of the ${squads.length} launches read within 2 hours of the launch post.`, squads.map((s) => s.requestId));

  // Repeat repliers: accounts that reply under two or more of the posts read.
  const ring = new Map<string, { posts: Set<string>; followers: number | null }>();
  for (const r of records.filter((r) => r.stage === "replies" && r.status === 200)) {
    for (const i of ((r.body.data as any)?.items ?? []) as any[]) {
      const c = i.comment ?? i;
      const h = String(c.author?.username ?? "").toLowerCase();
      if (!h || h === handle) continue;
      if (!ring.has(h)) ring.set(h, { posts: new Set(), followers: c.ext?.author_followers ?? null });
      ring.get(h)!.posts.add(r.meta.post_id);
    }
  }
  const replyRing = [...ring.entries()]
    .filter(([, v]) => v.posts.size >= 2)
    .map(([h, v]) => ({ handle: h, posts: v.posts.size, followers: v.followers }))
    .sort((a, b) => b.posts - a.posts);
  if (replies.length >= 2) ledger.add("inferred", `${replyRing.length} accounts replied under two or more of the ${replies.length} posts whose replies were read.`, replies.map((r) => r.requestId));

  const echoes = records.filter((r) => r.stage === "echo").map((r) => ({ postId: r.meta.post_id, launch: r.meta.launch, summary: echoSummary(r.body.data), requestId: r.requestId, status: r.status }));
  for (const e of echoes) {
    if (e.status === 200) ledger.add("observed", `Off-X echo of "${e.launch}": ${Object.entries(e.summary).map(([k, v]) => `${k} ${v}`).join(", ")}.`, [e.requestId]);
    else ledger.add("unknown", `Off-X echo of "${e.launch}" could not be read (${e.status}).`, [e.requestId]);
  }

  // Gate fulfilment: the account sends the same link again and again in one conversation.
  const sends = new Map<string, Map<string, number>>();
  for (const c of coded.filter((c) => c.kind === "reply_other" && c.conversation_id)) {
    for (const u of (c.text.match(/https?:\/\/\S+/g) ?? [])) {
      const m = sends.get(c.conversation_id!) ?? new Map<string, number>();
      m.set(u, (m.get(u) ?? 0) + 1);
      sends.set(c.conversation_id!, m);
    }
  }
  for (const [conv, m] of sends) {
    const [link, k] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
    if (k < 5) continue;
    const root = coded.find((c) => c.post_id === conv);
    if (root) {
      root.gated = "yes";
      if (root.cta === "none" || root.cta === "link_below" || root.cta === "link_inline") root.cta = "comment_to_get";
    }
    ledger.add("observed", `The account replied ${k} times with the same link (${link.slice(0, 80)}) under post ${conv}${root ? "" : " (a post no read returned)"}: a gated give-away, fulfilled by hand.`, coded.filter((c) => c.conversation_id === conv && c.kind === "reply_other").slice(0, 4).map((c) => c.request_no));
  }

  // Gates: posts whose replies are mostly one word (comment-a-word give-aways).
  for (const rp of replies.filter((r) => r.gate)) {
    ledger.add("observed", `Post ${rp.postId} is gated: "${rp.gate!.word}" is ${Math.round(rp.gate!.share * 100)}% of the ${rp.count} replies read (a comment-a-word give-away).`, [rp.requestId]);
    const c = coded.find((x) => x.post_id === rp.postId);
    if (c && c.gated !== "yes") {
      c.gated = "yes";
      if (c.cta === "none" || c.cta === "link_inline" || c.cta === "link_below") c.cta = "comment_to_get";
    }
  }

  // Quotes: who quoted each depth post, and how soon (X's quoted_tweet_id: search).
  const quotes = quoteRecords(records).map((r) => {
    const post = coded.find((c) => c.post_id === r.meta.post_id);
    const t0 = new Date(post?.created_utc ?? 0).getTime();
    const rows = (((r.body.data as any)?.items ?? []) as any[]).map((i) => i.post ?? i).filter((p) => String(p.author?.username ?? "").toLowerCase() !== handle);
    const acc = rows.map((p) => ({ handle: String(p.author?.username ?? "").toLowerCase(), followers: Number(p.ext?.author_followers ?? 0), minutes: Math.round((new Date(p.published_at).getTime() - t0) / 60000), views: Number(p.engagement?.views ?? 0) }));
    const early = acc.filter((x) => x.minutes >= 0 && x.minutes <= 180);
    return {
      postId: r.meta.post_id,
      count: acc.length,
      within3h: early.length,
      firstMinutes: early.length ? Math.min(...early.map((x) => x.minutes)) : null,
      medianFollowers3h: median(early.map((x) => x.followers)),
      quoteViews: acc.reduce((s, x) => s + x.views, 0),
      postViews: post?.views ?? null,
      top: acc.sort((x, y) => y.followers - x.followers).slice(0, 10).map(({ handle: h, followers, minutes }) => ({ handle: h, followers, minutes })),
      requestId: r.requestId,
    };
  });
  const quoteSeen = new Map<string, { posts: Set<string>; followers: number }>();
  for (const r of quoteRecords(records)) {
    for (const i of ((r.body.data as any)?.items ?? []) as any[]) {
      const p = i.post ?? i;
      const h = String(p.author?.username ?? "").toLowerCase();
      if (!h || h === handle) continue;
      if (!quoteSeen.has(h)) quoteSeen.set(h, { posts: new Set(), followers: Number(p.ext?.author_followers ?? 0) });
      quoteSeen.get(h)!.posts.add(r.meta.post_id);
    }
  }
  const repeatQuoters = [...quoteSeen.entries()].filter(([, v]) => v.posts.size >= 2).map(([h, v]) => ({ handle: h, posts: v.posts.size, followers: v.followers })).sort((a, b) => b.posts - a.posts || b.followers - a.followers);
  for (const q of quotes) {
    ledger.add("observed", `Post ${q.postId}: ${q.count} quote posts found, ${q.within3h} within 3 hours${q.firstMinutes !== null ? ` (the first after ${q.firstMinutes} minutes)` : ""}, median ${q.medianFollowers3h?.toLocaleString("en-GB") ?? "?"} followers among the early ones; the quotes had ${q.quoteViews.toLocaleString("en-GB")} views against the post's ${q.postViews?.toLocaleString("en-GB") ?? "?"}.`, [q.requestId]);
  }
  if (quotes.length >= 2) ledger.add("inferred", `${repeatQuoters.length} accounts quoted two or more of the ${quotes.length} posts read (${repeatQuoters.filter((r) => r.followers > 10_000).length} with more than 10,000 followers).`, quotes.map((q) => q.requestId));
  if (!records.some((r) => r.stage === "quotes")) ledger.add("unknown", "Quote posts of this account's posts were not read in this run (quotes stage off).", []);

  // Team candidates: the accounts this one retweets most (founders and staff usually lead the list).
  const rts = new Map<string, number>();
  for (const c of coded.filter((c) => c.kind === "retweet")) {
    const m = c.text.match(/^RT @(\w{1,15})/);
    if (m) rts.set(m[1].toLowerCase(), (rts.get(m[1].toLowerCase()) ?? 0) + 1);
  }
  const teamCandidates = [...rts.entries()].filter(([h, k]) => k >= 3 && h !== handle).map(([h, k]) => ({ handle: h, retweets: k })).sort((a, b) => b.retweets - a.retweets).slice(0, 10);
  if (teamCandidates.length) ledger.add("inferred", `The account retweets ${teamCandidates.map((t) => `@${t.handle} (${t.retweets})`).join(", ")} most; such accounts are often the team, whose own posts may carry more reach than the brand's. Run REA-X on each to see it.`, timelineIds);

  // Recycled templates: the same text posted again with only numbers or links changed.
  const norm = (t: string) => t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[\d.,$€£%]+/g, "#").replace(/\s+/g, " ").trim().slice(0, 90);
  const tpl = new Map<string, string[]>();
  for (const c of originals) {
    const k = norm(c.text);
    if (k.length < 40) continue;
    if (!tpl.has(k)) tpl.set(k, []);
    tpl.get(k)!.push(c.post_id);
  }
  const recycled = [...tpl.entries()].filter(([, ids]) => ids.length >= 2).map(([template, posts]) => ({ template, posts })).sort((a, b) => b.posts.length - a.posts.length);
  for (const r of recycled.slice(0, 5)) ledger.add("observed", `The same text was posted ${r.posts.length} times with only numbers or links changed: "${r.template.slice(0, 70)}".`, r.posts.map((id) => coded.find((c) => c.post_id === id)?.request_no));

  const credits = records.reduce((s, r) => s + (r.creditsUsed || 0), 0);
  // Launch lift (marketingskills' method): launches within 42 days form one cluster; lift is views
  // per original post in the 3 months from the cluster's start minus the 3 before, refused when
  // either window is not wholly inside the posts read (the newest post read stands for "now").
  const originalsViews = coded.filter((c) => c.kind === "original" || c.kind === "thread_head").map((c) => ({ publishedAt: c.created_utc, views: c.views }));
  const lift = first && last ? clusterMoves(launches.map((l) => l.launchDate)).map((cluster) => ({ cluster, lift: windowLift(originalsViews, cluster.start, first, new Date(last)) })) : [];
  for (const { cluster, lift: l } of lift) {
    if (l.lift === null) continue;
    const t0 = Date.parse(cluster.start);
    const reqs = [...new Set(coded.filter((c) => Math.abs(Date.parse(c.created_utc) - t0) < 92 * 86_400_000).map((c) => c.request_no).filter(Boolean))];
    ledger.add("inferred", `Launches from ${cluster.start.slice(0, 10)} (${cluster.moves.length}): views per original post went from ${l.before} in the 3 months before to ${l.after} in the 3 months after (${l.postsBefore} and ${l.postsAfter} posts); timing is a lead, not a cause.`, reqs);
  }
  // Month by month from the first post read: launches per month, and the change in views per original post.
  const monthKey = (iso: string) => iso.slice(0, 7);
  const monthsList: string[] = [];
  if (first && last) for (let d = new Date(`${first.slice(0, 7)}-01T00:00:00Z`); monthKey(d.toISOString()) <= monthKey(last); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) monthsList.push(monthKey(d.toISOString()));
  const perMonth = monthsList.map((m) => {
    const vs = originalsViews.filter((p) => monthKey(p.publishedAt) === m && p.views !== null).map((p) => p.views as number);
    return vs.length ? vs.reduce((s2, v) => s2 + v, 0) / vs.length : 0;
  });
  const growth = perMonth.slice(1).map((v, i2) => v - perMonth[i2]);
  const moves = monthsList.slice(1).map((m) => launches.filter((l) => monthKey(l.launchDate) === m).length);
  const leading = leadingChannel([{ channel: "x launches", monthlyMoves: moves }], growth);
  return { handle, profile, coded, launches, amplifiers, repeatAmplifiers, replies, transcripts, repos, reddit, byFormat, byHook, byArtefact, byWeekday, byHour, squads, repeatSquad, replyRing, echoes, quotes, repeatQuoters, teamCandidates, recycled, ledger, credits, calls: records.length, window: { first, last }, lift, leading };


}

/** The counts a launch-echo answer carries, whatever its exact shape: every number and every list's length, two levels deep. */
export function echoSummary(data: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (o: any, prefix: string, depth: number) => {
    if (!o || typeof o !== "object" || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "number") out[key] = v;
      else if (Array.isArray(v)) out[`${key} (items)`] = v.length;
      else if (v && typeof v === "object") walk(v, key, depth + 1);
    }
  };
  walk(data, "", 0);
  return Object.fromEntries(Object.entries(out).slice(0, 12));
}

/** The quote reads to use: the 3-hour window when a run has it, else whatever was read. */
function quoteRecords(records: CallRecord[]): CallRecord[] {
  const ok = records.filter((r) => r.stage === "quotes" && r.status === 200);
  const windowed = new Set(ok.filter((r) => r.meta.window === "3h").map((r) => r.meta.post_id));
  return ok.filter((r) => r.meta.window === "3h" || !windowed.has(r.meta.post_id));
}
