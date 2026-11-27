// The shared kit of every SocialCrawl open-source app (build sheet C1).
//
// Every app prices before it spends, prints what each call cost, shows the
// 402 offer word for word and never retries it, and names itself so its calls
// can be counted. No runtime dependencies: Node 20+ fetch only.
//
// Help: socialcrawl@ridio.io. Licence: MIT.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const SITE = "https://www.socialcrawl.dev";
export const API = `${SITE}/v1`;

const APP_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type Params = Record<string, string | number | boolean | undefined>;

export interface ApiBody {
  success: boolean;
  data?: unknown;
  error?: { type?: string; message?: string; status?: number; details?: Record<string, any> };
  credits_used?: number;
  credits_remaining?: number | null;
  request_id?: string;
  [key: string]: unknown;
}

/** The header and user agent an app sends, so its calls are its own surface. */
export function clientHeaders(app: string, version: string): Record<string, string> {
  if (!APP_NAME.test(app) || app.length > 64) {
    throw new Error(`"${app}" is not a valid app name: lower-case words joined by "-"`);
  }
  return {
    "X-SocialCrawl-Client": `template:${app}`,
    "User-Agent": `socialcrawl-${app}/${version} (+https://github.com/socialcrawl/${app})`,
  };
}

/** Where a person without a key signs up. UTM values only, never `ref`. */
export function getAKeyUrl(app: string): string {
  return `${SITE}/auth/register?utm_source=github&utm_medium=open-source&utm_campaign=${app}`;
}

export interface Offer {
  nextStep: string | null;
  topUpUrl: string | null;
  checkoutUrl: string | null;
  pack: { name: string; credits: number; priceDisplay: string; daysAtCurrentBurn: number | null } | null;
  firstPackBonus: { credits: number; percent: number; endsAt: string } | null;
  autoRechargeSetupUrl: string | null;
  topUpRequested: boolean;
}

/** The offer in a 402 `INSUFFICIENT_CREDITS` answer, or null for anything else. */
export function readOffer(body: ApiBody): Offer | null {
  if (body?.error?.type !== "INSUFFICIENT_CREDITS") return null;
  const d = body.error.details ?? {};
  const p = d.recommended_pack;
  const bonus = p?.first_pack_bonus;
  return {
    nextStep: d.next_step ?? null,
    topUpUrl: d.top_up_url ?? null,
    checkoutUrl: d.checkout_url ?? null,
    pack: p
      ? {
          name: p.name,
          credits: p.credits,
          priceDisplay: p.price_display,
          daysAtCurrentBurn: p.days_at_current_burn ?? null,
        }
      : null,
    firstPackBonus: bonus
      ? { credits: bonus.credits, percent: bonus.percent, endsAt: bonus.ends_at }
      : null,
    autoRechargeSetupUrl: d.auto_recharge?.setup_url ?? null,
    topUpRequested: d.auto_recharge?.top_up_requested === true,
  };
}

const n = (x: number) => x.toLocaleString("en-GB");

/** The offer as lines for a terminal, a log or a card. Only what the API sent. */
export function offerLines(offer: Offer): string[] {
  const lines = ["Out of credits."];
  if (offer.nextStep) lines.push(offer.nextStep);
  if (offer.topUpRequested) {
    lines.push("Auto-recharge has been asked for a top-up. Run again once it lands.");
    return lines;
  }
  if (offer.pack) {
    const days = offer.pack.daysAtCurrentBurn;
    lines.push(
      `${offer.pack.name}: ${n(offer.pack.credits)} credits for ${offer.pack.priceDisplay}` +
        (days === null ? "" : `, about ${days} days at your current rate`),
    );
  }
  if (offer.firstPackBonus) {
    const b = offer.firstPackBonus;
    lines.push(`Your first pack comes with ${n(b.credits)} more credits (${b.percent}%) if checkout starts before ${b.endsAt}.`);
  }
  if (offer.checkoutUrl) lines.push(`Buy it: ${offer.checkoutUrl}`);
  else if (offer.topUpUrl) lines.push(`Top up: ${offer.topUpUrl}`);
  if (offer.autoRechargeSetupUrl) lines.push(`Turn on auto-recharge: ${offer.autoRechargeSetupUrl}`);
  return lines;
}

export class ApiError extends Error {
  status: number;
  type: string;
  requestId: string | null;
  body: ApiBody;
  constructor(status: number, body: ApiBody) {
    super(body?.error?.message ?? `SocialCrawl answered ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.type = body?.error?.type ?? "UNKNOWN";
    this.requestId = body?.request_id ?? null;
    this.body = body;
  }
}

/** A 402. Show `offerLines(err.offer)`; retrying will not succeed. */
export class OutOfCredits extends ApiError {
  offer: Offer;
  constructor(body: ApiBody) {
    super(402, body);
    this.name = "OutOfCredits";
    this.offer = readOffer(body)!;
  }
}

/** One line per call: what it cost, what is left and the request id. */
export function costLine(body: ApiBody): string {
  const used = body.credits_used ?? 0;
  const left = body.credits_remaining;
  return `${used} credit${used === 1 ? "" : "s"} used, ${left ?? "?"} left (${body.request_id ?? "no request id"})`;
}

export interface KitOptions {
  app: string;
  version: string;
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

function query(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createKit(opts: KitOptions) {
  const base = opts.baseUrl ?? API;
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? ((line: string) => console.error(line));
  const headers: Record<string, string> = { ...clientHeaders(opts.app, opts.version) };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  else if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  else throw new Error(`Set SOCIALCRAWL_API_KEY. Get a key: ${getAKeyUrl(opts.app)}`);

  async function request(method: string, path: string, params: Params = {}, json?: unknown): Promise<ApiBody> {
    const res = await doFetch(`${base}/${path.replace(/^\//, "")}${query(params)}`, {
      method,
      headers: json === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const body = (await res.json().catch(() => ({ success: false }))) as ApiBody;
    if (res.status === 402 && readOffer(body)) throw new OutOfCredits(body);
    if (!res.ok || body.success === false) throw new ApiError(res.status, body);
    log(costLine(body));
    return body;
  }

  return {
    /** GET a `/v1` endpoint, for example `call("instagram/profile/posts", { handle })`. */
    call: (path: string, params: Params = {}) => request("GET", path, params),
    /** POST to a `/v1` endpoint (jobs, listeners, watches). */
    post: (path: string, json: unknown, params: Params = {}) => request("POST", path, params, json),
    /** The free quote for an endpoint, by its slash id. */
    async estimate(id: string, params: Params = {}) {
      const body = await request("GET", "utility/estimate", { id, ...params });
      return body.data as { hold: number; expected_min?: number; expected_max?: number; valid: boolean };
    },
    /** The free balance read. */
    balance: () => request("GET", "credits/balance"),
  };
}

/**
 * The key from `SOCIALCRAWL_API_KEY`, or from a key file that must live
 * outside the app's folder so it is never committed.
 */
export function loadApiKey(opts: { env?: Record<string, string | undefined>; keyFile?: string; repoRoot?: string; app?: string } = {}): string {
  const env = opts.env ?? process.env;
  const fromEnv = env.SOCIALCRAWL_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (opts.keyFile) {
    const root = path.resolve(opts.repoRoot ?? process.cwd());
    const file = path.resolve(opts.keyFile);
    if (file === root || file.startsWith(root + path.sep)) {
      throw new Error(`The key file ${file} is inside the repository, where it could be committed. Move it outside, or set SOCIALCRAWL_API_KEY.`);
    }
    if (existsSync(file)) {
      const match = readFileSync(file, "utf8").match(/^\s*SOCIALCRAWL_API_KEY\s*=\s*(\S+)/m);
      if (match) return match[1];
    }
  }
  throw new Error(`Set SOCIALCRAWL_API_KEY. Get a key, with free credits and no card: ${getAKeyUrl(opts.app ?? "open-source")}`);
}

/** The row a scheduled pull writes even when nothing is new. */
export function heartbeat(newRows: number, at: Date = new Date()) {
  return { kind: "heartbeat", at: at.toISOString(), new_rows: newRows };
}

export interface LoginOptions {
  app: string;
  email: string;
  fetch?: typeof fetch;
  show: (verificationUri: string, userCode: string) => void;
  sleep?: (ms: number) => Promise<void>;
  site?: string;
}

/**
 * Sign in without a key: the agent registration described at
 * https://www.socialcrawl.dev/auth.md. The person opens the link, signs in or
 * signs up, and types the code. Store the tokens in the user's config folder.
 */
export async function login(opts: LoginOptions) {
  const claim = await startLogin(opts);
  opts.show(claim.verificationUri, claim.userCode);
  const r = await pollLogin(claim, { ...opts, tries: Infinity });
  if (r.status === "done") return r.tokens;
  throw new Error(r.status === "failed" ? `Sign-in stopped: ${r.error}` : "Sign-in stopped.");
}

export interface LoginClaim {
  claimToken: string;
  verificationUri: string;
  userCode: string;
  /** Seconds between polls. */
  interval: number;
}

export type LoginPoll =
  | { status: "done"; tokens: { accessToken: string; refreshToken: string | null; clientId: string | null } }
  | { status: "pending" }
  | { status: "failed"; error: string };

/** Register the sign-in: the link and code the person needs, and the claim to poll with. */
export async function startLogin(opts: { app: string; email: string; fetch?: typeof fetch; site?: string }): Promise<LoginClaim> {
  const site = opts.site ?? SITE;
  const doFetch = opts.fetch ?? fetch;
  const reg = await doFetch(`${site}/api/auth/agent/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "service_auth", login_hint: opts.email, client_name: opts.app }),
  });
  const claim = (await reg.json()) as { claim_token?: string; claim?: { user_code: string; verification_uri: string; interval?: number } };
  if (!reg.ok || !claim.claim_token || !claim.claim) throw new Error(`Sign-in could not start (${reg.status}).`);
  return { claimToken: claim.claim_token, verificationUri: claim.claim.verification_uri, userCode: claim.claim.user_code, interval: claim.claim.interval ?? 5 };
}

/** A new 6-digit code for a started sign-in whose code expired (a code lasts 10 minutes, the claim an hour). */
export async function renewLogin(o: { claimToken: string; email: string; fetch?: typeof fetch; site?: string }): Promise<Omit<LoginClaim, "claimToken"> | null> {
  const doFetch = o.fetch ?? fetch;
  const res = await doFetch(`${o.site ?? SITE}/api/auth/agent/identity/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim_token: o.claimToken, email: o.email }),
  });
  const body = (await res.json().catch(() => ({}))) as { claim?: { user_code?: string; verification_uri?: string; interval?: number } };
  if (!res.ok || !body.claim?.user_code || !body.claim.verification_uri) return null;
  return { userCode: body.claim.user_code, verificationUri: body.claim.verification_uri, interval: body.claim.interval ?? 5 };
}

/** Poll a started sign-in up to `tries` times; "pending" when the person has not signed in yet. */
export async function pollLogin(
  claim: { claimToken: string; interval: number },
  opts: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; site?: string; tries?: number },
): Promise<LoginPoll> {
  const site = opts.site ?? SITE;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const wait = claim.interval * 1000;
  const form = new URLSearchParams({ grant_type: "urn:workos:agent-auth:grant-type:claim", claim_token: claim.claimToken });
  for (let i = 0; i < (opts.tries ?? Infinity); i++) {
    await sleep(wait);
    const res = await doFetch(`${site}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (res.status === 429) continue;
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; client_id?: string; error?: string };
    if (res.ok && body.access_token) {
      return { status: "done", tokens: { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, clientId: body.client_id ?? null } };
    }
    if (body.error === "authorization_pending" || body.error === "slow_down") continue;
    return { status: "failed", error: String(body.error ?? res.status) };
  }
  return { status: "pending" };
}
