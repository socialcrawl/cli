// video-teardown: one video link in; out, how it did against its creator's own earlier videos, a
// storyboard of what is on screen and what is said in the same time windows, its words, its sound,
// and what the comments ask. The report holds the measured blocks only; what each beat does is the
// agent's reading, which SKILL.md asks it to mark as inferred (study file 15a, 6.4; file 21, 2.10).
import { Evidence, rateOf } from "../../engine/index.ts";
import type { CardInput, Meta, ReportInput } from "../../engine/index.ts";
import type { Session } from "../../kit/record.ts";
import type { Table, WorkflowResult } from "../../render/types.ts";
import type { Workflow, WorkflowArgs, WorkflowQuote } from "../types.ts";
import { ASK_CLASSES, ASK_LABEL } from "../_video/comments.ts";
import { accountLabel, mayName, NAME_MIN_FOLLOWERS } from "../_video/naming.ts";
import { times } from "../_video/report.ts";
import { dmy } from "../_video/window.ts";
import { DEPTH, ENDPOINTS, FRAMES_ALL_MAX_SECONDS, runTeardown, videoOf } from "./run.ts";
import type { Teardown } from "./run.ts";
import { beatStep, clip, hookOf, storyboardOf, wordsPerMinute } from "./storyboard.ts";

export const REPORT_SECTIONS = ["How it did", "Storyboard", "The words", "The sound", "What the comments ask", "Next plays"];
const PLATFORM: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };
const n = (x: number | null) => (x === null ? "unknown" : x.toLocaleString("en-GB"));
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const tick = (s: string) => "`" + s.replace(/`/g, "'").replace(/\s+/g, " ").trim() + "`";
const plural = (k: number, w: string) => `${w}${k === 1 ? "" : "s"}`;
const secs = (x: number | null) => (x === null ? "unknown length" : x >= 120 ? `${Math.floor(x / 60)} min ${Math.round(x % 60)} s` : `${Math.round(x)} s`);

function teardownResult(t: Teardown, session: Session, quoteDeep: WorkflowQuote): WorkflowResult {
  const meta: Meta = session.meta();
  const ev = new Evidence();
  ev.seeRequests(session.ledger.requestIds());
  for (const rec of session.records) if (rec.status === 200) ev.cover(rec, rec.stage);
  const P = PLATFORM[t.ref.platform];
  const r = t.row;
  const who = accountLabel({ platform: t.ref.platform, handle: r.author || null, followers: t.followers });
  const named = mayName(t.followers);
  // A video link carries its creator's handle: under 10,000 followers it stays in data/post.csv only.
  const link = named ? t.url : "<the video link>";
  const whoSized = named ? `${who} (${n(t.followers)} followers)` : who;
  const subject = named ? `${who}'s video` : `The video, by ${who},`;
  const unit = t.baseline?.metric === "likes" ? "likes" : "views";
  const postIds = session.records.filter((x) => x.stage.startsWith("post:")).map((x) => x.requestId).filter((x): x is string => Boolean(x));

  const F1 = ev.add({
    claim: `The video: ${n(r.views)} views, ${n(r.likes)} likes, ${n(r.comments)} comments.`,
    confidence: "seen",
    numbers: { views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, followers: t.followers, seconds: r.durationSeconds, nameMin: NAME_MIN_FOLLOWERS },
    requests: postIds,
    rows: [r.id],
  });
  const b = t.baseline;
  const FB = b
    ? ev.add({
        claim: t.multiple !== null ? `${times(t.multiple)} its creator's usual ${unit}.` : b.band === "base_too_small" ? `No multiple: the creator's earlier videos had a median under the floor.` : `No multiple: too few earlier videos to compare.`,
        confidence: "seen",
        numbers: Object.fromEntries(Object.entries({ multiple: t.multiple, median: b.median, shown: b.median === null ? null : Math.round(b.median), peers: b.peers, value: unit === "likes" ? r.likes : r.views }).filter(([, v]) => v !== null)),
        requests: b.requestIds.length ? b.requestIds : postIds,
        method: `${unit} over the median of the creator's earlier comparable videos published before it`,
      })
    : null;

  const words = t.words;
  const screen = t.screen;
  const beats = storyboardOf(screen, words, r.durationSeconds);
  const hook = hookOf(screen, words);
  const wpm = wordsPerMinute(words, r.durationSeconds);
  const FS = screen.items.length
    ? ev.add({ claim: `${screen.items.length} on-screen ${plural(screen.items.length, "text")} read.`, confidence: "seen", numbers: { texts: screen.items.length, step: beatStep(r.durationSeconds), beats: beats.length, moreInHook: hook.moreOnScreen }, requests: t.screenRequestId ? [t.screenRequestId] : postIds })
    : null;
  const FW = words.state === "words" ? ev.add({ claim: `${n(words.wordCount)} words transcribed.`, confidence: "seen", numbers: { words: words.wordCount, perMinute: wpm, segments: words.segments.length, step: beatStep(r.durationSeconds), beats: beats.length }, requests: t.wordsRequestId ? [t.wordsRequestId] : postIds }) : null;
  const asks = t.asks;
  const FC = asks.read ? ev.add({ claim: `${asks.read} comments read; ${asks.labelled} labelled.`, confidence: "seen", numbers: { read: asks.read, labelled: asks.labelled, questions: asks.classes.question.count, buying: asks.classes.purchase_intent.count, complaints: asks.classes.complaint.count }, requests: asks.requestIds }) : null;
  const FT = beats.length && !FS && !FW ? ev.add({ claim: "Storyboard beats.", confidence: "seen", numbers: { step: beatStep(r.durationSeconds), beats: beats.length }, requests: postIds }) : null;
  const beatRef = (FS ?? FW ?? FT)!;

  // What could not be read
  if (screen.state === "no_frames") ev.unknown({ what: `What is on screen`, why: `${P} gives no frames here, so only the words are read` });
  if (screen.state === "cover") ev.unknown({ what: "On-screen text after the cover", why: `frames=all reads videos of ${FRAMES_ALL_MAX_SECONDS} s or less, and this one runs ${secs(r.durationSeconds)}` });
  if (screen.state === "not_read") ev.unknown({ what: "On-screen text", why: "the screen read failed; see How this was read" });
  if (words.state === "not_read") ev.unknown({ what: "The words", why: t.transcriptError ? `no transcript: ${t.transcriptError}` : "no transcript was read" });
  if (words.state === "words" && !words.timed) ev.unknown({ what: "When each word is said", why: `${P}'s transcript has no times` });
  if (!b) ev.unknown({ what: "How it did against its creator's earlier videos", why: "no earlier videos could be read" });
  ev.unknown({ what: "What each beat does (hook, proof, call to action)", why: "not measured: it is a reading of the storyboard, to be marked inferred" });
  for (const e of session.errors) if (!e.stage.startsWith("words:")) ev.unknown({ what: `${e.stage} failed`, why: `${e.status ?? "no status"} ${e.message}`.trim() });

  const sections: ReportInput["sections"] = [];
  const published = r.publishedAt ? dmy(r.publishedAt) : "an unknown date";
  sections.push({
    title: "How it did",
    body: [
      `${whoSized.charAt(0).toUpperCase()}${whoSized.slice(1)} posted this ${P} video on ${published}, ${secs(r.durationSeconds)} [${F1.id}].`,
      "",
      table(
        ["Views", "Likes", "Comments", "Shares", "Saves", `× its creator's usual ${unit}`, "Baseline"],
        [[n(r.views), n(r.likes), n(r.comments), n(r.shares), n(r.saves), t.multiple !== null ? times(t.multiple) : "no multiple", b && b.median !== null ? `median of ${n(Math.round(b.median))} ${unit} over ${b.peers} earlier videos${b.from && b.to ? `, ${dmy(b.from)} to ${dmy(b.to)}` : ""}` : b ? `${b.peers} earlier videos: too few or too small to compare` : "not read"]],
      ),
      "",
      named && r.url ? `Link: ${r.url}` : `The link is in data/post.csv.`,
    ].join("\n"),
  });

  const noFrames = screen.state === "no_frames" ? `${P} gives no frames here, so the storyboard holds the words alone. ` : screen.state === "none" ? "The frames were read and show no text. " : screen.state === "cover" ? `Only the cover was read for on-screen text: frames=all reads videos of ${FRAMES_ALL_MAX_SECONDS} s or less. ` : "";
  // Read after "It opens with": what is on screen in the first 3 seconds, then the first words.
  const hookLine = [hook.onScreen.length ? `${hook.onScreen.map(tick).join(", ")}${hook.moreOnScreen ? ` and ${hook.moreOnScreen} more` : ""} on screen` : null, hook.said ? `the words ${tick(hook.said)}` : null].filter(Boolean).join(", and ");
  sections.push({
    title: "Storyboard",
    body: beats.length
      ? [
          `${noFrames}What is on screen and what is said, in beats of ${beatStep(r.durationSeconds)} s [${beatRef.id}].${hookLine ? ` It opens with ${hookLine}.` : ""}`,
          "",
          // A beat's start as m:ss (one token, so the column never wraps); a column whose source
          // has no times is left out rather than filled with dashes.
          table(
            ["Time", ...(screen.state === "timed" ? ["On screen"] : []), ...(words.timed ? ["Said"] : [])],
            beats.map((x) => [`${Math.floor(x.from / 60)}:${String(x.from % 60).padStart(2, "0")}`, ...(screen.state === "timed" ? [clip(x.onScreen.join(" · "), 160) || "-"] : []), ...(words.timed ? [clip(x.said.join(" "), 220) || "-"] : [])]),
          ),
          screen.state !== "timed" && screen.items.length ? `\nOn the ${screen.state === "cover" ? "cover" : "screen, untimed"}: ${screen.items.slice(0, 12).map((i) => tick(i.text)).join(", ")}${screen.items.length > 12 ? `, and more in data/screen.csv` : ""} [${FS!.id}].` : "",
          "",
          "What each beat does (the hook, the proof, the turn, the call to action) is not measured here: it is a reading of this table.",
        ].join("\n")
      : [
          screen.state === "no_frames" ? `${P} gives no frames, and ${words.state === "words" ? `its transcript has no times` : "no words were read"}, so there is no storyboard.${hookLine ? ` It opens with ${hookLine}.` : ""}` : `No storyboard: neither the on-screen text nor the words carry times.${hookLine ? ` It opens with ${hookLine}.` : ""}`,
          screen.items.length ? "\nOn screen" + (screen.state === "cover" ? " (the cover)" : "") + ": " + screen.items.map((i) => tick(i.text)).join(", ") + (FS ? ` [${FS.id}].` : ".") : "",
        ].join("\n"),
  });

  const excerpt = words.text.split(/\s+/).slice(0, 80).join(" ");
  sections.push({
    title: "The words",
    body:
      words.state === "words"
        ? [`${n(words.wordCount)} words${wpm !== null ? `, ${wpm} a minute` : ""}${words.timed ? "" : `; ${P}'s transcript has no times`} [${FW!.id}]. The full transcript is in data/transcript.csv.`, "", `> ${excerpt}${words.wordCount > 80 ? " …" : ""}`].join("\n")
        : words.state === "no_speech"
          ? "No speech: the transcript came back empty, so the words on screen carry the video, or it is music only."
          : `No transcript was read${t.transcriptError ? ` (${t.transcriptError.replace(/\d+/g, "")})`.replace(/\(\s+/, "(") : ""}. The words are unknown, not absent.`,
  });

  sections.push({
    title: "The sound",
    body: t.sound
      ? `${tick(t.sound.title ?? "unknown")}${t.sound.original === true ? ", the creator's own sound" : t.sound.original === false ? ", a sound from the library that others can use" : ""} [${F1.id}].`
      : `${P} gives no sound name here.`,
  });

  sections.push({
    title: "What the comments ask",
    body: FC ? [`Comments labelled by the API; commenters are never named [${FC.id}].`, "", table(["Kind", "Comments", "Most liked"], ASK_CLASSES.map((k) => [ASK_LABEL[k], String(asks.classes[k].count), asks.classes[k].quotes.map((q) => `"${q.text}"`).join(" · ") || "none"]))].join("\n") : "No comments were read in this run.",
  });

  const cmd = (rest: string) => `\`npx -y socialcrawl@latest ${rest}\``;
  const plays: string[][] = [[`Track it: its ${unit} again in a few days`, cmd(`post-tracker ${named && r.url ? r.url : link}`), "whether it is still growing"]];
  if (named && r.author) plays.push(["Read how its creator grows", cmd(`social-teardown @${r.author}`), "the videos that carried the account"]);
  if (!t.deep) plays.push(["Read more comments", cmd(`video-teardown ${link} --deep`), `free quote first: about ${quoteDeep.expected} credits, at most ${quoteDeep.max}`]);
  sections.push({ title: "Next plays", body: table(["Play", "Command", "What to check"], plays) });

  const summary: string[] = [];
  summary.push(
    t.multiple !== null
      ? `${subject} has ${n(unit === "likes" ? r.likes : r.views)} ${unit}, ${times(t.multiple)} its creator's usual ${unit}${b?.median != null ? ` (a median of ${n(Math.round(b.median))} over ${b.peers} earlier videos)` : ""} [${FB!.id}].`
      : `${subject} has ${n(r.views)} views; no multiple against its creator's earlier videos [${(FB ?? F1).id}].`,
  );
  if (hookLine) summary.push(`It opens with ${hookLine} [${beatRef?.id ?? F1.id}].`);
  if (words.state === "words") summary.push(`${n(words.wordCount)} words${wpm !== null ? `, ${wpm} a minute` : ""} [${FW!.id}].`);
  else if (words.state === "no_speech") summary.push("No speech: the transcript came back empty.");
  if (screen.state === "no_frames") summary.push(`${P} gives no frames, so on-screen text is not read.`);
  if (FC) summary.push(`${asks.classes.question.count} ${plural(asks.classes.question.count, "question")} and ${asks.classes.complaint.count} ${plural(asks.classes.complaint.count, "complaint")} in ${asks.read} ${plural(asks.read, "comment")} read [${FC.id}].`);

  const fit = (s: string) => (s.length <= 110 ? s : s.slice(0, 109).replace(/\s+\S*$/, "") + "…");
  const card: CardInput = {
    command: `/video-teardown ${link}`,
    skill: "video-teardown",
    headlines: [
      fit(t.multiple !== null ? `${n(r.views)} views, ${times(t.multiple)} its creator's usual` : `${n(r.views)} views; no multiple against earlier videos`),
      ...(hook.onScreen[0] || hook.said ? [fit(`Opens with "${hook.onScreen[0] ?? hook.said}"`)] : []),
      fit(words.state === "words" ? `${n(words.wordCount)} words${wpm !== null ? `, ${wpm} a minute` : ""}${t.sound?.title ? `; sound: ${t.sound.title}` : ""}` : words.state === "no_speech" ? "No speech: the screen carries it" : "Words not read"),
    ].slice(0, 3),
    basis: `${P} video, ${secs(r.durationSeconds)}, ${b ? `${b.peers} earlier videos` : "no baseline"}, ${asks.read} comments`,
    meta,
    rerun: `npx -y socialcrawl@latest video-teardown ${link}`,
  };
  const report: ReportInput = {
    command: card.command,
    skill: "video-teardown",
    badge: `${P} · ${who} · ${published} · ${secs(r.durationSeconds)} · ${t.deep ? "deep" : "default"} run`,
    summary,
    sections,
    evidence: ev,
    meta,
    methodNotes: [
      "The multiple is the video's views (likes where views are not shown) over the median of its creator's earlier comparable videos published before it; under 8 such videos, or a median under 100 views, no multiple is given.",
      `The storyboard puts the on-screen text the API read off the frames (TikTok and Instagram; frames=all up to ${FRAMES_ALL_MAX_SECONDS} s) and the transcript's timed lines into the same windows. YouTube and X give no frames, and Instagram's and X's transcripts have no times.`,
      `Accounts under ${n(NAME_MIN_FOLLOWERS)} followers are described, not named or linked; commenters are never named.`,
    ],
  };

  const tables: Record<string, Table> = {
    post: { columns: ["id", "url", "platform", "author", "followers", "published_at", "seconds", "views", "likes", "comments", "shares", "saves", "multiple", "baseline_median", "baseline_peers", "sound", "request_id"], rows: [{ id: r.id, url: r.url, platform: t.ref.platform, author: r.author, followers: t.followers, published_at: r.publishedAt, seconds: r.durationSeconds, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, multiple: t.multiple, baseline_median: b?.median ?? null, baseline_peers: b?.peers ?? null, sound: t.sound?.title ?? null, request_id: postIds[0] ?? null }] },
    transcript: { columns: ["start", "end", "text"], rows: words.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })) },
    screen: { columns: ["at_seconds", "text"], rows: screen.items.map((i) => ({ at_seconds: i.at, text: i.text })) },
  };
  return {
    card,
    report,
    tiles: [
      { label: "Views", value: n(r.views) },
      { label: "× usual", value: t.multiple !== null ? times(t.multiple) : "-", finding: FB?.id },
      { label: "Words", value: words.state === "words" ? n(words.wordCount) : words.state === "no_speech" ? "none" : "-" },
      { label: "Credits", value: n(meta.credits) },
    ],
    charts: [],
    tables,
  };
}

function teardownQuote(args: WorkflowArgs): WorkflowQuote {
  const ref = videoOf(args.input);
  const ep = ENDPOINTS[ref.platform];
  const d = args.deep ? DEPTH.deep : DEPTH.default;
  const lines: string[] = [];
  let expected = 0;
  let max = 0;
  const stage = (name: string, e: number, m: number) => {
    expected += e;
    max += m;
    lines.push(`${name}: about ${e} credits (at most ${m})`);
  };
  stage("the video", rateOf(ref.endpoint).page, rateOf(ref.endpoint).page);
  if (ref.platform === "youtube" || ref.platform === "instagram") stage("its creator's size", 0, 1);
  const base = ref.platform === "tiktok" ? 3 : ref.platform === "instagram" ? 2 * rateOf("instagram/profile/reels").page : ref.platform === "x" ? 2 : 1;
  stage("its creator's earlier videos", base, base);
  if (ep.screen) stage("on-screen text", 10, 10);
  stage("the words", rateOf(ep.words).page, rateOf(ep.words).page);
  const c = rateOf(ep.comments).page;
  stage("comments", c * d.commentPages, c * d.commentPages);
  lines.push(`Total: about ${expected} credits, at most ${max}.`);
  return { expected, max, lines };
}

export const workflow: Workflow = {
  name: "video-teardown",
  summary: "One video taken apart: how it did against its creator's earlier videos, a storyboard of what is on screen and said, its words, sound and comments.",
  usage: "socialcrawl video-teardown <video link: TikTok, YouTube, Instagram or X> [--deep]",
  examples: ["socialcrawl video-teardown https://www.tiktok.com/@<account>/video/<id>", "socialcrawl video-teardown https://www.youtube.com/watch?v=<id>", "socialcrawl video-teardown https://www.instagram.com/reel/<code>/ --deep"],
  defaultBudget: 60,
  deepBudget: 100,
  takesWindow: false,
  options: {},
  quote: teardownQuote,
  async run(session, args) {
    const t = await runTeardown(session, args);
    return teardownResult(t, session, teardownQuote({ ...args, deep: true }));
  },
};
