// card.svg: the 1200 × 675 card a person can post. The command, up to three findings the
// engine computed, what was read, and the footer "Read with SocialCrawl /<workflow> ·
// N credits · date". The logo is embedded, so the card fetches nothing.
import { CARD_MAX_CHARS, CARD_MAX_HEADLINES } from "../engine/outputs.ts";
import type { CardInput } from "../engine/outputs.ts";
import { LOGO_DATA_URI, LOGO_HEIGHT, LOGO_WIDTH } from "./logo.ts";
import { wrapText } from "./svg.ts";
import { COLOR, FONT_MONO, FONT_SANS, esc } from "./theme.ts";

const W = 1200;
const H = 675;
const PAD = 72;
const TEXT_W = W - PAD * 2;

/** Characters per line at a font size, for Figtree's average glyph width. */
const perLine = (size: number) => Math.floor(TEXT_W / (size * 0.52));

function block(lines: string[], x: number, y: number, size: number, lineHeight: number, attrs: string): string {
  const spans = lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${esc(l)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${spans}</text>`;
}

export function renderCard675(c: CardInput): string {
  if (c.headlines.length === 0) throw new Error("A card needs at least one headline finding.");
  if (c.headlines.length > CARD_MAX_HEADLINES) throw new Error(`A card has at most ${CARD_MAX_HEADLINES} headlines, so it fits one screen.`);
  for (const h of c.headlines) if (h.length > CARD_MAX_CHARS) throw new Error(`Headline over ${CARD_MAX_CHARS} characters: "${h}"`);
  const credits = `${c.meta.credits} credit${c.meta.credits === 1 ? "" : "s"}`;
  const logoH = 34;
  const logoW = Math.round((logoH * LOGO_WIDTH) / LOGO_HEIGHT);
  const parts: string[] = [];
  let y = 168;
  const title = wrapText(c.command, perLine(46), 2);
  parts.push(block(title, PAD, y, 46, 54, `font-family="${FONT_SANS}" font-weight="500" letter-spacing="-0.9" fill="${COLOR.ink.hex}"`));
  y += (title.length - 1) * 54 + 66;
  for (const h of c.headlines) {
    const lines = wrapText(h, perLine(30) - 2, 2);
    parts.push(`<rect x="${PAD}" y="${y - 20}" width="10" height="10" rx="1" fill="${COLOR.brand.hex}"/>`);
    parts.push(block(lines, PAD + 28, y - 8, 30, 40, `font-family="${FONT_SANS}" font-weight="400" fill="${COLOR.ink.hex}"`));
    y += lines.length * 40 + 16;
  }
  parts.push(block([c.basis], PAD, y + 18, 20, 28, `font-family="${FONT_MONO}" fill="${COLOR.ink2.hex}"`));
  const footY = H - 92;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${COLOR.canvas.hex}"/>`,
    `<image href="${LOGO_DATA_URI}" x="${PAD}" y="56" width="${logoW}" height="${logoH}"/>`,
    ...parts,
    `<rect x="0" y="${footY}" width="${W}" height="92" fill="${COLOR.band.hex}"/>`,
    `<line x1="0" y1="${footY}" x2="${W}" y2="${footY}" stroke="${COLOR.line.hex}" stroke-width="1"/>`,
    block([`Read with SocialCrawl /${c.skill} · ${credits} · ${c.meta.date}`], PAD, footY + 38, 22, 28, `font-family="${FONT_SANS}" font-weight="500" fill="${COLOR.ink.hex}"`),
    block(wrapText(`Run it yourself: ${c.rerun}`, Math.floor(TEXT_W / (17 * 0.62)), 1), PAD, footY + 68, 17, 24, `font-family="${FONT_MONO}" fill="${COLOR.muted.hex}"`),
    `</svg>`,
    "",
  ].join("\n");
}
