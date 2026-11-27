import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderCard675 } from "../../src/render/card.ts";
import { sampleRun } from "./sample.ts";

describe("renderCard675", () => {
  const card = sampleRun().card;
  const svg = renderCard675(card);

  it("is 1200 by 675", () => {
    assert.ok(svg.includes('width="1200" height="675" viewBox="0 0 1200 675"'));
  });

  it("carries the command, each headline and the footer", () => {
    assert.ok(svg.includes("/social-viral &quot;AI coding tools&quot;"));
    assert.ok(svg.includes("Acme&#39;s post reached 41x its usual views") || svg.includes("Acme's post reached 41x its usual views"));
    assert.ok(svg.includes("Read with SocialCrawl /social-viral · 59 credits · 27/11/2026"));
    assert.ok(svg.includes("534 posts read on 6 platforms"));
  });

  it("embeds the logo and fetches nothing", () => {
    assert.ok(svg.includes('href="data:image/png;base64,'));
    assert.ok(!/href="https?:/.test(svg));
  });

  it("wraps a long headline instead of running off the card", () => {
    const lines = (headline: string) => [...renderCard675({ ...card, headlines: [headline] }).matchAll(/<tspan[^>]*>[^<]*<\/tspan>/g)].length;
    const long = "A video by Globex reached 113x the median of its author's twenty earlier videos on TikTok";
    assert.equal(lines(long), lines("Short") + 1);
  });

  it("keeps the space between wrapped lines, so its text reads whole", () => {
    const out = renderCard675({ ...card, headlines: ["Read 9 posts that broke out this week on TikTok and Instagram (9 of 46 measured)"] });
    const text = [...out.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, "")).join("|");
    assert.ok(text.includes("(9 of 46 measured)"), text);
  });

  it("does not break inside a parenthesis when it can break before it", () => {
    const out = renderCard675({ ...card, headlines: ["Read 9 posts that broke out this week on TikTok and Instagram (9 of 46 measured)"] });
    const spans = [...out.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
    assert.ok(!spans.some((s) => /\([^)]*$/.test(s.trim())), spans.join(" / "));
  });

  it("names itself for a screen reader", () => {
    assert.ok(svg.includes('role="img"'));
    assert.ok(/aria-label="[^"]*AI coding tools/.test(svg));
  });

  it("refuses more than three headlines, so it stays one screen", () => {
    assert.throws(() => renderCard675({ ...card, headlines: ["a", "b", "c", "d"] }));
  });
});
