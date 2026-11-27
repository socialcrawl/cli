// The small slice of Markdown the reports use (headings, paragraphs, lists, pipe tables,
// code, bold, links, rules), turned into HTML. Everything is escaped first, so a post's
// text can never become markup; links go to http and https only; [F1] becomes a link to
// its evidence entry when that finding exists.
import { esc } from "./theme.ts";

function inline(text: string, refs: Set<string>): string {
  const codes: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\[(F\d+)\]/g, (whole, id: string) => (refs.has(id) ? `<a class="ref" href="#${id}">${id}</a>` : whole));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** A cell that is a figure: a number with an optional x or %, unit word and finding reference. */
const FIGURE = /^(\?|\d[\d,.]*)(x|%)?(\s+[a-z]+)?(\s+\[F\d+\])?$/i;

const TABLE_RULE =/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function mdToHtml(md: string, refs: Set<string> = new Set()): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), refs)}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2], refs)}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, "").trim());
      i--;
      out.push(`<blockquote><p>${inline(quoted.filter(Boolean).join(" "), refs)}</p></blockquote>`);
      continue;
    }
    if (line.trim().startsWith("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i--;
      // A column of figures ("131x", "173,032 views", "?") is centred, its header with it.
      const num = head.map((_, c) => rows.length > 0 && rows.every((r) => !r[c] || FIGURE.test(r[c])) && rows.some((r) => r[c]));
      const cls = (c: number) => (num[c] ? ' class="num"' : "");
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => `<th${cls(k)}>${inline(c, refs)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${cls(k)}>${inline(c, refs)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }
    const item = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (item) {
      const tag = /\d/.test(item[1]) ? "ol" : "ul";
      if (para.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push(inline(item[2], refs));
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}
