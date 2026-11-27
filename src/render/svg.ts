// Inline SVG for the report: horizontal bars in the logo's petal colour, one series, each
// bar labelled with its value, a native hover title, and a link to its evidence entry.
// No chart library, no script. Rules from DESIGN.md §7: thin marks, mono labels, no
// legend inside the plot, bars rounded no more than 1px.
import type { BarChart } from "./types.ts";
import { COLOR, FONT_MONO, FONT_SANS, esc } from "./theme.ts";

/** 41.25 -> "41.3", 1130 -> "1,130". */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const r = Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10;
  return r.toLocaleString("en-GB");
}

/** Greedy word wrap at `max` characters; past `maxLines` the last line ends with "…". */
export function wrapText(text: string, max: number, maxLines = Infinity): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > max) {
      if (cur) lines.push(cur);
      lines.push(w.slice(0, max));
      w = w.slice(max);
      cur = "";
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length + 1 > max) last = last.slice(0, last.lastIndexOf(" ") > 0 ? last.lastIndexOf(" ") : max - 1);
  kept[maxLines - 1] = last.replace(/[\s,;:.]+$/, "") + "…";
  return kept;
}

const LABEL_W = 220;
const VALUE_W = 72;
const ROW = 28;
const GAP = 10;

export function barChartSvg(chart: BarChart, width = 720): string {
  if (chart.bars.length === 0) return "";
  const top = Math.max(...chart.bars.map((b) => b.value), 0);
  const plot = width - LABEL_W - VALUE_W;
  const height = chart.bars.length * (ROW + GAP) - GAP;
  const unit = chart.unit ?? "";
  const rows = chart.bars.map((b, i) => {
    const y = i * (ROW + GAP);
    const w = top > 0 ? Math.max(1, (b.value / top) * plot) : 1;
    const value = `${formatNumber(b.value)}${unit}`;
    const label = b.label.length > 30 ? b.label.slice(0, 29) + "…" : b.label;
    const tip = `${b.label}: ${value}${b.note ? ` (${b.note})` : ""}`;
    const g = [
      `<g>`,
      `<title>${esc(tip)}</title>`,
      `<text x="0" y="${y + ROW / 2 + 5}" font-family="${FONT_SANS}" font-size="14" fill="${COLOR.ink.hex}">${esc(label)}</text>`,
      `<rect class="bar" x="${LABEL_W}" y="${y + 4}" width="${w.toFixed(1)}" height="${ROW - 8}" rx="1" fill="${COLOR.brandDeep.hex}"/>`,
      `<text x="${(LABEL_W + w + 8).toFixed(1)}" y="${y + ROW / 2 + 5}" font-family="${FONT_MONO}" font-size="12" fill="${COLOR.ink2.hex}">${esc(value)}</text>`,
      `</g>`,
    ].join("");
    return b.finding ? `<a href="#${esc(b.finding)}">${g}</a>` : g;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(chart.title)}">`,
    `<line x1="${LABEL_W}" y1="0" x2="${LABEL_W}" y2="${height}" stroke="${COLOR.line.hex}" stroke-width="1"/>`,
    ...rows,
    `</svg>`,
  ].join("\n");
}
