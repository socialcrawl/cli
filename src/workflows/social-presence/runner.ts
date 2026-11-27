// /social-presence, run: price the name search for free, search six platforms, then read one
// page of recent posts for each account a link confirms or a judgment supports.
import type { CostLedger, Meta } from "../../engine/rates.ts";
import { rowsOf } from "../../engine/rows.ts";
import type { CallRecord, Session } from "../../kit/record.ts";
import { activityCall, activityOf, statusOf } from "./presence.ts";
import type { Activity, PlatformAnswer, Verdict } from "./presence.ts";

export const PRESENCE_PLATFORMS = "linkedin,instagram,tiktok,twitter,threads,youtube";

export interface PresenceInput {
  name: string;
  type: "company" | "person";
  website?: string;
}

export interface AccountRead extends Verdict {
  platform: string;
  activity: Activity | null;
  /** Why recent posts were not read, when they were not. */
  activityNotRead: string | null;
  activityRequest: string | null;
}

export interface PresenceOutput {
  find: CallRecord | null;
  /** Why the name was not searched, when it was not. */
  notSearched: string | null;
  notice: string | null;
  accounts: AccountRead[];
  /** Every candidate ranked, per platform, for the raw data. */
  candidates: { platform: string; rank: number; handle: string; url: string | null; followers: number | null; probability: number | null }[];
  records: CallRecord[];
  meta: Meta;
  ledger: CostLedger;
  notRead: Session["notRead"];
  errors: Session["errors"];
}

export async function runPresence(session: Session, input: PresenceInput, now: () => Date): Promise<PresenceOutput> {
  const params = { name: input.name, type: input.type, platforms: PRESENCE_PLATFORMS, ...(input.website ? { website: input.website } : {}) };
  let notSearched: string | null = null;
  let find: CallRecord | null = null;
  const quote = await session.call("find:quote", "utility/estimate", { id: "prism/find-accounts", ...params });
  const data = quote?.body.data as { hold?: unknown; expected_max?: unknown } | undefined;
  const hold = Number(data?.hold ?? data?.expected_max);
  if (!quote || !Number.isFinite(hold)) notSearched = "its free quote did not come back";
  else if (hold > session.budget.left) {
    session.notRead.push({ stage: "find:search", endpoint: "prism/find-accounts", reason: "budget", limit: "run" });
    notSearched = `its quote asks for ${hold} credits and this run had ${session.budget.left} left`;
  } else {
    find = await session.call("find:search", "prism/find-accounts", params);
    if (!find) notSearched = "the API refused the search";
  }

  const answer = (find?.body.data ?? {}) as { platforms?: PlatformAnswer[]; notice?: string };
  const platforms = answer.platforms ?? [];
  const accounts: AccountRead[] = [];
  for (const p of platforms) {
    const v = statusOf(p);
    const acc: AccountRead = { platform: p.platform, ...v, activity: null, activityNotRead: null, activityRequest: null };
    if ((v.status === "confirmed" || v.status === "judged") && v.handle) {
      const c = activityCall(p.platform, v.handle, v.url);
      if ("why" in c) acc.activityNotRead = c.why;
      else {
        const rec = await session.call(`activity:${p.platform}`, c.endpoint, c.params, 5);
        if (rec) {
          acc.activity = activityOf(rowsOf(rec), now());
          acc.activityRequest = rec.requestId;
        } else acc.activityNotRead = "the read of its recent posts did not come back";
      }
    }
    accounts.push(acc);
  }
  const candidates = platforms.flatMap((p) =>
    (p.candidates ?? []).map((c, i) => ({ platform: p.platform, rank: i + 1, handle: c.handle, url: c.url ?? null, followers: c.followers ?? null, probability: (c as { choice_probability?: number }).choice_probability ?? null })),
  );
  return { find, notSearched, notice: answer.notice ?? null, accounts, candidates, records: session.records.filter((r) => r.status === 200), meta: session.meta(), ledger: session.ledger, notRead: session.notRead, errors: session.errors };
}
