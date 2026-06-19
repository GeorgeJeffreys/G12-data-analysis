/**
 * Two-step upload flow on the data-import screen.
 *
 * Task 1 — the status line names each explicit stage (idle → uploading →
 * ingesting → done / failed), reusing the spinner while work is happening and
 * resolving to a clear done/failed state.
 * Task 2 — Confirm is a distinct second step: disabled with a visible hint until
 * ingest + validation succeed, then the primary next action (a link).
 * Task 3 — after a failure the control is in a retryable state (no spinner; the
 * button re-enabled with a retry label).
 */
import { describe, it, expect } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadStatusLine, ConfirmStep } from "@/components/import/UploadFlow";
import { UploadButton } from "@/components/import/UploadButton";

describe("upload status line — staged progress", () => {
  it("idle: renders nothing (no premature status)", () => {
    const html = renderToStaticMarkup(e(UploadStatusLine, { stage: "idle" }));
    expect(html).toBe("");
  });

  it("uploading: spinner + 'Uploading' stage text, polite status role", () => {
    const html = renderToStaticMarkup(e(UploadStatusLine, { stage: "uploading" }));
    expect(html).toContain("Uploading");
    expect(html).toContain("hf-spinner"); // reuses the existing spinner
    expect(html).toContain('role="status"');
  });

  it("ingesting: names the split/detect work with a spinner", () => {
    const html = renderToStaticMarkup(e(UploadStatusLine, { stage: "ingesting" }));
    expect(html).toContain("Ingesting — detecting and splitting subjects…");
    expect(html).toContain("hf-spinner");
  });

  it("done: clear done state with the detected-subject count, no spinner", () => {
    const html = renderToStaticMarkup(e(UploadStatusLine, { stage: "done", subjectCount: 5 }));
    expect(html).toContain("Done");
    expect(html).toContain("5 subjects");
    expect(html).not.toContain("hf-spinner");
  });

  it("failed: shows the inline error and is no longer working (retryable)", () => {
    const html = renderToStaticMarkup(
      e(UploadStatusLine, { stage: "failed", error: "No rows found." }),
    );
    expect(html).toContain("No rows found.");
    expect(html).not.toContain("hf-spinner"); // resolved, not stuck spinning
  });
});

describe("confirm step — distinct second action", () => {
  it("disabled with a hint until ingest + validation succeed", () => {
    const html = renderToStaticMarkup(
      e(ConfirmStep, {
        subjectCount: 0,
        canContinue: false,
        hint: "Upload and ingest a file first.",
        href: "/cycles/c1/clean",
      }),
    );
    expect(html).toContain("Upload and ingest a file first.");
    expect(html).toContain('disabled=""'); // the button is truly disabled
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("href"); // no navigation while disabled
  });

  it("enabled once ingest succeeds: the primary next action linking onward", () => {
    const html = renderToStaticMarkup(
      e(ConfirmStep, {
        subjectCount: 5,
        canContinue: true,
        hint: "",
        href: "/cycles/c1/clean",
      }),
    );
    expect(html).toContain("Confirm 5 subjects &amp; continue");
    expect(html).toContain('href="/cycles/c1/clean"');
    expect(html).not.toContain('disabled=""'); // not disabled when ingest succeeded
    expect(html).not.toContain('aria-disabled="true"');
  });
});

describe("upload control — retryable after failure", () => {
  it("re-enables with a retry label (not busy)", () => {
    const html = renderToStaticMarkup(
      e(UploadButton, { busy: false, label: "Try again", variant: "pri" }),
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("hf-spinner");
  });
});
