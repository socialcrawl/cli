// The public fixtures carry no private individuals: accounts under 10,000 followers (or of
// unknown size) are aliased, their text cut and masked, commenters always aliased.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anonymise } from "./anonymise.ts";

const post = (over: Record<string, unknown> = {}, ext: Record<string, unknown> = {}) => ({
  post: {
    id: "7712387253263289608",
    url: "https://www.tiktok.com/@smallcreator/video/7712387253263289608",
    content: { text: "Ask @friend or mail me at someone@example.com, this tool is wild and here is a much longer caption that goes on", duration_seconds: 48, media_urls: ["https://cdn/x.mp4"], thumbnail_url: "https://cdn/x.jpg" },
    author: { username: "smallcreator", display_name: "Small Creator", avatar_url: "https://cdn/a.jpg" },
    engagement: { views: 113, likes: 5 },
    ext: { author_followers: 1945, author_id: "6958210029728678918", music_title: "original sound - smallcreator", music_artist: "Small Creator", hashtags: ["ai"], ...ext },
    ...over,
  },
});

describe("anonymise", () => {
  it("aliases an account under 10,000 followers and masks its text", () => {
    const out = anonymise({ endpoint: "tiktok/search", response: { data: { items: [post()] }, pagination: { next_cursor: "eyJxIjoic21hbGxjcmVhdG9yIn0", has_more: true } } });
    const p = out.response.data.items[0].post;
    assert.match(p.author.username, /^u\d{3}$/);
    assert.equal(p.author.display_name, undefined);
    assert.equal(p.author.avatar_url, undefined);
    assert.equal(p.url, `https://example.invalid/${p.author.username}/7712387253263289608`);
    assert.ok(p.content.text.length <= 60, p.content.text);
    assert.doesNotMatch(p.content.text, /@friend|someone@example\.com/);
    assert.equal(p.content.media_urls, undefined);
    assert.equal(p.ext.author_id, undefined);
    assert.doesNotMatch(JSON.stringify(p.ext), /smallcreator|Small Creator/);
    assert.deepEqual(p.ext.hashtags, ["ai"], "hashtags are generic and kept");
    assert.equal(out.response.pagination.next_cursor, "cursor-1");
    assert.equal(p.engagement.views, 113, "numbers are kept");
  });

  it("keeps an account of 10,000 followers or more by name", () => {
    const out = anonymise({ endpoint: "tiktok/search", response: { data: { items: [post({ author: { username: "bigcreator" } }, { author_followers: 74_421 })] } } });
    const p = out.response.data.items[0].post;
    assert.equal(p.author.username, "bigcreator");
    assert.ok(p.content.text.startsWith("Ask"));
  });

  it("keeps a named channel only when it is on the keep list, and aliases its channel id otherwise", () => {
    const yt = (u: string | null, ch: string) => ({ post: { id: "L9iYmDzZh3k", url: "https://www.youtube.com/watch?v=L9iYmDzZh3k", content: { text: "A title" }, author: { username: u }, engagement: { views: 1761 }, ext: { channel_id: ch } } });
    const out = anonymise({ endpoint: "youtube/search", response: { data: { items: [yt("@IBMTechnology", "UCKW"), yt(null, "UCsmall")] } } }, { keep: ["@IBMTechnology", "UCKW"] });
    const [a, b] = out.response.data.items.map((i: any) => i.post);
    assert.equal(a.author.username, "@IBMTechnology");
    assert.equal(a.ext.channel_id, "UCKW");
    assert.match(b.ext.channel_id, /^c\d{3}$/);
  });

  it("aliases every commenter and scrubs contact details from comment text", () => {
    const out = anonymise({ endpoint: "tiktok/post/comments", response: { data: { items: [{ comment: { id: "1", text: "call +44 7700 900123 or @bob, see https://x.co/a", author: { username: "bob", avatar_url: "x" } }, computed: { labels: { question: { p: 0.9 } } } }] } } });
    const c = out.response.data.items[0].comment;
    assert.match(c.author.username, /^u\d{3}$/);
    assert.equal(c.author.avatar_url, undefined);
    assert.doesNotMatch(c.text, /7700|@bob|https/);
    assert.deepEqual(out.response.data.items[0].computed.labels, { question: { p: 0.9 } });
  });

  it("gives the same alias to the same account across records", () => {
    const aliases = new Map<string, string>();
    const a = anonymise({ endpoint: "tiktok/search", response: { data: { items: [post()] } } }, { aliases });
    const b = anonymise({ endpoint: "tiktok/profile/videos", response: { data: { items: [post()] } } }, { aliases });
    assert.equal(a.response.data.items[0].post.author.username, b.response.data.items[0].post.author.username);
  });
});
