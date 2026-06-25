"use client";

/**
 * Settings › Test centres (migrations 0010 + 0013).
 *
 * Test centres are the top-level scoping dimension: each centre (e.g. "Shatila 1")
 * owns its own exam years and sittings. This section lists every centre and lets
 * a Lead/Admin create, rename/re-code, and (de)activate them. Deactivating hides
 * a centre from new work without touching its historical years/sittings.
 *
 * Centre is a partition / labelling key only — nothing here feeds scoring.
 *
 * Management is admin-only and enforced SERVER-SIDE: the create/update/set-active
 * RPCs assert app.is_workspace_admin() (migration 0013), so this client gate is
 * UX only — a non-admin is rejected at the data layer regardless.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Button, Card, Toggle } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/icons";
import type { TestCentreSummary } from "@/lib/data/types";

export function TestCentresEditor() {
  const provider = useProvider();
  const centres = useProviderData((p) => p.listTestCentres());
  const editable = provider.getCurrentUser().role === "lead_admin";

  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const add = () => {
    if (!newName.trim() || !newCode.trim()) return;
    provider.createTestCentre({ name: newName, code: newCode });
    setNewName("");
    setNewCode("");
  };

  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="hf-h2">Centres</div>
      </div>
      <div className="hf-sub" style={{ fontSize: 12, marginTop: 3, marginBottom: 14 }}>
        Each centre owns its own exam years and sittings; the same year (e.g. 2026) can run in more than
        one centre and is aligned later for cross-centre comparison.
      </div>

      <div className="hf-scroll-x">
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <th className="hf-th" style={{ paddingLeft: 0 }}>Centre</th>
              <th className="hf-th">Code</th>
              <th className="hf-th">Slug</th>
              <th className="hf-th" style={{ textAlign: "right", paddingRight: 0 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {centres.map((c) => (
              <CentreRow key={c.id} centre={c} editable={editable} />
            ))}
            {centres.length === 0 && (
              <tr>
                <td className="hf-td" colSpan={4} style={{ paddingLeft: 0 }}>
                  <span className="hf-sub" style={{ fontSize: 12 }}>No test centres yet — add the first one below.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
            <span className="hf-lbl">New centre name</span>
            <input
              className="hf-input"
              placeholder="e.g. Shatila 2"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 120 }}>
            <span className="hf-lbl">Code</span>
            <input
              className="hf-input"
              placeholder="SHA2"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
          </label>
          <Button variant="pri" disabled={!newName.trim() || !newCode.trim()} onClick={add}>Add centre</Button>
        </div>
      )}
      {!editable && (
        <div className="hf-sub" style={{ fontSize: 11.5, marginTop: 10 }}>
          Only a Lead/Admin can manage test centres.
        </div>
      )}
    </Card>
  );
}

function CentreRow({ centre, editable }: { centre: TestCentreSummary; editable: boolean }) {
  const provider = useProvider();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(centre.name);
  const [code, setCode] = useState(centre.code);

  const save = () => {
    provider.updateTestCentre(centre.id, { name, code });
    setEditing(false);
  };
  const cancel = () => {
    setName(centre.name);
    setCode(centre.code);
    setEditing(false);
  };

  return (
    <tr>
      <td className="hf-td" style={{ paddingLeft: 0, fontWeight: 600, fontSize: 12.5 }}>
        {editing ? (
          <input className="hf-input" style={{ width: 160 }} value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {centre.name}
            {editable && (
              <button onClick={() => setEditing(true)} className="hf-sub" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: H.ink3, textDecoration: "underline" }}>edit</button>
            )}
          </span>
        )}
      </td>
      <td className="hf-td hf-mono" style={{ fontSize: 12 }}>
        {editing ? (
          <input className="hf-input" style={{ width: 84 }} value={code} onChange={(e) => setCode(e.target.value)} />
        ) : (
          centre.code
        )}
      </td>
      <td className="hf-td hf-mono hf-sub" style={{ fontSize: 11.5 }}>{centre.slug}</td>
      <td className="hf-td" style={{ textAlign: "right", paddingRight: 0 }}>
        {editing ? (
          <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={cancel} style={{ fontSize: 11 }}>Cancel</Button>
            <Button variant="pri" onClick={save} style={{ fontSize: 11 }} disabled={!name.trim() || !code.trim()}>
              <Mark kind="pass" size={13} />Save
            </Button>
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <span className="hf-sub" style={{ fontSize: 11 }}>{centre.active ? "Active" : "Inactive"}</span>
            <Toggle on={centre.active} onClick={editable ? () => provider.setTestCentreActive(centre.id, !centre.active) : undefined} />
          </span>
        )}
      </td>
    </tr>
  );
}
