// tiktok-marketing: a keyword in, the TikTok videos breaking out against their creators' own
// earlier videos out, with their lengths, hooks, sounds and hashtags, what the comments ask,
// and the words of the top video.
import { videoWorkflow } from "../_video/workflow.ts";
import { TIKTOK } from "./spec.ts";

export const workflow = videoWorkflow(TIKTOK, {
  summary: "The TikTok videos breaking out on a keyword, against each creator's own earlier videos: lengths, hooks, sounds, comments.",
  examples: ['socialcrawl tiktok-marketing "AI coding tools"', 'socialcrawl tiktok-marketing "meal prep" --about "cooking meals ahead for the week"', 'socialcrawl tiktok-marketing "skincare routine" --deep'],
});
