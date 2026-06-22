/**
 * Minimal, dependency-free CSV reader for the Questionmark 3-export ingest.
 *
 * The real QM exports are UTF-8 with a BOM, may use CRLF or LF line endings, and
 * carry quoted fields containing commas, embedded newlines and doubled quotes
 * (`""`) — notably the HTML-laden wording/answer columns. SheetJS coerces values
 * (e.g. big `ResultId`s to numbers, leading zeros lost), so we parse to plain
 * strings ourselves to keep every join key and score byte-faithful.
 */

export interface CsvTable {
  /** Header names in file order (BOM stripped, trimmed). */
  headers: string[];
  /** One record per data row, keyed by header. Missing cells are "". */
  rows: Record<string, string>[];
}

type CsvInput = string | ArrayBuffer | Uint8Array;

const utf8 = new TextDecoder("utf-8");

/** Decode bytes (or accept a string), strip a leading UTF-8 BOM. */
function toText(input: CsvInput): string {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    text = utf8.decode(bytes);
  }
  // Strip BOM (either the raw 0xFEFF char or a stray decoded one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/**
 * Parse CSV text into rows of strings. Handles quoted fields (with embedded
 * commas, CRLF/LF newlines and escaped `""`), and tolerates both line endings.
 */
export function parseCsv(input: CsvInput): CsvTable {
  const text = toText(input);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF or lone CR both terminate the record.
      if (text[i + 1] === "\n") i += 1;
      endRecord();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the trailing field/record if the file didn't end with a newline.
  if (field.length > 0 || record.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0]!.map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r]!;
    // Skip fully-blank trailing lines.
    if (cells.length === 1 && cells[0] === "") continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]!] = cells[c] ?? "";
    rows.push(row);
  }
  return { headers, rows };
}
