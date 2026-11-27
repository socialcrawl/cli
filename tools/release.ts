// The checks before a release (Node 22.18 or later runs this file as it is).
//
//   node tools/release.ts                 on the maintainer's machine, before tagging: runs the
//                                         leak gate (SOCIALCRAWL_LEAK_GATE=<path to the gate>),
//                                         the whole suite, the build, and the package checks
//   node tools/release.ts --ci --tag vX.Y.Z --notes <file>
//                                         in the release workflow: the suite has run; checks the
//                                         tag, the package and its contents, writes the notes
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { changelogSection, keyShaped, packProblems, tagProblems } from "./release-lib.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { ci: { type: "boolean", default: false }, tag: { type: "string" }, notes: { type: "string" } } });
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// npm.cmd needs a shell on Windows; node's own path may hold a space, so it never gets one.
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: cmd === npm && process.platform === "win32" });
const problems: string[] = [];

if (!values.ci) {
  const gate = process.env.SOCIALCRAWL_LEAK_GATE;
  if (!gate) {
    console.error("Set SOCIALCRAWL_LEAK_GATE to the leak gate script. A release is never tagged without it.");
    process.exit(1);
  }
  run(process.execPath, [gate, root]);
  run(npm, ["test"]);
  run(npm, ["run", "build"]);
}

const tag = values.tag ?? `v${pkg.version}`;
problems.push(...tagProblems(tag, pkg.version, changelog));

const packed = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" })) as { files: { path: string }[] }[];
const files = packed[0].files.map((f) => f.path.split(path.sep).join("/"));
problems.push(...packProblems(files));
for (const f of files) {
  const found = keyShaped(readFileSync(path.join(root, f), "utf8"));
  if (found.length) problems.push(`${f} holds a key-shaped string`);
}

if (problems.length) {
  for (const p of problems) console.error(`release: ${p}`);
  process.exit(1);
}
if (values.notes) writeFileSync(values.notes, (changelogSection(changelog, tag.slice(1)) ?? "") + "\n");
console.log(`release: ${tag} is ready, ${files.length} files in the package.`);
if (!values.ci) console.log(`Tag and push it to publish: git tag ${tag} && git push origin ${tag}`);
