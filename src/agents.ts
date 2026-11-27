// The coding agents init installs the workflows into, and where each reads skills from.
// Codex, Gemini CLI and GitHub Copilot share ~/.agents/skills, so it is written once.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export interface Agent {
  id: string;
  name: string;
  /** The global skills folder. */
  dir: string;
  /** The skills folder inside a project. */
  projectDir: string;
}

interface AgentSpec {
  id: string;
  name: string;
  home: (home: string, env: Record<string, string | undefined>) => string;
  dir: (home: string) => string;
  projectDir: string;
}

const SHARED = (home: string) => path.join(home, ".agents", "skills");

const AGENTS: AgentSpec[] = [
  { id: "claude-code", name: "Claude Code", home: (h) => path.join(h, ".claude"), dir: (h) => path.join(h, ".claude", "skills"), projectDir: path.join(".claude", "skills") },
  { id: "cursor", name: "Cursor", home: (h) => path.join(h, ".cursor"), dir: (h) => path.join(h, ".cursor", "skills"), projectDir: path.join(".agents", "skills") },
  { id: "codex", name: "Codex", home: (h, env) => env.CODEX_HOME || path.join(h, ".codex"), dir: SHARED, projectDir: path.join(".agents", "skills") },
  { id: "gemini-cli", name: "Gemini CLI", home: (h) => path.join(h, ".gemini"), dir: SHARED, projectDir: path.join(".agents", "skills") },
  { id: "github-copilot", name: "GitHub Copilot", home: (h) => path.join(h, ".copilot"), dir: SHARED, projectDir: path.join(".agents", "skills") },
];

export const AGENT_NAMES = AGENTS.map((a) => a.name);

export function detectAgents(home: string, env: Record<string, string | undefined>): Agent[] {
  return AGENTS.filter((a) => existsSync(a.home(home, env))).map((a) => ({ id: a.id, name: a.name, dir: a.dir(home), projectDir: a.projectDir }));
}

/** One folder per place to write, with the agents that read it. */
export function installTargets(agents: Agent[], o: { home: string; project: string | null }): { dir: string; agents: string[] }[] {
  const out: { dir: string; agents: string[] }[] = [];
  for (const a of agents) {
    const dir = o.project ? path.join(o.project, a.projectDir) : a.dir;
    const t = out.find((x) => x.dir === dir);
    if (t) t.agents.push(a.name);
    else out.push({ dir, agents: [a.name] });
  }
  return out;
}

const WORKFLOWS_SOURCE = "source: https://github.com/socialcrawl/workflows";
/** Skill folders 0.1.0 installed and this release no longer ships. Its router was called
 * socialcrawl, the API skill's name; the workflow skills have been socialcrawl-<task> since. */
const RETIRED = [
  "socialcrawl",
  "social-viral",
  "social-pulse",
  "social-presence",
  "social-teardown",
  "video-teardown",
  "reddit-marketing",
  "x-marketing",
  "tiktok-marketing",
  "instagram-marketing",
  "youtube-marketing",
  "linkedin-marketing",
  "competitor-research",
  "post-tracker",
];

/** Whether the skill folder at `dir` was installed from socialcrawl/workflows. */
function ours(dir: string): boolean {
  const file = path.join(dir, "SKILL.md");
  return existsSync(file) && readFileSync(file, "utf8").includes(WORKFLOWS_SOURCE);
}

/**
 * Copy every skills/<name>/ that has a SKILL.md into `dest`. A folder already there is replaced
 * only when it came from socialcrawl/workflows; anyone else's skill of the same name is kept.
 */
export function installSkills(source: string, dest: string): { installed: string[]; kept: string[]; removed: string[] } {
  const names = readdirSync(source)
    .filter((n) => statSync(path.join(source, n)).isDirectory() && existsSync(path.join(source, n, "SKILL.md")))
    .sort();
  mkdirSync(dest, { recursive: true });
  const installed: string[] = [];
  const kept: string[] = [];
  for (const n of names) {
    const target = path.join(dest, n);
    if (existsSync(target) && !ours(target)) {
      kept.push(n);
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(path.join(source, n), target, { recursive: true });
    installed.push(n);
  }
  const removed = RETIRED.filter((n) => !names.includes(n) && ours(path.join(dest, n)));
  for (const n of removed) rmSync(path.join(dest, n), { recursive: true, force: true });
  return { installed, kept, removed };
}
