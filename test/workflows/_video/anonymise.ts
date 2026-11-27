// Turns a recorded live response into a public fixture. Accounts under 10,000 followers, or of
// unknown size and not on the keep list, get a stable alias (u001), an example.invalid link,
// and their text cut to 60 characters with mentions, links, emails and phone numbers masked.
// Commenters are always aliased. Counts, dates, ids and request ids are kept, so the fixture
// still exercises the maths. Media, avatars, cursors and creator ids are dropped.

export interface AnonymiseOptions {
  /** Handles or channel ids kept by name (companies and accounts known to have 10,000 followers or more). */
  keep?: string[];
  /** Shared across records so one account keeps one alias. */
  aliases?: Map<string, string>;
}

const BIG = 10_000;
const DROP_POST = ["media_urls", "thumbnail_url"];
const DROP_EXT = ["author_id", "author_url", "author_following", "matched_song_artist", "description", "coauthors", "mentions", "usertags", "published_at_epoch"];

export function scrub(text: string, max: number): string {
  const s = text
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/@[\w.]+/g, "@[account]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "");
}

export function anonymise(rec: any, opts: AnonymiseOptions = {}): any {
  const aliases = opts.aliases ?? new Map<string, string>();
  const keep = new Set((opts.keep ?? []).map((k) => k.toLowerCase()));
  const out = structuredClone(rec);
  const alias = (key: string, prefix: "u" | "c") => {
    const k = `${prefix}:${key.toLowerCase()}`;
    if (!aliases.has(k)) aliases.set(k, `${prefix}${String([...aliases.keys()].filter((x) => x.startsWith(`${prefix}:`)).length + 1).padStart(3, "0")}`);
    return aliases.get(k) as string;
  };
  let cursors = 0;
  const pg = out.response?.pagination;
  if (pg?.next_cursor) pg.next_cursor = `cursor-${++cursors}`;
  const d = out.response?.data ?? {};
  if (d.next_cursor) d.next_cursor = `cursor-${++cursors}`;

  const items: any[] = Array.isArray(d.items) ? d.items : d.post ? [{ post: d.post }] : [];
  for (const it of items) {
    if (it.post) post(it.post);
    if (it.comment) comment(it.comment);
  }
  if (Array.isArray(d.results)) for (const r of d.results) if (typeof r?.data?.transcript === "string") r.data.transcript = scrub(r.data.transcript, 300);
  if (typeof d.transcript === "string") d.transcript = scrub(d.transcript, 300);
  return out;

  function post(p: any) {
    const a = p.author ?? {};
    const ext = p.ext ?? {};
    const user: string | null = typeof a.username === "string" ? a.username : null;
    const channel: string | null = typeof ext.channel_id === "string" ? ext.channel_id : null;
    const followers = typeof ext.author_followers === "number" ? ext.author_followers : typeof a.followers === "number" ? a.followers : null;
    const named = (followers !== null && followers >= BIG) || (user !== null && keep.has(user.toLowerCase())) || (channel !== null && keep.has(channel.toLowerCase()));
    for (const k of DROP_POST) if (p.content) delete p.content[k];
    for (const k of DROP_EXT) delete ext[k];
    delete a.avatar_url;
    if (named) return;
    const id = user ?? channel ?? String(p.id);
    const u = user ? alias(user, "u") : null;
    if (u) a.username = u;
    const display = typeof a.display_name === "string" ? a.display_name : null;
    delete a.display_name;
    if (channel) ext.channel_id = alias(channel, "c");
    p.url = `https://example.invalid/${u ?? ext.channel_id ?? "null"}/${p.id}`;
    if (p.content && typeof p.content.text === "string") p.content.text = scrub(p.content.text, 60);
    // A creator's own sound carries their handle or display name: masked, never kept.
    const own =
      ext.music_is_original === true ||
      (typeof ext.music_title === "string" && ext.music_title.toLowerCase().includes(id.toLowerCase())) ||
      (display !== null && ext.music_artist === display);
    if (own) {
      for (const k of ["music_title", "matched_song_title"]) if (typeof ext[k] === "string") ext[k] = "original sound";
      if (typeof ext.music_artist === "string") ext.music_artist = "[creator]";
    }
    if (ext.music && typeof ext.music === "object") ext.music = { id: ext.music.id ?? null, track_title: own ? "original sound" : (ext.music.track_title ?? null) };
  }

  function comment(c: any) {
    if (c.author?.username) c.author = { username: alias(String(c.author.username), "u") };
    else c.author = { username: null };
    if (typeof c.text === "string") c.text = scrub(c.text, 100);
    delete c.url;
  }
}
