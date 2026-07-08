/**
 * Unit tests for the Clean-stage flagging engine (lib/clean/flags.ts).
 * Each rule gets a positive case (fires) and a negative case (does not fire).
 * This is a view-layer helper, deliberately NOT part of the engine parity suite.
 */
import { describe, it, expect } from "vitest";
import { computeCleanFlags, type CleanFlagInput } from "@/lib/clean/flags";

/** A minimal well-formed input; override per-test. */
function base(over: Partial<CleanFlagInput> = {}): CleanFlagInput {
  return {
    items: [
      { id: "q1", maxScore: 1, label: "Q1" },
      { id: "q2", maxScore: 1, label: "Q2" },
    ],
    rows: [
      { id: "s1", email: "alice@school.edu", cells: [1, 0] },
      { id: "s2", email: "bob@school.edu", cells: [0, 1] },
    ],
    ...over,
  };
}

function codesFor(input: CleanFlagInput, target: "row" | "column", id: string): string[] {
  return computeCleanFlags(input)
    .filter((f) => f.target === target && f.id === id)
    .map((f) => f.code);
}

describe("computeCleanFlags — column rules", () => {
  it("STIMULUS_ITEM fires for a maxScore-0 item, as low/informational", () => {
    const input = base({
      items: [
        { id: "q1", maxScore: 1, label: "Q1" },
        { id: "stim", maxScore: 0, label: "Welcome" },
      ],
      rows: [
        { id: "s1", email: "a@x.io", cells: [1, 0] },
        { id: "s2", email: "b@x.io", cells: [0, 0] },
      ],
    });
    const flags = computeCleanFlags(input).filter((f) => f.id === "stim");
    expect(flags.map((f) => f.code)).toContain("STIMULUS_ITEM");
    const stim = flags.find((f) => f.code === "STIMULUS_ITEM")!;
    expect(stim.severity).toBe("low");
    // A stimulus item must NOT also be reported as ZERO_VARIANCE noise.
    expect(flags.map((f) => f.code)).not.toContain("ZERO_VARIANCE");
  });

  it("STIMULUS_ITEM does not fire for a normal scored item", () => {
    expect(codesFor(base(), "column", "q1")).not.toContain("STIMULUS_ITEM");
  });

  it("ALL_BLANK fires when no participant answered the column", () => {
    const input = base({
      rows: [
        { id: "s1", email: "a@x.io", cells: [1, null] },
        { id: "s2", email: "b@x.io", cells: [0, null] },
      ],
    });
    expect(codesFor(input, "column", "q2")).toContain("ALL_BLANK");
  });

  it("ALL_BLANK does not fire when at least one response exists", () => {
    expect(codesFor(base(), "column", "q2")).not.toContain("ALL_BLANK");
  });

  it("ZERO_VARIANCE fires when every candidate scored identically", () => {
    const input = base({
      rows: [
        { id: "s1", email: "a@x.io", cells: [1, 1] },
        { id: "s2", email: "b@x.io", cells: [0, 1] },
      ],
    });
    expect(codesFor(input, "column", "q2")).toContain("ZERO_VARIANCE");
  });

  it("ZERO_VARIANCE does not fire when responses differ", () => {
    expect(codesFor(base(), "column", "q1")).not.toContain("ZERO_VARIANCE");
  });

  it("NON_QUESTION_FIELD fires for a metadata column and not for a question", () => {
    const input = base({
      items: [
        { id: "q1", maxScore: 1, label: "Q1" },
        { id: "dur", maxScore: 1, label: "Duration", metadata: true },
      ],
    });
    expect(codesFor(input, "column", "dur")).toContain("NON_QUESTION_FIELD");
    expect(codesFor(input, "column", "q1")).not.toContain("NON_QUESTION_FIELD");
  });
});

describe("computeCleanFlags — row rules", () => {
  it("MISSING_ID fires for an empty email and an invalid shape", () => {
    const empty = base({ rows: [{ id: "s1", email: "", cells: [1, 1] }] });
    expect(codesFor(empty, "row", "s1")).toContain("MISSING_ID");
    const bad = base({ rows: [{ id: "s1", email: "not-an-email", cells: [1, 1] }] });
    expect(codesFor(bad, "row", "s1")).toContain("MISSING_ID");
  });

  it("MISSING_ID is skipped when the dataset carries no email field (undefined)", () => {
    const input = base({ rows: [{ id: "s1", cells: [1, 1] }] });
    expect(codesFor(input, "row", "s1")).not.toContain("MISSING_ID");
  });

  it("NO_RESPONSES fires for an all-blank row, not for a populated one", () => {
    const input = base({
      rows: [
        { id: "s1", email: "a@x.io", cells: [null, null] },
        { id: "s2", email: "b@x.io", cells: [1, 0] },
      ],
    });
    expect(codesFor(input, "row", "s1")).toContain("NO_RESPONSES");
    expect(codesFor(input, "row", "s2")).not.toContain("NO_RESPONSES");
  });

  it("DUPLICATE_SITTING flags every row sharing an email, without picking a winner", () => {
    const input = base({
      rows: [
        { id: "s1", email: "dup@x.io", cells: [1, 0] },
        { id: "s2", email: "dup@x.io", cells: [0, 1] },
        { id: "s3", email: "solo@x.io", cells: [1, 1] },
      ],
    });
    expect(codesFor(input, "row", "s1")).toContain("DUPLICATE_SITTING");
    expect(codesFor(input, "row", "s2")).toContain("DUPLICATE_SITTING");
    expect(codesFor(input, "row", "s3")).not.toContain("DUPLICATE_SITTING");
  });

  it("KNOWN_TEST_ACCOUNT fires only for a configured test email (case-insensitive)", () => {
    const input = base({
      rows: [
        { id: "s1", email: "Test@Test.com", cells: [1, 1] },
        { id: "s2", email: "real@school.edu", cells: [1, 0] },
      ],
      testAccountEmails: ["test@test.com"],
    });
    expect(codesFor(input, "row", "s1")).toContain("KNOWN_TEST_ACCOUNT");
    expect(codesFor(input, "row", "s2")).not.toContain("KNOWN_TEST_ACCOUNT");
  });

  it("PARTIAL_EMPTY fires below the threshold and not above it", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, maxScore: 1 }));
    const oneAnswered = [1, ...Array(19).fill(null)] as (number | null)[]; // 5% answered
    const manyAnswered = [...Array(10).fill(1), ...Array(10).fill(null)] as (number | null)[]; // 50%
    const input: CleanFlagInput = {
      items,
      rows: [
        { id: "s1", email: "a@x.io", cells: oneAnswered },
        { id: "s2", email: "b@x.io", cells: manyAnswered },
      ],
    };
    expect(codesFor(input, "row", "s1")).toContain("PARTIAL_EMPTY");
    expect(codesFor(input, "row", "s2")).not.toContain("PARTIAL_EMPTY");
  });

  it("PARTIAL_EMPTY does not double up with NO_RESPONSES on an all-blank row", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, maxScore: 1 }));
    const input: CleanFlagInput = {
      items,
      rows: [{ id: "s1", email: "a@x.io", cells: Array(20).fill(null) }],
    };
    const codes = codesFor(input, "row", "s1");
    expect(codes).toContain("NO_RESPONSES");
    expect(codes).not.toContain("PARTIAL_EMPTY");
  });

  it("SUSPECT_TIMESTAMP fires outside a configured window and not inside it", () => {
    const window = { startMs: 1000, endMs: 2000 };
    const input = base({
      rows: [
        { id: "s1", email: "a@x.io", cells: [1, 1], timestampMs: 5000 },
        { id: "s2", email: "b@x.io", cells: [1, 0], timestampMs: 1500 },
      ],
      examWindow: window,
    });
    expect(codesFor(input, "row", "s1")).toContain("SUSPECT_TIMESTAMP");
    expect(codesFor(input, "row", "s2")).not.toContain("SUSPECT_TIMESTAMP");
  });

  it("SUSPECT_TIMESTAMP is skipped when a row has no timestamp", () => {
    const input = base({
      rows: [{ id: "s1", email: "a@x.io", cells: [1, 1] }],
      examWindow: { startMs: 1000, endMs: 2000 },
    });
    expect(codesFor(input, "row", "s1")).not.toContain("SUSPECT_TIMESTAMP");
  });

  it("SUSPECT_TIMESTAMP flags a clear IQR outlier when no window is set", () => {
    const input: CleanFlagInput = {
      items: [{ id: "q1", maxScore: 1 }],
      rows: [
        { id: "s1", email: "a@x.io", cells: [1], timestampMs: 100 },
        { id: "s2", email: "b@x.io", cells: [1], timestampMs: 105 },
        { id: "s3", email: "c@x.io", cells: [1], timestampMs: 110 },
        { id: "s4", email: "d@x.io", cells: [1], timestampMs: 115 },
        { id: "s5", email: "e@x.io", cells: [1], timestampMs: 100000 },
      ],
    };
    expect(codesFor(input, "row", "s5")).toContain("SUSPECT_TIMESTAMP");
    expect(codesFor(input, "row", "s1")).not.toContain("SUSPECT_TIMESTAMP");
  });
});

describe("computeCleanFlags — determinism", () => {
  it("returns an identical result on repeated calls", () => {
    const input = base();
    expect(computeCleanFlags(input)).toEqual(computeCleanFlags(input));
  });
});
