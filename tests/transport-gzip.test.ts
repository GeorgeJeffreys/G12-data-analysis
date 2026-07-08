/**
 * Transport gzip round-trip — proves the ingest 413 fix is size-independent.
 *
 * The real ingest POST body grows with the cohort; Vercel caps request bodies at
 * 4.5 MB (unraisable). These tests construct an Items-shaped payload larger than
 * BOTH ceilings (1 MB Server-Action, 4.5 MB Vercel) uncompressed, then assert:
 *   • gzipText → gunzipToText recovers byte-identical text (length + checksum),
 *   • the compressed size is a small fraction of the original (well under 4.5 MB),
 *   • detection still classifies the recovered CSV as the Items export, and
 *   • a small (May-sized) payload round-trips through the same path (regression).
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { gzipText, gunzipToText } from "@/lib/transport/gzip";
import { parseCsv, detectKind } from "@/lib/ingest/qm";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Build a valid Items-shaped CSV whose uncompressed size exceeds `minBytes`. */
function makeItemsCsv(minBytes: number): string {
  const header = "ResultId,QuestionId,AnswerScore,ResultParticipantName,TopicName";
  const rows: string[] = [header];
  let bytes = header.length + 1;
  let i = 0;
  while (bytes < minBytes) {
    const row = `R${100000 + i},Q${i},${(i % 5) + 1},Participant Name ${i} — الطالب,Topic ${i % 12}`;
    rows.push(row);
    bytes += row.length + 1;
    i++;
  }
  return rows.join("\n");
}

describe("transport gzip round-trip", () => {
  it("recovers byte-identical text for a payload larger than both ceilings", async () => {
    const original = makeItemsCsv(5 * 1024 * 1024); // > 4.5 MB uncompressed
    const originalBytes = Buffer.byteLength(original, "utf8");
    expect(originalBytes).toBeGreaterThan(4.5 * 1024 * 1024);

    const gz = await gzipText(original);
    const gzBytes = gz.size;
    const recovered = await gunzipToText(await gz.arrayBuffer());

    // Byte-identical recovery.
    expect(recovered.length).toBe(original.length);
    expect(sha(recovered)).toBe(sha(original));

    // Compresses to a small fraction — comfortably under the 4.5 MB ceiling.
    expect(gzBytes).toBeLessThan(4.5 * 1024 * 1024);
    expect(gzBytes).toBeLessThan(originalBytes / 5);

    // Detection is unchanged on the recovered text.
    expect(detectKind(parseCsv(recovered).headers)).toBe("items");
  });

  it("round-trips a small (May-sized) payload through the same path", async () => {
    const small = makeItemsCsv(50 * 1024); // ~50 KB, like a smaller cycle
    const gz = await gzipText(small);
    const recovered = await gunzipToText(await gz.arrayBuffer());
    expect(sha(recovered)).toBe(sha(small));
    expect(detectKind(parseCsv(recovered).headers)).toBe("items");
  });

  it("round-trips a realistic JSON ingest body (the actual transport shape)", async () => {
    const body = JSON.stringify({
      clean: Array.from({ length: 20000 }, (_, i) => ({
        resultId: `R${i}`,
        questionId: `Q${i}`,
        score: i % 4,
        subject: "Mathematics",
      })),
      fileName: "Assessments.csv",
    });
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(1024 * 1024); // > 1 MB
    const gz = await gzipText(body);
    const recovered = await gunzipToText(await gz.arrayBuffer());
    expect(sha(recovered)).toBe(sha(body));
    expect(JSON.parse(recovered)).toEqual(JSON.parse(body));
  });
});
