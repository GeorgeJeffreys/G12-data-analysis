/**
 * Text-encoding repair for Questionmark exports.
 *
 * The Arabic content arrives as "mojibake": UTF-8 bytes that were decoded as
 * Windows-1252 (CP1252). To repair a string we re-encode each character back to
 * its CP1252 byte and decode the byte stream as UTF-8. ASCII and already-correct
 * text are left untouched; anything that does not cleanly round-trip is returned
 * unchanged so we never corrupt good data.
 */

// CP1252 code points for bytes 0x80–0x9F (the bytes that differ from Latin-1).
// Index i corresponds to byte 0x80 + i. 0x81/0x8D/0x8F/0x90/0x9D are unused.
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030,
  0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e,
  0x178,
];

const CP1252_REVERSE = new Map<number, number>();
CP1252_HIGH.forEach((codePoint, i) => CP1252_REVERSE.set(codePoint, 0x80 + i));

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Repair a single mojibake string, or return it unchanged if not repairable. */
export function repairText(value: string): string {
  // Fast path: pure ASCII can't be mojibake.
  let suspicious = false;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) {
      suspicious = true;
      break;
    }
  }
  if (!suspicious) return value;

  const bytes: number[] = [];
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0xff) {
      bytes.push(cp);
    } else {
      const b = CP1252_REVERSE.get(cp);
      if (b === undefined) return value; // not a CP1252 char → not our mojibake
      bytes.push(b);
    }
  }

  try {
    return utf8Decoder.decode(Uint8Array.from(bytes));
  } catch {
    return value; // bytes weren't valid UTF-8 → leave as-is
  }
}

/** Repair a value if it is a string; pass through everything else. */
export function repairValue(value: unknown): unknown {
  return typeof value === "string" ? repairText(value) : value;
}

/** True if the string still looks like Latin-1-decoded UTF-8 (e.g. "Ø§Ù„"). */
export function looksLikeMojibake(value: string): boolean {
  // The Arabic block U+0600–U+06FF encodes as 0xD8/0xD9 lead bytes, which show
  // up as Ø (U+00D8) / Ù (U+00D9) when mis-decoded. That pairing is the tell.
  return /[ØÙ][-¿‘-™Œ-ž]/.test(value);
}
