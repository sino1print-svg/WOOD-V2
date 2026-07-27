/**
 * Deterministic ZIP archive writer - EX section 11/11.1.
 *
 * Fixed method (store, no compression - avoids any Node/zlib version-dependent
 * compressed-byte variance), fixed 1980-01-01 timestamps, fixed attributes, no
 * comments, no extra fields, byte-lexicographic entry order (the caller's sorted
 * order is trusted and re-verified here). No filesystem access, no wall-clock
 * read, no randomness.
 */
import { crc32 } from './crc32';
import { encodeUtf8 } from '../utf8';
import { compareUtf8 } from '../runtime';
import { isSafeZipPath } from './path';
import type { PackageEntry } from './package-entry';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
const GENERAL_PURPOSE_FLAG_UTF8 = 0x0800;
const COMPRESSION_METHOD_STORE = 0;
const DOS_TIME_FIXED = 0x0000;
const DOS_DATE_1980_01_01 = 0x0021;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;

class BinaryWriter {
  #chunks: Uint8Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  bytes(value: Uint8Array): this {
    this.#chunks.push(value);
    this.#length += value.byteLength;
    return this;
  }

  uint16(value: number): this {
    const buffer = new Uint8Array(2);
    new DataView(buffer.buffer).setUint16(0, value, true);
    return this.bytes(buffer);
  }

  uint32(value: number): this {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setUint32(0, value, true);
    return this.bytes(buffer);
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.#length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

export interface ZipWriteResult {
  readonly ok: true;
  readonly bytes: Uint8Array;
}

export interface ZipWriteFailure {
  readonly ok: false;
  readonly reason:
    | 'invalid_entries'
    | 'invalid_entry'
    | 'invalid_limits'
    | 'too_many_entries'
    | 'entry_too_large'
    | 'archive_too_large'
    | 'unsafe_path'
    | 'duplicate_path'
    | 'unordered_entries';
}

const PACKAGE_ENTRY_KEYS = [
  'path',
  'kind',
  'format',
  'mediaType',
  'bytes',
  'byteLength',
  'checksum',
] as const;
const SHA256 = /^[0-9a-f]{64}$/u;

function ownDataValue(
  descriptors: PropertyDescriptorMap,
  key: (typeof PACKAGE_ENTRY_KEYS)[number],
): unknown {
  const descriptor = descriptors[key];
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Inspect hostile runtime input without invoking entry accessors, then take a
 * trusted snapshot.  The writer never touches the untrusted objects again.
 */
function snapshotEntries(
  value: unknown,
): { readonly ok: true; readonly entries: readonly PackageEntry[] } | ZipWriteFailure {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return { ok: false, reason: 'invalid_entries' };
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return { ok: false, reason: 'invalid_entries' };
  }

  const entries: PackageEntry[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const arrayDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!arrayDescriptor || !('value' in arrayDescriptor)) {
      return { ok: false, reason: 'invalid_entries' };
    }
    const entry = arrayDescriptor.value;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      return { ok: false, reason: 'invalid_entry' };
    }
    const keys = Reflect.ownKeys(entry);
    if (
      keys.length !== PACKAGE_ENTRY_KEYS.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !PACKAGE_ENTRY_KEYS.includes(key as (typeof PACKAGE_ENTRY_KEYS)[number]),
      )
    ) {
      return { ok: false, reason: 'invalid_entry' };
    }
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (
      PACKAGE_ENTRY_KEYS.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor || !('value' in descriptor);
      })
    ) {
      return { ok: false, reason: 'invalid_entry' };
    }

    const path = ownDataValue(descriptors, 'path');
    const kind = ownDataValue(descriptors, 'kind');
    const format = ownDataValue(descriptors, 'format');
    const mediaType = ownDataValue(descriptors, 'mediaType');
    const bytes = ownDataValue(descriptors, 'bytes');
    const byteLength = ownDataValue(descriptors, 'byteLength');
    const checksum = ownDataValue(descriptors, 'checksum');
    if (
      typeof path !== 'string' ||
      typeof kind !== 'string' ||
      typeof format !== 'string' ||
      typeof mediaType !== 'string' ||
      !(bytes instanceof Uint8Array) ||
      Object.getPrototypeOf(bytes) !== Uint8Array.prototype ||
      !Number.isSafeInteger(byteLength) ||
      byteLength !== bytes.byteLength ||
      typeof checksum !== 'string' ||
      !SHA256.test(checksum)
    ) {
      return { ok: false, reason: 'invalid_entry' };
    }
    entries.push({
      path,
      kind: kind as PackageEntry['kind'],
      format: format as PackageEntry['format'],
      mediaType: mediaType as PackageEntry['mediaType'],
      bytes: bytes.slice(),
      byteLength,
      checksum: checksum as PackageEntry['checksum'],
    });
  }
  return { ok: true, entries };
}

/**
 * Third Corrective F4: `writeDeterministicZip` is exported through the
 * packaging public surface and must fail closed on its own, independent of
 * whatever upstream path-safety checks the caller already ran - it must
 * never be possible to reach a written ZIP containing an unsafe path (e.g.
 * `../evil.txt`) merely by calling this function directly.
 */
function findUnsafePath(entries: readonly PackageEntry[]): string | null {
  for (const entry of entries) {
    if (!isSafeZipPath(entry.path)) return entry.path;
  }
  return null;
}

/** Ordering/duplicate check kept distinct from path-safety (F4): a caller passing unsorted or duplicate-path *safe* paths gets a different, more precise reason than an unsafe path would. */
function findOrderingFailure(
  entries: readonly PackageEntry[],
): 'duplicate_path' | 'unordered_entries' | null {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!.path;
    const current = entries[index]!.path;
    const comparison = compareUtf8(previous, current);
    if (comparison === 0) return 'duplicate_path';
    if (comparison > 0) return 'unordered_entries';
  }
  return null;
}

/**
 * Build a deterministic ZIP archive from already sorted, already path-safe
 * entries. The caller is responsible for path safety and byte-lexicographic
 * ordering; this function re-verifies both and fails closed rather than
 * silently reordering or truncating.
 */
export function writeDeterministicZip(
  entries: readonly PackageEntry[],
  maxZipEntries: number,
  maxArchiveBytes: number,
): ZipWriteResult | ZipWriteFailure {
  try {
    if (
      !Number.isSafeInteger(maxZipEntries) ||
      maxZipEntries <= 0 ||
      !Number.isSafeInteger(maxArchiveBytes) ||
      maxArchiveBytes <= 0
    ) {
      return { ok: false, reason: 'invalid_limits' };
    }
    const snapshot = snapshotEntries(entries);
    if (!snapshot.ok) return snapshot;
    return writeValidatedEntries(snapshot.entries, maxZipEntries, maxArchiveBytes);
  } catch {
    return { ok: false, reason: 'invalid_entries' };
  }
}

function writeValidatedEntries(
  entries: readonly PackageEntry[],
  maxZipEntries: number,
  maxArchiveBytes: number,
): ZipWriteResult | ZipWriteFailure {
  if (entries.length > maxZipEntries || entries.length > MAX_UINT16) {
    return { ok: false, reason: 'too_many_entries' };
  }
  if (findUnsafePath(entries) !== null) return { ok: false, reason: 'unsafe_path' };
  const orderingFailure = findOrderingFailure(entries);
  if (orderingFailure !== null) return { ok: false, reason: orderingFailure };

  const writer = new BinaryWriter();
  const centralDirectoryEntries: {
    readonly nameBytes: Uint8Array;
    readonly offset: number;
    readonly crc: number;
    readonly size: number;
  }[] = [];

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.path);
    if (nameBytes.byteLength > MAX_UINT16 || entry.bytes.byteLength > MAX_UINT32) {
      return { ok: false, reason: 'entry_too_large' };
    }
    const offset = writer.length;
    if (offset > MAX_UINT32) return { ok: false, reason: 'archive_too_large' };
    const crc = crc32(entry.bytes);
    writer
      .uint32(LOCAL_FILE_HEADER_SIGNATURE)
      .uint16(VERSION_NEEDED)
      .uint16(GENERAL_PURPOSE_FLAG_UTF8)
      .uint16(COMPRESSION_METHOD_STORE)
      .uint16(DOS_TIME_FIXED)
      .uint16(DOS_DATE_1980_01_01)
      .uint32(crc)
      .uint32(entry.bytes.byteLength)
      .uint32(entry.bytes.byteLength)
      .uint16(nameBytes.byteLength)
      .uint16(0)
      .bytes(nameBytes)
      .bytes(entry.bytes);
    centralDirectoryEntries.push({ nameBytes, offset, crc, size: entry.bytes.byteLength });
  }

  const centralDirectoryStart = writer.length;
  for (const record of centralDirectoryEntries) {
    writer
      .uint32(CENTRAL_DIRECTORY_SIGNATURE)
      .uint16(VERSION_MADE_BY)
      .uint16(VERSION_NEEDED)
      .uint16(GENERAL_PURPOSE_FLAG_UTF8)
      .uint16(COMPRESSION_METHOD_STORE)
      .uint16(DOS_TIME_FIXED)
      .uint16(DOS_DATE_1980_01_01)
      .uint32(record.crc)
      .uint32(record.size)
      .uint32(record.size)
      .uint16(record.nameBytes.byteLength)
      .uint16(0)
      .uint16(0)
      .uint16(0)
      .uint16(0)
      .uint32(0)
      .uint32(record.offset)
      .bytes(record.nameBytes);
  }
  const centralDirectorySize = writer.length - centralDirectoryStart;

  if (centralDirectorySize > MAX_UINT32 || centralDirectoryStart > MAX_UINT32) {
    return { ok: false, reason: 'archive_too_large' };
  }

  writer
    .uint32(END_OF_CENTRAL_DIRECTORY_SIGNATURE)
    .uint16(0)
    .uint16(0)
    .uint16(centralDirectoryEntries.length)
    .uint16(centralDirectoryEntries.length)
    .uint32(centralDirectorySize)
    .uint32(centralDirectoryStart)
    .uint16(0);

  if (writer.length > maxArchiveBytes) return { ok: false, reason: 'archive_too_large' };
  return { ok: true, bytes: writer.finish() };
}
