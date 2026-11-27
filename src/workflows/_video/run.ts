// The stages every video-platform marketing workflow runs (study file 18, section 2.1), each
// through the Session, so the one budget, max_pages and responses.jsonl hold on every call:
//
//   1. search      the platform's keyword searches, topic-filtered (relevance=filter&relevant_to=)
//   2. enrich      optional: what the search rows lack (YouTube's two batch lookups)
//   3. candidates  originals at or above the reach floor, one copy each
//   4. baseline    each chosen creator's own videos, judging off, never topic-filtered; one more
//                  page when the first holds fewer than 8 earlier comparable videos (file 25:
//                  TikTok and Instagram need 2 to 3 pages per creator)
//   5. ratio       each candidate against the creator's videos published BEFORE it
//   6. comments    the top posts' comments, labels sent explicitly (file 18, finding N1)
//   7. transcript  the spoken words of the top posts
//   8. names       optional: follower counts for accounts the report would name
//
// Nothing is guessed: a candidate with no baseline is listed with the reason.
import {
  breakoutWithPage,
  cardWorthy,
  describe as describeBreakout,
  engagementFlags,
  isViral,
  morePage,
  rateOf,
  rowsOf,
  stageParams,
  topicSentence,
  uniqueRows,
  viewsPerFollower,
} from "../../engine/index.ts";
import type { BaselineStep, Breakout, FlagRead, Row } from "../../engine/index.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import type { WorkflowArgs } from "../types.ts";
import { askSummary } from "./comments.ts";
import type { AskSummary } from "./comments.ts";
import type { Shares, VideoSpec } from "./spec.ts";

export interface VideoItem {
  row: Row;
  breakout: Breakout;
  flag: FlagRead | null;
  /** 3x or more over 8 or more earlier comparable videos, and not flagged as likely boosted. */
  viral: boolean;
  cardWorthy: boolean;
  line: string;
}

export type UnreadReason = "below_top_n" | "budget" | "error" | "no_id";

export interface Candidates {
  rows: Row[];
  /** Rows the searches returned, one copy each. */
  read: number;
  belowFloor: number;
  notOriginal: number;
  noViews: number;
}

export interface VideoRun {
  topic: string;
  query: string;
  deep: boolean;
  searches: CallRecord[];
  /** Every row the searches returned, one copy each, as the enrich stage left them. */
  allRows: Row[];
  candidates: Candidates;
  items: VideoItem[];
  unread: { row: Row; reason: UnreadReason }[];
  baselines: { key: string; rows: Row[]; records: CallRecord[] }[];
  comments: CallRecord[];
  asks: AskSummary;
  transcripts: { rowId: string; text: string; requestId: string | null }[];
  /** Follower (or subscriber) counts by baseline key, where read; null where the read had none. */
  followers: Map<string, number | null>;
}

const spentIn = (session: Session, group: string) =>
  session.ledger.lines.filter((l) => l.stage === group || l.stage.startsWith(`${group}:`)).reduce((s, l) => s + l.credits, 0);

/** The most one call may hold: its pages at the page price plus the topic filter's hold. */
function ceiling(endpoint: string, pages: number, topic: boolean): number {
  const r = rateOf(endpoint);
  return pages * (r.page + (topic ? (r.topicHold ?? 0) : 0));
}

export function candidatesOf(rows: Row[], floorViews: number): Candidates {
  const c: Candidates = { rows: [], read: rows.length, belowFloor: 0, notOriginal: 0, noViews: 0 };
  for (const r of rows) {
    if (r.kind !== "original") c.notOriginal++;
    else if (r.views === null) c.noViews++;
    else if (r.views < floorViews) c.belowFloor++;
    else c.rows.push(r);
  }
  return c;
}

export async function runVideo(session: Session, spec: VideoSpec, args: WorkflowArgs): Promise<VideoRun> {
  const deep = args.deep;
  const query = args.input.trim();
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about : query;
  const topic = topicSentence(query, about);
  const shares: Shares = deep ? spec.shares.deep : spec.shares.default;
  const pick = <T>(d: { default: T; deep: T }) => (deep ? d.deep : d.default);

  // 1. search
  const searches: CallRecord[] = [];
  for (const s of spec.searches(query, deep)) {
    const params = stageParams(s.endpoint, s.params, { topic, labels: "default" });
    const max = Math.min(ceiling(s.endpoint, s.pages, true), shares.search - spentIn(session, "search"));
    const rec = await session.call(`search:${s.stage}`, s.endpoint, params, max);
    if (rec) searches.push(rec);
  }
  let rows = uniqueRows(searches.flatMap((r) => rowsOf(r)));

  // 2. enrich
  const followers = new Map<string, number | null>();
  if (spec.enrich && rows.length) {
    const e = await spec.enrich(session, rows, shares.enrich);
    rows = e.rows;
    for (const [k, v] of e.followers) followers.set(k, v);
  }
  for (const r of rows) if (r.authorFollowers !== null && !followers.has(spec.groupKey(r))) followers.set(spec.groupKey(r), r.authorFollowers);

  // 3. candidates
  const candidates = candidatesOf(rows, spec.floorViews);

  // 4. baselines, one read per group, best pre-rank first
  const groups = new Map<string, Row[]>();
  for (const r of candidates.rows) {
    const k = spec.groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  // Follower counts for the most viewed creators, where the search rows carry none (Instagram),
  // so views over followers can order who gets a baseline.
  const readFollowers = async (r: Row) => {
    if (!spec.names) return;
    const rec = await session.call(`names:${spec.platform}`, spec.names.endpoint, spec.names.params(r), shares.names - spentIn(session, "names"));
    followers.set(spec.groupKey(r), rec ? spec.names.followers(rec) : null);
  };
  if (spec.names?.preRead) {
    const byViews = [...groups.values()].sort((a, b) => Math.max(...b.map((r) => r.views ?? 0)) - Math.max(...a.map((r) => r.views ?? 0)));
    for (const g of byViews.filter((x) => !followers.has(spec.groupKey(x[0]))).slice(0, pick(spec.names.preRead))) await readFollowers(g[0]);
  }
  const perFollower = (r: Row) => {
    const f = followers.get(spec.groupKey(r)) ?? r.authorFollowers;
    return f && f > 0 && r.views !== null ? r.views / f : (viewsPerFollower(r) ?? null);
  };
  const score = (g: Row[]) =>
    Math.max(...g.map((r) => (spec.preRank === "views_per_follower" ? (perFollower(r) ?? (r.views ?? 0) / 1e9) : (r.views ?? 0))));
  // A creator's newest pages reach back only so far: candidates older than recentDays go after
  // the recent ones, whose earlier posts those pages can hold (kept, never dropped).
  const recent = (g: Row[]) => {
    if (!spec.recentDays) return true;
    const newest = Math.max(...g.map((r) => (r.publishedAt ? Date.parse(r.publishedAt) : 0)));
    return args.now.getTime() - newest <= spec.recentDays * 86_400_000;
  };
  const ordered = [...groups.entries()].sort((a, b) => Number(recent(b[1])) - Number(recent(a[1])) || score(b[1]) - score(a[1]) || a[0].localeCompare(b[0]));
  const unread: VideoRun["unread"] = [];
  const baselines: VideoRun["baselines"] = [];
  const pageOf = new Map<string, Row[]>();
  const confirm = pick(spec.confirm);
  let read = 0;
  for (const [key, g] of ordered) {
    const miss = (reason: UnreadReason) => g.forEach((row) => unread.push({ row, reason }));
    if (read >= confirm) {
      miss("below_top_n");
      continue;
    }
    const newest = [...g].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0];
    const call = spec.baselineCall(newest, deep);
    if (!call) {
      miss("no_id");
      continue;
    }
    read++;
    const left = () => shares.baseline - spentIn(session, "baseline");
    const pages = Math.max(1, Number(call.params.max_pages ?? 1));
    const params = stageParams(call.endpoint, call.params, { labels: "off" });
    const notReadBefore = session.notRead.length;
    const rec = await session.call(`baseline:${spec.platform}`, call.endpoint, params, Math.min(ceiling(call.endpoint, pages, false), left()));
    if (!rec) {
      miss(session.notRead.length > notReadBefore ? "budget" : "error");
      continue;
    }
    const recs = [rec];
    let page = shape(spec, rowsOf(rec), call);
    // Walk back one page at a time while a candidate still has fewer than 8 earlier posts and
    // the response says more exist: busy creators post daily, so the newest pages often end
    // after the candidate (a live Instagram run, 27/11/2026: 5 of 6 creators short after 3 pages).
    const step: BaselineStep = { platform: spec.platform, key, endpoint: call.endpoint, params: call.params as Record<string, string | number>, credits: pages, rowIds: g.map((r) => r.id), preRank: null };
    for (let extra = 0; extra < pick(spec.extraPages ?? { default: 1, deep: 2 }); extra++) {
      const thin = g.map((r) => breakoutWithPage(r, page, { now: args.now, metric: "views" })).find((b) => b.band === "too_few");
      const next = thin ? morePage(thin, step, recs[recs.length - 1].body, left()) : null;
      if (!next) break;
      const more = await session.call(`baseline:${spec.platform}`, next.endpoint, stageParams(next.endpoint, next.params, { labels: "off" }), Math.min(next.credits, left()));
      if (!more) break;
      recs.push(more);
      page = [...page, ...shape(spec, rowsOf(more), call)];
    }
    baselines.push({ key, rows: page, records: recs });
    for (const r of g) pageOf.set(r.id, page);
  }

  // A candidate's own row on its creator's list may carry what the search row lacks (Instagram
  // gives a reel's music only there): its sound and hashtags are copied over, nothing else.
  for (const r of candidates.rows) {
    const own = pageOf.get(r.id)?.find((p) => p.id === r.id);
    if (!own) continue;
    if (!r.sound && own.sound) r.sound = own.sound;
    if (!r.hashtags && own.hashtags) r.hashtags = own.hashtags;
  }

  // 5. ratio and flags
  const flags = new Map(engagementFlags(candidates.rows).map((f) => [f.id, f]));
  const items: VideoItem[] = [];
  for (const r of candidates.rows) {
    const page = pageOf.get(r.id);
    if (!page) continue;
    const b = breakoutWithPage(r, page, { now: args.now, metric: "views" });
    const flag = flags.get(r.id) ?? null;
    const viral = isViral(b, flag ?? undefined);
    items.push({ row: r, breakout: b, flag, viral, cardWorthy: viral && cardWorthy(b), line: describeBreakout(b) });
  }
  items.sort((a, b) => Number(b.viral) - Number(a.viral) || (b.breakout.multiple ?? -1) - (a.breakout.multiple ?? -1) || (b.row.views ?? 0) - (a.row.views ?? 0));

  // The posts the later stages read: the break-outs first, then the most viewed candidates.
  const topPosts = (n: number) => {
    const out: Row[] = items.filter((i) => i.viral).map((i) => i.row);
    for (const r of [...candidates.rows].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))) if (!out.includes(r)) out.push(r);
    return out.filter((r) => r.url).slice(0, n);
  };

  // 6. comments
  const comments: CallRecord[] = [];
  const cpages = pick(spec.comments.pages);
  for (const r of topPosts(pick(spec.comments.posts))) {
    const params = stageParams(spec.comments.endpoint, { url: r.url as string, max_pages: cpages }, { labels: "explicit" });
    const max = Math.min(ceiling(spec.comments.endpoint, cpages, false), shares.comments - spentIn(session, "comments"));
    const rec = await session.call(`comments:${spec.platform}`, spec.comments.endpoint, params, max);
    if (rec) comments.push(rec);
  }

  // 7. transcripts
  const transcripts: VideoRun["transcripts"] = [];
  const tposts = topPosts(pick(spec.transcripts.posts));
  if (tposts.length) {
    if (spec.transcripts.batch) {
      const rec = await session.post(`transcript:${spec.platform}`, spec.transcripts.endpoint, { ids: tposts.map((r) => r.id) }, shares.transcript);
      if (rec) for (const r of tposts) pushText(rec, r);
    } else {
      for (const r of tposts) {
        const rec = await session.call(`transcript:${spec.platform}`, spec.transcripts.endpoint, { url: r.url as string }, shares.transcript - spentIn(session, "transcript"));
        if (rec) pushText(rec, r);
      }
    }
  }
  function pushText(rec: CallRecord, r: Row) {
    const text = spec.transcripts.text(rec, r);
    if (text) transcripts.push({ rowId: r.id, text, requestId: rec.requestId });
  }

  // 8. names: follower counts for the accounts the report would name
  if (spec.names) {
    const want = items.filter((i) => i.viral).map((i) => i.row).filter((r) => !followers.has(spec.groupKey(r)));
    const seen = new Set<string>();
    for (const r of want) {
      const k = spec.groupKey(r);
      if (seen.has(k) || seen.size >= pick(spec.names.max)) continue;
      seen.add(k);
      await readFollowers(r);
    }
  }

  return { topic, query, deep, searches, allRows: rows, candidates, items, unread, baselines, comments, asks: askSummary(comments), transcripts, followers };
}

function shape(spec: VideoSpec, rows: Row[], call: { endpoint: string }): Row[] {
  return spec.baselineRows ? spec.baselineRows(rows, call) : rows;
}

/** WEBVTT or SRT to plain words: cue numbers, timings and the header dropped, lines joined. */
export function vttText(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/-->/.test(l) && !/^\d+$/.test(l.trim()) && !/^(NOTE|STYLE)\b/.test(l))
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
