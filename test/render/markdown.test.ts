import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mdToHtml } from "../../src/render/markdown.ts";

describe("mdToHtml", () => {
  it("escapes HTML in the text, so a post can never inject markup", () => {
    const html = mdToHtml('A post said <script>alert("x")</script> & more');
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&amp; more"));
  });

  it("renders headings, paragraphs and both kinds of list", () => {
    const html = mdToHtml("# Title\n\n## Part\n\nOne line\nsame paragraph\n\n- a\n- b\n\n1. first\n2. second");
    assert.ok(html.includes("<h1>Title</h1>"));
    assert.ok(html.includes("<h2>Part</h2>"));
    assert.ok(html.includes("<p>One line same paragraph</p>"));
    assert.ok(html.includes("<ul><li>a</li><li>b</li></ul>"));
    assert.ok(html.includes("<ol><li>first</li><li>second</li></ol>"));
  });

  it("renders a pipe table with its header row", () => {
    const html = mdToHtml("| Post | Multiple |\n| --- | ---: |\n| Acme | 41x |");
    assert.ok(html.includes("<table>"));
    assert.ok(html.includes("<th>Post</th><th>Multiple</th>"));
    assert.ok(html.includes("<td>Acme</td><td>41x</td>"));
  });

  it("links http and https only", () => {
    const html = mdToHtml("[post](https://x.com/acme/status/1) and [bad](javascript:alert(1))");
    assert.ok(html.includes('<a href="https://x.com/acme/status/1">post</a>'));
    assert.ok(!html.includes('href="javascript'));
  });

  it("turns a finding reference into a link to its evidence entry, when the finding exists", () => {
    const html = mdToHtml("Reached 41x [F1], see also [F9]", new Set(["F1"]));
    assert.ok(html.includes('<a class="ref" href="#F1">F1</a>'));
    assert.ok(html.includes("[F9]"));
  });

  it("renders bold and inline code", () => {
    const html = mdToHtml("Read the **top** one with `socialcrawl social-viral`");
    assert.ok(html.includes("<strong>top</strong>"));
    assert.ok(html.includes("<code>socialcrawl social-viral</code>"));
  });

  it("renders quoted lines as one blockquote", () => {
    const html = mdToHtml(["Someone asked:", "", "> Which tool reads Reddit?", "> I need **one** that works", "", "After"].join("\n"));
    assert.ok(html.includes("<blockquote><p>Which tool reads Reddit? I need <strong>one</strong> that works</p></blockquote>"), html);
    assert.ok(html.includes("<p>After</p>"));
  });

  it("renders a horizontal rule", () => {
    assert.ok(mdToHtml("a\n\n---\n\nb").includes("<hr>"));
  });
});
