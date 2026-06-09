/**
 * Shared test fixture loaders. The parity fixtures contain bare `NaN` literals
 * (undefined correlations) which are not valid JSON, so we sanitise them to
 * `null` before parsing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", "data");

export interface PublishedStats {
  p_value: number | null;
  p_rating: string;
  item_total: number | null;
  item_total_rating: string;
  point_biserial: number | null;
  point_biserial_rating: string;
  discrimination: number | null;
  discrimination_rating: string;
  overall_review: string;
}

export interface FixtureItem {
  qid: number;
  wording: string;
  major: string;
  sub: string;
  demand: string;
  published: PublishedStats;
}

export interface FixtureResponse {
  student: string;
  qid: number;
  score: number;
}

export interface FixtureAssessment {
  participants: number;
  items: FixtureItem[];
  responses: FixtureResponse[];
}

export type ParityFixtures = Record<string, FixtureAssessment>;

export function loadParityFixtures(): ParityFixtures {
  const raw = readFileSync(path.join(dataDir, "parity_fixtures.json"), "utf8");
  const sanitised = raw.replace(/\bNaN\b/g, "null");
  return JSON.parse(sanitised) as ParityFixtures;
}

export function sampleExportPath(): string {
  return path.join(dataDir, "sample_qm_export.xlsx");
}
