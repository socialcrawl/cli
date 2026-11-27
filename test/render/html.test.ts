import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderReport } from "../../src/engine/outputs.ts";
import { renderReportHtml } from "../../src/render/html.ts";
import { sampleRun } from "./sample.ts";

describe("renderReportHtml", () => {
  const run = sampleRun();
  const html = renderReportHtml(run);

  it("separates each evidence id from its claim", () => {
    assert.ok(html.includes('<span class="id">F1</span> A post by Acme'));
  });

  it("keeps a chart readable on a phone: it scrolls rather than shrinking", () => {
    assert.ok(/figure svg\{[^}]*min-width:\s*\d+px/.test(html));
  });

  it("is one page that fetches nothing", () => {
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(!/<link\b/i.test(html), "no stylesheet links");
    assert.ok(!/<script\b[^>]*\bsrc=/i.test(html), "no script files");
    assert.ok(!/@import/i.test(html));
    assert.ok(!/\bsrc="https?:/i.test(html), "no remote images");
    assert.ok(!/url\(\s*["']?https?:/i.test(html), "no remote CSS assets");
  });

  it("titles the page with the command", () => {
    assert.ok(html.includes("<title>/social-viral &quot;AI coding tools&quot;</title>"));
  });

  it("shows the stat tiles, each linked to its evidence entry where it has one", () => {
    assert.ok(html.includes("Posts read"));
    assert.ok(/<a class="tile" href="#F1">/.test(html));
  });

  it("draws the charts as inline SVG", () => {
    assert.ok(html.includes("<svg"));
    assert.ok(html.includes("Break-out multiple"));
  });

  it("says everything report.md says: every summary line and section", () => {
    const md = renderReport(run.report);
    assert.ok(md.includes("Acme's post reached 41x its usual views"));
    assert.ok(html.includes("Acme&#39;s post reached 41x its usual views"));
    assert.ok(html.includes('<th>Post</th><th class="num">Multiple</th>'));
    assert.ok(html.includes("What we could not verify"));
    assert.ok(html.includes("LinkedIn views: LinkedIn gives no view count"));
  });

  it("lists every finding with its anchor, its confidence and its request ids", () => {
    assert.ok(html.includes('id="F1"'));
    assert.ok(html.includes('id="F2"'));
    assert.ok(html.includes("req-1"));
    assert.ok(html.includes("inferred"));
  });

  it("links the summary's finding references to the evidence", () => {
    assert.ok(html.includes('<a class="ref" href="#F1">F1</a>'));
  });

  it("names the files of the run folder and what the run did not read", () => {
    assert.ok(html.includes('href="data/posts.csv"'));
    assert.ok(html.includes('href="responses.jsonl"'));
    assert.ok(html.includes("linkedin/profile/posts"));
  });

  it("ends with the SocialCrawl line", () => {
    assert.ok(html.includes("Read with SocialCrawl /social-viral · 59 credits"));
  });
});
