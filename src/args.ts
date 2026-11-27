// The command line, as fixed in the CLI contract:
//   socialcrawl init | whoami | <workflow> "<input>" [--deep --budget --since --until --out --plan --yes --open --json --no-cache]
import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

import type { RunOptions } from "./run.ts";
import type { Workflow, WorkflowArgs } from "./workflows/types.ts";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type Parsed =
  | { cmd: "help" }
  | { cmd: "version" }
  | { cmd: "whoami" }
  | { cmd: "init"; yes: boolean; skillsFrom?: string; install: boolean }
  | { cmd: "run"; workflow: Workflow; args: WorkflowArgs; opts: RunOptions };

const SHARED: NonNullable<ParseArgsConfig["options"]> = {
  deep: { type: "boolean", default: false },
  budget: { type: "string" },
  since: { type: "string" },
  until: { type: "string" },
  out: { type: "string" },
  plan: { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  open: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  "no-cache": { type: "boolean", default: false },
};

function day(name: string, v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== v) throw new UsageError(`--${name} takes a date as YYYY-MM-DD, for example 2026-11-20.`);
  return v;
}

function parse(argv: string[], options: NonNullable<ParseArgsConfig["options"]>) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message.replace(/^TypeError \[[A-Z_]+\]: /, ""));
  }
}

export function parseCli(argv: string[], workflows: Workflow[], now: Date): Parsed {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") return { cmd: "help" };
  if (first === "--version" || first === "-v" || first === "version") return { cmd: "version" };
  if (first === "whoami") return { cmd: "whoami" };
  if (first === "init") {
    const { values } = parse(rest, { yes: { type: "boolean", default: false }, "skills-from": { type: "string" }, "no-install": { type: "boolean", default: false } });
    return { cmd: "init", yes: values.yes === true, skillsFrom: values["skills-from"] as string | undefined, install: values["no-install"] !== true };
  }
  const workflow = workflows.find((w) => w.name === first);
  if (!workflow) {
    throw new UsageError(`Unknown command "${first}". Workflows: ${workflows.map((w) => w.name).join(", ") || "none installed"}. Run socialcrawl --help.`);
  }
  const own = workflow.options ?? {};
  for (const k of Object.keys(own)) if (k in SHARED) throw new Error(`${workflow.name} redefines the shared option --${k}.`);
  const { values, positionals } = parse(rest, { ...SHARED, ...own });
  const input = positionals.join(" ").trim();
  if (!input) throw new UsageError(`${workflow.name} needs its input. Usage: ${workflow.usage}`);
  let budget: number | undefined;
  if (values.budget !== undefined) {
    budget = Number(values.budget);
    if (!/^\d+$/.test(String(values.budget)) || budget < 1) throw new UsageError("--budget takes a whole number of credits, 1 or more.");
  }
  const since = day("since", values.since as string | undefined);
  const until = day("until", values.until as string | undefined);
  if ((since || until) && !workflow.takesWindow) throw new UsageError(`${workflow.name} does not take --since or --until.`);
  if (since && until && since > until) throw new UsageError("--since must be on or before --until.");
  const flags: Record<string, string | boolean | undefined> = {};
  for (const k of Object.keys(own)) if (values[k] !== undefined) flags[k] = values[k] as string | boolean;
  return {
    cmd: "run",
    workflow,
    args: { input, flags, deep: values.deep === true, ...(since ? { since } : {}), ...(until ? { until } : {}), now },
    opts: {
      ...(budget !== undefined ? { budget } : {}),
      ...(values.out !== undefined ? { out: values.out as string } : {}),
      plan: values.plan === true,
      yes: values.yes === true,
      open: values.open === true,
      json: values.json === true,
      noCache: values["no-cache"] === true,
    },
  };
}
