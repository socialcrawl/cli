// Runs every compiled test file with node --test. Node 20 and Node 22 read
// glob arguments differently, so the files are listed here instead.
// Pass a substring to run only matching files: node scripts/run-tests.mjs render
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".test-build", "test");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".test.js") ? [p] : [];
  });
}

const only = process.argv[2];
const files = walk(root).filter((f) => !only || f.includes(only)).sort();
if (files.length === 0) {
  console.error(`No test files found under ${root}${only ? ` matching "${only}"` : ""}.`);
  process.exit(1);
}
const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
