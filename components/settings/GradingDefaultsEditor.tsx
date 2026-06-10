"use client";

/**
 * Editable grade-vocabulary defaults (performance levels + stars + cut-points,
 * and the overall award levels + cut-points). Used inside Settings → Configuration.
 * Edits commit to the provider; nothing here hardcodes the vocabulary.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Card } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";

export function GradingDefaultsEditor() {
  const provider = useProvider();
  const defaults = useProviderData((p) => p.getGradingDefaults());

  const [perfLevels, setPerfLevels] = useState<string[]>(defaults.performanceLevels);
  const [stars, setStars] = useState<string[]>(defaults.performanceLevels.map((l) => defaults.starMap[l] ?? ""));
  const [awardLevels, setAwardLevels] = useState<string[]>(defaults.awardLevels);
  const [perfCuts, setPerfCuts] = useState<number[]>(defaults.performanceCuts);
  const [awardCuts, setAwardCuts] = useState<number[]>(defaults.awardCuts);
  const [saved, setSaved] = useState(false);

  const dirty =
    JSON.stringify(perfLevels) !== JSON.stringify(defaults.performanceLevels) ||
    JSON.stringify(stars) !== JSON.stringify(defaults.performanceLevels.map((l) => defaults.starMap[l] ?? "")) ||
    JSON.stringify(awardLevels) !== JSON.stringify(defaults.awardLevels) ||
    JSON.stringify(perfCuts) !== JSON.stringify(defaults.performanceCuts) ||
    JSON.stringify(awardCuts) !== JSON.stringify(defaults.awardCuts);

  const save = () => {
    const starMap: Record<string, string> = {};
    perfLevels.forEach((l, i) => (starMap[l] = stars[i] ?? ""));
    provider.setGradingDefaults({ performanceLevels: perfLevels, starMap, awardLevels, performanceCuts: perfCuts, awardCuts });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="hf-h2">Grading defaults</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {saved && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.good, fontSize: 12.5, fontWeight: 600 }}>
              <Mark kind="pass" size={15} /> Saved
            </span>
          )}
          <Button variant="pri" disabled={!dirty} onClick={save}>Save grading defaults</Button>
        </div>
      </div>

      <Card style={{ padding: "18px 20px" }}>
        <div className="hf-h2" style={{ marginBottom: 4 }}>Per-assessment performance levels</div>
        <div className="hf-sub" style={{ marginBottom: 16 }}>
          Best → lowest. Four bands, so three default cut-points. Stars are used in the performance reports and are derived from the level — never entered against a student.
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="hf-th">#</th>
              <th className="hf-th">Level label</th>
              <th className="hf-th">Stars</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Default cut ≥</th>
            </tr>
          </thead>
          <tbody>
            {perfLevels.map((lvl, i) => (
              <tr key={i}>
                <td className="hf-td hf-mono" style={{ color: H.ink3, width: 30 }}>{i + 1}</td>
                <td className="hf-td"><TextField value={lvl} onChange={(v) => setPerfLevels(replaceAt(perfLevels, i, v))} /></td>
                <td className="hf-td"><TextField value={stars[i] ?? ""} width={90} mono onChange={(v) => setStars(replaceAt(stars, i, v))} placeholder="(blank)" /></td>
                <td className="hf-td" style={{ textAlign: "right" }}>
                  {i < perfLevels.length - 1 ? (
                    <NumberField value={perfCuts[i] ?? 0} onChange={(v) => setPerfCuts(replaceAt(perfCuts, i, v))} />
                  ) : (
                    <span className="hf-sub hf-mono">remainder</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ padding: "18px 20px" }}>
        <div className="hf-h2" style={{ marginBottom: 4 }}>Overall award levels</div>
        <div className="hf-sub" style={{ marginBottom: 12 }}>
          Best → lowest. The overall award is derived from each student’s overall score using these cut-points.
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", marginBottom: 16, background: H.warnSoft, border: `1px solid ${H.warn}33`, borderRadius: 10 }}>
          <Mark kind="warn" size={17} />
          <span style={{ fontSize: 12.5, color: H.ink }}>
            <strong>Unverified rule.</strong> The real award-derivation rule isn’t in the source files. This default classifies the overall score into the four awards by cut-point (a placeholder) — confirm with the assessment team before going live.
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="hf-th">#</th>
              <th className="hf-th">Award label</th>
              <th className="hf-th" style={{ textAlign: "right" }}>Default cut ≥</th>
            </tr>
          </thead>
          <tbody>
            {awardLevels.map((lvl, i) => (
              <tr key={i}>
                <td className="hf-td hf-mono" style={{ color: H.ink3, width: 30 }}>{i + 1}</td>
                <td className="hf-td"><TextField value={lvl} onChange={(v) => setAwardLevels(replaceAt(awardLevels, i, v))} /></td>
                <td className="hf-td" style={{ textAlign: "right" }}>
                  {i < awardLevels.length - 1 ? (
                    <NumberField value={awardCuts[i] ?? 0} onChange={(v) => setAwardCuts(replaceAt(awardCuts, i, v))} />
                  ) : (
                    <span className="hf-sub hf-mono">remainder</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const next = arr.slice();
  next[i] = v;
  return next;
}

function TextField({ value, onChange, width = 280, mono, placeholder }: { value: string; onChange: (v: string) => void; width?: number; mono?: boolean; placeholder?: string }) {
  return (
    <input
      className={mono ? "hf-mono" : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ width, maxWidth: "100%", border: `1px solid ${H.line2}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, outline: "none", background: H.paper, color: H.ink }}
    />
  );
}

function NumberField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input className="hf-input" value={String(value)} inputMode="numeric" onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} />
  );
}
