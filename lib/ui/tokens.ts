/**
 * Design tokens — ported verbatim from the Claude Design hi-fi system
 * (design/hf.jsx). Alsama brand: cool-neutral surfaces, IBM Plex Mono for data,
 * Sofia Sans for UI, and a single magenta accent (`pink`) reserved for primary
 * actions, the active/current state, focus, and directly-manipulated controls
 * (cut-lines). Data visualisation stays neutral.
 */
export const H = {
  paper: "#ffffff",
  canvas: "#fbfcfd",
  tint: "#e9eef3",
  tint2: "#e2e8ee",
  line: "#e9ecf0",
  line2: "#d5dbe1",
  ink: "#1f2a31",
  ink2: "#58656d",
  ink3: "#97a1a9",
  pink: "#c12c68",
  pinkHover: "#a82357",
  pinkSoft: "#fbe7ef",
  pinkSoft2: "#fdf3f7",
  slate: "#37454e",
  slate2: "#46555f",
  cream: "#e9edf1",
  bar: "#8b959d",
  barFill: "#e3e7ea",
  good: "#2f7d52",
  goodSoft: "#e7f1ea",
  warn: "#946c1a",
  warnSoft: "#f4eed9",
  bad: "#c0392b",
  badSoft: "#f7e7e4",
} as const;

export type QualityTier = "Good" | "Review" | "Poor";

/** Quality bar colour by 0–100 index, matching hfQColor in the design. */
export function qualityColor(v: number): string {
  return v >= 65 ? H.good : v >= 30 ? H.warn : H.bad;
}
export function qualityTier(v: number): QualityTier {
  return v >= 65 ? "Good" : v >= 30 ? "Review" : "Poor";
}

/** Map an engine overall rating to its display colour. */
export function ratingColor(rating: "Good" | "Review" | "Flag"): string {
  return rating === "Good" ? H.good : rating === "Review" ? H.warn : H.bad;
}

// Mirrors `PIPELINE` in lib/data/types.ts. Document/certificate generation is not a
// per-sitting step — it lives at the cycle/overall level — so the per-sitting
// stepper ends at Grades.
export const PIPELINE_STAGES = [
  "Upload",
  "Clean",
  "Raw scores",
  "Question review",
  "Diagnostics",
  "Essay marks",
  "Technical adjustments",
  "Score",
  "Cut scores",
  "Grades",
] as const;
