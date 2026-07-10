"use client";

/**
 * Shared analytics helpers still used by Compare cycles: the award-band colour
 * ramp, the compact award-level label, and the mock-priors banner. (The old
 * Trends charts — Spark / AwardOverTimeChart / AwardCompareChart — were removed
 * when the Trends page was replaced by the Overall page.)
 */
import { H } from "@/lib/ui/tokens";
import { Mark } from "./icons";

/** Colour ramp for award bands: top band magenta, neutral ramp down. */
export function awardRamp(index: number, total: number): string {
  const ramp = [H.pink, "#6b7780", "#9aa4ac", "#c2cad0", "#dfe4e9"];
  if (index === 0) return ramp[0]!;
  const span = Math.max(1, total - 1);
  const pos = Math.min(ramp.length - 1, 1 + Math.round(((index - 1) / span) * (ramp.length - 2)));
  return ramp[pos]!;
}

/** Compact award-level label (drops the trailing "award"/"achievement award"). */
export function awardShortLabel(level: string): string {
  return level.replace(/ (award|achievement award)$/i, "");
}

export function MockBanner({ text }: { text?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: H.warnSoft, border: `1px solid ${H.warn}33`, borderRadius: 10 }}>
      <Mark kind="warn" size={15} />
      <span style={{ fontSize: 12, color: H.ink }}>
        {text ?? "Prior sittings are illustrative mock data — there's no real cross-sitting history yet. Only the latest sitting's figures are computed from real results."}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>MOCK PRIORS</span>
    </div>
  );
}
