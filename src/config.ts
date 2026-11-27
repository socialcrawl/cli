// ~/.socialcrawl/config.json: the saved key or sign-in, outside every project folder so it
// is never committed. Written owner-only (mode 600) where the OS allows it.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Config {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  /** The agents init installed the workflows into. */
  installed?: string[];
  savedAt?: string;
}

export type Credentials =
  | { kind: "key"; apiKey: string; source: string }
  | { kind: "token"; accessToken: string; refreshToken: string | null; clientId: string | null; source: string };

export const CONFIG_LABEL = "~/.socialcrawl/config.json";

export const configPath = (home: string) => path.join(home, ".socialcrawl", "config.json");

export function readConfig(home: string): Config {
  const file = configPath(home);
  if (!existsSync(file)) return {};
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return c && typeof c === "object" ? (c as Config) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the saved config. Fields set to undefined are removed. */
export function saveConfig(home: string, patch: Partial<Config>): Config {
  const file = configPath(home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const next: Config = { ...readConfig(home), ...patch, savedAt: new Date().toISOString() };
  for (const k of Object.keys(next) as (keyof Config)[]) if (next[k] === undefined) delete next[k];
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows keeps the file in the user's own profile folder instead.
  }
  return next;
}

/** SOCIALCRAWL_API_KEY first, then the saved key, then a saved sign-in. */
export function credentialsFrom(env: Record<string, string | undefined>, config: Config): Credentials | null {
  const fromEnv = env.SOCIALCRAWL_API_KEY?.trim();
  if (fromEnv) return { kind: "key", apiKey: fromEnv, source: "SOCIALCRAWL_API_KEY" };
  if (config.apiKey) return { kind: "key", apiKey: config.apiKey, source: CONFIG_LABEL };
  if (config.accessToken) {
    return { kind: "token", accessToken: config.accessToken, refreshToken: config.refreshToken ?? null, clientId: config.clientId ?? null, source: CONFIG_LABEL };
  }
  return null;
}

/** "sc_Live_…1234": enough to tell keys apart, never enough to use one. */
export function maskKey(key: string): string {
  if (key.length < 12) return "…";
  const prefix = key.match(/^sc_[A-Za-z0-9]+_/)?.[0] ?? key.slice(0, 4);
  return `${prefix}…${key.slice(-4)}`;
}
