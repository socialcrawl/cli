// The shared kit of every SocialCrawl open-source app (build sheet C1).
// Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fixturePath } from "../fixture-path.ts";

import {
  ApiError,
  OutOfCredits,
  clientHeaders,
  createKit,
  getAKeyUrl,
  heartbeat,
  loadApiKey,
  login,
  offerLines,
  readOffer,
} from "../../src/kit/kit.ts";

const fixture = (name: string) => JSON.parse(readFileSync(fixturePath("kit", name), "utf8"));

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fn = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("no response left");
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { fn: fn as typeof fetch, calls };
}

const header = (call: Call, name: string) =>
  new Headers(call.init.headers).get(name);

describe("clientHeaders", () => {
  it("names the app as a template surface and in the user agent", () => {
    assert.deepEqual(clientHeaders("list-tracker", "0.1.0"), {
      "X-SocialCrawl-Client": "template:list-tracker",
      "User-Agent":
        "socialcrawl-list-tracker/0.1.0 (+https://github.com/socialcrawl/list-tracker)",
    });
  });

  it("refuses a name the API would ignore", () => {
    assert.throws(() => clientHeaders("List Tracker", "0.1.0"));
    assert.throws(() => clientHeaders("", "0.1.0"));
  });
});

describe("the 402 offer", () => {
  it("reads every field an app shows", () => {
    const offer = readOffer(fixture("402.json"));
    assert.ok(offer);
    assert.equal(offer.pack?.name, "Growth");
    assert.equal(offer.pack?.priceDisplay, "£49");
    assert.equal(offer.pack?.daysAtCurrentBurn, 31);
    assert.match(offer.checkoutUrl ?? "", /checkout\?token=/);
    assert.match(offer.autoRechargeSetupUrl ?? "", /autorecharge=enable/);
    assert.equal(offer.firstPackBonus, null);
  });

  it("is null for any other answer", () => {
    assert.equal(readOffer(fixture("400.json")), null);
    assert.equal(readOffer(fixture("200-estimate.json")), null);
  });

  it("prints the next step, the pack, checkout and auto-recharge, word for word", () => {
    const lines = offerLines(readOffer(fixture("402.json"))!).join("\n");
    assert.match(lines, /Top up your credits on the billing page/);
    assert.match(lines, /Growth: 20,000 credits for £49, about 31 days at your current rate/);
    assert.match(lines, /checkout\?token=eyJzdWIi/);
    assert.match(lines, /autorecharge=enable/);
    assert.doesNotMatch(lines, /more credits/);
  });

  it("shows the first-pack bonus only when the API sends it", () => {
    const body = fixture("402.json");
    body.error.details.recommended_pack.first_pack_bonus = {
      credits: 4000,
      percent: 20,
      ends_at: "2026-11-26T14:00:00.000Z",
    };
    const lines = offerLines(readOffer(body)!).join("\n");
    assert.match(lines, /4,000 more credits \(20%\) if checkout starts before 2026-11-26T14:00:00.000Z/);
  });
});

describe("call", () => {
  const app = { app: "list-tracker", version: "0.1.0", apiKey: "sc_live_test" };

  it("sends the key, the surface and the user agent, and prints the cost line", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { success: true, data: [1], credits_used: 1, credits_remaining: 99, request_id: "req-1" } },
    ]);
    const log: string[] = [];
    const kit = createKit({ ...app, fetch: fn, log: (l) => log.push(l) });
    const body = await kit.call("instagram/profile/posts", { handle: "nasa" });
    assert.deepEqual(body.data, [1]);
    assert.equal(calls[0].url, "https://www.socialcrawl.dev/v1/instagram/profile/posts?handle=nasa");
    assert.equal(header(calls[0], "x-api-key"), "sc_live_test");
    assert.equal(header(calls[0], "x-socialcrawl-client"), "template:list-tracker");
    assert.match(header(calls[0], "user-agent") ?? "", /^socialcrawl-list-tracker\/0\.1\.0/);
    assert.deepEqual(log, ["1 credit used, 99 left (req-1)"]);
  });

  it("raises OutOfCredits with the offer on a 402 and never retries it", async () => {
    const { fn, calls } = fakeFetch([{ status: 402, body: fixture("402.json") }]);
    const kit = createKit({ ...app, fetch: fn, log: () => {} });
    await assert.rejects(kit.call("instagram/profile/posts", { handle: "nasa" }), (err) => {
      assert.ok(err instanceof OutOfCredits);
      assert.equal(err.offer.pack?.name, "Growth");
      assert.equal(err.requestId, "req-abc123");
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("raises ApiError with the type and message on any other refusal", async () => {
    const { fn } = fakeFetch([{ status: 400, body: fixture("400.json") }]);
    const kit = createKit({ ...app, fetch: fn, log: () => {} });
    await assert.rejects(kit.call("instagram/profile/posts", {}), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.type, "INVALID_PARAMETER");
      assert.equal(err.status, 400);
      assert.equal(err.requestId, "req-bad400");
      return true;
    });
  });

  it("sends an OAuth token from login as a bearer token", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { success: true, data: {}, credits_used: 0, credits_remaining: 100, request_id: "req-2" } },
    ]);
    const kit = createKit({ app: "list-tracker", version: "0.1.0", accessToken: "tok_1", fetch: fn, log: () => {} });
    await kit.balance();
    assert.equal(calls[0].url, "https://www.socialcrawl.dev/v1/credits/balance");
    assert.equal(header(calls[0], "authorization"), "Bearer tok_1");
    assert.equal(header(calls[0], "x-api-key"), null);
  });
});

describe("estimate", () => {
  it("asks the free quote by the endpoint's slash id and returns the hold", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: fixture("200-estimate.json") }]);
    const kit = createKit({ app: "list-tracker", version: "0.1.0", apiKey: "sc_live_test", fetch: fn, log: () => {} });
    const quote = await kit.estimate("instagram/profile/posts", { handle: "nasa" });
    assert.equal(quote.hold, 1);
    assert.equal(
      calls[0].url,
      "https://www.socialcrawl.dev/v1/utility/estimate?id=instagram%2Fprofile%2Fposts&handle=nasa",
    );
  });
});

describe("loadApiKey", () => {
  it("reads SOCIALCRAWL_API_KEY from the environment", () => {
    assert.equal(loadApiKey({ env: { SOCIALCRAWL_API_KEY: " sc_live_x " } }), "sc_live_x");
  });

  it("refuses a key file inside the app's own folder", () => {
    const repo = path.join(tmpdir(), "my-app");
    assert.throws(
      () => loadApiKey({ env: {}, keyFile: path.join(repo, ".env"), repoRoot: repo }),
      /inside the repository/,
    );
  });

  it("says where to get a key when none is set", () => {
    assert.throws(() => loadApiKey({ env: {}, app: "list-tracker" }), /utm_campaign=list-tracker/);
  });
});

describe("getAKeyUrl", () => {
  it("carries UTM values and never a referral code", () => {
    const url = getAKeyUrl("list-tracker");
    assert.equal(
      url,
      "https://www.socialcrawl.dev/auth/register?utm_source=github&utm_medium=open-source&utm_campaign=list-tracker",
    );
    assert.doesNotMatch(url, /[?&]ref=/);
  });
});

describe("heartbeat", () => {
  it("is one row with the time and the count, so a stopped job shows", () => {
    const row = heartbeat(3, new Date("2026-11-23T06:17:00Z"));
    assert.deepEqual(row, { kind: "heartbeat", at: "2026-11-23T06:17:00.000Z", new_rows: 3 });
  });
});

describe("login", () => {
  it("registers by email, shows the code, polls until the token comes", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          claim_token: "clm_1",
          claim: { user_code: "123456", verification_uri: "https://www.socialcrawl.dev/auth/agent-claim?x=1", interval: 5, expires_in: 600 },
        },
      },
      { status: 400, body: { error: "authorization_pending" } },
      { status: 200, body: { access_token: "tok_1", refresh_token: "ref_1", client_id: "cli_1" } },
    ]);
    const shown: string[] = [];
    const slept: number[] = [];
    const tokens = await login({
      app: "list-tracker",
      email: "person@example.com",
      fetch: fn,
      show: (uri, code) => shown.push(`${uri} ${code}`),
      sleep: async (ms) => void slept.push(ms),
    });
    assert.deepEqual(tokens, { accessToken: "tok_1", refreshToken: "ref_1", clientId: "cli_1" });
    assert.deepEqual(shown, ["https://www.socialcrawl.dev/auth/agent-claim?x=1 123456"]);
    assert.deepEqual(slept, [5000, 5000]);
    assert.equal(calls[0].url, "https://www.socialcrawl.dev/api/auth/agent/identity");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      type: "service_auth",
      login_hint: "person@example.com",
      client_name: "list-tracker",
    });
    assert.equal(calls[1].url, "https://www.socialcrawl.dev/api/auth/oauth2/token");
    assert.equal(
      String(calls[1].init.body),
      "grant_type=urn%3Aworkos%3Aagent-auth%3Agrant-type%3Aclaim&claim_token=clm_1",
    );
  });

  it("stops on a refusal that polling cannot fix", async () => {
    const { fn } = fakeFetch([
      { status: 200, body: { claim_token: "clm_1", claim: { user_code: "1", verification_uri: "u", interval: 1 } } },
      { status: 400, body: { error: "access_denied" } },
    ]);
    await assert.rejects(
      login({ app: "list-tracker", email: "p@example.com", fetch: fn, show: () => {}, sleep: async () => {} }),
      /access_denied/,
    );
  });
});
