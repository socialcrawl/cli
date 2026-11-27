// The one look of every report and card, from codebase DESIGN.md: the neutral register
// (§2.1: white canvas, black ink, an alpha ladder for secondary text and lines) and the
// logo's own colours for chart bars and small marks (§2.2, §7). CSS takes the OKLCH
// values; SVG takes the hex, since many SVG viewers cannot read oklch().
export const COLOR = {
  canvas: { css: "oklch(1 0 0)", hex: "#ffffff" },
  ink: { css: "oklch(0 0 0)", hex: "#000000" },
  /** Secondary text: ink at 64%. */
  ink2: { css: "oklch(0 0 0 / 64%)", hex: "#5c5c5c" },
  /** Metadata: ink at 56% (clears 4.5:1 on white). */
  muted: { css: "oklch(0 0 0 / 56%)", hex: "#707070" },
  line: { css: "oklch(0 0 0 / 10%)", hex: "#e6e6e6" },
  lineSoft: { css: "oklch(0 0 0 / 6%)", hex: "#f0f0f0" },
  /** The quiet 4% band. */
  band: { css: "oklch(0 0 0 / 4%)", hex: "#f5f5f5" },
  /** Logo yellow: small fills only, never text or a thin line. */
  brand: { css: "oklch(0.885 0.183 95)", hex: "#ffd600" },
  /** Logo petals: the lead chart series. */
  brandDeep: { css: "oklch(0.318 0.066 101)", hex: "#3a3300" },
  brandSoft: { css: "oklch(0.97 0.055 102)", hex: "#fcf7cd" },
  /** Coloured text and small dots (6.9:1 on white). */
  signal: { css: "oklch(0.47 0.10 80)", hex: "#785300" },
} as const;

export const FONT_SANS = "Figtree, Inter, 'Segoe UI', Helvetica, Arial, sans-serif";
export const FONT_MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Escape text for HTML and SVG. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
