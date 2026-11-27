import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanEnv, parseInstalled, skillsAddArgs } from "../../src/skills-add.ts";

describe("npx skills add", () => {
  it("asks for every skill in socialcrawl/workflows, for the agents found, globally, as JSON", () => {
    assert.deepEqual(skillsAddArgs(["claude-code", "codex"], true), ["-y", "skills", "add", "socialcrawl/workflows", "--skill", "*", "--agent", "claude-code", "codex", "--global", "--yes", "--json"]);
  });

  it("leaves out --global for a project install", () => {
    assert.ok(!skillsAddArgs(["cursor"], false).includes("--global"));
  });

  it("strips the npm variables npx sets, so the nested npx starts clean, and keeps the rest", () => {
    const env = cleanEnv({ npm_command: "exec", npm_config_yes: "true", INIT_CWD: "/x", PROJECT_CWD: "/y", PATH: "/bin", DO_NOT_TRACK: "1" });
    assert.deepEqual(env, { PATH: "/bin", DO_NOT_TRACK: "1" });
  });

  it("reads the names of the skills it installed from the JSON", () => {
    const stdout = JSON.stringify([
      { name: "socialcrawl-pulse", status: "installed" },
      { name: "socialcrawl-viral", status: "installed" },
      { name: "socialcrawl-teardown", status: "failed" },
    ]);
    assert.deepEqual(parseInstalled(stdout), ["socialcrawl-pulse", "socialcrawl-viral"]);
  });

  it("finds the JSON after any banner text", () => {
    assert.deepEqual(parseInstalled('note\n[{"name":"socialcrawl-viral","status":"installed"}]\n'), ["socialcrawl-viral"]);
  });

  it("returns null for output that is not the JSON list", () => {
    assert.equal(parseInstalled("Error: no skills found"), null);
    assert.equal(parseInstalled('{"error":"x"}'), null);
  });
});
