"use client";

/**
 * Start a new cycle — name it, pick the assessments, add each raw export now or
 * later. MOCK: cycles need the database, so "Create cycle" records the intent in
 * the audit log and returns to the (only) live cycle.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Badge, Check } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";

export default function NewCyclePage() {
  const router = useRouter();
  const provider = useProvider();
  const model = useProviderData((p) => p.getNewCycle());

  const [name, setName] = useState(model.defaultName);
  const [sittingDate, setSittingDate] = useState(model.sittingDate);
  const [included, setIncluded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(model.assessments.map((a) => [a.id, a.included])),
  );
  const [files, setFiles] = useState<Record<string, string>>({});

  const selectedCount = useMemo(() => Object.values(included).filter(Boolean).length, [included]);

  const create = () => {
    const assessmentIds = model.assessments.filter((a) => included[a.id]).map((a) => a.id);
    const cycleId = provider.createCycle({ name, sittingDate, assessmentIds });
    router.push(`/cycles/${cycleId}`);
  };

  return (
    <Shell
      active="Cycles"
      crumb={[{ label: "Cycles", href: "/" }, { label: "New cycle" }]}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => router.push("/")}>Cancel</Button>
          <Button variant="pri" disabled={selectedCount === 0 || !name.trim()} onClick={create}>Create cycle</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "flex-start", overflow: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 760, padding: "30px 24px", gap: 24 }}>
          <div>
            <div className="hf-h1">Start a new cycle</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              A cycle is one exam sitting. Name it, pick the assessments, and add each raw export now or later.
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <span className="hf-lbl">Cycle name</span>
              <input
                className="hf-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ color: H.ink, fontWeight: 600, fontFamily: "inherit" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 7, width: 220 }}>
              <span className="hf-lbl">Sitting date</span>
              <span className="hf-field" style={{ justifyContent: "space-between" }}>
                <input
                  value={sittingDate}
                  onChange={(e) => setSittingDate(e.target.value)}
                  style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5, fontFamily: "inherit", color: H.ink }}
                />
                <Icon name="cal" color={H.ink3} />
              </span>
            </label>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="hf-lbl">Assessments in this cycle</span>
              <span className="hf-sub" style={{ fontSize: 11.5 }}>{selectedCount} of {model.assessments.length} selected</span>
            </div>
            <Card style={{ overflow: "hidden" }}>
              {model.assessments.map((a, i) => {
                const on = included[a.id] ?? false;
                const file = files[a.id];
                return (
                  <div
                    key={a.id}
                    style={{ display: "flex", alignItems: "center", padding: "13px 16px", gap: 13, borderBottom: i < model.assessments.length - 1 ? `1px solid ${H.line}` : "none", opacity: on ? 1 : 0.55 }}
                  >
                    <Check on={on} onClick={() => setIncluded((s) => ({ ...s, [a.id]: !on }))} />
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                      {a.name}
                      {a.rtl && (
                        <span className="hf-mono" style={{ fontSize: 9, color: H.ink3, marginLeft: 8, border: `1px solid ${H.line2}`, padding: "1px 5px", borderRadius: 4 }}>RTL</span>
                      )}
                    </span>
                    {!on ? (
                      <span className="hf-sub" style={{ fontSize: 12 }}>Not included</span>
                    ) : file ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <Badge tone="good"><Mark kind="pass" size={12} />Export added</Badge>
                        <span className="hf-mono hf-sub" style={{ fontSize: 11 }}>{file}</span>
                        <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => setFiles((s) => ({ ...s, [a.id]: "" }))}>Replace</Button>
                      </span>
                    ) : (
                      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <label className="hf-btn" style={{ fontSize: 11.5, cursor: "pointer" }}>
                          <Icon name="upload" size={13} />Upload export
                          <input type="file" accept=".xlsx,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles((s) => ({ ...s, [a.id]: f.name })); }} />
                        </label>
                        <span className="hf-sub" style={{ fontSize: 11.5 }}>or add later</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </Card>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 10 }}>
              You can create the cycle now and upload missing exports from the pipeline — each assessment validates on upload.{" "}
              <span style={{ color: H.ink3 }}>(Mock — no cycle is persisted in this build.)</span>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
