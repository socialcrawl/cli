// Every workflow the CLI runs. A workflow's owner adds one import and one entry here.
import { workflow as instagramMarketing } from "./instagram-marketing/index.ts";
import { workflow as socialViral } from "./social-viral/index.ts";
import { workflow as tiktokMarketing } from "./tiktok-marketing/index.ts";
import { workflow as youtubeMarketing } from "./youtube-marketing/index.ts";
import type { Workflow } from "./types.ts";

export const WORKFLOWS: Workflow[] = [socialViral, tiktokMarketing, instagramMarketing, youtubeMarketing];

export function workflowByName(name: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.name === name);
}

export type { Workflow, WorkflowArgs, WorkflowQuote } from "./types.ts";
