"use client";

/**
 * Editable per-subject A–E element labels (Settings → Element labels).
 *
 * Each subject carries an ordered A–E mapping of
 *   { match key (the QuestionMajorElement value in the data) → letter → display label }.
 * The element columns across the app use the configured letter + display label
 * instead of a generic, appearance-ordered A–E.
 *
 * The match key binds to the data (read-only here) and the letter fixes the order;
 * only the display label is editable. Lead/Admin only — non-leads see it read-only.
 * The save re-validates server-side (non-empty labels, a letter used at most once
 * per subject) before persisting.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { can } from "@/lib/auth/permissions";
import { H } from "@/lib/ui/tokens";
import { Button, Card, Badge } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";
import { validateElementLabels, type ElementLabelsConfig } from "@/lib/data/element-labels";

const clone = (c: ElementLabelsConfig): ElementLabelsConfig => JSON.parse(JSON.stringify(c));

export function ElementLabelsEditor() {
  const provider = useProvider();
  const live = useProviderData((p) => p.getElementLabels());
  const editable = can(provider.getCurrentUser().role, "configure");

  const [draft, setDraft] = useState<ElementLabelsConfig>(() => clone(live));
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(live);
  const error = validateElementLabels(draft);

  const save = () => {
    if (error) return;
    provider.setElementLabels(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const reset = () => setDraft(clone(live));

  const setLabel = (subject: string, i: number, value: string) =>
    setDraft((d) => ({
      ...d,
      [subject]: d[subject]!.map((e, j) => (j === i ? { ...e, label: value } : e)),
    }));

  const subjects = Object.keys(draft);

  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="hf-h2">Element labels</div>
        <div style={{ flex: 1 }} />
        {editable && saved && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: H.good, fontSize: 12.5, fontWeight: 600 }}>
            <Mark kind="pass" size={15} /> Saved
          </span>
        )}
        {editable && (
          <>
            <Button variant="ghost" disabled={!dirty} onClick={reset}>Reset</Button>
            <Button variant="pri" disabled={!dirty || !!error} onClick={save}>Save labels</Button>
          </>
        )}
      </div>
      <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 12 }}>
        How each subject&apos;s major elements are labelled wherever the app shows generic A–E. The
        match key binds to the <code>QuestionMajorElement</code> value in the data (case-insensitive,
        &ldquo;&amp;&rdquo; and &ldquo;and&rdquo; are treated as the same); only the display label is editable.
      </div>

      {dirty && error && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: 8, background: H.badSoft, marginBottom: 12 }}>
          <Mark kind="fail" size={15} />
          <span style={{ fontSize: 12.5, color: H.ink }}>{error}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {subjects.map((subject) => (
          <div key={subject}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: H.ink }}>{subject}</span>
              <Badge tone="neutral">{draft[subject]!.length} elements</Badge>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {draft[subject]!.map((e, i) => (
                <div key={`${e.matchKey}-${i}`} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span
                    className="hf-mono"
                    style={{ width: 20, height: 20, borderRadius: 5, background: H.tint2, color: H.ink2, fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}
                  >
                    {e.letter}
                  </span>
                  <span
                    title={e.matchKey}
                    style={{ flex: "1 1 280px", minWidth: 0, fontSize: 12, color: H.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {e.matchKey}
                  </span>
                  <span className="hf-sub" style={{ fontSize: 11, flex: "0 0 auto" }}>→</span>
                  <input
                    value={e.label}
                    disabled={!editable}
                    onChange={(ev) => setLabel(subject, i, ev.target.value)}
                    aria-label={`Display label for ${subject} ${e.letter}`}
                    style={{
                      flex: "1 1 260px",
                      minWidth: 0,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: `1px solid ${e.label.trim() ? H.line2 : H.bad}`,
                      fontSize: 12.5,
                      color: H.ink,
                      background: editable ? H.paper : H.canvas,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
