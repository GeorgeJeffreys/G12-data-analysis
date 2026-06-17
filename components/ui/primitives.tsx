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

/**
 * Inline loading spinner — sized to sit next to button text. Inherits the
 * surrounding text colour by default (so it reads white on a `pri` button and
 * ink on a ghost one). Respects prefers-reduced-motion via the `.hf-spinner`
 * rule in globals.css.
 */
export function Spinner({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      className="hf-spinner"
      viewBox="0 0 16 16"
      style={{ width: size, height: size, flex: "0 0 auto", display: "inline-block", verticalAlign: "middle" }}
      role="status"
      aria-label="Loading"
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
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

export type BadgeTone = "good" | "warn" | "bad" | "accent" | "neutral";

/** Small status pill with a tone (ported from design HBadge). */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const map: Record<BadgeTone, [string, string]> = {
    good: [H.good, H.goodSoft],
    warn: [H.warn, H.warnSoft],
    bad: [H.bad, H.badSoft],
    accent: [H.pink, H.pinkSoft],
    neutral: [H.ink2, H.tint2],
  };
  const [fg, bg] = map[tone];
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: fg,
        background: bg,
        padding: "3px 9px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
        letterSpacing: ".2px",
      }}
    >
      {children}
    </span>
  );
}

/** Initials avatar (ported from design HAvatar). */
export function Avatar({ name, size = 32, tone }: { name: string; size?: number; tone?: "pink" }) {
  const init = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: tone === "pink" ? H.pinkSoft : H.tint2,
        color: tone === "pink" ? H.pink : H.ink2,
        fontWeight: 700,
        fontSize: size * 0.38,
      }}
    >
      {init}
    </span>
  );
}

/** Toggle switch (ported from design HToggle). */
export function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        width: 34,
        height: 20,
        borderRadius: 999,
        background: on ? H.pink : H.line2,
        position: "relative",
        flex: "0 0 auto",
        transition: ".15s",
        border: "none",
        cursor: onClick ? "pointer" : "default",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 16 : 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
          transition: ".15s",
        }}
      />
    </button>
  );
}

/** Checkbox (ported from design HCheck). */
export function Check({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1.5px solid ${on ? H.pink : H.line2}`,
        background: on ? H.pink : H.paper,
        cursor: onClick ? "pointer" : "default",
        padding: 0,
      }}
    >
      {on && (
        <svg width="11" height="11" viewBox="0 0 12 12">
          <path d="M2.5 6.2l2.2 2.2L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
