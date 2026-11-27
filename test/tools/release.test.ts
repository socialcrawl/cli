import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changelogSection, keyShaped, packedFiles, packProblems, tagProblems } from "../../tools/release-lib.ts";

const CHANGELOG = ["# Changelog", "", "## Unreleased", "", "- next thing", "", "## 0.1.0 (27/11/2026)", "", "- First release.", "- init.", "", "## 0.0.9 (01/11/2026)", "", "- old"].join("\n");

describe("changelogSection", () => {
  it("returns a version's entries, without its heading", () => {
    assert.equal(changelogSection(CHANGELOG, "0.1.0"), "- First release.\n- init.");
  });
  it("is null for a version with no entry", () => {
    assert.equal(changelogSection(CHANGELOG, "0.2.0"), null);
  });
});

describe("tagProblems", () => {
  it("passes a tag that matches package.json and a dated changelog entry", () => {
    assert.deepEqual(tagProblems("v0.1.0", "0.1.0", CHANGELOG), []);
  });
  it("names each mismatch", () => {
    assert.deepEqual(tagProblems("v0.1.1", "0.1.0", CHANGELOG), ["tag v0.1.1 does not match package.json version 0.1.0", "CHANGELOG.md has no entry for 0.1.1"]);
    assert.deepEqual(tagProblems("0.1.0", "0.1.0", CHANGELOG), ['tag 0.1.0 must start with "v"']);
  });
  it("refuses an entry still marked unreleased", () => {
    const md = CHANGELOG.replace("## 0.1.0 (27/11/2026)", "## 0.1.0 (unreleased)");
    assert.deepEqual(tagProblems("v0.1.0", "0.1.0", md), ["CHANGELOG.md's 0.1.0 entry has no release date (DD/MM/YYYY)"]);
  });
});

describe("packProblems", () => {
  const good = ["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "dist/cli.js", "dist/engine/rows.js"];
  it("passes a package of the build and its notices", () => {
    assert.deepEqual(packProblems(good), []);
  });
  it("refuses sources, tests, fixtures and env files, and a package without the CLI", () => {
    const p = packProblems(["package.json", "README.md", "LICENSE", "src/cli.ts", "test/x.test.ts", "test/fixtures/a.json", ".env"]);
    assert.ok(p.includes("dist/cli.js is missing"));
    assert.ok(p.includes("THIRD_PARTY_NOTICES.md is missing"));
    for (const f of ["src/cli.ts", "test/x.test.ts", "test/fixtures/a.json", ".env"]) assert.ok(p.includes(`${f} should not be published`), f);
  });
});

describe("keyShaped", () => {
  it("finds a string shaped like a SocialCrawl key, and nothing in ordinary text", () => {
    const fake = "sc_" + "Live_" + "Ab3".repeat(14);
    assert.deepEqual(keyShaped(`const k = "${fake}";`), [fake]);
    assert.deepEqual(keyShaped("sc_Test_notarealkey6789 and sc_ alone"), []);
  });
});

describe("packedFiles", () => {
  const entry = { name: "socialcrawl", version: "0.1.0", files: [{ path: "package.json" }, { path: "dist\\cli.js" }] };
  it("reads npm 11's output, a list of packages", () => {
    assert.deepEqual(packedFiles(JSON.stringify([entry])), ["package.json", "dist/cli.js"]);
  });
  it("reads npm 12's output, an object keyed by package name", () => {
    assert.deepEqual(packedFiles(JSON.stringify({ socialcrawl: entry })), ["package.json", "dist/cli.js"]);
  });
  it("throws a plain error when the output has no package in it", () => {
    assert.throws(() => packedFiles("{}"), /npm pack --json listed no package/);
  });
});
