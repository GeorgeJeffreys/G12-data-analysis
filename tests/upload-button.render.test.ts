/**
 * Upload button loading state. While the upload request is in flight the button
 * must be disabled (no double-submission) and marked aria-busy. It does NOT render
 * its own spinner/busy-label — that would duplicate the single loading indicator,
 * which lives in the adjacent UploadStatusLine (one spinner, one stage label). Once
 * it resets it shows the upload icon and the normal label again and is clickable.
 */
import { describe, it, expect } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadButton } from "@/components/import/UploadButton";

describe("upload button loading state", () => {
  it("idle: enabled, upload label, no spinner", async () => {
    const html = renderToStaticMarkup(e(UploadButton, { busy: false, label: "Upload exam export", variant: "pri" }));
    expect(html).toContain("Upload exam export");
    expect(html).not.toContain("hf-spinner");
    expect(html).not.toContain("disabled");
    expect(html).toContain('aria-busy="false"');
  });

  it("in-flight: disabled + aria-busy, keeps its label, no spinner (one indicator lives in the status line)", async () => {
    const html = renderToStaticMarkup(e(UploadButton, { busy: true, label: "Upload exam export", variant: "pri" }));
    expect(html).toContain("Upload exam export"); // plain trigger, label kept
    expect(html).not.toContain("hf-spinner"); // no duplicate spinner on the button
    expect(html).not.toContain("Ingesting"); // no bare busy label here
    expect(html).toContain("disabled"); // still blocks double-submit
    expect(html).toContain('aria-busy="true"');
  });
});
