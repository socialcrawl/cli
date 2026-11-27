// A fake API for runner tests: answers each call from a route table, bills each page at the
// rate table's price, gives every response a request id, and records what was sent.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Budget, postCost, rateOf } from "../../../src/engine/index.ts";
import { ApiError } from "../../../src/kit/kit.ts";
import type { ApiBody, Params } from "../../../src/kit/kit.ts";
import { Session } from "../../../src/kit/record.ts";

export interface Route {
  endpoint: string;
  /** Matches the params (GET) or the JSON body (POST). */
  when?: (params: Params, json: any) => boolean;
  /** The response's data, or a number for an API error with that status. */
  data: ((params: Params, json: any) => unknown) | unknown;
}

export interface Sent {
  method: "GET" | "POST";
  endpoint: string;
  params: Params;
  json: unknown;
}

export function fakeKit(routes: Route[]) {
  const sent: Sent[] = [];
  let n = 0;
  const answer = (method: "GET" | "POST", endpoint: string, params: Params, json: unknown): ApiBody => {
    sent.push({ method, endpoint, params, json });
    const r = routes.find((x) => x.endpoint === endpoint && (!x.when || x.when(params, json)));
    const id = `req-fake${String(++n).padStart(3, "0")}`;
    if (!r) throw new ApiError(404, { success: false, request_id: id, error: { type: "not_found", message: `no route for ${endpoint}` } } as unknown as ApiBody);
    const data = typeof r.data === "function" ? (r.data as (p: Params, j: unknown) => unknown)(params, json) : r.data;
    if (typeof data === "number") throw new ApiError(data, { success: false, request_id: id, error: { type: "upstream_error", message: "upstream failed" } } as unknown as ApiBody);
    const rate = rateOf(endpoint);
    const pages = Math.max(1, Number(params.max_pages ?? 1));
    // A walk stops at its max_credits, as the API's does.
    const cap = params.max_credits === undefined ? Infinity : Number(params.max_credits);
    const credits = method === "POST" ? postCost(endpoint, json) : rate.walks ? Math.min(rate.page * pages, cap) : rate.page;
    // A route may answer { $pagination, ...data } to set the body's pagination block.
    const { $pagination, ...rest } = (data ?? {}) as { $pagination?: unknown };
    return { success: true, data: rest, credits_used: credits, request_id: id, ...($pagination ? { pagination: $pagination } : {}) } as ApiBody;
  };
  return {
    sent,
    call: async (endpoint: string, params: Params = {}) => answer("GET", endpoint, params, undefined),
    post: async (endpoint: string, json: unknown, params: Params = {}) => answer("POST", endpoint, params, json),
  };
}

export function fakeSession(routes: Route[], budget = 60, now = new Date("2026-11-27T12:00:00Z")) {
  const kit = fakeKit(routes);
  const dir = mkdtempSync(path.join(tmpdir(), "sc-video-"));
  const session = new Session({ dir, kit, budget: new Budget(budget), skill: "test", version: "0.0.0", now: () => now });
  return { kit, session, dir };
}

/** A post in the API's shared envelope. */
export function post(o: {
  id: string;
  author: string;
  followers?: number | null;
  views: number;
  likes?: number;
  at: string;
  text?: string;
  duration?: number;
  url?: string;
  ext?: Record<string, unknown>;
  pinned?: boolean;
}) {
  return {
    post: {
      id: o.id,
      url: o.url ?? `https://www.tiktok.com/@${o.author}/video/${o.id}`,
      content: { text: o.text ?? "", duration_seconds: o.duration ?? 30 },
      author: { username: o.author },
      engagement: { views: o.views, likes: o.likes ?? Math.round(o.views / 20), comments: 10, shares: 1, saves: 1 },
      flags: { pinned: o.pinned ?? false },
      published_at: o.at,
      ext: { author_followers: o.followers ?? null, ...(o.ext ?? {}) },
    },
  };
}

/** `n` posts by one author, one a day, ending the day before `end`, each with `views`. */
export function history(author: string, n: number, views: number, end: string, extra: Partial<Parameters<typeof post>[0]> = {}) {
  const last = Date.parse(end) - 86_400_000;
  return Array.from({ length: n }, (_, i) => post({ id: `${author}-h${i}`, author, views, at: new Date(last - i * 86_400_000).toISOString(), ...extra }));
}
