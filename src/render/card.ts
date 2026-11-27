// card.svg: the 1200 × 675 card a person can post. The command, up to three findings the
// engine computed, what was read, and the footer "Read with SocialCrawl /<workflow> ·
// N credits · date". The logo is embedded, so the card fetches nothing; colours are hex,
// since slide tools and many viewers cannot draw oklch().
import { CARD_MAX_CHARS, CARD_MAX_HEADLINES } from "../engine/outputs.ts";
import type { CardInput } from "../engine/outputs.ts";
import { LOGO_DATA_URI, LOGO_HEIGHT, LOGO_WIDTH } from "./logo.ts";
import { wrapText } from "./svg.ts";
import { COLOR, FONT_MONO, FONT_SANS, esc } from "./theme.ts";

const W = 1200;
const H = 675;
const PAD = 72;
const TEXT_W = W - PAD * 2;
const TOP = 112;
const FOOT_H = 92;

/** Characters per line at a font size, for Figtree's average glyph width. */
const perLine = (size: number) => Math.floor(TEXT_W / (size * 0.52));

/**
 * Two lines of even length, never breaking inside a parenthesis when a break before it
 * fits; one line when it fits; otherwise a greedy wrap cut to `maxLines`.
 */
export function wrapBalanced(text: string, max: number, maxLines: number): string[] {
  const greedy = wrapText(text, max, maxLines);
  if (greedy.length !== 2) return greedy;
  const words = text.trim().split(/\s+/);
  let best: { lines: string[]; score: number } | null = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const b = words.slice(k).join(" ");
    if (a.length > max || b.length > max) continue;
    const open = (a.match(/\(/g)?.length ?? 0) - (a.match(/\)/g)?.length ?? 0);
    const score = Math.max(a.length, b.length) + (open > 0 ? 1000 : 0);
    if (!best || score < best.score) best = { lines: [a, b], score };
  }
  return best ? best.lines : greedy;
}

/** A <text> of several lines; each line but the last keeps its trailing space, so the text reads whole. */
function block(lines: string[], x: number, y: number, size: number, lineHeight: number, attrs: string): string {
  const spans = lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${esc(l)}${i < lines.length - 1 ? " " : ""}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${spans}</text>`;
}

export function renderCard675(c: CardInput): string {
  if (c.headlines.length === 0) throw new Error("A card needs at least one headline finding.");
  if (c.headlines.length > CARD_MAX_HEADLINES) throw new Error(`A card has at most ${CARD_MAX_HEADLINES} headlines, so it fits one screen.`);
  for (const h of c.headlines) if (h.length > CARD_MAX_CHARS) throw new Error(`Headline over ${CARD_MAX_CHARS} characters: "${h}"`);
  const credits = `${c.meta.credits} credit${c.meta.credits === 1 ? "" : "s"}`;

  // Lay out at the larger size when the headlines fit, then centre the block.
  const title = wrapBalanced(c.command, perLine(46), 2);
  const layout = (size: number) => c.headlines.map((h) => wrapBalanced(h, perLine(size) - 2, 2));
  let size = 36;
  let heads = layout(size);
  if (heads.flat().length > 4) heads = layout((size = 30));
  const lh = size + 10;
  const height = title.length * 54 + 28 + heads.reduce((s, l) => s + l.length * lh + 18, 0) + 40;
  const room = H - FOOT_H - TOP;
  let y = TOP + Math.max(0, Math.floor((room - height) / 2)) + 46;

  const parts: string[] = [];
  parts.push(block(title, PAD, y, 46, 54, `font-family="${FONT_SANS}" font-weight="500" letter-spacing="-0.9" fill="${COLOR.ink.hex}"`));
  y += (title.length - 1) * 54 + 28 + lh;
  for (const lines of heads) {
    parts.push(`<rect x="${PAD}" y="${y - Math.round(size * 0.62)}" width="10" height="10" rx="1" fill="${COLOR.brand.hex}"/>`);
    parts.push(block(lines, PAD + 28, y, size, lh, `font-family="${FONT_SANS}" font-weight="400" fill="${COLOR.ink.hex}"`));
    y += lines.length * lh + 18;
  }
  parts.push(block([c.basis], PAD, y + 8, 20, 28, `font-family="${FONT_MONO}" fill="${COLOR.ink2.hex}"`));

  const logoH = 34;
  const logoW = Math.round((logoH * LOGO_WIDTH) / LOGO_HEIGHT);
  const footY = H - FOOT_H;
  const name = `${c.command}: ${c.headlines.join("; ")}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}">`,
    `<rect width="${W}" height="${H}" fill="${COLOR.canvas.hex}"/>`,
    `<image href="${LOGO_DATA_URI}" x="${PAD}" y="56" width="${logoW}" height="${logoH}"/>`,
    ...parts,
    `<rect x="0" y="${footY}" width="${W}" height="${FOOT_H}" fill="${COLOR.band.hex}"/>`,
    `<line x1="0" y1="${footY}" x2="${W}" y2="${footY}" stroke="${COLOR.line.hex}" stroke-width="1"/>`,
    block([`Read with SocialCrawl /${c.skill} · ${credits} · ${c.meta.date}`], PAD, footY + 38, 22, 28, `font-family="${FONT_SANS}" font-weight="500" fill="${COLOR.ink.hex}"`),
    block(wrapText(`Run it yourself: ${c.rerun}`, Math.floor(TEXT_W / (17 * 0.62)), 1), PAD, footY + 68, 17, 24, `font-family="${FONT_MONO}" fill="${COLOR.muted.hex}"`),
    `</svg>`,
    "",
  ].join("\n");
}
