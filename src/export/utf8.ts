/**
 * UTF-8 primitives for Export documents — EX §4, §8–§10, §14.
 *
 * Text is encoded exactly as supplied. No BOM, line-ending conversion, trimming,
 * or Unicode normalization is performed here.
 */
const UTF8_ENCODER = new TextEncoder();

/** Encode exactly one string as UTF-8 without a BOM. */
export function encodeUtf8(text: string): Uint8Array {
  return UTF8_ENCODER.encode(text);
}

/**
 * Count the bytes TextEncoder will emit without allocating an intermediate
 * byte array. Unpaired UTF-16 surrogates follow TextEncoder replacement rules.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}
