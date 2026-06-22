"use client";

/**
 * Editable grade-vocabulary defaults — full CRUD on the configured performance
 * and award level sets (add / remove / rename / reorder, edit cut-points and the
 * star mapping). Backed by the provider's grading config (which feeds the
 * engine's ScoringConfig). Lead/Admin only.
 *
 * Destructive edits surface the downstream impact flagged in prompt 1 before
 * saving: a removed level/award that is still in use by a cycle's results, or a
 * new level without a star mapping, warns first — because exports and
 * certificates read the configured set rather than a hardcoded one.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Card } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

interface PerfRow {
  label: string;
  stars: string;
  /** Min score for this level; null for the lowest (remainder) band. */
  cut: number | null;
}
interface AwardRow {
  label: string;
  cut: number | null;
}

export function GradingDefaultsEditor() {
  const provider = useProvider();
  const defaults = useProviderData((p) => p.getGradingDefaults());
  const editable = provider.getCurrentUser().role === "lead_admin";

  // Levels currently assigned to real (non-mock) cycle results — used to warn
  // when a removed level/award is still in use. Real data, via the provider.
  const inUse = useProviderData((p) => {
    const perf = new Set<string>();
    const award = new Set<string>();
    for (const c of p.listCycles()) {
      if (c.mock) continue;
      const g = p.getGrades(c.id);
      if (!g) continue;
      for (const r of g.rows) {
        if (r.award) award.add(r.award);
        for (const a of g.assessments) {
          const lvl = r.grades[a.id]?.level;
          if (lvl) perf.add(lvl);
        }
      }
    }
    return { perf: [...perf], award: [...award] };
  });

  const initialPerf = useMemo<PerfRow[]>(
    () =>
      defaults.performanceLevels.map((label, i) => ({
        label,
        stars: defaults.starMap[label] ?? "",
        cut: i < defaults.performanceLevels.length - 1 ? defaults.performanceCuts[i] ?? 0 : null,
      })),
    [defaults],
  );
  const initialAward = useMemo<AwardRow[]>(
    () =>
      defaults.awardLevels.map((label, i) => ({
        label,
        cut: i < defaults.awardLevels.length - 1 ? defaults.awardCuts[i] ?? 0 : null,
      })),
    [defaults],
  );

  const [perf, setPerf] = useState<PerfRow[]>(initialPerf);
  const [award, setAward] = useState<AwardRow[]>(initialAward);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    JSON.stringify(perf) !== JSON.stringify(initialPerf) ||
    JSON.stringify(award) !== JSON.stringify(initialAward);

  // Keep the cut/remainder invariant: only the last row is the remainder (null),
  // every earlier row carries a numeric cut.
  const normPerf = (rows: PerfRow[]): PerfRow[] =>
    rows.map((r, i) => ({ ...r, cut: i === rows.length - 1 ? null : r.cut ?? 50 }));
  const normAward = (rows: AwardRow[]): AwardRow[] =>
    rows.map((r, i) => ({ ...r, cut: i === rows.length - 1 ? null : r.cut ?? 50 }));

  const validationError = (): string | null => {
    for (const set of [perf.map((p) => p.label), award.map((a) => a.label)]) {
      if (set.some((l) => !l.trim())) return "Every level needs a label.";
      if (new Set(set.map((l) => l.trim())).size !== set.length) return "Level labels must be unique.";
    }
    if (perf.length < 2 || award.length < 2) return "Keep at least two levels in each set.";
    return null;
  };

  const downstreamWarnings = (): string[] => {
    const w: string[] = [];
    const livePerf = new Set(initialPerf.map((p) => p.label));
    const liveAward = new Set(initialAward.map((a) => a.label));
    const nextPerf = new Set(perf.map((p) => p.label));
    const nextAward = new Set(award.map((a) => a.label));

    for (const lbl of livePerf) {
      if (!nextPerf.has(lbl) && inUse.perf.includes(lbl))
        w.push(`Performance level “${lbl}” is in use by current sitting results — removing it leaves those cells unmapped.`);
    }
    for (const lbl of liveAward) {
      if (!nextAward.has(lbl) && inUse.award.includes(lbl))
        w.push(`Award “${lbl}” is in use by current sitting results — removing it leaves those awards unmapped.`);
    }
    for (const p of perf) {
      if (!livePerf.has(p.label) && !p.stars.trim())
        w.push(`New performance level “${p.label || "(unnamed)"}” has no star mapping — reports will show a blank.`);
    }
    if (perf.length !== initialPerf.length)
      w.push(`Performance level count is changing (${initialPerf.length} → ${perf.length}). The Excel export's colour palette only has 4 slots; extra levels render without a fill until exports are extended.`);
    if (award.length !== initialAward.length)
      w.push(`Award level count is changing (${initialAward.length} → ${award.length}). Certificates map awards by label — confirm the template handles the new set.`);
    return w;
  };

  const commit = () => {
    const np = normPerf(perf);
    const na = normAward(award);
    const starMap: Record<string, string> = {};
    np.forEach((r) => (starMap[r.label] = r.stars));
    provider.setGradingDefaults({
      performanceLevels: np.map((r) => r.label),
      starMap,
      awardLevels: na.map((r) => r.label),
      performanceCuts: np.slice(0, -1).map((r) => r.cut ?? 0),
      awardCuts: na.slice(0, -1).map((r) => r.cut ?? 0),
    });
    setConfirm(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const attemptSave = () => {
    const err = validationError();
    if (err) {
      setConfirm([`Can’t save: ${err}`]);
      return;
    }
    const warnings = downstreamWarnings();
    if (warnings.length) setConfirm(warnings);
    else commit();
  };

  const saveBlocked = !!validationError();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="hf-h2">Grading defaults</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {saved && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.good, fontSize: 12.5, fontWeight: 600 }}>
              <Mark kind="pass" size={15} /> Saved
            </span>
          )}
          {editable && (
            <>
              <Button variant="ghost" disabled={!dirty} onClick={() => { setPerf(initialPerf); setAward(initialAward); }}>Reset</Button>
              <Button variant="pri" disabled={!dirty} onClick={attemptSave}>Save grading defaults</Button>
            </>
          )}
        </div>
      </div>

      {/* performance levels */}
      <Card style={{ padding: "18px 20px" }}>
        <div className="hf-h2" style={{ marginBottom: 4 }}>Per-assessment performance levels</div>
        <div className="hf-sub" style={{ marginBottom: 16 }}>
          Best → lowest. The lowest level is the remainder. Stars are used in the performance reports
          and derived from the level — never entered against a student.
        </div>
        <LevelTable
          rows={perf}
          editable={editable}
          showStars
          onChange={setPerf}
          empty={(label) => ({ label, stars: "", cut: 50 })}
          inUse={inUse.perf}
        />
      </Card>

      {/* award levels */}
      <Card style={{ padding: "18px 20px" }}>
        <div className="hf-h2" style={{ marginBottom: 4 }}>Overall award levels</div>
        <div className="hf-sub" style={{ marginBottom: 12 }}>
          Best → lowest. These are the award <strong>vocabulary</strong> — their order maps positionally to the
          award-derivation rule below (top = Distinction tier, then Advanced, Secondary, and the lowest is
          No&nbsp;Award). The award is <strong>not</strong> a cut on an overall score; it is derived from the pattern
          of the five subject performance levels (Wave&nbsp;3a). Renaming a level renames it everywhere it appears.
        </div>
        <LevelTable
          rows={award}
          editable={editable}
          showStars={false}
          showCut={false}
          onChange={setAward}
          empty={(label) => ({ label, cut: 50 })}
          inUse={inUse.award}
        />

        {/* the confirmed level-pattern award rule — policy-set, display-only */}
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${H.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div className="hf-h2" style={{ fontSize: 14 }}>Award-derivation rule</div>
            <DisplayBadge />
          </div>
          <div className="hf-sub" style={{ marginBottom: 12 }}>
            Evaluated highest → lowest, first match wins. These counts are policy-set and fixed in the engine
            (<span className="hf-mono">lib/engine/award.ts</span>) — changing them changes the awards real students
            receive, so they are not editable here.
          </div>
          <AwardRuleTable awards={award.map((a) => a.label)} />
        </div>
      </Card>

      {!editable && (
        <div className="hf-sub" style={{ fontSize: 11.5 }}>Only a Lead/Admin can edit the grading vocabulary.</div>
      )}

      {confirm && (
        <ConfirmDialog
          warnings={confirm}
          blocked={saveBlocked}
          onCancel={() => setConfirm(null)}
          onConfirm={commit}
        />
      )}
    </div>
  );
}

/** Generic add/remove/reorder/rename table for a level set (perf or award). */
function LevelTable<T extends { label: string; cut: number | null; stars?: string }>({
  rows,
  editable,
  showStars,
  showCut = true,
  onChange,
  empty,
  inUse,
}: {
  rows: T[];
  editable: boolean;
  showStars: boolean;
  showCut?: boolean;
  onChange: (rows: T[]) => void;
  empty: (label: string) => T;
  inUse: string[];
}) {
  const update = (i: number, patch: Partial<T>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = () => onChange([...rows, empty("New level")]);

  return (
    <div className="hf-scroll-x">
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
        <thead>
          <tr>
            <th className="hf-th" style={{ width: 30 }}>#</th>
            <th className="hf-th">{showStars ? "Level label" : "Award label"}</th>
            {showStars && <th className="hf-th">Stars</th>}
            {showCut && <th className="hf-th" style={{ textAlign: "right" }}>Default cut ≥</th>}
            {editable && <th className="hf-th" style={{ textAlign: "right" }}>Reorder / remove</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const last = i === rows.length - 1;
            const used = inUse.includes(r.label);
            return (
              <tr key={i}>
                <td className="hf-td hf-mono" style={{ color: H.ink3, width: 30 }}>{i + 1}</td>
                <td className="hf-td">
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <TextField value={r.label} editable={editable} onChange={(v) => update(i, { label: v } as Partial<T>)} />
                    {used && <span title="In use by current sitting results" style={{ fontSize: 8.5, color: H.ink2, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 4px", letterSpacing: 0.4 }}>IN USE</span>}
                  </div>
                </td>
                {showStars && (
                  <td className="hf-td">
                    <TextField value={r.stars ?? ""} width={90} mono editable={editable} placeholder="(blank)" onChange={(v) => update(i, { stars: v } as Partial<T>)} />
                  </td>
                )}
                {showCut && (
                  <td className="hf-td" style={{ textAlign: "right" }}>
                    {last ? (
                      <span className="hf-sub hf-mono">remainder</span>
                    ) : (
                      <NumberField value={r.cut ?? 0} editable={editable} onChange={(v) => update(i, { cut: v } as Partial<T>)} />
                    )}
                  </td>
                )}
                {editable && (
                  <td className="hf-td" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconBtn>
                    <IconBtn label="Move down" disabled={last} onClick={() => move(i, 1)}>↓</IconBtn>
                    <IconBtn label="Remove" danger disabled={rows.length <= 2} onClick={() => remove(i)}>✕</IconBtn>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {editable && (
        <Button variant="ghost" style={{ marginTop: 10 }} onClick={add}>
          <Icon name="plus" size={13} /> Add {showStars ? "performance level" : "award level"}
        </Button>
      )}
    </div>
  );
}

/** Small "display-only" badge — for policy-fixed values that aren't editable. */
function DisplayBadge() {
  return (
    <span style={{ fontSize: 8.5, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.5 }}>
      DISPLAY-ONLY
    </span>
  );
}

/**
 * The confirmed Wave-3a level-pattern award rule, rendered read-only against the
 * live award vocabulary. Mirrors `deriveAward` exactly — the counts are the
 * engine's fixed literals (≥3 Outstanding, ≥3 Exceeds, ≥4 Meets), not config.
 */
function AwardRuleTable({ awards }: { awards: string[] }) {
  const distinction = awards[0] ?? "Distinction";
  const advanced = awards[1] ?? distinction;
  const secondary = awards[2] ?? advanced;
  const noAward = awards[3] ?? secondary;
  const rules: { award: string; rule: ReactNode }[] = [
    {
      award: distinction,
      rule: (
        <>
          <strong>★★★ Outstanding</strong> in <strong>≥&nbsp;3</strong> subjects <em>and</em> <strong>≥&nbsp;★ Meets</strong> in
          every remaining subject <em>and</em> the student clears the D3 safeguard.
        </>
      ),
    },
    { award: advanced, rule: (<><strong>★★ Exceeds</strong> (or better) in <strong>≥&nbsp;3</strong> subjects.</>) },
    { award: secondary, rule: (<><strong>★ Meets</strong> (or better) in <strong>≥&nbsp;4</strong> subjects.</>) },
    { award: noAward, rule: (<>None of the above patterns are met.</>) },
  ];
  return (
    <div className="hf-scroll-x">
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
        <thead>
          <tr>
            <th className="hf-th" style={{ width: 30 }}>#</th>
            <th className="hf-th">Award</th>
            <th className="hf-th">Granted when</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i}>
              <td className="hf-td hf-mono" style={{ color: H.ink3, width: 30 }}>{i + 1}</td>
              <td className="hf-td" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.award}</td>
              <td className="hf-td" style={{ fontSize: 12.5, color: H.ink }}>{r.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmDialog({ warnings, blocked, onCancel, onConfirm }: { warnings: string[]; blocked: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,42,49,.32)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }} onClick={onCancel}>
      <div className="hf-card" style={{ padding: "20px 22px", maxWidth: 560, width: "100%", background: H.paper }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Mark kind={blocked ? "fail" : "warn"} size={18} />
          <span className="hf-h2">{blocked ? "Can’t save these changes" : "Confirm grading changes"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 18 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: H.ink }}>
              <span style={{ color: blocked ? H.bad : H.warn, fontWeight: 700 }}>•</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onCancel}>{blocked ? "Close" : "Cancel"}</Button>
          {!blocked && <Button variant="pri" onClick={onConfirm}>Save anyway</Button>}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="hf-mono"
      style={{
        width: 26,
        height: 24,
        marginLeft: 4,
        borderRadius: 6,
        border: `1px solid ${H.line2}`,
        background: H.paper,
        color: disabled ? H.ink3 : danger ? H.bad : H.ink2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

function TextField({ value, onChange, width = 260, mono, placeholder, editable }: { value: string; onChange: (v: string) => void; width?: number; mono?: boolean; placeholder?: string; editable: boolean }) {
  if (!editable) return <span className={mono ? "hf-mono" : undefined} style={{ fontSize: 12.5 }}>{value || placeholder || "—"}</span>;
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

function NumberField({ value, onChange, editable }: { value: number; onChange: (v: number) => void; editable: boolean }) {
  if (!editable) return <span className="hf-mono" style={{ fontSize: 12.5 }}>{value}%</span>;
  return (
    <input className="hf-input" value={String(value)} inputMode="numeric" onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} />
  );
}
