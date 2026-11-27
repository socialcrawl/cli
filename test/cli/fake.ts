// A fake workflow and a fake API for the harness tests.
import { Evidence } from "../../src/engine/evidence.ts";
import { OutOfCredits } from "../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../src/kit/kit.ts";
import type { Workflow } from "../../src/workflows/types.ts";

export const fakeWorkflow = (over: Partial<Workflow> = {}): Workflow => ({
  name: "test-flow",
  summary: "Reads a topic for the tests.",
  usage: 'socialcrawl test-flow "<topic>"',
  examples: ['socialcrawl test-flow "acme"'],
  defaultBudget: 40,
  deepBudget: 200,
  takesWindow: true,
  options: { platforms: { type: "string" } },
  quote: () => ({ expected: 22, max: 40, lines: ["search: about 6 credits (at most 12)"] }),
  async run(session, args) {
    const rec = await session.call("search:x", "twitter/search/tweets", { query: args.input }, 5);
    await session.call("baseline:x", "twitter/user/tweets", { handle: "acme" }, 5);
    const evidence = new Evidence();
    evidence.add({ claim: "One post broke out", confidence: "seen", numbers: { n: 1 }, requests: [rec?.requestId ?? "req-none"] });
    const meta = session.meta();
    return {
      card: { command: `/test-flow "${args.input}"`, skill: "test-flow", headlines: ["One post broke out"], basis: "2 calls", meta, rerun: `socialcrawl test-flow "${args.input}"` },
      report: { command: `/test-flow "${args.input}"`, skill: "test-flow", badge: "test", summary: ["One post broke out [F1]"], sections: [], evidence, meta, methodNotes: [] },
      tables: { posts: { columns: ["id"], rows: [{ id: 1 }] } },
    };
  },
  ...over,
});

export function fakeApi(opts: { balance?: number; outOfCreditsOn?: number; topUpUrl?: string } = {}) {
  const sent: { path: string; params: Params }[] = [];
  let n = 0;
  return {
    sent,
    async call(path: string, params: Params = {}): Promise<ApiBody> {
      sent.push({ path, params });
      n++;
      if (opts.outOfCreditsOn === n) {
        throw new OutOfCredits({
          success: false,
          error: { type: "INSUFFICIENT_CREDITS", message: "Out of credits", status: 402, details: { next_step: "Top up.", checkout_url: "https://www.socialcrawl.dev/checkout" } },
          request_id: `req-${n}`,
        });
      }
      // A walk never spends past the max_credits it was sent.
      const cap = params.max_credits === undefined ? 2 : Number(params.max_credits);
      return { success: true, data: { items: [] }, credits_used: Math.min(2, cap), request_id: `req-${n}` };
    },
    async balance(): Promise<ApiBody> {
      return { success: true, data: { balance: opts.balance ?? 100, ...(opts.topUpUrl ? { top_up_url: opts.topUpUrl } : {}) }, credits_used: 0, request_id: "req-balance" };
    },
  };
}
