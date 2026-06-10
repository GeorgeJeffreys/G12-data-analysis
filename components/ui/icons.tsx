/**
 * Line icons + status marks, ported from design/hf.jsx (HIco / HMark).
 */
import { H } from "@/lib/ui/tokens";

export type IconName =
  | "search"
  | "lock"
  | "upload"
  | "x"
  | "chev"
  | "plus"
  | "arrow"
  | "doc"
  | "download"
  | "award"
  | "refresh";

export function Icon({
  name,
  size = 15,
  color = "currentColor",
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const st = { width: size, height: size, flex: "0 0 auto", display: "inline-block", verticalAlign: "middle" as const };
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "search":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <circle cx="7" cy="7" r="4.2" {...p} />
          <path d="M10.2 10.2L14 14" {...p} />
        </svg>
      );
    case "lock":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" {...p} />
          <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" {...p} />
        </svg>
      );
    case "upload":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M8 10.5V3.5M5 6l3-3 3 3M3 12.5h10" {...p} />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M4 4l8 8M12 4l-8 8" {...p} />
        </svg>
      );
    case "chev":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M4 6l4 4 4-4" {...p} />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M8 3v10M3 8h10" {...p} />
        </svg>
      );
    case "arrow":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M3 8h10M9 4l4 4-4 4" {...p} />
        </svg>
      );
    case "doc":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M4 2.5h5l3 3v8H4z" {...p} />
          <path d="M9 2.5v3h3" {...p} />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M8 2.5v7M5 7l3 3 3-3M3 13h10" {...p} />
        </svg>
      );
    case "refresh":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <path d="M13 6a5 5 0 10.5 4M13 3v3h-3" {...p} />
        </svg>
      );
    case "award":
      return (
        <svg viewBox="0 0 16 16" style={st}>
          <circle cx="8" cy="6.5" r="3.5" {...p} />
          <path d="M6 9.5L5 14l3-1.6L11 14l-1-4.5" {...p} />
        </svg>
      );
    default:
      return null;
  }
}

export type MarkKind = "pass" | "warn" | "fail";

export function Mark({ kind, size = 16 }: { kind: MarkKind; size?: number }) {
  const st = { width: size, height: size, flex: "0 0 auto", display: "inline-block", verticalAlign: "middle" as const };
  if (kind === "pass")
    return (
      <svg viewBox="0 0 16 16" style={st}>
        <circle cx="8" cy="8" r="7.2" fill={H.goodSoft} />
        <path d="M4.5 8.2l2.3 2.3L11.5 5.6" fill="none" stroke={H.good} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "warn")
    return (
      <svg viewBox="0 0 16 16" style={st}>
        <circle cx="8" cy="8" r="7.2" fill={H.warnSoft} />
        <path d="M8 4.3v4.3M8 10.9v.05" stroke={H.warn} strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" style={st}>
      <circle cx="8" cy="8" r="7.2" fill={H.badSoft} />
      <path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" fill="none" stroke={H.bad} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
