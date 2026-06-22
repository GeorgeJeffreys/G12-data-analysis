"use client";

/**
 * Start a new sitting — name it, set the date, pick the assessments. Creating a
 * sitting is metadata only; the three Questionmark CSVs are uploaded later at the
 * pipeline's first step (Upload). "Create sitting" persists through the
 * DataProvider (a real Supabase write when running live), then navigates to the
 * new sitting by its real id.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Check } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

export default function NewCyclePage() {
  const router = useRouter();
  const provider = useProvider();
  const model = useProviderData((p) => p.getNewCycle());

  const [name, setName] = useState(model.defaultName);
  const [sittingDate, setSittingDate] = useState(model.sittingDate);
  const [included, setIncluded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(model.assessments.map((a) => [a.id, a.included])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = useMemo(() => Object.values(included).filter(Boolean).length, [included]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const assessmentIds = model.assessments.filter((a) => included[a.id]).map((a) => a.id);
      const cycleId = await provider.createCycle({ name, sittingDate, assessmentIds });
      router.push(`/cycles/${cycleId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the sitting. Please try again.");
      setBusy(false);
    }
  };

  return (
    <Shell
      active="Cycles"
      crumb={[{ label: "Sittings", href: "/" }, { label: "New sitting" }]}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => router.push("/")} disabled={busy}>Cancel</Button>
          <Button variant="pri" disabled={busy || selectedCount === 0 || !name.trim()} onClick={create}>
            {busy ? "Creating…" : "Create sitting"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "flex-start", overflow: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 760, padding: "30px 24px", gap: 24 }}>
          <div>
            <div className="hf-h1">Start a new sitting</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              A sitting is one exam event — name it, set the date, pick the assessments.
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <span className="hf-lbl">Sitting name</span>
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
              <span className="hf-lbl">Assessments in this sitting</span>
              <span className="hf-sub" style={{ fontSize: 11.5 }}>{selectedCount} of {model.assessments.length} selected</span>
            </div>
            <Card style={{ overflow: "hidden" }}>
              {model.assessments.map((a, i) => {
                const on = included[a.id] ?? false;
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
                    <span className="hf-sub" style={{ fontSize: 12 }}>{on ? "Included" : "Not included"}</span>
                  </div>
                );
              })}
            </Card>
            <div className="hf-sub" style={{ fontSize: 12, marginTop: 10 }}>
              After you create the sitting you land in the pipeline, where the first step (Upload) takes the three Questionmark CSVs and splits them into subjects.
            </div>
            {error && (
              <div style={{ marginTop: 12, padding: "10px 13px", borderRadius: 8, background: "#3a1d1d", color: "#f3b4b4", fontSize: 12.5 }}>
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
