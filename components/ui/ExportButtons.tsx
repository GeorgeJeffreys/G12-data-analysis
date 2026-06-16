"use client";

/**
 * Shared CSV + Excel export control for the analysis screens. Every analysis
 * surface offers both: CSV (the primary tabular data) and Excel (the full
 * multi-sheet workbook that matches the team's reference formats).
 */
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

export function ExportButtons({
  onCsv,
  onXlsx,
  disabled,
  xlsxLabel = "Excel (.xlsx)",
  csvLabel = "CSV",
  title,
}: {
  onCsv: () => void | Promise<void>;
  onXlsx: () => void | Promise<void>;
  disabled?: boolean;
  xlsxLabel?: string;
  csvLabel?: string;
  /** Tooltip when disabled (e.g. "No data to export yet"). */
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => void | Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Button variant="ghost" onClick={run(onCsv)} disabled={disabled || busy} title={title}>
        <Icon name="doc" />
        {csvLabel}
      </Button>
      <Button variant="ghost" onClick={run(onXlsx)} disabled={disabled || busy} title={title}>
        <Icon name="download" />
        {xlsxLabel}
      </Button>
    </div>
  );
}
