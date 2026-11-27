// competitor-research: two to five brands in; out, each brand's share of the posts read per
// platform, its best post against its author's usual reach, what its audience asks and
// complains about, and (with --deep) its own ads in the TikTok ad library.
import { rateOf } from "../../engine/index.ts";
import type { Workflow, WorkflowArgs, WorkflowQuote } from "../types.ts";
import { windowOf } from "../_video/window.ts";
import { parseBrands, planMentions } from "./plan.ts";
import { competitorResult } from "./report.ts";
import { SHARES, runCompetitors } from "./run.ts";

export { REPORT_SECTIONS } from "./report.ts";

function competitorQuote(args: WorkflowArgs): WorkflowQuote {
  let brands: string[];
  try {
    brands = parseBrands(args.input);
  } catch {
    brands = ["a", "b", "c"];
  }
  const sh = args.deep ? SHARES.deep : SHARES.default;
  const calls = planMentions(brands, { window: windowOf(args), deep: args.deep });
  let mExp = 0;
  let mMax = 0;
  for (const c of calls) {
    const r = rateOf(c.endpoint);
    mExp += c.pages * (r.page + (r.topicHold ? 1 : 0));
    mMax += c.pages * (r.page + (r.topicHold ?? 0));
  }
  const platforms = new Set(calls.map((c) => c.platform)).size;
  const lines: string[] = [];
  let expected = 0;
  let max = 0;
  const stage = (name: string, e: number, m: number, share: number) => {
    const mm = Math.min(m, share);
    const ee = Math.min(e, mm);
    expected += ee;
    max += mm;
    lines.push(`${name}: about ${ee} credits (at most ${mm})`);
  };
  stage("mentions", mExp, mMax, sh.mentions);
  stage("baselines", brands.length * platforms * 1.5, brands.length * platforms * 3, sh.baselines);
  stage("sizes", 5, 5, sh.sizes);
  stage("comments", brands.length * 3, brands.length * (args.deep ? 8 : 3), sh.comments);
  if (args.deep) stage("ads", brands.length * 5, brands.length * 5, sh.ads);
  expected = Math.round(expected);
  max = Math.round(max);
  lines.push(`Total: about ${expected} credits, at most ${max}.`);
  return { expected, max, lines };
}

export const workflow: Workflow = {
  name: "competitor-research",
  summary: "Two to five brands side by side: share of the posts read per platform, each brand's best post against its author's usual reach, what each audience asks and complains about.",
  usage: 'socialcrawl competitor-research "<brand>, <brand>[, ...]" [--about "<their category>"] [--deep]',
  examples: ['socialcrawl competitor-research "Notion, Obsidian, Logseq" --about "note-taking apps"', 'socialcrawl competitor-research "Supabase, Firebase, Neon" --about "backend and database platforms for app developers" --deep'],
  defaultBudget: 100,
  deepBudget: 300,
  takesWindow: true,
  options: { about: { type: "string" } },
  quote: competitorQuote,
  async run(session, args) {
    const run = await runCompetitors(session, args);
    const deep = competitorQuote({ ...args, deep: true });
    return competitorResult(run, session, { expected: deep.expected, max: deep.max });
  },
};
