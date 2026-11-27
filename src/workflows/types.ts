// The contract every workflow in src/workflows/<name>/ exports as `workflow`.
//
// The harness (cli.ts) owns the key, the kit, the budget, the free quote and the
// confirmation, the run folder and the terminal summary. A workflow plans its calls,
// sends every one through session.call (never the kit directly, so the budget,
// max_pages and responses.jsonl hold everywhere) and returns what to render.
import type { ParseArgsConfig } from "node:util";

import type { Session } from "../kit/record.ts";
import type { WorkflowResult } from "../render/types.ts";

export interface WorkflowArgs {
  /** The text after the workflow's name: a topic, a keyword, an account or a link. */
  input: string;
  /** The workflow's own flags, parsed from its `options`. */
  flags: Record<string, string | boolean | undefined>;
  /** A deep run reads more and always asks before it spends. */
  deep: boolean;
  /** --since and --until, YYYY-MM-DD, for a workflow that takes a window. */
  since?: string;
  until?: string;
  now: Date;
}

export interface WorkflowQuote {
  /** The credits the run is expected to read. */
  expected: number;
  /** The most it can spend; the harness asks before a run whose max is over the budget. */
  max: number;
  /** Optional detail lines, one per stage. */
  lines: string[];
}

export interface Workflow {
  /** Lower-case words joined by "-": the command and the agent skill name. */
  name: string;
  /** One line for `socialcrawl --help`. */
  summary: string;
  /** `socialcrawl <name> "<topic>" [--deep]` */
  usage: string;
  examples: string[];
  /** The budget of a default run, inside the 100 welcome credits. */
  defaultBudget: number;
  /** The budget of a deep run. */
  deepBudget: number;
  /** True when the workflow reads --since and --until. */
  takesWindow?: boolean;
  /** The workflow's own flags, in node:util parseArgs form. */
  options?: NonNullable<ParseArgsConfig["options"]>;
  /** The folder name's middle part; defaults to a slug of the input. */
  slug?(args: WorkflowArgs): string;
  /** The free quote: no paid call. */
  quote(args: WorkflowArgs): WorkflowQuote | Promise<WorkflowQuote>;
  run(session: Session, args: WorkflowArgs): Promise<WorkflowResult>;
}
