import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { EXIT, runWorkflow } from "../../src/run.ts";
import type { RunOptions } from "../../src/run.ts";
import type { WorkflowArgs } from "../../src/workflows/types.ts";
import { fakeApi, fakeWorkflow } from "./fake.ts";

const NOW = new Date("2026-11-27T10:00:00Z");
const ARGS: WorkflowArgs = { input: "acme", flags: {}, deep: false, now: NOW };
const OPTS: RunOptions = { plan: false, yes: false, open: false, json: false, noCache: false };

function harness(over: { api?: ReturnType<typeof fakeApi>; opts?: Partial<RunOptions>; args?: Partial<WorkflowArgs>; workflow?: Parameters<typeof fakeWorkflow>[0] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "sc-cwd-"));
  const api = over.api ?? fakeApi();
  const ctx = {
    workflow: fakeWorkflow(over.workflow),
    args: { ...ARGS, ...over.args },
    opts: { ...OPTS, ...over.opts },
    kit: api,
    cwd,
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
    openFile: (p: string) => opened.push(p),
  };
  return { ctx, out, err, opened, cwd, api, dir: path.join(cwd, "socialcrawl-runs", "test-flow-acme-2026-11-27") };
}

describe("runWorkflow", () => {
  it("quotes first, runs, writes the folder and answers in the terminal", async () => {
    const h = harness();
    assert.equal(await runWorkflow(h.ctx), EXIT.ok);
    assert.equal(h.err[0], "This run reads about 22 credits (at most 40). You have 100.");
    assert.ok(existsSync(path.join(h.dir, "report.html")));
    assert.ok(existsSync(path.join(h.dir, "data", "posts.csv")));
    assert.equal(h.out[0], "One post broke out");
    assert.ok(h.out.some((l) => l.includes(path.join(h.dir, "report.html"))));
  });

  it("prints one progress line per stage", async () => {
    const h = harness();
    await runWorkflow(h.ctx);
    assert.ok(h.err.includes("search: 1 call, 1 credit"));
    assert.ok(h.err.includes("baseline: 1 call, 1 credit"));
  });

  it("records the run: inputs, stages, credits", async () => {
    const h = harness();
    await runWorkflow(h.ctx);
    const run = JSON.parse(readFileSync(path.join(h.dir, "run.json"), "utf8"));
    assert.equal(run.workflow, "test-flow");
    assert.equal(run.credits, 2);
    assert.equal(run.calls, 2);
    assert.equal(run.inputs.input, "acme");
    assert.equal(run.inputs.budget, 40);
    assert.deepEqual(run.stages.map((s: { name: string }) => s.name), ["search:x", "baseline:x"]);
  });

  it("tells the workflow when the run must read everything fresh", async () => {
    const seen: (boolean | undefined)[] = [];
    const h = harness({ opts: { noCache: true }, workflow: { quote: (args) => (seen.push(args.noCache), { expected: 1, max: 2, lines: [] }) } });
    await runWorkflow(h.ctx);
    assert.deepEqual(seen, [true]);
  });

  it("with --plan prints the quote and spends nothing", async () => {
    const h = harness({ opts: { plan: true } });
    assert.equal(await runWorkflow(h.ctx), EXIT.ok);
    assert.equal(h.api.sent.length, 0);
    assert.ok(h.err.includes("search: about 6 credits (at most 12)"));
    assert.ok(!existsSync(h.dir));
  });

  it("uses the deep budget for --deep and --budget over both", async () => {
    const deep = harness({ args: { deep: true }, api: fakeApi({ balance: 1000 }) });
    await runWorkflow(deep.ctx);
    assert.equal(JSON.parse(readFileSync(path.join(deep.dir, "run.json"), "utf8")).inputs.budget, 200);
    const set = harness({ opts: { budget: 7 } });
    await runWorkflow(set.ctx);
    assert.equal(JSON.parse(readFileSync(path.join(set.dir, "run.json"), "utf8")).inputs.budget, 7);
  });

  it("runs inside the balance when it is under the budget, and says how to top up", async () => {
    const h = harness({ api: fakeApi({ balance: 3, topUpUrl: "https://www.socialcrawl.dev/top-up" }) });
    assert.equal(await runWorkflow(h.ctx), EXIT.ok);
    const run = JSON.parse(readFileSync(path.join(h.dir, "run.json"), "utf8"));
    assert.equal(run.inputs.budget, 3);
    assert.ok(run.credits <= 3);
    assert.ok(h.out.some((l) => l.includes("https://www.socialcrawl.dev/top-up")));
  });

  it("stops before any call when the balance is empty, with exit 3", async () => {
    const h = harness({ api: fakeApi({ balance: 0, topUpUrl: "https://www.socialcrawl.dev/top-up" }) });
    assert.equal(await runWorkflow(h.ctx), EXIT.outOfCredits);
    assert.equal(h.api.sent.length, 0);
    assert.ok(h.err.some((l) => l.includes("https://www.socialcrawl.dev/top-up")));
  });

  it("shows the offer on a 402, says what it read, keeps the responses, exit 3", async () => {
    const h = harness({ api: fakeApi({ outOfCreditsOn: 2 }) });
    assert.equal(await runWorkflow(h.ctx), EXIT.outOfCredits);
    const text = h.err.join("\n");
    assert.ok(text.includes("Out of credits."));
    assert.ok(text.includes("https://www.socialcrawl.dev/checkout"));
    assert.ok(/Read before it stopped: 1 call, 1 credit./.test(text), text);
    assert.equal(readFileSync(path.join(h.dir, "responses.jsonl"), "utf8").trim().split("\n").length, 1);
  });

  it("exits 1 when the workflow fails, keeping what it read", async () => {
    const h = harness({
      workflow: {
        async run(session) {
          await session.call("search:x", "twitter/search/tweets", { query: "a" }, 5);
          throw new Error("could not parse a page");
        },
      },
    });
    assert.equal(await runWorkflow(h.ctx), EXIT.error);
    assert.ok(h.err.some((l) => l.includes("could not parse a page")));
    assert.ok(existsSync(path.join(h.dir, "responses.jsonl")));
  });

  it("with --json prints run.json alone on stdout", async () => {
    const h = harness({ opts: { json: true } });
    await runWorkflow(h.ctx);
    assert.equal(JSON.parse(h.out.join("\n")).workflow, "test-flow");
  });

  it("with --out writes there, and --open opens the report", async () => {
    const h = harness({ opts: { open: true, out: "my-run" } });
    await runWorkflow(h.ctx);
    assert.ok(existsSync(path.join(h.cwd, "my-run", "report.html")));
    assert.deepEqual(h.opened, [path.join(h.cwd, "my-run", "report.html")]);
  });
});
