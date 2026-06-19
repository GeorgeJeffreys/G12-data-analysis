"use client";

/**
 * Essay-marks entry — the single shared upload/enter surface for offline-marked
 * essays (English & Arabic only). Used in two places that write to the same
 * provider state: the optional "Essay marks" card on the Upload screen and the
 * dedicated "Essay marks" pipeline step. Keeping one component means both entry
 * points stay in lock-step — same parse, same matching, same preview, same
 * sample loader.
 */
import { useRef, useState } from "react";
import { useProvider } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { parseEssayMarks } from "@/lib/data/parse-essays";
import type { EssayMarksModel } from "@/lib/data/types";

export function EssayMarksCard({ cycleId, model }: { cycleId: string; model: EssayMarksModel | null }) {
  const provider = useProvider();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await parseEssayMarks(file);
      if (rows.length === 0) setError("No essay rows found. Expected AFL / ESL sheets with ParticipantID and TotalScore columns.");
      else provider.uploadEssayMarks(cycleId, file.name, rows);
    } catch {
      setError("Couldn’t read that file. Use a .xlsx with per-subject sheets (AFL, ESL).");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div className="hf-sub" style={{ fontSize: 12, maxWidth: 640 }}>
        Offline-marked essays for <b style={{ color: H.ink }}>English &amp; Arabic only</b> — per-subject sheets{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>AFL · ESL</span>, keyed by ParticipantID, marked out of 20 (the{" "}
        <span className="hf-mono" style={{ fontSize: 11 }}>TotalScore</span> column; the rubric D1–D5 columns are ignored). Adds to the subject total.
      </div>

      {model?.uploaded ? (
        <div className="hf-card" style={{ overflow: "hidden", borderColor: H.line2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", background: model.sample ? H.pinkSoft2 : H.tint, borderBottom: `1px solid ${H.line2}`, flexWrap: "wrap" }}>
            <Mark kind="pass" size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{model.fileName}</span>
            {model.sample && <Badge tone="accent">SAMPLE</Badge>}
            <span style={{ flex: 1 }} />
            <span className="hf-sub" style={{ fontSize: 11.5 }}>{model.matchedCount} students matched · {model.subjects.map((s) => `${s.code} ${s.count}`).join(" · ")}</span>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearEssayMarks(cycleId)}><Icon name="trash" size={13} />Remove</Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr>{model.preview.headers.map((h) => <th key={h} className="hf-th" style={{ padding: "7px 12px" }}>{h}</th>)}</tr></thead>
            <tbody>{model.preview.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="hf-td" style={{ padding: "7px 12px", color: H.ink2 }}>{c}</td>)}</tr>)}</tbody>
          </table>
          {model.unmatchedIds.length > 0 && (
            <div className="hf-sub" style={{ fontSize: 11, padding: "8px 14px", borderTop: `1px solid ${H.line}` }}>
              {model.unmatchedIds.length} ParticipantID(s) didn’t match the roster (e.g. <span className="hf-mono">{model.unmatchedIds.slice(0, 3).join(", ")}</span>) — those marks were skipped.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{busy ? "Reading…" : "Add essay-marks file"}</Button>
          <Button variant="ghost" onClick={() => provider.loadSampleEssayMarks(cycleId)} disabled={busy}>Load sample (labelled)</Button>
          {error && <span className="hf-sub" style={{ fontSize: 11.5, color: H.bad }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
