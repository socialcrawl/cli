// Installs the workflows with the skills installer (`npx skills add`), the same command a person
// would type. That installer tells skills.sh which skills were installed from a public repo, so
// each install counts on the skill's page there; DISABLE_TELEMETRY or DO_NOT_TRACK turns that off.
import { spawn } from "node:child_process";

export const WORKFLOWS_REPO = "socialcrawl/workflows";

export type SkillsAdd = (args: string[], o: { env: Record<string, string | undefined>; cwd: string }) => Promise<{ code: number; stdout: string }>;

/** npx arguments: every skill in socialcrawl/workflows, for these agents, without prompts, as JSON. */
export function skillsAddArgs(agentIds: string[], global: boolean): string[] {
  return ["-y", "skills", "add", WORKFLOWS_REPO, "--skill", "*", "--agent", ...agentIds, ...(global ? ["--global"] : []), "--yes", "--json"];
}

/** The environment without the npm_* variables npx sets, which leak into a nested npx and confuse it. */
export function cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("npm_") || k === "INIT_CWD" || k === "PROJECT_CWD") continue;
    out[k] = v;
  }
  return out;
}

/** The names the installer reports as installed, or null when its output is not the JSON list. */
export function parseInstalled(stdout: string): string[] | null {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  try {
    const list = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    if (!Array.isArray(list)) return null;
    return list.filter((s): s is { name: string; status: string } => typeof s?.name === "string" && s.status === "installed").map((s) => s.name);
  } catch {
    return null;
  }
}

/** Runs npx with no terminal input, so a prompt can only fail, never wait. */
export const runSkillsAdd: SkillsAdd = (args, o) =>
  new Promise((resolve) => {
    let stdout = "";
    let child;
    try {
      // Windows runs npx through npx.cmd, which Node starts only with a shell. The arguments are fixed.
      child = spawn("npx", args.map((a) => (process.platform === "win32" && a === "*" ? '"*"' : a)), {
        cwd: o.cwd,
        env: o.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "ignore"],
        shell: process.platform === "win32",
        timeout: 180_000,
      });
    } catch {
      resolve({ code: -1, stdout: "" });
      return;
    }
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.on("error", () => resolve({ code: -1, stdout }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
  });
