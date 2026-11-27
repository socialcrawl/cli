import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { RUN_FILES, runFolderName, slugify, terminalSummary, writeRunFolder } from "../../src/render/index.ts";
import { sampleRun } from "./sample.ts";

describe("writeRunFolder", () => {
  it("writes every file of the run folder", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "sc-run-")), "social-viral-ai-2026-11-27");
    const written = writeRunFolder(dir, sampleRun());
    for (const f of [...RUN_FILES, "data/posts.csv"]) assert.ok(existsSync(path.join(dir, f)), f);
    assert.equal(written.length, RUN_FILES.length + 1);
  });

  it("keeps every raw response, one per line, with its request id", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sc-run-"));
    writeRunFolder(dir, sampleRun());
    const lines = readFileSync(path.join(dir, "responses.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.requestId), ["req-1", "req-2"]);
    assert.equal(lines[0].body.request_id, "req-1");
  });

  it("writes the rows as CSV and the run block as JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sc-run-"));
    writeRunFolder(dir, sampleRun());
    assert.equal(readFileSync(path.join(dir, "data", "posts.csv"), "utf8"), "platform,author,multiple\nx,acme,41\ntiktok,globex,12\n");
    const run = JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8"));
    assert.equal(run.workflow, "social-viral");
    assert.equal(run.credits, 59);
    const ev = JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8"));
    assert.equal(ev.findings.length, 2);
  });

  it("keeps post text from running as a spreadsheet formula", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sc-run-"));
    const run = sampleRun();
    run.tables = { posts: { columns: ["text", "views"], rows: [{ text: "=HYPERLINK(\"x\")", views: -3 }, { text: "@everyone look", views: 5 }, { text: "fine", views: 1 }] } };
    writeRunFolder(dir, run);
    const csv = readFileSync(path.join(dir, "data", "posts.csv"), "utf8");
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")",-3`), csv);
    assert.ok(csv.includes("'@everyone look,5"), csv);
    assert.ok(csv.includes("fine,1"), csv);
  });

  it("keeps a table name inside data/", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sc-run-"));
    const run = sampleRun();
    run.tables = { "../escape": { columns: ["a"], rows: [{ a: 1 }] } };
    writeRunFolder(dir, run);
    assert.ok(!existsSync(path.join(dir, "..", "escape.csv")));
    assert.ok(existsSync(path.join(dir, "data", "escape.csv")));
  });
});

describe("terminalSummary", () => {
  const lines = terminalSummary(sampleRun(), "socialcrawl-runs/social-viral-ai-coding-tools-2026-11-27");
  it("fits in 12 lines", () => {
    assert.ok(lines.length <= 12, lines.join("\n"));
  });
  it("leads with the headline, then the findings", () => {
    assert.equal(lines[0], "Acme's post reached 41x its usual views");
    assert.ok(lines.some((l) => l.includes("TikTok led with 3 of the top 5")));
  });
  it("says what was not read, the cost and where the report is", () => {
    const text = lines.join("\n");
    assert.ok(/Not read: 1 call \(budget\)/.test(text), text);
    assert.ok(/Not verified: 1 item/.test(text), text);
    assert.ok(text.includes("59 credits"));
    assert.ok(text.includes(path.join("socialcrawl-runs/social-viral-ai-coding-tools-2026-11-27", "report.html")));
  });
});

describe("runFolderName", () => {
  it("is <workflow>-<slug>-<YYYY-MM-DD>", () => {
    assert.equal(runFolderName("social-viral", "AI coding tools", new Date("2026-11-27T10:00:00Z")), "social-viral-ai-coding-tools-2026-11-27");
  });
  it("slugs any input to safe, short, lower-case words", () => {
    assert.equal(slugify("  Café & Crème: the ../best!  "), "cafe-creme-the-best");
    assert.ok(slugify("a".repeat(100)).length <= 40);
    assert.equal(slugify("@@@"), "run");
  });
});
