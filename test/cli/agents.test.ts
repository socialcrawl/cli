import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { detectAgents, installSkills, installTargets } from "../../src/agents.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

const OURS = "metadata:\n  source: https://github.com/socialcrawl/workflows\n";
const ourSkill = (name: string) => `---\nname: ${name}\n${OURS}---\n`;

function skillsSource() {
  const src = temp("sc-skills-");
  for (const name of ["socialcrawl-workflows", "socialcrawl-viral"]) {
    mkdirSync(path.join(src, name, "examples"), { recursive: true });
    writeFileSync(path.join(src, name, "SKILL.md"), ourSkill(name));
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
  it("copies every skill folder that has a SKILL.md, and overwrites an older copy of ours", () => {
    const src = skillsSource();
    const dest = path.join(temp("sc-dest-"), "skills");
    mkdirSync(path.join(dest, "socialcrawl-viral"), { recursive: true });
    writeFileSync(path.join(dest, "socialcrawl-viral", "SKILL.md"), `---\nname: socialcrawl-viral\n${OURS}---\nold\n`);
    const r = installSkills(src, dest);
    assert.deepEqual(r.installed, ["socialcrawl-viral", "socialcrawl-workflows"]);
    assert.deepEqual(r.kept, []);
    assert.equal(readFileSync(path.join(dest, "socialcrawl-viral", "SKILL.md"), "utf8"), ourSkill("socialcrawl-viral"));
    assert.ok(existsSync(path.join(dest, "socialcrawl-workflows", "examples", "report.md")));
    assert.ok(!existsSync(path.join(dest, "not-a-skill")));
    assert.ok(!existsSync(path.join(dest, "stray.md")));
  });

  it("never replaces a skill of the same name from somewhere else, and says so", () => {
    const src = skillsSource();
    const dest = path.join(temp("sc-dest-"), "skills");
    mkdirSync(path.join(dest, "socialcrawl-viral"), { recursive: true });
    writeFileSync(path.join(dest, "socialcrawl-viral", "SKILL.md"), "---\nname: socialcrawl-viral\n---\nsomeone else's\n");
    const r = installSkills(src, dest);
    assert.deepEqual(r.installed, ["socialcrawl-workflows"]);
    assert.deepEqual(r.kept, ["socialcrawl-viral"]);
    assert.equal(readFileSync(path.join(dest, "socialcrawl-viral", "SKILL.md"), "utf8"), "---\nname: socialcrawl-viral\n---\nsomeone else's\n");
  });

  it("removes the workflow skills 0.1.0 installed under their old names, and keeps anyone else's", () => {
    const dest = path.join(temp("sc-dest-"), "skills");
    for (const n of ["social-viral", "reddit-marketing"]) mkdirSync(path.join(dest, n), { recursive: true });
    writeFileSync(path.join(dest, "social-viral", "SKILL.md"), ourSkill("social-viral"));
    writeFileSync(path.join(dest, "reddit-marketing", "SKILL.md"), "---\nname: reddit-marketing\n---\nsomeone else's\n");
    const r = installSkills(skillsSource(), dest);
    assert.deepEqual(r.removed, ["social-viral"]);
    assert.ok(!existsSync(path.join(dest, "social-viral")));
    assert.equal(readFileSync(path.join(dest, "reddit-marketing", "SKILL.md"), "utf8"), "---\nname: reddit-marketing\n---\nsomeone else's\n");
  });

  it("leaves the socialcrawl API skill alone, and removes the router 0.1.0 installed under that name", () => {
    const api = "---\nname: socialcrawl\nmetadata:\n  source: https://github.com/socialcrawl/skills\n---\n";
    const withApi = path.join(temp("sc-dest-"), "skills");
    mkdirSync(path.join(withApi, "socialcrawl"), { recursive: true });
    writeFileSync(path.join(withApi, "socialcrawl", "SKILL.md"), api);
    assert.deepEqual(installSkills(skillsSource(), withApi).removed, []);
    assert.equal(readFileSync(path.join(withApi, "socialcrawl", "SKILL.md"), "utf8"), api);

    const withOldRouter = path.join(temp("sc-dest-"), "skills");
    mkdirSync(path.join(withOldRouter, "socialcrawl"), { recursive: true });
    writeFileSync(path.join(withOldRouter, "socialcrawl", "SKILL.md"), ourSkill("socialcrawl"));
    assert.deepEqual(installSkills(skillsSource(), withOldRouter).removed, ["socialcrawl"]);
    assert.ok(!existsSync(path.join(withOldRouter, "socialcrawl")));
  });
});
