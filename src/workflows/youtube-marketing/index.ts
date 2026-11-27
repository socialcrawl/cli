// youtube-marketing: a keyword in, the YouTube videos and Shorts breaking out against their
// channels' own earlier uploads (Shorts with Shorts) out, with their lengths, titles, what the
// comments ask, and the words of the top videos.
import { videoWorkflow } from "../_video/workflow.ts";
import { YOUTUBE } from "./spec.ts";

export const workflow = videoWorkflow(YOUTUBE, {
  summary: "The YouTube videos and Shorts breaking out on a keyword, against each channel's own earlier uploads: lengths, titles, comments.",
  examples: ['socialcrawl youtube-marketing "AI coding tools"', 'socialcrawl youtube-marketing "home espresso" --about "making espresso at home"', 'socialcrawl youtube-marketing "budget travel" --deep'],
});
