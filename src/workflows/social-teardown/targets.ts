// What the person typed, read into accounts: "@handle" (X), "tiktok:@name", or a profile link
// on any platform the teardown reads. Several handles of one brand are kept once each.

export type TeardownPlatform = "x" | "tiktok" | "instagram" | "youtube" | "linkedin" | "reddit" | "threads";

export const PLATFORMS: TeardownPlatform[] = ["x", "tiktok", "instagram", "youtube", "linkedin", "reddit", "threads"];

export interface Target {
  platform: TeardownPlatform;
  /** Lower case for X, TikTok, Instagram, Threads and Reddit; a YouTube channel id keeps its case. */
  handle: string;
  url: string;
  channelId?: string;
  linkedinKind?: "company" | "member";
}

export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetError";
  }
}

const ALIASES: Record<string, TeardownPlatform> = {
  x: "x",
  twitter: "x",
  tiktok: "tiktok",
  tt: "tiktok",
  instagram: "instagram",
  ig: "instagram",
  youtube: "youtube",
  yt: "youtube",
  linkedin: "linkedin",
  li: "linkedin",
  reddit: "reddit",
  threads: "threads",
};

const POST_LINK = /\/(status|video|p|reel|reels|shorts|watch|post|posts|comments)\//i;

function postLink(raw: string): never {
  throw new TargetError(`"${raw}" is a link to one post. social-teardown reads a whole account: pass the account (for example @handle), or run video-teardown on the post.`);
}

function urlOf(platform: TeardownPlatform, handle: string): string {
  switch (platform) {
    case "x":
      return `https://x.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
    case "youtube":
      return `https://www.youtube.com/@${handle}`;
    case "reddit":
      return `https://www.reddit.com/user/${handle}/`;
    case "threads":
      return `https://www.threads.net/@${handle}`;
    case "linkedin":
      return handle;
  }
}

function fromUrl(raw: string): Target {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new TargetError(`"${raw}" is not a link this tool can read.`);
  }
  const host = u.hostname.replace(/^(www|m|mobile)\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (POST_LINK.test(u.pathname + "/") || (host === "youtu.be")) postLink(raw);
  const first = parts[0] ?? "";
  if (host === "x.com" || host === "twitter.com") return named("x", first);
  if (host === "tiktok.com") return named("tiktok", first);
  if (host === "instagram.com") return named("instagram", first);
  if (host === "threads.net" || host === "threads.com") return named("threads", first);
  if (host === "reddit.com") return named("reddit", first === "user" || first === "u" ? parts[1] ?? "" : first);
  if (host === "youtube.com") {
    if (first === "channel" && parts[1]) return { platform: "youtube", handle: parts[1], channelId: parts[1], url: `https://www.youtube.com/channel/${parts[1]}` };
    return named("youtube", first);
  }
  if (host === "linkedin.com") {
    if ((first === "company" || first === "in") && parts[1]) {
      return { platform: "linkedin", handle: parts[1].toLowerCase(), linkedinKind: first === "company" ? "company" : "member", url: raw.split(/[?#]/)[0] };
    }
    throw new TargetError(`"${raw}" is not a LinkedIn member or company page (linkedin.com/in/<name> or linkedin.com/company/<name>).`);
  }
  throw new TargetError(`"${raw}": ${host} is not a platform this tool reads. It reads ${PLATFORMS.join(", ")}.`);
}

function named(platform: TeardownPlatform, raw: string): Target {
  const handle = raw.replace(/^@/, "").replace(/^u\//i, "").trim();
  if (!handle || !/^[\w.-]{1,64}$/.test(handle)) throw new TargetError(`"${raw}" is not a ${platform} handle.`);
  const h = platform === "youtube" ? handle : handle.toLowerCase();
  return { platform, handle: h, url: urlOf(platform, h) };
}

/** One account from one piece of input. */
export function parseTarget(input: string): Target {
  const raw = input.trim();
  if (!raw) throw new TargetError("Name an account: @handle for X, or platform:handle, or a profile link.");
  if (/^https?:\/\//i.test(raw)) return fromUrl(raw);
  const m = raw.match(/^([a-z]+):(.+)$/i);
  if (m) {
    const platform = ALIASES[m[1].toLowerCase()];
    if (!platform) throw new TargetError(`"${m[1]}" is not a platform this tool reads. It reads ${PLATFORMS.join(", ")}.`);
    const rest = m[2].trim();
    if (/^https?:\/\//i.test(rest)) return fromUrl(rest);
    if (platform === "linkedin") throw new TargetError(`For LinkedIn pass the page link, for example linkedin.com/company/<name> or linkedin.com/in/<name>.`);
    return named(platform, rest);
  }
  return named("x", raw);
}

/** Every account named, once each, in the order typed. One argument may hold several, split on commas or spaces. */
export function parseTargets(inputs: string[]): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const piece of inputs.flatMap((s) => s.split(/[\s,]+/)).filter(Boolean)) {
    const t = parseTarget(piece);
    const key = `${t.platform}:${t.handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
