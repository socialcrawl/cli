// instagram-marketing: a keyword in, the Instagram reels breaking out against their creators'
// own earlier reels out, with their lengths, hooks, music and hashtags, what the comments ask,
// and the words of the top reel.
import { videoWorkflow } from "../_video/workflow.ts";
import { INSTAGRAM } from "./spec.ts";

export const workflow = videoWorkflow(INSTAGRAM, {
  summary: "The Instagram reels breaking out on a keyword, against each creator's own earlier reels: lengths, hooks, music, comments.",
  examples: ['socialcrawl instagram-marketing "AI coding tools"', 'socialcrawl instagram-marketing "home workouts" --about "workouts people do at home without a gym"', 'socialcrawl instagram-marketing "skincare routine" --deep'],
});
