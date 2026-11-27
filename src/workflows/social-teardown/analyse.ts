// Everything after the calls, for any platform. Pure: it reads kept records and rows, never
// the network. The method is REA's (github.com/morluto/rea, MIT): every conclusion says
// whether it was seen, inferred or unknown, and cites the request it was read from; a count
// never claims a cause.
import { contrast, median } from "../../engine/breakout.ts";
import type { Breakout, Contrast, Feature } from "../../engine/breakout.ts";
import type { Row } from "../../engine/rows.ts";
import { commentsOf } from "../../engine/rows.ts";
import type { AccountRun } from "./account.ts";
import { profileOf } from "./platforms.ts";
import type { Profile } from "./platforms.ts";
import type { TaggedRecord } from "./tracker.ts";
import { hookOf } from "./x/codebook.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function durationBand(r: Row): string {
  if (!r.video) return "not a video";
  const s = r.durationSeconds;
  if (s === null) return "video, length unknown";
  if (s < 15) return "under 15 s";
  if (s <= 60) return "15 to 60 s";
  if (s <= 180) return "1 to 3 min";
  return "over 3 min";
}

/** The first line's type, with the codebook's hook rules (a rule match, not an intention). */
export function firstLineType(r: Row): string {
  return hookOf(r.text);
}

const hourOf = (r: Row) => (r.publishedAt ? String(new Date(r.publishedAt).getUTCHours()).padStart(2, "0") : null);
const dayOf = (r: Row) => (r.publishedAt ? WEEKDAYS[new Date(r.publishedAt).getUTCDay()] : null);

/** The features the top third is compared on against the bottom third. */
export const FEATURES: Record<string, Feature> = {
  length: durationBand,
  "first line": firstLineType,
  "weekday (UTC)": dayOf,
  "hour band (UTC)": (r) => {
    const h = hourOf(r);
    if (h === null) return null;
    const n = Number(h);
    return n < 6 ? "00 to 05" : n < 12 ? "06 to 11" : n < 18 ? "12 to 17" : "18 to 23";
  },
  "tags an account": (r) => (/@[\w.]{2,}/.test(r.text) ? "yes" : "no"),
  "links out": (r) => (/https?:\/\//.test(r.text) ? "yes" : "no"),
};

export interface Count {
  key: string;
  n: number;
}

export function postingHours(rows: Row[]): { hours: Count[]; weekdays: Count[] } {
  const count = (f: (r: Row) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = f(r);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  };
  return { hours: count(hourOf), weekdays: count(dayOf) };
}

const PLATFORM_HOSTS = /(^|\.)(x\.com|twitter\.com|t\.co|tiktok\.com|instagram\.com|youtube\.com|youtu\.be|linkedin\.com|lnkd\.in|reddit\.com|redd\.it|threads\.net|threads\.com|facebook\.com)$/;

const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Where the account sends people: each linked domain, from the bio and from the posts, the platforms' own left out. */
export function linkDomains(bioLinks: string[], rows: Row[]): { domain: string; bio: number; posts: number }[] {
  const m = new Map<string, { domain: string; bio: number; posts: number }>();
  const add = (u: string, where: "bio" | "posts") => {
    const d = domainOf(u.replace(/[.,;:!?)]+$/, ""));
    if (!d || PLATFORM_HOSTS.test(d)) return;
    const e = m.get(d) ?? { domain: d, bio: 0, posts: 0 };
    e[where]++;
    m.set(d, e);
  };
  for (const u of bioLinks) add(u, "bio");
  for (const r of rows) for (const u of new Set(r.text.match(/https?:\/\/[^\s)\]>"']+/g) ?? [])) add(u, "posts");
  return [...m.values()].sort((a, b) => b.bio + b.posts - (a.bio + a.posts) || a.domain.localeCompare(b.domain));
}

export interface CommentRead {
  postId: string;
  read: number;
  /** How many the platform says there are, when it says. */
  of: number | null;
  /** The API's free label shares: question, purchase_intent, complaint; null where it abstained. */
  shares: Record<string, number | null>;
  /** Up to two quoted comments per label, with no name and no leading @mentions. */
  receipts: { label: string; text: string }[];
  /** How many comments the account itself wrote under the post. */
  ownReplies: number;
  requestId: string | null;
}

const unname = (t: string) => t.replace(/^(@[\w.]+\s+)+/, "").replace(/@[\w.]+/g, "@…").replace(/\s+/g, " ").trim().slice(0, 140);

/** The comment reads, and how many accounts commented under two or more of the posts read (counted, never named). */
export function commentReads(records: TaggedRecord[], handle: string): CommentRead[] & { repeat: number } {
  const me = handle.replace(/^@/, "").toLowerCase();
  const out: CommentRead[] = [];
  const seen = new Map<string, Set<string>>();
  for (const r of records.filter((x) => x.stage === "comments" && x.status === 200)) {
    const d: any = r.body.data ?? {};
    const rows = commentsOf(r);
    const shares: Record<string, number | null> = {};
    const receipts: { label: string; text: string }[] = [];
    for (const [k, v] of Object.entries<any>(d.label_share?.presets ?? {})) {
      if (k === "sentiment") continue;
      shares[k] = typeof v?.share === "number" ? v.share : null;
      for (const x of (v?.receipts ?? []).slice(0, 2)) if (x?.text) receipts.push({ label: k, text: unname(String(x.text)) });
    }
    const postId = r.meta.post_id ?? "";
    for (const c of rows) {
      const a = c.author.replace(/^@/, "").toLowerCase();
      if (!a || a === me) continue;
      if (!seen.has(a)) seen.set(a, new Set());
      seen.get(a)!.add(postId);
    }
    out.push({ postId, read: rows.length, of: typeof d.total === "number" ? d.total : null, shares, receipts, ownReplies: rows.filter((c) => c.author.replace(/^@/, "").toLowerCase() === me).length, requestId: r.requestId });
  }
  return Object.assign(out, { repeat: [...seen.values()].filter((s) => s.size >= 2).length });
}

export interface TranscriptRead {
  postId: string;
  kind: "transcript" | "screen_text";
  opening: string | null;
  words: number | null;
  status: number;
  reason: string | null;
  requestId: string | null;
}

/** The text of a transcript answer, whatever its shape (a string, segments, or texts on screen). */
function wordsOf(d: any): string {
  if (!d) return "";
  if (typeof d.transcript === "string") return d.transcript;
  if (Array.isArray(d.transcript)) return d.transcript.map((s: any) => s?.text ?? "").join(" ");
  if (Array.isArray(d.texts)) return d.texts.map((s: any) => (typeof s === "string" ? s : s?.text ?? "")).join(" ");
  if (typeof d.text === "string") return d.text;
  return "";
}

export function transcriptReads(records: TaggedRecord[]): TranscriptRead[] {
  return records
    .filter((r) => r.stage === "words" || r.stage === "transcript")
    .map((r) => {
      const kind: TranscriptRead["kind"] = /screen-text/.test(r.endpoint) ? "screen_text" : "transcript";
      const err: any = (r.body as any).error;
      const text = r.status === 200 ? wordsOf(r.body.data).replace(/\s+/g, " ").trim() : "";
      if (!text) {
        const reason = r.status === 200 ? "no words came back (no speech, or captions not published)" : `${r.status}: ${String(err?.message ?? err?.type ?? "no answer").split(/(?<=[.!?])\s/)[0]}`;
        return { postId: r.meta.post_id ?? "", kind, opening: null, words: null, status: r.status, reason, requestId: r.requestId };
      }
      const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
      return { postId: r.meta.post_id ?? "", kind, opening: first.slice(0, 200), words: text.split(/\s+/).length, status: r.status, reason: null, requestId: r.requestId };
    });
}

export interface Group {
  key: string;
  n: number;
  median: number | null;
}

function groupMedian(rows: Row[], key: (r: Row) => string | null, metric: "views" | "likes"): Group[] {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const v = metric === "views" ? r.views : r.likes;
    if (!m.has(k)) m.set(k, []);
    if (v !== null) m.get(k)!.push(v);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, n: v.length, median: median(v) })).sort((a, b) => b.n - a.n);
}

export interface AccountAnalysis {
  account: string;
  platform: string;
  handle: string;
  metric: "views" | "likes";
  profile: Profile;
  profileRequest: string | null;
  posts: Row[];
  others: number;
  first: string | null;
  last: string | null;
  timelineRequests: string[];
  /** Posts read against the profile's own count, when it gives one. */
  ofTotal: number | null;
  outliers: { row: Row; breakout: Breakout }[];
  /**
   * Break-outs whose likes per 1,000 views are under a fifth of the account's median: views far
   * ahead of likes, as promoted posts look. Inferred, shown, never used to leave a post out.
   */
  unusual: { row: Row; perThousand: number; accountMedian: number }[];
  /** Every post's multiple, null where it has none. */
  multiples: Record<string, number | null>;
  /** Posts with too few earlier comparable posts for a multiple. */
  tooFew: number;
  /** Posts whose earlier posts' median is under the engine's MIN_BASE: too few views to compare. */
  baseTooSmall: number;
  /** The median of the metric over all the posts read. */
  medianMetric: number | null;
  /** The share of the metric the outliers carry. */
  outlierShare: number | null;
  byLength: Group[];
  byFirstLine: Group[];
  contrast: Contrast;
  hours: Count[];
  weekdays: Count[];
  /** Median days between posts. */
  gapDays: number | null;
  links: { domain: string; bio: number; posts: number }[];
  comments: CommentRead[];
  repeatCommenters: number;
  words: TranscriptRead[];
  /** On TikTok: the share of the top posts on the account's own sound. */
  sounds: { original: number; borrowed: number; top: string[] } | null;
}

/** An account run as the analysis needs it: any adapter that names the metric (X's included). */
export type AnalysisInput = Omit<AccountRun, "adapter"> & { adapter: { metric: "views" | "likes" } };

export function analyseAccount(run: AnalysisInput, now: Date): AccountAnalysis {
  const { target, adapter, records, own } = run;
  const metric = adapter.metric;
  const profRec = records.find((r) => r.stage === "profile" && r.status === 200) ?? null;
  const profile = profileOf(profRec);
  const posts = own.slice().sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
  const val = (r: Row) => (metric === "views" ? r.views : r.likes);
  const pairs = run.breakouts.map((b) => ({ breakout: b, row: own.find((r) => r.id === b.id)! })).filter((p) => p.row);
  const outliers = pairs.filter((p) => p.breakout.band === "beat").sort((a, b) => (b.breakout.multiple ?? 0) - (a.breakout.multiple ?? 0));
  const total = posts.reduce((s, r) => s + (val(r) ?? 0), 0);
  const outSum = outliers.reduce((s, p) => s + (val(p.row) ?? 0), 0);
  const times = posts.map((r) => Date.parse(r.publishedAt ?? "")).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86_400_000);
  const hw = postingHours(posts);
  const comments = commentReads(records, target.handle);
  const tiktokSounds = (() => {
    if (target.platform !== "tiktok") return null;
    const rec = records.filter((r) => r.stage === "timeline" && r.status === 200);
    const music = new Map<string, { original: boolean; title: string }>();
    for (const r of rec) for (const it of ((r.body.data as any)?.items ?? []) as any[]) {
      const p = it?.post;
      if (p?.id) music.set(String(p.id), { original: p.ext?.music_is_original === true, title: String(p.ext?.music_title ?? "") });
    }
    const top = outliers.slice(0, 10).map((o) => music.get(o.row.id)).filter((m): m is { original: boolean; title: string } => Boolean(m));
    return { original: top.filter((m) => m.original).length, borrowed: top.filter((m) => !m.original).length, top: top.filter((m) => !m.original).map((m) => m.title).filter(Boolean).slice(0, 5) };
  })();
  const perK = (r: Row) => (r.views && r.views > 0 && r.likes !== null ? (r.likes / r.views) * 1000 : null);
  const accountPerK = median(posts.map(perK).filter((v): v is number => v !== null));
  const unusual =
    metric === "views" && accountPerK !== null && accountPerK > 0
      ? outliers
          .filter((o) => (o.row.views ?? 0) >= 10_000 && perK(o.row) !== null && (perK(o.row) as number) < accountPerK / 5)
          .map((o) => ({ row: o.row, perThousand: Math.round((perK(o.row) as number) * 100) / 100, accountMedian: Math.round(accountPerK * 100) / 100 }))
      : [];
  return {
    account: `${target.platform}:${target.handle.toLowerCase()}`,
    platform: target.platform,
    handle: target.handle,
    metric,
    profile,
    profileRequest: profRec?.requestId ?? null,
    posts,
    others: run.others.length,
    first: posts[0]?.publishedAt ?? null,
    last: posts[posts.length - 1]?.publishedAt ?? null,
    timelineRequests: [...new Set(records.filter((r) => r.stage === "timeline" && r.status === 200).map((r) => r.requestId).filter((x): x is string => Boolean(x)))],
    ofTotal: profile.posts,
    outliers,
    unusual,
    multiples: Object.fromEntries(pairs.map((p) => [p.row.id, p.breakout.multiple])),
    tooFew: pairs.filter((p) => p.breakout.band === "too_few").length,
    baseTooSmall: pairs.filter((p) => p.breakout.band === "base_too_small").length,
    medianMetric: median(posts.map(val).filter((v): v is number => v !== null)),
    outlierShare: total > 0 ? Math.round((outSum / total) * 1000) / 1000 : null,
    byLength: groupMedian(posts, durationBand, metric),
    byFirstLine: groupMedian(posts, firstLineType, metric),
    contrast: contrast(pairs, FEATURES, { now }),
    hours: hw.hours,
    weekdays: hw.weekdays,
    gapDays: gaps.length ? Math.round((median(gaps) ?? 0) * 10) / 10 : null,
    links: linkDomains(profile.links, posts),
    comments,
    repeatCommenters: comments.repeat,
    words: transcriptReads(records),
    sounds: tiktokSounds,
  };
}
