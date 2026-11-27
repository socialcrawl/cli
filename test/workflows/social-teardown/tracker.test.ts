// The teardown's stages tag each call with what it was for (the post, the launch, the
// month), so the analysis can join a reply page to its post. The Tracker keeps those tags
// beside the Session's records, and says when a stage stopped for its share.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Budget } from "../../../src/engine/rates.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { Session } from "../../../src/kit/record.ts";
import { Tracker } from "../../../src/workflows/social-teardown/tracker.ts";

const dir = () => mkdtempSync(path.join(tmpdir(), "sc-teardown-"));

function kit(answers: (ApiBody | Error)[]) {
  return {
    async call(_p: string, _params: Params = {}): Promise<ApiBody> {
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

const session = (answers: (ApiBody | Error)[], total = 100) => new Session({ dir: dir(), kit: kit(answers), budget: new Budget(total), skill: "social-teardown", version: "0.1.0" });

describe("Tracker", () => {
  it("keeps each call's tags with its record", async () => {
    const t = new Tracker(session([{ success: true, data: { items: [] }, credits_used: 2, request_id: "req-a" }]));
    const rec = await t.call("replies", "twitter/tweet/replies", { url: "u", max_pages: 2 }, { post_id: "9" });
    assert.equal(rec?.meta.post_id, "9");
    assert.equal(t.records[0].meta.post_id, "9");
    assert.equal(t.spent, 2);
  });

  it("keeps an error record, tagged, and returns null", async () => {
    const t = new Tracker(session([new ApiError(404, { success: false, request_id: "req-e", error: { type: "RESOURCE_NOT_FOUND", message: "gone" } } as ApiBody)]));
    const rec = await t.call("transcript", "twitter/tweet/transcript", { url: "u" }, { post_id: "7" });
    assert.equal(rec, null);
    assert.equal(t.records.length, 1);
    assert.equal(t.records[0].status, 404);
    assert.equal(t.records[0].meta.post_id, "7");
  });

  it("names a stage stopped by its share, with how many calls were not made", async () => {
    const t = new Tracker(session([{ success: true, data: { items: [] }, credits_used: 1, request_id: "req-1" }]));
    await t.withinShare("profile", 1, [
      { endpoint: "twitter/profile", params: { handle: "a" } },
      { endpoint: "twitter/profile", params: { handle: "b" } },
    ]);
    assert.equal(t.records.length, 1);
    assert.match(t.limits[0].reason, /1 of 2 calls not made/);
  });

  it("reads one page when the share pays for it, even if an even split would not", async () => {
    const page = { success: true, data: { items: [], walk: { pages: 1 } }, credits_used: 5, request_id: "req-ig" } as ApiBody;
    const t = new Tracker(session([page, page, page], 100));
    await t.withinShare("comments", 9, [1, 2, 3].map((i) => ({ endpoint: "instagram/post/comments", params: { url: `u${i}`, max_pages: 1 } })));
    assert.equal(t.records.length, 1);
    assert.match(t.limits[0]?.reason ?? "", /2 of 3 calls not made/);
  });
});
