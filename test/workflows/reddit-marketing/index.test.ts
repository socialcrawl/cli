// reddit-marketing as the CLI sees it: the Workflow it registers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { workflow } from "../../../src/workflows/reddit-marketing/index.ts";
import { NOW, fakeApi, session } from "./fake.ts";

const args = (input: string, deep = false) => ({ input, flags: {}, deep, now: NOW });

describe("the reddit-marketing workflow", () => {
  it("is named as its command and skill, with a default budget inside the welcome credits", () => {
    assert.equal(workflow.name, "reddit-marketing");
    assert.ok(workflow.defaultBudget <= 100);
    assert.ok(workflow.deepBudget > workflow.defaultBudget);
    assert.match(workflow.usage, /^socialcrawl reddit-marketing "<keyword>"/);
  });

  it("quotes for free, a default run fitting its own budget", async () => {
    const q = await workflow.quote(args("headless CMS"));
    assert.ok(q.max <= workflow.defaultBudget, `max ${q.max}`);
    assert.ok(q.lines.length >= 5);
    const deep = await workflow.quote(args("headless CMS", true));
    assert.ok(deep.max <= workflow.deepBudget && deep.max > q.max);
  });

  it("refuses an empty keyword before anything is spent", async () => {
    const api = fakeApi();
    await assert.rejects(() => workflow.run(session(api), args("   ")), /keyword/);
    assert.equal(api.calls.length, 0);
  });

  it("runs end to end and returns what the render kit needs", async () => {
    const r = await workflow.run(session(fakeApi()), args("headless CMS"));
    assert.equal(r.card.command, '/reddit-marketing "headless CMS"');
    assert.ok(Object.keys(r.tables).includes("threads"));
    assert.ok(r.report.evidence.findings.length >= 5);
  });

  it("names the run folder after the keyword", () => {
    assert.equal(workflow.slug!(args('"Headless CMS" tools')), "headless-cms-tools");
  });
});
