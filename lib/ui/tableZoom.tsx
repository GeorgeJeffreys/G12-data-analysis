"use client";

/**
 * Shared whole-table zoom — the single implementation used by every zoomable
 * data table (Review, Grades, Diagnostics, Audit). It is a true scale transform:
 * − / + (and trackpad pinch via ctrl+wheel) scale the entire table — columns,
 * text and rows together — so zooming out genuinely fits more rows on screen.
 *
 * Do NOT use this on fixed-size tables (Boundaries award levels, Settings roles)
 * — those are sized to fit and have no need to zoom.
 *
 * Usage:
 *   const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();
 *   <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
 *     <div style={zoomWrapStyle}><table>…</table></div>
 *   </div>
 *   <ZoomControl zoom={zoom} onZoom={setZoom} />
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { H } from "@/lib/ui/tokens";

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.5;
export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export function useTableZoom(initial = 1) {
  const [zoom, setZoom] = useState<number>(initial);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pinch-to-zoom (trackpad pinch fires a ctrl+wheel). Native non-passive
  // listener so we can preventDefault the browser page-zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.01));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Scale the wrapped content; widen it inversely so it still fills the scroller.
  const zoomWrapStyle: CSSProperties = {
    transform: `scale(${zoom})`,
    transformOrigin: "top left",
    width: `${100 / zoom}%`,
  };

  return { zoom, setZoom, scrollRef, zoomWrapStyle };
}

/** − / reset% / + control. Reused wherever a table is zoomable. */
export function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const step = (d: -1 | 1) => onZoom(clampZoom(Math.round((zoom + d * 0.1) * 10) / 10));
  const btn = (label: string, d: -1 | 1, disabled: boolean) => (
    <button
      onClick={() => step(d)}
      disabled={disabled}
      aria-label={d < 0 ? "Zoom out" : "Zoom in"}
      title={d < 0 ? "Zoom out (fit more rows)" : "Zoom in"}
      style={{ width: 26, height: 24, fontSize: 14, fontWeight: 700, background: H.paper, color: disabled ? H.ink3 : H.ink2, border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
    >
      {label}
    </button>
  );
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ display: "flex", alignItems: "center", border: `1px solid ${H.line2}`, borderRadius: 7, overflow: "hidden" }}>
        {btn("−", -1, zoom <= ZOOM_MIN + 1e-9)}
        <button onClick={() => onZoom(1)} title="Reset zoom" className="hf-mono" style={{ minWidth: 38, height: 24, fontSize: 10.5, fontWeight: 600, color: H.ink2, background: H.paper, border: "none", borderLeft: `1px solid ${H.line2}`, borderRight: `1px solid ${H.line2}`, cursor: "pointer" }}>
          {Math.round(zoom * 100)}%
        </button>
        {btn("+", 1, zoom >= ZOOM_MAX - 1e-9)}
      </span>
    </span>
  );
}
