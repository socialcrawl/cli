// One video-platform spec becomes a CLI workflow: its free quote (from the rate table, each
// stage capped at its share of the budget), and its run (runVideo, then the report).
import { rateOf } from "../../engine/index.ts";
import type { Row } from "../../engine/index.ts";
import type { Workflow, WorkflowArgs, WorkflowQuote } from "../types.ts";
import { videoResult } from "./report.ts";
import { runVideo } from "./run.ts";
import type { VideoSpec } from "./spec.ts";

/** A row with every id a baseline call can need, to price one. */
const PROBE: Row = {
  platform: "other",
  id: "probe",
  url: "https://example.invalid/probe",
  author: "probe",
  authorFollowers: null,
  authorUrl: null,
  channelId: "probe",
  community: null,
  text: "",
  publishedAt: null,
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  durationSeconds: null,
  video: true,
  pinned: false,
  kind: "original",
  requestId: null,
};

export function videoQuote(spec: VideoSpec, deep: boolean): WorkflowQuote {
  const pick = <T>(d: { default: T; deep: T }) => (deep ? d.deep : d.default);
  const sh = pick(spec.shares);
  const lines: string[] = [];
  let expected = 0;
  let max = 0;
  const stage = (name: string, exp: number, most: number, share: number) => {
    const m = Math.min(most, share);
    const e = Math.min(exp, m);
    expected += e;
    max += m;
    lines.push(`${name}: about ${e} credits (at most ${m})`);
  };

  let sExp = 0;
  let sMax = 0;
  for (const s of spec.searches("probe", deep)) {
    const r = rateOf(s.endpoint);
    sExp += s.pages * (r.page + (r.topicHold ? 1 : 0));
    sMax += s.pages * (r.page + (r.topicHold ?? 0));
  }
  stage("search", sExp, sMax, sh.search);
  if (spec.enrich) stage("enrich", sh.enrich, sh.enrich, sh.enrich);

  const call = spec.baselineCall({ ...PROBE, platform: spec.platform }, deep);
  if (call) {
    const pages = Math.max(1, Number(call.params.max_pages ?? 1));
    const per = rateOf(call.endpoint).page * pages;
    stage("baselines", per * pick(spec.confirm), sh.baseline, sh.baseline);
  }
  const c = rateOf(spec.comments.endpoint).page * pick(spec.comments.pages) * pick(spec.comments.posts);
  stage("comments", c, c, sh.comments);
  const t = rateOf(spec.transcripts.endpoint).page * pick(spec.transcripts.posts);
  stage("transcripts", t, t, sh.transcript);
  if (spec.names) {
    const k = rateOf(spec.names.endpoint).page * pick(spec.names.max);
    stage("names", k, k, sh.names);
  }
  lines.push(`Total: about ${expected} credits, at most ${max}.`);
  return { expected, max, lines };
}

export function videoWorkflow(spec: VideoSpec, about: { summary: string; examples: string[] }): Workflow {
  return {
    name: spec.workflow,
    summary: about.summary,
    usage: `socialcrawl ${spec.workflow} "<keyword>" [--about "<one line on the topic>"] [--deep]`,
    examples: about.examples,
    defaultBudget: spec.defaultBudget,
    deepBudget: spec.deepBudget,
    options: { about: { type: "string" } },
    quote: (args: WorkflowArgs) => videoQuote(spec, args.deep),
    async run(session, args) {
      const run = await runVideo(session, spec, args);
      const deepQuote = videoQuote(spec, true);
      return videoResult(spec, run, session, args, { expected: deepQuote.expected, max: deepQuote.max });
    },
  };
}
