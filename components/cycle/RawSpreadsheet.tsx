"use client";

/**
 * The "show me my data" spreadsheet — the raw response matrix with a sticky
 * header row and two sticky meta columns (Student ID + Name), shared by the Raw
 * data and Clean screens. Cells: 1 correct · 0 incorrect · — omitted/blank.
 *
 * On the Clean screen it becomes selectable: click a column header or a row's
 * meta cell to mark it for removal (highlighted), driven by the parent's state.
 */
import type { CSSProperties, ReactNode, RefObject } from "react";
import { H } from "@/lib/ui/tokens";
import type { RawColumnMeta, RawDataRow } from "@/lib/data/types";

interface RawLike {
  columns: RawColumnMeta[];
  rows: RawDataRow[];
}

const W = { id: 84, name: 150 };

export function RawSpreadsheet({
  model,
  scrollRef,
  zoomWrapStyle,
  maxHeight = 460,
  rtl = false,
  selectable = false,
  selCols,
  selRows,
  struckRows,
  onToggleCol,
  onToggleRow,
}: {
  model: RawLike;
  scrollRef?: RefObject<HTMLDivElement>;
  zoomWrapStyle?: CSSProperties;
  maxHeight?: number;
  rtl?: boolean;
  selectable?: boolean;
  selCols?: Set<string>;
  selRows?: Set<string>;
  /**
   * Soft-deleted (cohort-excluded) row ids — rendered struck-through in red and
   * kept visible so the removal is obvious and reversible. Purely presentational;
   * the exclusion itself lives in the provider.
   */
  struckRows?: Set<string>;
  onToggleCol?: (id: string) => void;
  onToggleRow?: (id: string) => void;
}) {
  const stickyTh = (left: number, w: number): CSSProperties => ({
    position: "sticky",
    top: 0,
    left,
    zIndex: 7,
    minWidth: w,
    width: w,
    background: H.tint,
    textAlign: "left",
  });
  const stickyTd = (left: number, w: number, bg: string): CSSProperties => ({
    position: "sticky",
    left,
    zIndex: 2,
    minWidth: w,
    width: w,
    background: bg,
    whiteSpace: "nowrap",
  });

  const cellText = (v: number | null): ReactNode => (v === null ? "–" : v);
  const cellColor = (v: number | null): string => (v === 1 ? H.ink : v === 0 ? H.ink3 : H.line2);

  // Major-element letter: the configured A–E (Settings → Element labels) when the
  // model carries it, else first-appearance order as a fallback.
  const elLetter = new Map<string, string>();
  for (const c of model.columns) {
    if (c.major && !elLetter.has(c.major)) elLetter.set(c.major, c.elLetter ?? String.fromCharCode(65 + elLetter.size));
  }

  return (
    <div
      ref={scrollRef}
      className="hf-card"
      style={{ overflow: "auto", maxHeight, padding: 0, direction: rtl ? "rtl" : "ltr" }}
    >
      <div style={zoomWrapStyle}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5, width: "max-content", direction: "ltr" }}>
          <thead>
            <tr>
              <th className="hf-th" style={{ ...stickyTh(0, W.id) }}>Student ID</th>
              <th
                className="hf-th"
                style={{ ...stickyTh(W.id, W.name), boxShadow: `2px 0 0 ${H.line2}`, borderRight: `1px solid ${H.line2}` }}
              >
                Name
              </th>
              {model.columns.map((c) => {
                const on = selectable && selCols?.has(c.id);
                return (
                  <th
                    key={c.id}
                    className="hf-th"
                    onClick={selectable ? () => onToggleCol?.(c.id) : undefined}
                    title={`${c.elLabel ?? c.major ?? "—"}${c.sub ? " · " + c.sub : ""}`}
                    style={{
                      position: "sticky",
                      top: 0,
                      minWidth: 46,
                      width: 46,
                      textAlign: "center",
                      padding: "7px 4px",
                      background: on ? H.pinkSoft : H.tint,
                      cursor: selectable ? "pointer" : "default",
                    }}
                  >
                    <div className="hf-mono" style={{ fontSize: 11, color: on ? H.pink : H.ink2 }}>{c.qLabel}</div>
                    <div style={{ fontSize: 8, marginTop: 2, color: H.ink3, fontWeight: 700, letterSpacing: ".2px" }}>
                      {c.major ? elLetter.get(c.major) : "·"}{c.demand ? `·${c.demand}` : ""}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r) => {
              const rowSel = selectable && selRows?.has(r.id);
              const struck = struckRows?.has(r.id) ?? false;
              const bg = rowSel ? H.pinkSoft2 : H.paper;
              // Struck (soft-deleted) rows: red strike-through, kept visible.
              const strikeStyle: CSSProperties = struck
                ? { textDecoration: "line-through", textDecorationColor: H.bad }
                : {};
              return (
                <tr key={r.id} className="hf-hover">
                  <td
                    className="hf-td hf-mono"
                    onClick={selectable ? () => onToggleRow?.(r.id) : undefined}
                    style={{ ...stickyTd(0, W.id, bg), fontSize: 11.5, color: struck ? H.bad : H.ink2, cursor: selectable ? "pointer" : "default", ...strikeStyle }}
                  >
                    {r.studentId}
                  </td>
                  <td
                    className="hf-td"
                    onClick={selectable ? () => onToggleRow?.(r.id) : undefined}
                    style={{ ...stickyTd(W.id, W.name, bg), fontSize: 12.5, fontWeight: 600, boxShadow: `2px 0 0 ${H.line2}`, borderRight: `1px solid ${H.line2}`, cursor: selectable ? "pointer" : "default", color: struck ? H.bad : undefined, ...strikeStyle }}
                  >
                    {r.name}
                  </td>
                  {r.cells.map((v, ci) => {
                    const col = model.columns[ci]!;
                    const colSel = selectable && selCols?.has(col.id);
                    return (
                      <td
                        key={col.id}
                        className="hf-mono"
                        style={{
                          textAlign: "center",
                          padding: "10px 4px",
                          borderBottom: `1px solid ${H.line}`,
                          background: colSel ? H.pinkSoft2 : bg,
                          color: struck ? H.bad : cellColor(v),
                          fontWeight: v === 1 ? 600 : 400,
                          fontSize: 12,
                          ...strikeStyle,
                        }}
                      >
                        {cellText(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
