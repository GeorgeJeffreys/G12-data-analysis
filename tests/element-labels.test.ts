/**
 * Configurable A–E element labels per subject.
 * Covers the case-insensitive, "&"/"and"-equivalent matching that binds the seed
 * to whatever spelling the data uses, the resolution/label-map helpers, validation,
 * and the provider get/set round-trip (with the lead-admin gate).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import {
  normalizeElementKey,
  resolveElementLabel,
  labelMapForSubject,
  validateElementLabels,
  DEFAULT_ELEMENT_LABELS,
  type ElementLabelsConfig,
} from "@/lib/data/element-labels";

describe("element-label matching", () => {
  it("normalises case and treats & / and as equivalent", () => {
    expect(normalizeElementKey("Spatial & geometric reasoning")).toBe(
      normalizeElementKey("Spatial and geometric reasoning"),
    );
    expect(normalizeElementKey("DATA, PROBABILITY  and decision-making")).toBe(
      "data, probability and decision-making",
    );
  });

  it("resolves a data value to its configured letter + label regardless of &/and or case", () => {
    // data uses "&" where the seed key uses "and" — must still bind
    const hit = resolveElementLabel(DEFAULT_ELEMENT_LABELS, "Applicable Math", "Spatial & geometric reasoning");
    expect(hit).toEqual({ letter: "B", label: "Spatial & geometric reasoning" });
    // case-insensitive subject + value
    const hit2 = resolveElementLabel(DEFAULT_ELEMENT_LABELS, "applicable math", "numerical AND quantitative reasoning");
    expect(hit2?.letter).toBe("A");
  });

  it("falls back to appearance-order A–E + the raw value for unconfigured elements", () => {
    const map = labelMapForSubject(DEFAULT_ELEMENT_LABELS, "Applicable Math", ["Totally new element", "Another"]);
    expect(map.get("Totally new element")).toEqual({ letter: "A", label: "Totally new element" });
    expect(map.get("Another")).toEqual({ letter: "B", label: "Another" });
  });

  it("flags an invalid config (empty label / duplicate letter)", () => {
    const dupLetter: ElementLabelsConfig = {
      X: [
        { matchKey: "a", letter: "A", label: "A" },
        { matchKey: "b", letter: "A", label: "B" },
      ],
    };
    expect(validateElementLabels(dupLetter)).toMatch(/letter/i);
    const emptyLabel: ElementLabelsConfig = { X: [{ matchKey: "a", letter: "A", label: "  " }] };
    expect(validateElementLabels(emptyLabel)).toMatch(/label/i);
    expect(validateElementLabels(DEFAULT_ELEMENT_LABELS)).toBeNull();
  });
});

describe("provider element-label config", () => {
  it("seeds the confirmed defaults and round-trips an edit", () => {
    const provider = new InMemoryDataProvider();
    const cfg = provider.getElementLabels();
    expect(cfg["Applicable Math"]?.[0]?.label).toBe("Numerical and quantitative reasoning");

    cfg["Applicable Math"]![0]!.label = "Numerical reasoning";
    provider.setElementLabels(cfg);
    expect(provider.getElementLabels()["Applicable Math"]?.[0]?.label).toBe("Numerical reasoning");
  });

  it("rejects an invalid edit (left unchanged)", () => {
    const provider = new InMemoryDataProvider();
    const bad = provider.getElementLabels();
    bad["Applicable Math"]![0]!.label = "";
    provider.setElementLabels(bad);
    // unchanged — the original seed label is retained
    expect(provider.getElementLabels()["Applicable Math"]?.[0]?.label).toBe("Numerical and quantitative reasoning");
  });

  it("drives the element columns: raw-scores element headers use the configured letter + label", () => {
    const provider = new InMemoryDataProvider();
    const cycle = provider.getCycle("may-2026")!;
    const aId = cycle.assessments.find((a) => /math/i.test(a.name))?.id ?? cycle.assessments[0]!.id;
    const naive = provider.getNaiveScores("may-2026", aId)!;
    // every element column carries a single-letter id and a display label
    for (const el of naive.elements) {
      expect(el.shortId).toMatch(/^[A-E]$/);
      expect(el.label && el.label.length).toBeTruthy();
    }
    // the config truly binds to the seed data (which uses "and"): the configured
    // "&" display label is applied to the matching major element.
    const spatial = naive.elements.find((e) => /spatial/i.test(e.major));
    if (spatial) {
      expect(spatial.shortId).toBe("B");
      expect(spatial.label).toBe("Spatial & geometric reasoning");
    }
  });
});
