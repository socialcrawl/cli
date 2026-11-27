// Every workflow the CLI runs. A workflow's owner adds one import and one entry here.
import type { Workflow } from "./types.ts";

export const WORKFLOWS: Workflow[] = [];

export function workflowByName(name: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.name === name);
}

export type { Workflow, WorkflowArgs, WorkflowQuote } from "./types.ts";
