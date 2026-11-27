import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import { extractSkills } from "../../src/tarball.ts";

/** One 512-byte ustar header plus its padded body. */
function entry(name: string, body: string, type = "0", prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  const data = Buffer.from(body, "utf8");
  h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([h, data, pad]);
}
const pax = (records: Record<string, string>, type: string) => {
  const body = Object.entries(records)
    .map(([k, v]) => {
      const rec = ` ${k}=${v}\n`;
      let len = rec.length + 1;
      while (String(len).length + rec.length !== len) len = String(len).length + rec.length;
      return `${len}${rec}`;
    })
    .join("");
  return entry("pax_header", body, type);
};
const tarGz = (...parts: Buffer[]) => gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

describe("extractSkills", () => {
  it("writes the files under skills/ of a GitHub archive, and nothing else", () => {
    const dest = mkdtempSync(path.join(tmpdir(), "sc-tar-"));
    const gz = tarGz(
      pax({ comment: "abc123" }, "g"),
      entry("workflows-main/", "", "5"),
      entry("workflows-main/README.md", "root"),
      entry("workflows-main/skills/social-viral/", "", "5"),
      entry("workflows-main/skills/social-viral/SKILL.md", "---\nname: social-viral\n---\n"),
    );
    const files = extractSkills(gz, dest);
    assert.deepEqual(files, ["social-viral/SKILL.md"]);
    assert.equal(readFileSync(path.join(dest, "social-viral", "SKILL.md"), "utf8"), "---\nname: social-viral\n---\n");
    assert.ok(!existsSync(path.join(dest, "README.md")));
  });

  it("reads a long name from a pax header and from the ustar prefix", () => {
    const dest = mkdtempSync(path.join(tmpdir(), "sc-tar-"));
    const long = `workflows-main/skills/${"a".repeat(90)}/SKILL.md`;
    const gz = tarGz(pax({ path: long }, "x"), entry("ignored", "long one"), entry("SKILL.md", "prefixed", "0", "workflows-main/skills/b"));
    assert.deepEqual(extractSkills(gz, dest).sort(), [`${"a".repeat(90)}/SKILL.md`, "b/SKILL.md"]);
  });

  it("refuses a path that climbs out of the folder", () => {
    const dest = mkdtempSync(path.join(tmpdir(), "sc-tar-"));
    const gz = tarGz(entry("workflows-main/skills/../../evil.md", "x"), entry("workflows-main/skills/ok/SKILL.md", "ok"));
    assert.deepEqual(extractSkills(gz, dest), ["ok/SKILL.md"]);
    assert.ok(!existsSync(path.join(dest, "..", "evil.md")));
  });
});
