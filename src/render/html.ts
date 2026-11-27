// report.html: one page that works offline. The text is the engine's own report.md turned
// into HTML, so the two never disagree; around it go the stat tiles, the charts, every
// finding with its request ids, what was not read, the run folder's files and the card.
import { CONFIDENCE_LABEL } from "../engine/evidence.ts";
import { renderReport } from "../engine/outputs.ts";
import { renderCard675 } from "./card.ts";
import { LOGO_DATA_URI, LOGO_HEIGHT, LOGO_WIDTH } from "./logo.ts";
import { mdToHtml } from "./markdown.ts";
import { barChartSvg } from "./svg.ts";
import { COLOR, FONT_MONO, FONT_SANS, esc } from "./theme.ts";
import type { RunOutput } from "./types.ts";

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:${COLOR.canvas.css};color:${COLOR.ink.css};font:16px/1.55 ${FONT_SANS};-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;padding:48px 40px 96px}
header{display:flex;flex-direction:column;gap:12px;padding-bottom:32px;border-bottom:1px solid ${COLOR.line.css}}
header img{height:20px;width:auto;align-self:flex-start}
h1{font-size:40px;line-height:1.1;letter-spacing:-0.025em;font-weight:500;margin:16px 0 0;text-wrap:balance}
h2{font-size:24px;line-height:1.25;letter-spacing:-0.018em;font-weight:500;margin:48px 0 16px;text-wrap:balance}
h3{font-size:18px;font-weight:500;margin:32px 0 8px}
p,li{max-width:66ch;text-wrap:pretty}
.badge{font:13px/1.45 ${FONT_MONO};color:${COLOR.muted.css};margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:${COLOR.line.css};border:1px solid ${COLOR.line.css};border-radius:14px;overflow:hidden;margin:32px 0 0}
.tile{display:flex;flex-direction:column;gap:4px;padding:20px 24px;background:${COLOR.canvas.css};color:inherit;text-decoration:none}
a.tile:hover{background:${COLOR.band.css}}
.tile .v{font-size:36px;line-height:1;letter-spacing:-0.04em;font-weight:500}
.tile .l{font:12px/1.45 ${FONT_MONO};color:${COLOR.muted.css}}
figure{margin:24px 0;padding:24px;border:1px solid ${COLOR.lineSoft.css};border-radius:14px;overflow-x:auto}
figcaption{font-weight:500;margin-bottom:16px}
figure svg{display:block;min-width:560px;width:100%;max-width:960px;height:auto}
figure svg a:hover rect{fill:${COLOR.ink.css}}
.table-wrap{overflow-x:auto;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid ${COLOR.lineSoft.css};vertical-align:top}
td.num,th.num{text-align:center;white-space:nowrap}
th{font:12px/1.45 ${FONT_MONO};color:${COLOR.muted.css};font-weight:500;border-bottom-color:${COLOR.line.css}}
code,pre{font:13px/1.45 ${FONT_MONO}}
code{background:${COLOR.band.css};padding:1px 4px;border-radius:4px}
pre{background:${COLOR.band.css};padding:16px;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0}
a{color:${COLOR.ink.css}}
a.ref{font:12px ${FONT_MONO};color:${COLOR.signal.css};text-decoration:none;padding:0 2px}
a.ref:hover{text-decoration:underline}
.ev{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.ev li{max-width:none;padding:16px 20px;border:1px solid ${COLOR.lineSoft.css};border-radius:8px}
.ev li:target{border-color:${COLOR.ink.css};background:${COLOR.brandSoft.css}}
.ev .id{font:12px ${FONT_MONO};color:${COLOR.signal.css};margin-right:8px}
.ev .m{font:12px/1.6 ${FONT_MONO};color:${COLOR.muted.css};margin-top:6px;overflow-wrap:anywhere}
.files{columns:2;font:13px/1.9 ${FONT_MONO}}
.card{margin-top:16px;border:1px solid ${COLOR.line.css};border-radius:14px;overflow:hidden;max-width:600px}
.card svg{display:block;width:100%;height:auto}
blockquote{margin:16px 0;padding:2px 0 2px 16px;border-left:2px solid ${COLOR.line.css};color:${COLOR.ink2.css}}
blockquote p{margin:0}
hr{border:0;border-top:1px solid ${COLOR.line.css};margin:48px 0 16px}
hr+p{font:13px/1.45 ${FONT_MONO};color:${COLOR.muted.css}}
@media (max-width:640px){main{padding:32px 16px 64px}h1{font-size:30px}.files{columns:1}}
`;

function tilesHtml(run: RunOutput): string {
  if (!run.tiles?.length) return "";
  const tiles = run.tiles.map((t) => {
    const inner = `<span class="v">${esc(t.value)}</span><span class="l">${esc(t.label)}</span>`;
    return t.finding ? `<a class="tile" href="#${esc(t.finding)}">${inner}</a>` : `<div class="tile">${inner}</div>`;
  });
  return `<section class="tiles" aria-label="Key numbers">${tiles.join("")}</section>`;
}

function chartsHtml(run: RunOutput): string {
  return (run.charts ?? [])
    .filter((c) => c.bars.length)
    .map((c) => `<figure><figcaption>${esc(c.title)}</figcaption>${barChartSvg(c)}</figure>`)
    .join("\n");
}

function evidenceHtml(run: RunOutput): string {
  const items = run.report.evidence.findings.map((f) => {
    const meta = [CONFIDENCE_LABEL[f.confidence], f.requests.length ? `requests ${f.requests.join(", ")}` : "no request", ...(f.method ? [f.method] : []), ...f.limitations].map(esc).join(" · ");
    return `<li id="${esc(f.id)}"><span class="id">${esc(f.id)}</span> ${esc(f.claim)}<div class="m">${meta}</div></li>`;
  });
  return items.length ? `<h2>Evidence</h2><ol class="ev">${items.join("")}</ol>` : "";
}

function notReadHtml(run: RunOutput): string {
  const lines = [
    ...run.run.notRead.map((n) => `${n.stage}, ${n.endpoint}: not sent (${n.reason})`),
    ...run.run.errors.map((e) => `${e.stage}, ${e.endpoint}: the API answered ${e.status ?? "an error"}${e.requestId ? ` (${e.requestId})` : ""}: ${e.message}`),
  ];
  if (!lines.length) return "";
  return `<h2>Calls this run did not complete</h2><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

function filesHtml(run: RunOutput): string {
  const files = [
    ["report.md", "this report as text"],
    ["card.svg", "the card"],
    ...Object.keys(run.tables).map((t) => [`data/${tableFileName(t)}.csv`, `${run.tables[t].rows.length.toLocaleString("en-GB")} rows`]),
    ["responses.jsonl", `${run.records.length} raw responses`],
    ["evidence.json", "each claim and its requests"],
    ["run.json", "inputs, cost, calls"],
  ];
  return `<h2>The run folder</h2><ul class="files">${files.map(([f, d]) => `<li><a href="${esc(f)}">${esc(f)}</a> ${esc(d)}</li>`).join("")}</ul>`;
}

/** A table's file name: lower-case words, never a path. */
export function tableFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "") || "table";
}

export function renderReportHtml(run: RunOutput): string {
  const md = renderReport(run.report);
  // The title and badge are drawn in the header; the rest of the Markdown follows.
  const lines = md.split("\n");
  const rest = lines.slice(lines.findIndex((l) => l.startsWith("## "))).join("\n");
  const refs = new Set(run.report.evidence.findings.map((f) => f.id));
  const body = mdToHtml(rest, refs);
  // The charts go after the summary, before the workflow's own sections.
  const second = body.indexOf("<h2>", body.indexOf("<h2>") + 1);
  const charts = chartsHtml(run);
  const withCharts = second === -1 ? body + charts : body.slice(0, second) + charts + "\n" + body.slice(second);
  const footer = withCharts.lastIndexOf("<hr>");
  const main = footer === -1 ? withCharts : withCharts.slice(0, footer);
  const tail = footer === -1 ? "" : withCharts.slice(footer);
  const logoH = 20;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(run.report.command)}</title>`,
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    "<main>",
    "<header>",
    `<img src="${LOGO_DATA_URI}" alt="SocialCrawl" width="${Math.round((logoH * LOGO_WIDTH) / LOGO_HEIGHT)}" height="${logoH}">`,
    `<h1>${esc(run.report.command)}</h1>`,
    `<p class="badge">${esc(run.report.badge)}</p>`,
    "</header>",
    tilesHtml(run),
    main,
    evidenceHtml(run),
    notReadHtml(run),
    filesHtml(run),
    `<h2>The card</h2><div class="card">${renderCard675(run.card)}</div>`,
    tail,
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
