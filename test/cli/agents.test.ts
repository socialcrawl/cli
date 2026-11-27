import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { detectAgents, installSkills, installTargets } from "../../src/agents.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

function skillsSource() {
  const src = temp("sc-skills-");
  for (const name of ["socialcrawl", "social-viral"]) {
    mkdirSync(path.join(src, name, "examples"), { recursive: true });
    writeFileSync(path.join(src, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
    writeFileSync(path.join(src, name, "README.md"), `# ${name}\n`);
    writeFileSync(path.join(src, name, "examples", "report.md"), "# r\n");
  }
  mkdirSync(path.join(src, "not-a-skill"));
  writeFileSync(path.join(src, "stray.md"), "x");
  return src;
}

describe("detectAgents", () => {
  it("finds the agents whose home folders exist", () => {
    const home = temp("sc-home-");
    mkdirSync(path.join(home, ".claude"));
    mkdirSync(path.join(home, ".codex"));
    const found = detectAgents(home, {});
    assert.deepEqual(found.map((a) => a.id), ["claude-code", "codex"]);
  });

  it("reads CODEX_HOME when it is set", () => {
    const home = temp("sc-home-");
    const codex = temp("sc-codex-");
    assert.deepEqual(detectAgents(home, { CODEX_HOME: codex }).map((a) => a.id), ["codex"]);
  });

  it("finds nothing in an empty home", () => {
    assert.deepEqual(detectAgents(temp("sc-home-"), {}), []);
  });
});

describe("installTargets", () => {
  it("puts each agent's skills in its own global folder, sharing ~/.agents/skills once", () => {
    const home = temp("sc-home-");
    for (const d of [".claude", ".cursor", ".codex", ".gemini"]) mkdirSync(path.join(home, d));
    const t = installTargets(detectAgents(home, {}), { home, project: null });
    assert.deepEqual(t.map((x) => x.dir), [path.join(home, ".claude", "skills"), path.join(home, ".cursor", "skills"), path.join(home, ".agents", "skills")]);
    assert.deepEqual(t[2].agents, ["Codex", "Gemini CLI"]);
  });

  it("with a project, installs into the project's folders instead", () => {
    const home = temp("sc-home-");
    const project = temp("sc-proj-");
    mkdirSync(path.join(home, ".claude"));
    mkdirSync(path.join(home, ".codex"));
    const t = installTargets(detectAgents(home, {}), { home, project });
    assert.deepEqual(t.map((x) => x.dir), [path.join(project, ".claude", "skills"), path.join(project, ".agents", "skills")]);
  });
});

describe("installSkills", () => {
  it("copies every skill folder that has a SKILL.md, and overwrites an older copy", () => {
    const src = skillsSource();
    const dest = path.join(temp("sc-dest-"), "skills");
    mkdirSync(path.join(dest, "social-viral"), { recursive: true });
    writeFileSync(path.join(dest, "social-viral", "SKILL.md"), "old");
    const names = installSkills(src, dest);
    assert.deepEqual(names, ["social-viral", "socialcrawl"]);
    assert.equal(readFileSync(path.join(dest, "social-viral", "SKILL.md"), "utf8"), "---\nname: social-viral\n---\n");
    assert.ok(existsSync(path.join(dest, "socialcrawl", "examples", "report.md")));
    assert.ok(!existsSync(path.join(dest, "not-a-skill")));
    assert.ok(!existsSync(path.join(dest, "stray.md")));
  });
});
