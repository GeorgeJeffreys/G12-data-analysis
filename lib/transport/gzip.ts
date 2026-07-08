/**
 * Transport-only gzip helpers, built on the native `CompressionStream` /
 * `DecompressionStream` Web APIs — available in the browser and in both the
 * Node and Edge runtimes on Vercel — so this adds no dependency and pins no
 * runtime.
 *
 * Why this exists: the raw-export ingest POST body (the cleaned response
 * matrix + canonical model) grows with the cohort. Vercel caps request bodies
 * at 4.5 MB platform-wide (`FUNCTION_PAYLOAD_TOO_LARGE`, unraisable on any
 * plan), so a large-enough sitting returns 413 before the handler even runs.
 * JSON/CSV compresses ~10×, which keeps the payload comfortably under the
 * ceiling with large headroom for any future sitting.
 *
 * This is transport only. The bytes recovered on the server are byte-identical
 * to what the client sent, so everything downstream of decompression — parse,
 * detect, join, split, persist, validate — receives exactly the text it
 * receives today.
 */

/**
 * Custom marker header set by the client when the body is manually gzipped, and
 * read by the server to decide whether to decompress. Deliberately NOT the
 * standard `Content-Encoding` — a proxy may auto-decompress that and desync the
 * stream, so we mark and decompress ourselves. Both sides import these constants
 * so the marker can never drift between client and server.
 */
export const GZIP_MARKER_HEADER = "x-content-encoding";
export const GZIP_MARKER_VALUE = "gzip";

/** Compress a UTF-8 string to a gzip `Blob` (client side). */
export async function gzipText(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).blob();
}

/** Compress a `Blob`/`File` to a gzip `Blob` (client side). */
export async function gzipBlob(input: Blob): Promise<Blob> {
  const stream = input.stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).blob();
}

/** Decompress gzip bytes back to a UTF-8 string (Node or Edge runtime). */
export async function gunzipToText(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
