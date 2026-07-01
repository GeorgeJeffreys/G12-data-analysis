"use client";

/**
 * Settings › Incident adjustments (configuration registry). ADMIN-ONLY editing
 * (gated on `hasRole(user, 'admin')` via the provider's `canEdit`); lower roles
 * see the same page read-only. This is the configuration half of the Incident
 * Adjustments subsystem (02a): the registry of incident codes + formulae + caps,
 * the per-student global cap, and the reconfigurable import column mapping.
 *
 * Nothing here applies a mark — the apply step (02b) consumes this config and
 * feeds the existing engine seam (alterations → raw). Every mark quantity is
 * ADD-ONLY (validated ≥ 0) and every code carries a per-incident cap.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Toggle } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";
import { validateIncidentCode, validatePerStudentCap } from "@/lib/incidents/config";
import { describeFormula } from "@/lib/incidents/formula";
import type {
  IncidentCode,
  IncidentCodeInput,
  IncidentColumnMapping,
  IncidentFormula,
  FormulaKind,
} from "@/lib/incidents/types";

export default function IncidentAdjustmentsConfigPage() {
  const config = useProviderData((p) => p.getIncidentConfig());
  const canEdit = config.canEdit;

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Incident adjustments" }]}
      subnav={settingsSubnav("incidents")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1, maxWidth: 1040 }}>
        <div>
          <div className="hf-h1">Incident adjustments</div>
          <div className="hf-sub" style={{ marginTop: 7, maxWidth: 720 }}>
            The rules that turn exam incidents into capped, auditable mark adjustments. Each incident code
            matches a set of incident types and grants marks via a formula, capped per incident. A per-student
            global cap limits the total any one student can receive. Adjustments only ever <b>add</b> marks.
          </div>
        </div>

        {!canEdit && (
          <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, background: H.tint }}>
            <Icon name="lock" />
            <span className="hf-sub" style={{ fontSize: 12.5 }}>
              View only. Configuring incident codes, caps and the import mapping is restricted to G12 admins.
            </span>
          </Card>
        )}

        <PerStudentCapCard cap={config.perStudentCap} canEdit={canEdit} />
        <IncidentCodesCard codes={config.codes} canEdit={canEdit} />
        <ColumnMappingCard mapping={config.mapping} canEdit={canEdit} />
      </div>
    </Shell>
  );
}

// ── per-student global cap ────────────────────────────────────────────────────
function PerStudentCapCard({ cap, canEdit }: { cap: number | null; canEdit: boolean }) {
  const provider = useProvider();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (cap === null ? "" : String(cap));
  const parsed = shown.trim() === "" ? null : Number(shown);
  const invalid = parsed !== null && (Number.isNaN(parsed) || validatePerStudentCap(parsed).length > 0);
  const commit = () => {
    if (!invalid) provider.setIncidentPerStudentCap(parsed);
    setText(null);
  };
  return (
    <SectionCard
      title="Per-student global cap"
      sub="A hard ceiling on the TOTAL marks any one student can receive from incidents across all codes combined. The apply step (02b) enforces this. Leave blank for no global cap."
    >
      <Row label="Maximum total incident marks per student" last>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              className="hf-input"
              style={{ width: 80, textAlign: "right", borderColor: invalid ? H.pink : undefined }}
              value={shown}
              inputMode="decimal"
              disabled={!canEdit}
              placeholder="No cap"
              aria-label="Per-student global cap (marks)"
              aria-invalid={invalid}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <span className="hf-sub" style={{ fontSize: 12 }}>marks</span>
          </span>
          {invalid && <span style={{ fontSize: 10.5, color: H.pink }}>Enter a number ≥ 0 (add-only), or blank for no cap.</span>}
        </span>
      </Row>
    </SectionCard>
  );
}

// ── incident codes registry ───────────────────────────────────────────────────
function IncidentCodesCard({ codes, canEdit }: { codes: IncidentCode[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${H.line}` }}>
        <div>
          <div className="hf-h2">Incident codes</div>
          <div className="hf-sub" style={{ fontSize: 12, marginTop: 2 }}>Each code matches incident types and grants marks via a formula, capped per incident.</div>
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && !adding && (
          <Button variant="ghost" style={{ fontSize: 11.5, padding: "6px 11px" }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} />Add code
          </Button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {codes.length === 0 && !adding && (
          <div className="hf-sub" style={{ padding: "22px 18px", fontSize: 12.5 }}>No incident codes yet. {canEdit ? "Add one to start." : ""}</div>
        )}
        {adding && (
          <CodeEditor canEdit={canEdit} existing={codes} onDone={() => setAdding(false)} />
        )}
        {codes.map((c) => (
          <CodeRow key={c.id} code={c} codes={codes} canEdit={canEdit} />
        ))}
      </div>
    </Card>
  );
}

function CodeRow({ code, codes, canEdit }: { code: IncidentCode; codes: IncidentCode[]; canEdit: boolean }) {
  const provider = useProvider();
  const [editing, setEditing] = useState(false);
  if (editing) return <CodeEditor canEdit={canEdit} existing={codes} initial={code} onDone={() => setEditing(false)} />;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderTop: `1px solid ${H.line}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="hf-mono" style={{ fontSize: 12, fontWeight: 700 }}>{code.code}</span>
          <span style={{ fontSize: 13 }}>{code.label}</span>
          {!code.active && <span style={{ fontSize: 9, color: H.ink3, border: `1px solid ${H.line2}`, borderRadius: 4, padding: "1px 5px" }}>INACTIVE</span>}
        </div>
        <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
          Matches: {code.matchTypes.join(", ") || "—"}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 150 }}>
        <div className="hf-mono" style={{ fontSize: 12 }}>{describeFormula(code.formula)}</div>
        <div className="hf-sub" style={{ fontSize: 11 }}>cap {code.perCodeCap} mark{code.perCodeCap === 1 ? "" : "s"}/incident</div>
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="ghost" style={{ fontSize: 11.5 }} onClick={() => setEditing(true)}>Edit</Button>
          <button
            onClick={() => provider.deleteIncidentCode(code.id)}
            title="Delete code"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: H.bad, display: "inline-flex", alignItems: "center" }}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

const EMPTY_INPUT: IncidentCodeInput = {
  code: "",
  label: "",
  matchTypes: [],
  formula: { kind: "fixed", marks: 1 },
  perCodeCap: 1,
  active: true,
};

function CodeEditor({
  canEdit,
  existing,
  initial,
  onDone,
}: {
  canEdit: boolean;
  existing: IncidentCode[];
  initial?: IncidentCode;
  onDone: () => void;
}) {
  const provider = useProvider();
  const [code, setCode] = useState(initial?.code ?? EMPTY_INPUT.code);
  const [label, setLabel] = useState(initial?.label ?? EMPTY_INPUT.label);
  const [matchText, setMatchText] = useState((initial?.matchTypes ?? []).join(", "));
  const [formula, setFormula] = useState<IncidentFormula>(initial?.formula ?? EMPTY_INPUT.formula);
  const [capText, setCapText] = useState(String(initial?.perCodeCap ?? EMPTY_INPUT.perCodeCap));
  const [active, setActive] = useState(initial?.active ?? true);

  const input: IncidentCodeInput = {
    id: initial?.id,
    code,
    label,
    matchTypes: matchText.split(",").map((t) => t.trim()).filter(Boolean),
    formula,
    perCodeCap: Number(capText),
    active,
  };
  const errors = validateIncidentCode(input, existing);
  const save = () => {
    if (errors.length === 0) {
      provider.upsertIncidentCode(input);
      onDone();
    }
  };

  return (
    <div style={{ padding: "16px 18px", borderTop: `1px solid ${H.line}`, background: H.canvas, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label="Code">
          <input className="hf-input" style={{ width: 150 }} value={code} disabled={!canEdit} onChange={(e) => setCode(e.target.value)} placeholder="CALC_FAIL" />
        </Field>
        <Field label="Label" grow>
          <input className="hf-textinput" value={label} disabled={!canEdit} onChange={(e) => setLabel(e.target.value)} placeholder="Calculator / device failure" />
        </Field>
        <Field label="Active">
          <Toggle on={active} onClick={canEdit ? () => setActive((a) => !a) : undefined} />
        </Field>
      </div>

      <Field label="Matches these incident types (comma-separated)">
        <input className="hf-textinput" value={matchText} disabled={!canEdit} onChange={(e) => setMatchText(e.target.value)} placeholder="calculator broke, device failure" />
      </Field>

      <FormulaEditor formula={formula} onChange={setFormula} canEdit={canEdit} />

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="Per-incident cap (marks)">
          <input
            className="hf-input"
            style={{ width: 90 }}
            value={capText}
            inputMode="decimal"
            disabled={!canEdit}
            onChange={(e) => setCapText(e.target.value)}
            placeholder="3"
          />
        </Field>
        <div className="hf-sub" style={{ fontSize: 11.5, flex: 1, minWidth: 200 }}>
          Preview: <span className="hf-mono">{describeFormula(formula)}</span>, capped at {Number(capText) || 0} marks/incident.
        </div>
      </div>

      {errors.length > 0 && canEdit && (
        <ul style={{ margin: 0, paddingLeft: 18, color: H.pink, fontSize: 11.5 }}>
          {errors.map((er, i) => <li key={i}>{er}</li>)}
        </ul>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {canEdit && <Button variant="pri" disabled={errors.length > 0} onClick={save}>{initial ? "Save code" : "Add code"}</Button>}
        <Button variant="ghost" onClick={onDone}>{canEdit ? "Cancel" : "Close"}</Button>
      </div>
    </div>
  );
}

function FormulaEditor({
  formula,
  onChange,
  canEdit,
}: {
  formula: IncidentFormula;
  onChange: (f: IncidentFormula) => void;
  canEdit: boolean;
}) {
  const setKind = (kind: FormulaKind) => {
    if (kind === "fixed") onChange({ kind: "fixed", marks: 1 });
    else if (kind === "per_duration") onChange({ kind: "per_duration", marksPerUnit: 0.5, perMinutes: 5, rounding: "block" });
    else onChange({ kind: "pct_section", percent: 5, basis: "assessment" });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>Formula</span>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {(
          [
            ["fixed", "Fixed marks"],
            ["per_duration", "Per duration"],
            ["pct_section", "% of section"],
          ] as const
        ).map(([k, lbl]) => (
          <button
            key={k}
            className={`hf-chip ${formula.kind === k ? "on" : ""}`}
            onClick={canEdit ? () => setKind(k) : undefined}
            disabled={!canEdit}
          >
            {lbl}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {formula.kind === "fixed" && (
          <Field label="Marks per incident">
            <input className="hf-input" style={{ width: 90 }} value={String(formula.marks)} inputMode="decimal" disabled={!canEdit}
              onChange={(e) => onChange({ kind: "fixed", marks: Number(e.target.value) })} />
          </Field>
        )}
        {formula.kind === "per_duration" && (
          <>
            <Field label="Marks">
              <input className="hf-input" style={{ width: 70 }} value={String(formula.marksPerUnit)} inputMode="decimal" disabled={!canEdit}
                onChange={(e) => onChange({ ...formula, marksPerUnit: Number(e.target.value) })} />
            </Field>
            <Field label="per (minutes)">
              <input className="hf-input" style={{ width: 70 }} value={String(formula.perMinutes)} inputMode="decimal" disabled={!canEdit}
                onChange={(e) => onChange({ ...formula, perMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Partial units">
              <select className="hf-select" value={formula.rounding ?? "block"} disabled={!canEdit}
                onChange={(e) => onChange({ ...formula, rounding: e.target.value as "block" | "proportional" })}>
                <option value="block">Whole blocks only</option>
                <option value="proportional">Pro-rata</option>
              </select>
            </Field>
          </>
        )}
        {formula.kind === "pct_section" && (
          <>
            <Field label="Percent">
              <input className="hf-input" style={{ width: 70 }} value={String(formula.percent)} inputMode="decimal" disabled={!canEdit}
                onChange={(e) => onChange({ ...formula, percent: Number(e.target.value) })} />
            </Field>
            <Field label="Of section">
              <select className="hf-select" value={formula.basis} disabled={!canEdit}
                onChange={(e) => onChange({ ...formula, basis: e.target.value as "assessment" | "major_element" })}>
                <option value="assessment">Subject / assessment max</option>
                <option value="major_element">Question major element</option>
              </select>
            </Field>
            <div className="hf-sub" style={{ fontSize: 11, maxWidth: 280 }}>
              The section max is the engine’s scored denominator (not a raw sum of item maxes).
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── import column mapping ─────────────────────────────────────────────────────
function ColumnMappingCard({ mapping, canEdit }: { mapping: IncidentColumnMapping; canEdit: boolean }) {
  const provider = useProvider();
  const fields: { key: keyof IncidentColumnMapping; label: string }[] = [
    { key: "studentId", label: "Student ID" },
    { key: "studentName", label: "Student Name" },
    { key: "incidentType", label: "Incident Type" },
    { key: "questionNumber", label: "Question Number" },
    { key: "duration", label: "Incident Duration" },
  ];
  return (
    <SectionCard
      title="Import column mapping"
      sub="Which column header in the uploaded incident file carries each logical field. Reconfigurable so we can point the parser at the real file without a code change."
    >
      {fields.map((f, i) => (
        <Row key={f.key} label={f.label} last={i === fields.length - 1}>
          <input
            className="hf-input"
            style={{ width: 220 }}
            value={mapping[f.key]}
            disabled={!canEdit}
            onChange={(e) => provider.setIncidentMapping({ ...mapping, [f.key]: e.target.value })}
            aria-label={`${f.label} column header`}
          />
        </Row>
      ))}
    </SectionCard>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────
function SectionCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div className="hf-h2">{title}</div>
      {sub && <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 14 }}>{sub}</div>}
      {!sub && <div style={{ height: 14 }} />}
      {children}
    </Card>
  );
}

function Row({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: last ? "none" : `1px solid ${H.line}`, gap: 16 }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}

function Field({ label, children, grow }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: grow ? "1 1 220px" : "0 0 auto", minWidth: grow ? 200 : undefined }}>
      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{label}</span>
      {children}
    </label>
  );
}
