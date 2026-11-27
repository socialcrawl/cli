// The coding agents init installs the workflows into, and where each reads skills from.
// Codex, Gemini CLI and GitHub Copilot share ~/.agents/skills, so it is written once.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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

/** Copy every skills/<name>/ that has a SKILL.md into `dest`, replacing an older copy. Returns the names. */
export function installSkills(source: string, dest: string): string[] {
  const names = readdirSync(source)
    .filter((n) => statSync(path.join(source, n)).isDirectory() && existsSync(path.join(source, n, "SKILL.md")))
    .sort();
  mkdirSync(dest, { recursive: true });
  for (const n of names) {
    rmSync(path.join(dest, n), { recursive: true, force: true });
    cpSync(path.join(source, n), path.join(dest, n), { recursive: true });
  }
  return names;
}
