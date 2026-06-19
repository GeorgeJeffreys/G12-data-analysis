"use client";

/**
 * Overall (best-of-two) view — STUB.
 *
 * Per the year model, Overall takes, for each student and each subject, the
 * HIGHER award across the February and May sittings (best-of-two by AWARD LEVEL,
 * not raw score). It is a derived aggregation, not a pipeline run — there is no
 * scoring/engine work here. The rollup logic is implemented in the next prompt;
 * this page documents the contract and links back to the two sittings.
 */
import Link from "next/link";
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Badge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

export default function YearOverallPage({ params }: { params: { yearId: string } }) {
  const year = useProviderData((p) => p.getYear(params.yearId), [params.yearId]);

  if (!year) {
    return (
      <Shell active="Cycles" crumb={[{ label: "Years", href: "/" }, { label: "Not found" }]}>
        <div style={{ padding: "40px 32px" }}>
          <div className="hf-h1">Year not found</div>
          <div className="hf-sub" style={{ marginTop: 8 }}>
            <Link href="/" style={{ color: H.pink }}>Back to years</Link>.
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      active="Cycles"
      crumb={[
        { label: "Years", href: "/" },
        { label: year.name, href: `/years/${year.id}` },
        { label: "Overall" },
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "28px 32px", gap: 22, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="hf-h1">{year.name} · Overall</div>
          <Badge tone={year.overall.ready ? "good" : "neutral"}>
            {year.overall.ready ? "Ready" : "Pending"}
          </Badge>
        </div>

        <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Best of two — coming next</div>
          <div className="hf-sub" style={{ lineHeight: 1.6 }}>
            The Overall result is derived from the two sittings. For every student and every
            subject it takes the <strong>higher award level</strong> (not the higher raw score)
            across February and May. Cut scores are standard-set per sitting and the D3 safeguard
            applies per sitting; Overall only compares the resulting awards. This is an aggregation
            view — no scoring or engine work runs here.
          </div>
          <div className="hf-sub">{year.overall.note}</div>
        </Card>

        <div>
          <div className="hf-sub" style={{ marginBottom: 8 }}>Sittings feeding this Overall</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[year.february, year.may].map((s) =>
              s.started ? (
                <Link key={s.sitting} href={`/cycles/${s.cycleId}`}>
                  <Button>
                    {s.label} sitting
                    <Icon name="arrow" />
                  </Button>
                </Link>
              ) : (
                <Button key={s.sitting} disabled>
                  {s.label} — not started
                </Button>
              ),
            )}
          </div>
        </div>

        <div style={{ marginTop: "auto" }}>
          <Link href={`/years/${year.id}`} style={{ color: H.pink, fontSize: 13 }}>
            ‹ Back to {year.name}
          </Link>
        </div>
      </div>
    </Shell>
  );
}
