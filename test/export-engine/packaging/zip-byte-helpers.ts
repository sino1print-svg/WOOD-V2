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

const TEXT_ENCODER = new TextEncoder();

/**
 * Builds one fixed-format local-file-header-plus-data block (matches the
 * `EXPECTED_*` constants `zip-verifier.ts` enforces: version needed 20,
 * general-purpose flag 0x0800, store compression, DOS date 0x0021/time
 * 0x0000, no extra field). Store method only, so compressed size ===
 * uncompressed size and `content` is written verbatim.
 */
export function buildLocalBlock(name: string, content: Uint8Array): Uint8Array {
  const nameBytes = TEXT_ENCODER.encode(name);
  const block = new Uint8Array(30 + nameBytes.length + content.length);
  writeU32(block, 0, 0x04034b50);
  writeU16(block, 4, 20);
  writeU16(block, 6, 0x0800);
  writeU16(block, 8, 0);
  writeU16(block, 10, 0x0000);
  writeU16(block, 12, 0x0021);
  writeU32(block, 14, crc32Of(content));
  writeU32(block, 18, content.length);
  writeU32(block, 22, content.length);
  writeU16(block, 26, nameBytes.length);
  writeU16(block, 28, 0);
  block.set(nameBytes, 30);
  block.set(content, 30 + nameBytes.length);
  return block;
}

export interface RawCentralRecord {
  readonly name: string;
  readonly crc: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

function buildCentralRecord(record: RawCentralRecord): Uint8Array {
  const nameBytes = TEXT_ENCODER.encode(record.name);
  const header = new Uint8Array(46 + nameBytes.length);
  writeU32(header, 0, 0x02014b50);
  writeU16(header, 4, 0x0014);
  writeU16(header, 6, 20);
  writeU16(header, 8, 0x0800);
  writeU16(header, 10, 0);
  writeU16(header, 12, 0x0000);
  writeU16(header, 14, 0x0021);
  writeU32(header, 16, record.crc);
  writeU32(header, 20, record.size);
  writeU32(header, 24, record.size);
  writeU16(header, 28, nameBytes.length);
  writeU16(header, 30, 0);
  writeU16(header, 32, 0);
  writeU16(header, 34, 0);
  writeU16(header, 36, 0);
  writeU32(header, 38, 0);
  writeU32(header, 42, record.localHeaderOffset);
  header.set(nameBytes, 46);
  return header;
}

/**
 * Assembles a complete ZIP archive from raw physical bytes (laid out
 * back-to-back starting at byte 0, in array order) and an independent list
 * of central-directory records that each freely declare their own
 * name/crc/size and may reference *any* byte offset into that physical
 * region - including an offset that reuses, overlaps, or physically
 * precedes another record's. `writeDeterministicZip` can never produce such
 * an archive (it always writes exactly one contiguous local block per
 * entry, in central order); this exists purely to construct structurally
 * hostile-but-per-entry-consistent archives for the verifier's canonical
 * local/central physical-order checks (Fourth Corrective C4).
 */
export function assembleRawZip(
  physicalBytes: readonly Uint8Array[],
  centralRecords: readonly RawCentralRecord[],
): Uint8Array {
  const localRegionLength = physicalBytes.reduce((sum, block) => sum + block.length, 0);
  const centralBlocks = centralRecords.map((record) => buildCentralRecord(record));
  const centralLength = centralBlocks.reduce((sum, block) => sum + block.length, 0);
  const bytes = new Uint8Array(localRegionLength + centralLength + 22);

  let cursor = 0;
  for (const block of physicalBytes) {
    bytes.set(block, cursor);
    cursor += block.length;
  }
  const centralDirectoryOffset = cursor;
  for (const block of centralBlocks) {
    bytes.set(block, cursor);
    cursor += block.length;
  }
  const eocdOffset = cursor;
  writeU32(bytes, eocdOffset, 0x06054b50);
  writeU16(bytes, eocdOffset + 4, 0);
  writeU16(bytes, eocdOffset + 6, 0);
  writeU16(bytes, eocdOffset + 8, centralRecords.length);
  writeU16(bytes, eocdOffset + 10, centralRecords.length);
  writeU32(bytes, eocdOffset + 12, centralLength);
  writeU32(bytes, eocdOffset + 16, centralDirectoryOffset);
  writeU16(bytes, eocdOffset + 20, 0);
  return bytes;
}

interface LocalBlockInfo {
  readonly centralOffset: number;
  readonly localHeaderOffset: number;
  readonly length: number;
}

function localBlockLength(bytes: Uint8Array, localHeaderOffset: number): number {
  const nameLength = readU16(bytes, localHeaderOffset + 26);
  const extraLength = readU16(bytes, localHeaderOffset + 28);
  const compressedSize = readU32(bytes, localHeaderOffset + 18);
  return 30 + nameLength + extraLength + compressedSize;
}

function collectLocalBlocks(bytes: Uint8Array): LocalBlockInfo[] {
  const blocks: LocalBlockInfo[] = [];
  forEachCentralHeaderOffset(bytes, (centralOffset) => {
    const localHeaderOffset = readU32(bytes, centralOffset + 42);
    blocks.push({
      centralOffset,
      localHeaderOffset,
      length: localBlockLength(bytes, localHeaderOffset),
    });
  });
  return blocks;
}

/**
 * Physically repacks a canonical archive's local-entry byte blocks into
 * `newOrder` (a permutation of indices into the blocks' *canonical*
 * central-directory order), then repairs every central record's
 * `localHeaderOffset` to point at its entry's new physical position -
 * leaving the central directory's own record order, and every entry's own
 * recorded fields (name/crc/size/flag/timestamp), completely untouched.
 * Reproduces an archive whose central directory is still in strict
 * canonical path order and whose entries are each individually
 * well-formed, but whose physical local-entry byte layout no longer
 * matches that canonical order (Fourth Corrective C4).
 */
export function reorderLocalBlocks(zipBytes: Uint8Array, newOrder: readonly number[]): Uint8Array {
  const blocks = collectLocalBlocks(zipBytes);
  if (newOrder.length !== blocks.length) {
    throw new Error('newOrder length must match the number of central-directory entries');
  }
  const firstLocalOffset = Math.min(...blocks.map((block) => block.localHeaderOffset));
  const regionLength = blocks.reduce((sum, block) => sum + block.length, 0);

  const combined = zipBytes.slice();
  const reorderedRegion = new Uint8Array(regionLength);
  const newOffsetByOriginalIndex = new Map<number, number>();
  let cursor = 0;
  for (const originalIndex of newOrder) {
    const block = blocks[originalIndex]!;
    reorderedRegion.set(
      zipBytes.subarray(block.localHeaderOffset, block.localHeaderOffset + block.length),
      cursor,
    );
    newOffsetByOriginalIndex.set(originalIndex, firstLocalOffset + cursor);
    cursor += block.length;
  }
  combined.set(reorderedRegion, firstLocalOffset);

  blocks.forEach((block, index) => {
    writeU32(combined, block.centralOffset + 42, newOffsetByOriginalIndex.get(index)!);
  });

  return combined;
}
