// reddit-marketing: a keyword in; out come the threads that beat their community's usual top
// post, what people ask and complain about, the communities and their rules on promotion,
// and the recent threads where a disclosed reply would help.
//
//   socialcrawl reddit-marketing "headless CMS"            about 29 credits, at most 38
//   socialcrawl reddit-marketing "headless CMS" --deep     a year back, more communities and comment trees
import type { Workflow, WorkflowArgs } from "../types.ts";
import { planQuote, WORKFLOW } from "./plan.ts";
import type { RedditInput } from "./plan.ts";
import { buildResult } from "./render.ts";
import { runReddit } from "./run.ts";

export const VERSION = "0.1.0";

function inputOf(args: WorkflowArgs): RedditInput {
  const keyword = args.input.replace(/\s+/g, " ").trim();
  if (!keyword) throw new Error('Give a keyword: socialcrawl reddit-marketing "headless CMS"');
  const about = typeof args.flags.about === "string" && args.flags.about.trim() ? args.flags.about.trim() : undefined;
  return { keyword, about, deep: args.deep, now: args.now };
}

export const workflow: Workflow = {
  name: WORKFLOW,
  summary: "A keyword's Reddit threads against their community, what people ask, the rules, and where to reply",
  usage: 'socialcrawl reddit-marketing "<keyword>" [--about "<fuller topic>"] [--deep]',
  examples: ['socialcrawl reddit-marketing "headless CMS"', 'socialcrawl reddit-marketing "invoice software" --about "invoicing software for freelancers"'],
  defaultBudget: 40,
  deepBudget: 150,
  options: { about: { type: "string" } },
  slug: (args) =>
    args.input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "keyword",
  quote(args) {
    const q = planQuote({ ...inputOf({ ...args, input: args.input.trim() || "x" }) });
    return { expected: q.expected, max: q.max, lines: q.lines.map((l) => `${l.stage}: ${l.calls} × ${l.endpoint}, about ${l.expected} credits (at most ${l.max})`) };
  },
  async run(session, args) {
    const input = inputOf(args);
    const run = await runReddit(session, input);
    return buildResult(run, session.meta(), session.records);
  },
};

export default workflow;
