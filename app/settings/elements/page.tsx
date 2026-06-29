"use client";

/**
 * Settings › Element labels. The per-subject, ordered A–E mapping of
 * { match key (the QuestionMajorElement value in the data) → letter → display label }
 * used to label the element columns wherever the app shows generic A–E.
 *
 * Editing is Lead/Admin only and re-validated server-side (migration 0014's
 * set_element_labels RPC); a non-admin sees the labels read-only.
 */
import { Shell } from "@/components/shell/Shell";
import { settingsSubnav } from "@/lib/ui/subnav";
import { ElementLabelsEditor } from "@/components/settings/ElementLabelsEditor";

export default function ElementLabelsPage() {
  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Element labels" }]}
      subnav={settingsSubnav("elements")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1, maxWidth: 1040 }}>
        <div>
          <div className="hf-h1">Element labels</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Name each subject&apos;s major elements (A–E) so the element columns across the pipeline
            read in your own words instead of a generic A–E. The match key binds to the data value;
            only the display label is editable.
          </div>
        </div>

        <ElementLabelsEditor />
      </div>
    </Shell>
  );
}
