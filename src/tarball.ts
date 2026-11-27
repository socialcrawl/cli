// The workflows' skills, read from GitHub's tar.gz archive of socialcrawl/workflows with no
// dependency: gunzip, then a small tar reader (ustar names and prefixes, pax and GNU long
// names). Only files under skills/ are written, and never outside the destination.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export const WORKFLOWS_ARCHIVE = "https://codeload.github.com/socialcrawl/workflows/tar.gz/refs/heads/main";

const str = (b: Buffer, start: number, len: number) => b.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");

function paxPath(body: Buffer): string | null {
  for (const line of body.toString("utf8").split("\n")) {
    const m = line.match(/^\d+ path=(.*)$/);
    if (m) return m[1];
  }
  return null;
}

/** Write the skills/ files of a gzipped archive into `dest`; returns their paths relative to it. */
export function extractSkills(tarGz: Buffer, dest: string): string[] {
  const tar = gunzipSync(tarGz);
  const root = path.resolve(dest);
  const written: string[] = [];
  let next: string | null = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(str(h, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "g") continue;
    if (type === "x") {
      next = paxPath(body);
      continue;
    }
    if (type === "L") {
      next = body.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    const prefix = str(h, 345, 155);
    const name = next ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    next = null;
    if (type !== "0") continue;
    // GitHub archives put everything under one "<repo>-<ref>/" folder.
    const rel = name.split("/").slice(1).join("/");
    if (!rel.startsWith("skills/")) continue;
    const inSkills = rel.slice("skills/".length);
    const target = path.resolve(root, inSkills);
    if (!inSkills || !target.startsWith(root + path.sep)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(path.relative(root, target).split(path.sep).join("/"));
  }
  return written;
}
