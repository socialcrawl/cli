import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UsageError, parseCli } from "../../src/args.ts";
import { fakeWorkflow } from "./fake.ts";

const W = [fakeWorkflow(), fakeWorkflow({ name: "no-window", takesWindow: false, options: undefined })];
const NOW = new Date("2026-11-27T10:00:00Z");
const parse = (argv: string[]) => parseCli(argv, W, NOW);

describe("parseCli", () => {
  it("reads help, version, init and whoami", () => {
    assert.equal(parse([]).cmd, "help");
    assert.equal(parse(["--help"]).cmd, "help");
    assert.equal(parse(["--version"]).cmd, "version");
    assert.equal(parse(["whoami"]).cmd, "whoami");
    const init = parse(["init", "--yes"]);
    assert.equal(init.cmd, "init");
    assert.equal(init.cmd === "init" && init.yes, true);
    const project = parse(["init", "--project", "--skills-from", "../workflows"]);
    assert.ok(project.cmd === "init" && project.project && project.skillsFrom === "../workflows" && project.install);
    const byEmail = parse(["init", "--email", "you@example.test"]);
    assert.ok(byEmail.cmd === "init" && byEmail.email === "you@example.test");
    const bare = parse(["init", "--no-install"]);
    assert.ok(bare.cmd === "init" && !bare.install && !bare.project);
  });

  it("reads <workflow> --help and -h as that workflow's help, input or not", () => {
    for (const argv of [["test-flow", "--help"], ["test-flow", "-h"], ["test-flow", "AI tools", "--help"], ["test-flow", "--deep", "--help"]]) {
      const p = parse(argv);
      assert.equal(p.cmd, "workflow-help", argv.join(" "));
      assert.ok(p.cmd === "workflow-help" && p.workflow.name === "test-flow");
    }
  });

  it("reads a workflow run with its input and the shared options", () => {
    const p = parse(["test-flow", "AI", "coding", "tools", "--budget", "60", "--since", "2026-11-20", "--until", "2026-11-27", "--out", "here", "--json", "--open", "--no-cache", "--yes", "--platforms", "x,tiktok"]);
    assert.equal(p.cmd, "run");
    if (p.cmd !== "run") return;
    assert.equal(p.workflow.name, "test-flow");
    assert.equal(p.args.input, "AI coding tools");
    assert.equal(p.args.since, "2026-11-20");
    assert.equal(p.args.until, "2026-11-27");
    assert.equal(p.args.deep, false);
    assert.equal(p.args.now, NOW);
    assert.deepEqual(p.args.flags, { platforms: "x,tiktok" });
    assert.deepEqual(p.opts, { budget: 60, out: "here", plan: false, yes: true, open: true, json: true, noCache: true });
  });

  it("reads --deep and --plan", () => {
    const p = parse(["test-flow", "acme", "--deep", "--plan"]);
    assert.ok(p.cmd === "run" && p.args.deep && p.opts.plan);
  });

  it("refuses a run without its input", () => {
    assert.throws(() => parse(["test-flow"]), UsageError);
  });

  it("refuses an unknown command and names the workflows", () => {
    assert.throws(() => parse(["nope", "x"]), (e: unknown) => e instanceof UsageError && /test-flow/.test(e.message));
  });

  it("refuses a bad budget or date", () => {
    assert.throws(() => parse(["test-flow", "a", "--budget", "0"]), UsageError);
    assert.throws(() => parse(["test-flow", "a", "--budget", "ten"]), UsageError);
    assert.throws(() => parse(["test-flow", "a", "--since", "27/11/2026"]), UsageError);
    assert.throws(() => parse(["test-flow", "a", "--since", "2026-02-30"]), UsageError);
    assert.throws(() => parse(["test-flow", "a", "--since", "2026-11-27", "--until", "2026-11-20"]), UsageError);
  });

  it("refuses a window on a workflow that takes none, and an unknown flag", () => {
    assert.throws(() => parse(["no-window", "a", "--since", "2026-11-20"]), UsageError);
    assert.throws(() => parse(["test-flow", "a", "--colour", "red"]), UsageError);
  });
});
