// A fake SocialCrawl API that answers from the recorded "headless CMS" run (27/11/2026,
// anonymised), and a Session on a temporary folder: no network, no credits.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Budget } from "../../../src/engine/rates.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { Session } from "../../../src/kit/record.ts";
import { fixturePath } from "../../fixture-path.ts";

export interface Fixture {
  name: string;
  endpoint: string;
  params: Record<string, unknown>;
  requestId: string | null;
  body: ApiBody;
}

export const RECORDS: Fixture[] = JSON.parse(readFileSync(fixturePath("reddit-marketing", "headless-cms.json"), "utf8"));
export const NOW = new Date("2026-11-27T12:00:00Z");
export const IN = { keyword: "headless CMS", now: NOW };
const ID_KEYS = ["subreddit", "url", "sort"];

export function fakeApi() {
  const calls: { path: string; params: Params }[] = [];
  return {
    calls,
    async call(p: string, params: Params = {}): Promise<ApiBody> {
      calls.push({ path: p, params });
      const hit = RECORDS.find((r) => r.endpoint === p && ID_KEYS.every((k) => params[k] === undefined || r.params[k] === undefined || String(r.params[k]) === String(params[k])));
      if (!hit) throw new ApiError(404, { success: false, error: { type: "NOT_FOUND", message: `no recorded response for ${p}` }, request_id: "req-fake404" });
      return hit.body;
    },
  };
}

export function session(api: ReturnType<typeof fakeApi>, budget = 100): Session {
  return new Session({ dir: mkdtempSync(path.join(tmpdir(), "rm-")), kit: api, budget: new Budget(budget), skill: "reddit-marketing", version: "0.1.0", now: () => NOW });
}

/** Every member name the recorded responses hold (thread and comment authors). */
export function memberNames(): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const a = o.author as Record<string, unknown> | undefined;
      if (a && typeof a.username === "string" && !("followers" in a)) out.add(a.username);
      Object.values(o).forEach(walk);
    }
  };
  RECORDS.forEach((r) => walk(r.body));
  return [...out];
}
