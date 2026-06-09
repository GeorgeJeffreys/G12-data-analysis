/**
 * Reusable design-system primitives (Button, Chip, StatBlock, QualityBar, …),
 * ported from design/hf.jsx. Pure presentational components.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { H, qualityColor, qualityTier } from "@/lib/ui/tokens";

type Variant = "default" | "pri" | "ghost" | "danger";

export function Button({
  variant = "default",
  children,
  className = "",
  ...rest
}: { variant?: Variant; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = variant === "default" ? "hf-btn" : `hf-btn ${variant}`;
  return (
    <button className={`${cls} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

export function Chip({
  on,
  children,
  onClick,
  as = "button",
}: {
  on?: boolean;
  children: ReactNode;
  onClick?: () => void;
  as?: "button" | "span";
}) {
  const Tag = as;
  return (
    <Tag className={`hf-chip ${on ? "on" : ""}`} onClick={onClick} type={as === "button" ? "button" : undefined}>
      {children}
    </Tag>
  );
}

export function Lbl({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span className="hf-lbl" style={style}>
      {children}
    </span>
  );
}

export function Sub({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span className="hf-sub" style={style}>
      {children}
    </span>
  );
}

export function StatBlock({
  n,
  label,
  sub,
  accent,
}: {
  n: ReactNode;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        className="hf-mono"
        style={{ fontSize: 25, fontWeight: 600, lineHeight: 1, color: accent ? H.pink : H.ink }}
      >
        {n}
      </span>
      <span className="hf-lbl" style={{ marginTop: 4 }}>
        {label}
      </span>
      {sub && (
        <span className="hf-sub" style={{ fontSize: 11 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

/** Coloured 0–100 quality bar with the numeric and optional tier label. */
export function QualityBar({
  v,
  width = 70,
  showLabel,
}: {
  v: number;
  width?: number;
  showLabel?: boolean;
}) {
  const c = qualityColor(v);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ width, height: 7, background: H.tint2, borderRadius: 5, flex: "0 0 auto" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, v))}%`, height: "100%", background: c, borderRadius: 5 }} />
      </div>
      <span className="hf-mono" style={{ fontSize: 11.5, color: c, fontWeight: 600, width: 20 }}>
        {v}
      </span>
      {showLabel && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: c }}>{qualityTier(v)}</span>
      )}
    </div>
  );
}

/** Small neutral pill, e.g. demand level. */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 500,
        border: `1px solid ${H.line2}`,
        borderRadius: 999,
        padding: "2px 9px",
        color: H.ink2,
        background: H.paper,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  style,
  className = "",
}: {
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div className={`hf-card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
