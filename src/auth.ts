// A saved email sign-in: an access token that expires and a refresh token that rotates
// (https://www.socialcrawl.dev/auth.md). tokenFetch sends the current access token, and on a
// 401 trades the refresh token for a new pair once, saves it, and retries the request.
import { SITE } from "./kit/kit.ts";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function refreshAccessToken(o: { site?: string; refreshToken: string; clientId: string | null; fetch?: typeof fetch }): Promise<TokenPair> {
  const site = o.site ?? SITE;
  const doFetch = o.fetch ?? fetch;
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: o.refreshToken, resource: site });
  if (o.clientId) form.set("client_id", o.clientId);
  const res = await doFetch(`${site}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Your sign-in has ended (${body.error ?? res.status}). Run socialcrawl init to sign in again.`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? o.refreshToken };
}

export function tokenFetch(
  creds: { accessToken: string; refreshToken: string | null; clientId: string | null },
  o: { fetch?: typeof fetch; site?: string; onRefresh: (t: TokenPair) => void },
): typeof fetch {
  const doFetch = o.fetch ?? fetch;
  let access = creds.accessToken;
  let refresh = creds.refreshToken;
  const send = (input: Parameters<typeof fetch>[0], init: RequestInit | undefined) =>
    doFetch(input, { ...init, headers: { ...((init?.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${access}` } });
  return async (input, init) => {
    const res = await send(input, init);
    if (res.status !== 401 || !refresh) return res;
    const t = await refreshAccessToken({ site: o.site, refreshToken: refresh, clientId: creds.clientId, fetch: doFetch });
    access = t.accessToken;
    refresh = t.refreshToken;
    o.onRefresh(t);
    return send(input, init);
  };
}
