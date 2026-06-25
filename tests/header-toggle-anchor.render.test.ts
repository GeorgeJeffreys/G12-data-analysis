/**
 * Shared pipeline-header — the persistent "Pipeline | Audit log" section toggle
 * must be right-anchored so it lands at the SAME x-position on every page,
 * regardless of which page-specific export actions are present. Page actions
 * (CSV/Excel on Cut scores, Export log on Audit log, none on Upload) sit to the
 * LEFT of the toggle and must never displace it.
 *
 * The toggle is the last element in the top bar (pinned to the right edge by the
 * breadcrumb's flex:1), so nothing renders to its right. We assert that the HTML
 * tail from the toggle onward is byte-identical across the three differing action
 * sets — proving its position is page-independent — and that the action markers
 * always appear before (to the left of) the toggle.
 *
 * Layout-only; consumes no engine/scoring logic.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as e, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Shell } from "@/components/shell/Shell";
import { cyclesSubnav } from "@/lib/ui/subnav";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/cycles/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/context", () => ({
  useProvider: () => ({
    getCurrentUser: () => ({ name: "Test Lead", role: "lead_admin", email: "lead@example.com" }),
  }),
  useProviderData: <T,>(selector: (p: unknown) => T) => selector({}),
}));

// The toggle is identical on every pipeline page; only the page actions differ.
const SUBNAV = cyclesSubnav("c1", "pipeline");
const CRUMB = [{ label: "Sittings", href: "/" }, { label: "May 2026", href: "/cycles/c1" }, { label: "Cut scores" }];

function renderHeader(actions?: ReactNode): string {
  return renderToStaticMarkup(
    e(Shell, {
      active: "Cycles",
      crumb: CRUMB,
      subnav: SUBNAV,
      cycleId: "c1",
      actions,
      children: null,
    }),
  );
}

// The three live action sets whose widths differ.
const UPLOAD = undefined; // no export buttons
const CUT_SCORES = e("div", { "data-actions": "cut" }, [
  e("button", { key: "csv" }, "CSV"),
  e("button", { key: "xlsx" }, "Excel (.xlsx)"),
]);
const AUDIT = e("button", { "data-actions": "audit" }, "Export log");

const TOGGLE_ANCHOR = 'aria-label="Section"';
const tailFromToggle = (html: string) => html.slice(html.indexOf(TOGGLE_ANCHOR));

describe("pipeline header — right-anchored section toggle", () => {
  it("renders the persistent Pipeline | Audit log toggle on every page", () => {
    const html = renderHeader(UPLOAD);
    expect(html).toContain(TOGGLE_ANCHOR);
    expect(html).toContain("Pipeline");
    expect(html).toContain("Audit log");
  });

  it("toggle position is page-independent: the markup from the toggle onward is identical regardless of export actions", () => {
    const upload = tailFromToggle(renderHeader(UPLOAD));
    const cutScores = tailFromToggle(renderHeader(CUT_SCORES));
    const audit = tailFromToggle(renderHeader(AUDIT));
    // Nothing renders to the right of the toggle, so its right edge — and, with a
    // page-independent width, its left edge — is the same on every page.
    expect(cutScores).toBe(upload);
    expect(audit).toBe(upload);
  });

  it("page-specific export actions render to the LEFT of the toggle, never displacing it", () => {
    const cutScores = renderHeader(CUT_SCORES);
    expect(cutScores.indexOf("CSV")).toBeGreaterThanOrEqual(0);
    expect(cutScores.indexOf("CSV")).toBeLessThan(cutScores.indexOf(TOGGLE_ANCHOR));
    expect(cutScores.indexOf("Excel (.xlsx)")).toBeLessThan(cutScores.indexOf(TOGGLE_ANCHOR));

    const audit = renderHeader(AUDIT);
    expect(audit.indexOf("Export log")).toBeGreaterThanOrEqual(0);
    expect(audit.indexOf("Export log")).toBeLessThan(audit.indexOf(TOGGLE_ANCHOR));
  });
});
