"use client";

/**
 * Charts: a neutral score-distribution histogram (recharts) and the horizontal
 * breakdown bars / mini grade-distribution bars (ported from design/hf.jsx).
 * Data visualisation stays neutral per the brand — the magenta accent is
 * reserved for interactive controls.
 */
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis } from "recharts";
import { H } from "@/lib/ui/tokens";
import type { BreakItem } from "@/lib/data/types";

/** Score-distribution histogram. `data` is bin counts. */
export function Histogram({
  data,
  height = 94,
  highlightIndex,
}: {
  data: number[];
  height?: number;
  highlightIndex?: number;
}) {
  const rows = data.map((count, i) => ({ i, count }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
          <XAxis dataKey="i" hide />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell
                key={r.i}
                fill={r.i === highlightIndex ? H.pink : H.barFill}
                stroke={r.i === highlightIndex ? H.pink : H.bar}
                strokeWidth={r.i === highlightIndex ? 0 : 1.5}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal breakdown bars (e.g. items by element / demand). */
export function BreakdownBars({ items }: { items: BreakItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {items.map((it) => (
        <div key={it.k} style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 92, fontSize: 11.5, color: H.ink2, textAlign: "right", flex: "0 0 auto" }}>
            {it.k}
          </span>
          <div style={{ flex: 1, height: 10, background: H.tint2, borderRadius: 5 }}>
            <div style={{ width: `${(it.v / max) * 100}%`, height: "100%", background: H.bar, borderRadius: 5 }} />
          </div>
          <span
            className="hf-mono"
            style={{ width: 28, fontSize: 11.5, color: H.ink, textAlign: "right", flex: "0 0 auto" }}
          >
            {it.v}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Compact vertical grade/award distribution bars. */
export function MiniGradeBars({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }} title={d.label}>
          <div style={{ width: 18, height: 44, background: H.tint2, borderRadius: 4, display: "flex", alignItems: "flex-end" }}>
            <div style={{ width: "100%", height: `${(d.count / max) * 100}%`, background: H.bar, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: H.ink2, maxWidth: 52, textAlign: "center", lineHeight: 1.05 }}>
            {d.label}
          </span>
          <span className="hf-mono" style={{ fontSize: 9.5, color: H.ink3 }}>
            {d.count}
          </span>
        </div>
      ))}
    </div>
  );
}
