// Every workflow the CLI runs. A workflow's owner adds one import and one entry here.
import { workflow as instagramMarketing } from "./instagram-marketing/index.ts";
import { workflow as socialViral } from "./social-viral/index.ts";
import { workflow as linkedinMarketing } from "./linkedin-marketing/index.ts";
import { workflow as socialPresence } from "./social-presence/index.ts";
import { workflow as socialPulse } from "./social-pulse/index.ts";
import { workflow as socialTeardown } from "./social-teardown/index.ts";
import { workflow as tiktokMarketing } from "./tiktok-marketing/index.ts";
import { workflow as youtubeMarketing } from "./youtube-marketing/index.ts";
import { workflow as competitorResearch } from "./competitor-research/index.ts";
import { workflow as postTracker } from "./post-tracker/index.ts";
import { workflow as xMarketing } from "./x-marketing/index.ts";
import { workflow as videoTeardown } from "./video-teardown/index.ts";
import type { Workflow } from "./types.ts";

export const WORKFLOWS: Workflow[] = [socialViral, linkedinMarketing, socialPresence, socialPulse, socialTeardown, tiktokMarketing, instagramMarketing, youtubeMarketing, competitorResearch, postTracker, xMarketing, videoTeardown];

export function workflowByName(name: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.name === name);
}

export type { Workflow, WorkflowArgs, WorkflowQuote } from "./types.ts";
