import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { saveConfig } from "../../src/config.ts";
import { main } from "../../src/cli.ts";
import type { MainDeps } from "../../src/cli.ts";
import { EXIT } from "../../src/run.ts";
import { VERSION } from "../../src/version.ts";
import { ROOT } from "../fixture-path.ts";
import { fakeWorkflow } from "./fake.ts";

function deps(over: Partial<MainDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchFake: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const body = url.includes("credits/balance")
      ? { success: true, data: { balance: 1234 }, credits_used: 0, request_id: "req-b" }
      : { success: true, data: { items: [] }, credits_used: 1, request_id: "req-x" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const d: MainDeps = {
    env: {},
    home: mkdtempSync(path.join(tmpdir(), "sc-home-")),
    cwd: mkdtempSync(path.join(tmpdir(), "sc-cwd-")),
    fetch: fetchFake,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    now: () => new Date("2026-11-27T10:00:00Z"),
    workflows: [fakeWorkflow()],
    ...over,
  };
  return { d, out, err, seen };
}

describe("main", () => {
  it("prints help with every workflow", async () => {
    const { d, out } = deps();
    assert.equal(await main([], d), EXIT.ok);
    assert.ok(out.join("\n").includes("test-flow"));
    assert.ok(out.join("\n").includes("socialcrawl init"));
  });

  it("prints the package's version", async () => {
    const { d, out } = deps();
    await main(["--version"], d);
    assert.equal(out[0], VERSION);
    assert.equal(VERSION, JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
  });

  it("exits 2 on a bad command", async () => {
    const { d, err } = deps();
    assert.equal(await main(["nope"], d), EXIT.usage);
    assert.ok(err.join("\n").includes("test-flow"));
  });

  it("whoami without a key exits 1 and says how to set one", async () => {
    const { d, err } = deps();
    assert.equal(await main(["whoami"], d), EXIT.error);
    assert.ok(err.join("\n").includes("socialcrawl init"));
  });

  it("whoami shows where the key comes from and the credits, never the whole key", async () => {
    const key = "sc_Test_notarealkey6789";
    const { d, out } = deps({ env: { SOCIALCRAWL_API_KEY: key } });
    assert.equal(await main(["whoami"], d), EXIT.ok);
    const text = out.join("\n");
    assert.ok(text.includes("sc_Test_…6789"));
    assert.ok(text.includes("1,234 credits"));
    assert.ok(!text.includes(key));
  });

  it("runs a workflow on the saved key, naming itself and sending no-cache when asked", async () => {
    const { d, seen } = deps();
    saveConfig(d.home, { apiKey: "sc_Saved_notarealkey0000" });
    assert.equal(await main(["test-flow", "acme", "--no-cache"], d), EXIT.ok);
    const call = seen.find((s) => s.url.includes("twitter/search/tweets"))!;
    assert.equal(call.headers["x-api-key"], "sc_Saved_notarealkey0000");
    assert.equal(call.headers["X-SocialCrawl-Client"], "template:cli");
    assert.equal(call.headers["Cache-Control"], "no-cache");
  });

  it("a run without a key exits 1 with the way to get one", async () => {
    const { d, err } = deps();
    assert.equal(await main(["test-flow", "acme"], d), EXIT.error);
    assert.ok(err.join("\n").includes("socialcrawl init"));
  });
});
