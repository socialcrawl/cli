// What a video did, read from its row: length band, hook, sound, comment gate, posting hour.
// The report counts these among the break-outs and among the rest; a trait is called a
// pattern only by the engine's contrast() (24 settled posts at least).
import type { Row } from "../../engine/index.ts";

const SHORT_BANDS: [number, string][] = [
  [15, "under 15 s"],
  [30, "15 to 30 s"],
  [60, "30 to 60 s"],
  [180, "1 to 3 min"],
];
const LONG_BANDS: [number, string][] = [
  [300, "under 5 min"],
  [600, "5 to 10 min"],
  [1200, "10 to 20 min"],
];

/** The length band; YouTube's long uploads have their own bands. Null without a duration. */
export function lengthBand(r: Row): string | null {
  const d = r.durationSeconds;
  if (d === null || !Number.isFinite(d) || d <= 0) return null;
  if (r.platform === "youtube" && r.format === "long") return LONG_BANDS.find(([max]) => d < max)?.[1] ?? "20 min or more";
  return SHORT_BANDS.find(([max]) => d < max)?.[1] ?? "3 min or more";
}

/** The first line or sentence of a caption or title, without its hashtags; null when nothing is left. */
export function hookOf(text: string): string | null {
  const line = text.split(/\r?\n/).map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, "").trim()).find((l) => l.length > 0) ?? "";
  const sentence = line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
  const s = sentence.trim();
  if (!s) return null;
  return s.length <= 100 ? s : s.slice(0, 100).replace(/\s+\S*$/, "");
}

export type HookType = "question" | "number" | "how-to" | "first-person" | "warning" | "pov" | "news" | "statement";

/** The kind of hook, by its first words. Checked in this order; the first match wins. */
export function hookType(text: string): HookType | null {
  const h = hookOf(text);
  if (!h) return null;
  const s = h.toLowerCase();
  if (/^pov\b/.test(s)) return "pov";
  if (/^(stop|don'?t|never|avoid|quit)\b|\bmistakes?\b/.test(s)) return "warning";
  if (/^how (to|i|we)\b/.test(s)) return "how-to";
  if (/^(top\s+)?\d+\b/.test(s)) return "number";
  if (/^(i|we|i'm|i've|we've|my)\b/.test(s)) return "first-person";
  // "Anthropic just dropped ...": news of a release, the hook file 18 saw lead TikTok.
  if (/\bjust (dropped|released|launched|made|announced|shipped|open[- ]?sourced|leaked)\b/.test(s)) return "news";
  if (/\?$/.test(s) || /^(why|what|which|who|when|is|are|can|do|does|should)\b/.test(s)) return "question";
  return "statement";
}

/** "Comment X to get the guide": a reward gated behind a comment (study file 18: 7 of 13 Instagram posts). */
export function commentGated(text: string): boolean {
  return /\bcomment\s+["“'‘]?[A-Z0-9]{2,}["”'’]?(?=\s|$|[,.!])/.test(text) || /\bcomment\s+["“'‘]?\w+["”'’]?\s+(and|to|for)\s+(i'?ll|i will|get|receive|we'?ll)\b/i.test(text);
}

/** The creator's own sound, or licensed music (Instagram music rows say nothing of origin: they are licensed tracks). */
export function soundKind(r: Row): "original" | "licensed" | null {
  if (!r.sound) return null;
  return r.sound.original === true ? "original" : "licensed";
}

export function hourUtc(r: Row): number | null {
  if (!r.publishedAt) return null;
  const t = Date.parse(r.publishedAt);
  return Number.isFinite(t) ? new Date(t).getUTCHours() : null;
}

/** The traits the report counts, each as a string value, or null where the row cannot say. */
export function traitsOf(r: Row): { length: string | null; hook: HookType | null; sound: "original" | "licensed" | null; gated: "yes" | "no" } {
  return { length: lengthBand(r), hook: hookType(r.text), sound: soundKind(r), gated: commentGated(r.text) ? "yes" : "no" };
}
