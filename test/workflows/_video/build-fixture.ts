// Builds a public replay fixture from a live run's responses.jsonl: every body through
// anonymise(), and the request params too (a small account's handle or link in a params block
// is aliased the same way). Run by hand, never by the suite:
//   node test/workflows/_video/build-fixture.ts <responses.jsonl> <out.json> <mask-words.txt> [keep,keep]
// mask-words.txt holds one word per line to replace with "[tool]" wherever it appears (the
// names a public file must not carry); it is kept outside the repository.
import { readFileSync, writeFileSync } from "node:fs";

import { anonymise } from "./anonymise.ts";

const [src, out, maskFile, keepArg] = process.argv.slice(2);
if (!src || !out || !maskFile) throw new Error("usage: build-fixture.ts <responses.jsonl> <out.json> <mask-words.txt> [keep,...]");
const keep = (keepArg ?? "").split(",").filter(Boolean);
const words = readFileSync(maskFile, "utf8").split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
const maskRe = words.length ? new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi") : null;
/** Every string in a value, masked; post-level `computed` blocks (unread by the engine) dropped. */
function clean(v: unknown, key = ""): unknown {
  if (typeof v === "string") return maskRe ? v.replace(maskRe, "[tool]") : v;
  if (Array.isArray(v)) return v.map((x) => clean(x));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const outObj: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if (k === "computed" && "post" in o) continue;
      if (k === "dropped_ids" || k === "pending_ids") continue;
      outObj[k] = clean(x, k);
    }
    return outObj;
  }
  void key;
  return v;
}
const lines = readFileSync(src, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// Who may keep their name: 10,000 followers or more on any row, or on the keep list.
const big = new Set(keep.map((k) => k.toLowerCase()));
for (const l of lines) for (const it of l.body?.data?.items ?? []) {
  const u = it?.post?.author?.username;
  const f = it?.post?.ext?.author_followers ?? it?.post?.author?.followers;
  if (typeof u === "string" && typeof f === "number" && f >= 10_000) big.add(u.toLowerCase());
}

const aliases = new Map<string, string>();
const alias = (handle: string) => {
  const k = `u:${handle.toLowerCase()}`;
  if (!aliases.has(k)) aliases.set(k, `u${String([...aliases.keys()].filter((x) => x.startsWith("u:")).length + 1).padStart(3, "0")}`);
  return aliases.get(k) as string;
};
// A cursor can encode a handle, so each one becomes "cursor-N", the same in a body and in the
// params of the call that followed it.
const cursors = new Map<string, string>();
const cursorOf = (c: unknown) => {
  const k = String(c);
  if (!cursors.has(k)) cursors.set(k, `cursor-${cursors.size + 1}`);
  return cursors.get(k) as string;
};
const records = lines.map((l) => {
  const next = l.body?.pagination?.next_cursor ?? null;
  const dataNext = l.body?.data?.next_cursor ?? null;
  const a = anonymise({ endpoint: l.endpoint, response: l.body }, { keep: [...big], aliases });
  if (next !== null && a.response.pagination) a.response.pagination.next_cursor = cursorOf(next);
  if (dataNext !== null && a.response.data) a.response.data.next_cursor = cursorOf(dataNext);
  const params = { ...l.params };
  if (params.cursor !== undefined) params.cursor = cursorOf(params.cursor);
  if (typeof params.handle === "string" && !big.has(params.handle.toLowerCase())) params.handle = alias(params.handle);
  if (typeof params.url === "string") {
    const m = params.url.match(/@([\w.]+)\/(?:video|reel)\/(\w+)/);
    if (m && !big.has(m[1].toLowerCase())) params.url = `https://example.invalid/${alias(m[1])}/${m[2]}`;
  }
  return clean({ stage: l.stage, endpoint: l.endpoint, params, status: l.status, requestId: l.requestId, creditsUsed: l.creditsUsed, at: l.at, body: a.response });
});
writeFileSync(out, JSON.stringify(records, null, 1) + "\n");
console.log(`${records.length} records, ${aliases.size} aliases, ${big.size} accounts kept by name`);
