"use client";

/**
 * Settings › Test centres. The top-level scoping dimension (migration 0010): each
 * centre (e.g. "Shatila 1", "Shatila 2") owns its own exam years and sittings.
 * This tab lists every centre with its active/inactive state and lets a Lead/Admin
 * create, rename / re-code, and (de)activate them.
 *
 * Management is ADMIN-ONLY and enforced server-side by the SECURITY DEFINER RPCs
 * (create_test_centre / update_test_centre / set_test_centre_active, admin-gated in
 * migration 0013). A non-admin sees the list read-only — the editor hides its
 * mutation controls, exactly like the other admin config surfaces.
 *
 * Centre is a partition / labelling key only — nothing here feeds scoring.
 */
import { Shell } from "@/components/shell/Shell";
import { settingsSubnav } from "@/lib/ui/subnav";
import { TestCentresEditor } from "@/components/settings/TestCentresEditor";

export default function TestCentresPage() {
  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Test centres" }]}
      subnav={settingsSubnav("centres")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1, maxWidth: 1040 }}>
        <div>
          <div className="hf-h1">Test centres</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            The top-level scoping dimension. Create the centres you run exams at, and
            deactivate the ones you no longer use without losing their history. New
            sittings are created under a centre; existing years can be reassigned from
            the Years list.
          </div>
        </div>

        <TestCentresEditor />
      </div>
    </Shell>
  );
}
