/**
 * Low-level ZIP byte helpers for adversarial structural tests only (test-only
 * code, mirrors the fixed offsets the packaging writer/verifier already use).
 */
export function findEocdOffset(bytes: Uint8Array): number {
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 &&
      bytes[index + 3] === 0x06
    ) {
      return index;
    }
  }
  throw new Error('EOCD not found');
}

export function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

export function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** Byte offset of the central directory record whose filename ends with `suffix`. */
export function findCentralHeaderOffset(bytes: Uint8Array, suffix: string): number {
  const eocd = findEocdOffset(bytes);
  let cursor = readU32(bytes, eocd + 16);
  const total = readU16(bytes, eocd + 10);
  const decoder = new TextDecoder('utf-8');
  for (let index = 0; index < total; index += 1) {
    if (
      !(
        bytes[cursor] === 0x50 &&
        bytes[cursor + 1] === 0x4b &&
        bytes[cursor + 2] === 0x01 &&
        bytes[cursor + 3] === 0x02
      )
    ) {
      throw new Error(`bad central directory signature at ${cursor}`);
    }
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name.endsWith(suffix)) return cursor;
    cursor = cursor + 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`entry not found: ${suffix}`);
}

export function localHeaderOffsetFor(bytes: Uint8Array, centralOffset: number): number {
  return readU32(bytes, centralOffset + 42);
}

/** Visits every central-directory record's byte offset, in listed order. */
export function forEachCentralHeaderOffset(
  bytes: Uint8Array,
  visit: (centralOffset: number) => void,
): void {
  const eocd = findEocdOffset(bytes);
  let cursor = readU32(bytes, eocd + 16);
  const total = readU16(bytes, eocd + 10);
  for (let index = 0; index < total; index += 1) {
    visit(cursor);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    cursor = cursor + 46 + nameLength + extraLength + commentLength;
  }
}

/**
 * Splices `insertedBytes` into the archive at `position` (a byte offset in
 * `zipBytes`'s original coordinate system, at or before the original central
 * directory) and repairs every reference that must shift as a result: each
 * central-directory entry's local header offset (if it was at or after
 * `position`), and the central directory offset recorded in the EOCD. Used
 * to prove hidden/unaccounted bytes (a prefix, a gap between two entries, or
 * bytes just before the central directory) are rejected even though every
 * individual entry's own recorded fields remain internally consistent.
 */
export function insertBytesIntoLocalRegion(
  zipBytes: Uint8Array,
  position: number,
  insertedBytes: Uint8Array,
): Uint8Array {
  const before = zipBytes.slice(0, position);
  const after = zipBytes.slice(position);
  const combined = new Uint8Array(before.length + insertedBytes.length + after.length);
  combined.set(before, 0);
  combined.set(insertedBytes, before.length);
  combined.set(after, before.length + insertedBytes.length);

  const originalEocd = findEocdOffset(zipBytes);
  const originalCentralDirectoryOffset = readU32(zipBytes, originalEocd + 16);
  const newEocdOffset = originalEocd + insertedBytes.length;
  const newCentralDirectoryOffset = originalCentralDirectoryOffset + insertedBytes.length;
  writeU32(combined, newEocdOffset + 16, newCentralDirectoryOffset);

  forEachCentralHeaderOffset(combined, (centralOffset) => {
    const localOffset = readU32(combined, centralOffset + 42);
    if (localOffset >= position) {
      writeU32(combined, centralOffset + 42, localOffset + insertedBytes.length);
    }
  });

  return combined;
}

/** Recompute CRC-32 for `bytes` (same polynomial/algorithm as the production writer). */
export function crc32Of(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
