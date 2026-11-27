import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { barChartSvg, wrapText } from "../../src/render/svg.ts";

const widths = (svg: string) => [...svg.matchAll(/<rect class="bar"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));

describe("barChartSvg", () => {
  it("draws one bar per value, the largest at full width and the rest in proportion", () => {
    const svg = barChartSvg({ title: "Break-out multiple", unit: "x", bars: [{ label: "Acme", value: 40 }, { label: "Globex", value: 10 }] });
    const [a, b] = widths(svg);
    assert.equal(widths(svg).length, 2);
    assert.ok(Math.abs(b / a - 0.25) < 0.01);
  });

  it("labels each bar with its value and unit, and gives it a hover title", () => {
    const svg = barChartSvg({ title: "T", unit: "x", bars: [{ label: "Acme", value: 41.25, note: "TikTok" }] });
    assert.ok(svg.includes(">41.3x<"));
    assert.ok(svg.includes("<title>Acme: 41.3x (TikTok)</title>"));
  });

  it("escapes labels", () => {
    const svg = barChartSvg({ title: "T", bars: [{ label: "Acme <b>", value: 1 }] });
    assert.ok(!svg.includes("<b>"));
    assert.ok(svg.includes("Acme &lt;b&gt;"));
  });

  it("links a bar to its finding", () => {
    const svg = barChartSvg({ title: "T", bars: [{ label: "Acme", value: 1, finding: "F2" }] });
    assert.ok(svg.includes('href="#F2"'));
  });

  it("draws nothing broken when every value is zero, or there are no bars", () => {
    const svg = barChartSvg({ title: "T", bars: [{ label: "a", value: 0 }] });
    assert.ok(!svg.includes("NaN"));
    assert.equal(barChartSvg({ title: "T", bars: [] }), "");
  });

  it("has a role and a label for screen readers", () => {
    const svg = barChartSvg({ title: "Break-out multiple", bars: [{ label: "a", value: 1 }] });
    assert.ok(svg.includes('role="img"'));
    assert.ok(svg.includes('aria-label="Break-out multiple"'));
  });
});

describe("wrapText", () => {
  it("breaks at spaces so no line passes the limit", () => {
    const lines = wrapText("TikTok led with three of the top five break-outs this week", 24);
    assert.ok(lines.length > 1);
    for (const l of lines) assert.ok(l.length <= 24, l);
    assert.equal(lines.join(" "), "TikTok led with three of the top five break-outs this week");
  });

  it("cuts to the line count asked for, ending with an ellipsis", () => {
    const lines = wrapText("one two three four five six seven eight nine ten", 9, 2);
    assert.equal(lines.length, 2);
    assert.ok(lines[1].endsWith("…"));
  });
});
