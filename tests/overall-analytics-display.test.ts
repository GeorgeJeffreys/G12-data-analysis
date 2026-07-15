/**
 * Overall analytics — display-layer regressions (presentation only; no engine).
 *
 * Covers the bugs where the ported design mock's hardcoded assumptions survived
 * contact with real data:
 *   §1 percentages must render rounded, not raw floats (40.0999…%).
 *   §2 signed figures must take their sign from the value (never a hardcoded +).
 *   §3 a below-floor value must stay INSIDE the plot area (derived y-domain), and
 *       the last-value tag must be anchored inside the card.
 */
import { describe, it, expect } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OVLine } from "@/components/ui/overall/kit";
import { niceRange, round, signed } from "@/components/ui/overall/sections";

describe("§1 · percentages round at the display layer", () => {
  it("round() collapses a float-sum artifact to 1 dp", () => {
    // levelPass = out + exc + meet — a raw float sum can land at 40.0999….
    expect(round(40.099999999999994)).toBe(40.1);
    expect(round(20.4 + 10.1 + 9.6)).toBe(40.1);
  });
});

describe("§2 · signs come from the value", () => {
  it("renders − for negatives and + for non-negatives (no '+-')", () => {
    expect(signed(-0.14)).toBe("−0.14");
    expect(signed(0.14)).toBe("+0.14");
    expect(signed(0)).toBe("+0");
    expect(signed(-0.14).includes("+")).toBe(false);
  });
});

describe("§3 · derived y-domain contains the data", () => {
  it("niceRange frames a below-floor value (min ≤ every value ≤ max)", () => {
    const vals = [20.4, 38.9, 33.1];
    const r = niceRange(vals);
    for (const v of vals) {
      expect(r.min).toBeLessThanOrEqual(v);
      expect(r.max).toBeGreaterThanOrEqual(v);
    }
    // The old hardcoded floor was 40 — well above the real 20.4% low.
    expect(r.min).toBeLessThan(40);
  });

  it("OVLine plots a below-floor value inside the plot area", () => {
    const h = 200;
    const pad = { t: 14, r: 16, b: 26, l: 34 };
    const low = 20.4; // would sit BELOW a hardcoded yMin=40 floor
    const r = niceRange([low, 38.9]);
    const html = renderToStaticMarkup(
      e(OVLine, {
        w: 340,
        h,
        yMin: r.min,
        yMax: r.max,
        xLabels: ["2025", "2026"],
        fmt: (v: number) => `${round(v)}%`,
        series: [{ pts: [low, 38.9], color: "#000" }],
      }),
    );
    // Every plotted dot's cy must fall within the plot area [pad.t, h - pad.b].
    const bottom = h - pad.b;
    const cys = [...html.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cys.length).toBeGreaterThan(0);
    for (const cy of cys) {
      expect(cy).toBeGreaterThanOrEqual(pad.t);
      expect(cy).toBeLessThanOrEqual(bottom);
    }
  });

  it("OVLine anchors the last-value tag inside the plot (textAnchor=end)", () => {
    const html = renderToStaticMarkup(
      e(OVLine, {
        w: 340,
        h: 200,
        yMin: 0,
        yMax: 100,
        xLabels: ["2025", "2026"],
        fmt: (v: number) => `${round(v)}%`,
        series: [{ pts: [20.4, 40.099999999999994], color: "#000" }],
      }),
    );
    // The tag renders the ROUNDED value…
    expect(html).toContain(">40.1%<");
    expect(html).not.toContain("40.099");
    // …and is right-anchored so it cannot escape the card's right edge.
    expect(html).toContain('text-anchor="end"');
    // The SVG clips to its box (no overflow:visible leak).
    expect(html).not.toContain("overflow:visible");
  });
});
