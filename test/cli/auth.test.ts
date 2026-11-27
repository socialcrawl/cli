import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refreshAccessToken, tokenFetch } from "../../src/auth.ts";

type Seen = { url: string; init?: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("refreshAccessToken", () => {
  it("trades the refresh token for a new pair, as auth.md describes", async () => {
    const seen: Seen[] = [];
    const f: typeof fetch = async (u, init) => {
      seen.push({ url: String(u), init });
      return json(200, { access_token: "at2", refresh_token: "rt2" });
    };
    const t = await refreshAccessToken({ site: "https://example.test", refreshToken: "rt1", clientId: "cid", fetch: f });
    assert.deepEqual(t, { accessToken: "at2", refreshToken: "rt2" });
    assert.equal(seen[0].url, "https://example.test/api/auth/oauth2/token");
    const form = new URLSearchParams(String(seen[0].init?.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "rt1");
    assert.equal(form.get("client_id"), "cid");
    assert.equal(form.get("resource"), "https://example.test");
  });

  it("throws when the refresh is refused", async () => {
    const f: typeof fetch = async () => json(400, { error: "invalid_grant" });
    await assert.rejects(refreshAccessToken({ site: "https://example.test", refreshToken: "rt1", clientId: "cid", fetch: f }), /invalid_grant/);
  });
});

describe("tokenFetch", () => {
  it("sends the current token, refreshes once on a 401, saves the new pair and retries", async () => {
    const auths: string[] = [];
    let call = 0;
    const f: typeof fetch = async (u, init) => {
      const url = String(u);
      if (url.endsWith("/api/auth/oauth2/token")) return json(200, { access_token: "at2", refresh_token: "rt2" });
      auths.push(String((init?.headers as Record<string, string>).Authorization));
      return ++call === 1 ? json(401, { success: false }) : json(200, { success: true });
    };
    const saved: unknown[] = [];
    const tf = tokenFetch({ accessToken: "at1", refreshToken: "rt1", clientId: "cid" }, { fetch: f, site: "https://example.test", onRefresh: (t) => saved.push(t) });
    const res = await tf("https://example.test/v1/credits/balance", { headers: { Authorization: "Bearer at1" } });
    assert.equal(res.status, 200);
    assert.deepEqual(auths, ["Bearer at1", "Bearer at2"]);
    assert.deepEqual(saved, [{ accessToken: "at2", refreshToken: "rt2" }]);
    await tf("https://example.test/v1/credits/balance", { headers: {} });
    assert.equal(auths[2], "Bearer at2");
  });

  it("returns the 401 when there is no refresh token", async () => {
    const f: typeof fetch = async () => json(401, { success: false });
    const tf = tokenFetch({ accessToken: "at1", refreshToken: null, clientId: null }, { fetch: f, site: "https://example.test", onRefresh: () => {} });
    assert.equal((await tf("https://example.test/v1/x", {})).status, 401);
  });
});
