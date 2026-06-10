/**
 * Pipeline stepper: Ingest → Validate → Review → Score → Boundaries → Grades →
 * Export. Ported from design/hf.jsx (HPipeline). Appears on every cycle screen.
 */
import { H, PIPELINE_STAGES } from "@/lib/ui/tokens";

export function Pipeline({
  active = 2,
  done,
  range,
  compact,
}: {
  active?: number;
  done?: number;
  range?: [number, number];
  compact?: boolean;
}) {
  const doneIdx = done ?? active;
  const isDone = (i: number) => (range ? i < range[0] : i < doneIdx);
  const isNow = (i: number) => (range ? i >= range[0] && i <= range[1] : i === active);

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "nowrap" }}>
      {PIPELINE_STAGES.map((s, i) => {
        const state = isDone(i) ? "done" : isNow(i) ? "now" : "next";
        return (
          <div key={s} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  width: 21,
                  height: 21,
                  borderRadius: 999,
                  flex: "0 0 auto",
                  border: `1.5px solid ${state === "done" ? H.slate : state === "now" ? H.pink : H.line2}`,
                  background: state === "done" ? H.slate : state === "now" ? H.pinkSoft : H.paper,
                  color: state === "done" ? "#fff" : state === "now" ? H.pink : H.ink3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
                className="hf-mono"
              >
                {state === "done" ? (
                  <svg width="10" height="10" viewBox="0 0 12 12">
                    <path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {!compact && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: state === "now" ? 700 : 500,
                    color: state === "next" ? H.ink3 : H.ink,
                  }}
                >
                  {s}
                </span>
              )}
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div
                style={{
                  width: compact ? 16 : 26,
                  height: 2,
                  background: isDone(i) ? H.slate : range && i >= range[0] && i < range[1] ? H.pink : H.line2,
                  margin: "0 9px",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
