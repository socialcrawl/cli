// Who may be named. An account is named on the card and in the report only at 10,000
// followers (subscribers on YouTube) or more; every other account, and every account whose
// size is unknown, is described instead and never linked. The raw data files keep the rows.
import type { Platform } from "../../engine/index.ts";

export const NAME_MIN_FOLLOWERS = 10_000;

export function mayName(followers: number | null): boolean {
  return followers !== null && followers >= NAME_MIN_FOLLOWERS;
}

const n = (x: number) => x.toLocaleString("en-GB");

export interface Account {
  platform: Platform;
  handle: string | null;
  followers: number | null;
  /** A YouTube channel's title, used when it has no handle. */
  title?: string | null;
}

export function accountLabel(a: Account): string {
  const yt = a.platform === "youtube";
  if (mayName(a.followers)) {
    if (a.handle) return a.handle.startsWith("@") ? a.handle : `@${a.handle}`;
    if (a.title) return a.title;
  }
  const who = yt ? "a channel" : "a creator";
  if (a.followers === null) return `${who} of unknown size`;
  return `${who} with ${n(a.followers)} ${yt ? "subscribers" : "followers"}`;
}
