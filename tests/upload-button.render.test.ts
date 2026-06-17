/**
 * Upload button loading state. While the upload request is in flight the button
 * must be disabled (no double-submission), show a spinner in place of the upload
 * icon, and read "Uploading…"; once it resets it shows the upload icon and the
 * normal label again and is clickable.
 */
import { describe, it, expect } from "vitest";
import { createElement as e } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadButton } from "@/components/import/UploadButton";

describe("upload button loading state", () => {
  it("idle: enabled, upload label, no spinner", async () => {
    const html = renderToStaticMarkup(e(UploadButton, { busy: false, label: "Upload exam export", variant: "pri" }));
    expect(html).toContain("Upload exam export");
    expect(html).not.toContain("Uploading…");
    expect(html).not.toContain("hf-spinner");
    expect(html).not.toContain("disabled");
    expect(html).toContain('aria-busy="false"');
  });

  it("in-flight: disabled + spinner + 'Uploading…' (prevents double-submit)", async () => {
    const html = renderToStaticMarkup(e(UploadButton, { busy: true, label: "Upload exam export", variant: "pri" }));
    expect(html).toContain("Uploading…");
    expect(html).toContain("hf-spinner"); // spinner shown in place of the upload icon
    expect(html).toContain('role="status"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Upload exam export"); // label swapped out while busy
  });
});
