/**
 * Independent ZIP integrity verifier - EX section 3.10.
 *
 * Parses the produced archive bytes back from scratch (its own reader, not the
 * writer's bookkeeping) and checks entry count, uniqueness, ordering, path
 * safety, per-entry CRC-32, and per-entry SHA-256 against the expected ledger
 * before packaging is allowed to report success.
 */
import type { Sha256 } from '../../shared/domain-model';
import { crc32 } from './crc32';
import { sha256Bytes } from './checksum';
import { isSafeZipPath } from './path';
import { compareUtf8 } from '../runtime';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const EOCD_FIXED_SIZE = 22;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

export interface ParsedZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly compressionMethod: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly generalPurposeFlag: number;
}

export type ZipParseResult =
  | { readonly ok: true; readonly entries: readonly ParsedZipEntry[] }
  | { readonly ok: false; readonly reason: string };

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number | null {
  if (bytes.byteLength < EOCD_FIXED_SIZE) return null;
  const candidate = bytes.byteLength - EOCD_FIXED_SIZE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readUint32(view, candidate) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) return null;
  const commentLength = readUint16(view, candidate + 20);
  return commentLength === 0 ? candidate : null;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/** Parse a ZIP archive from scratch. Never throws; fails closed on any anomaly. */
export function parseZip(bytes: Uint8Array): ZipParseResult {
  try {
    const eocdOffset = findEndOfCentralDirectory(bytes);
    if (eocdOffset === null) return { ok: false, reason: 'missing_or_commented_eocd' };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const totalEntries = readUint16(view, eocdOffset + 10);
    const centralDirectorySize = readUint32(view, eocdOffset + 12);
    const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
    if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
      return { ok: false, reason: 'central_directory_bounds_mismatch' };
    }

    const entries: ParsedZipEntry[] = [];
    let cursor = centralDirectoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
      if (readUint32(view, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
        return { ok: false, reason: 'bad_central_directory_signature' };
      }
      const generalPurposeFlag = readUint16(view, cursor + 8);
      const compressionMethod = readUint16(view, cursor + 10);
      const dosTime = readUint16(view, cursor + 12);
      const dosDate = readUint16(view, cursor + 14);
      const crc = readUint32(view, cursor + 16);
      const compressedSize = readUint32(view, cursor + 20);
      const uncompressedSize = readUint32(view, cursor + 24);
      const nameLength = readUint16(view, cursor + 28);
      const extraLength = readUint16(view, cursor + 30);
      const commentLength = readUint16(view, cursor + 32);
      const localHeaderOffset = readUint32(view, cursor + 42);
      const nameStart = cursor + 46;
      const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
      let path: string;
      try {
        path = UTF8_DECODER.decode(nameBytes);
      } catch {
        return { ok: false, reason: 'invalid_utf8_name' };
      }
      cursor = nameStart + nameLength + extraLength + commentLength;

      if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
        return { ok: false, reason: 'bad_local_header_signature' };
      }
      const localNameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      if (compressionMethod !== 0) return { ok: false, reason: 'unsupported_compression_method' };
      if (compressedSize !== uncompressedSize) {
        return { ok: false, reason: 'store_size_mismatch' };
      }
      const dataEnd = dataStart + uncompressedSize;
      if (dataEnd > centralDirectoryOffset) return { ok: false, reason: 'entry_overruns_archive' };
      const data = bytes.slice(dataStart, dataEnd);
      const actualCrc = crc32(data);
      if (actualCrc !== crc) return { ok: false, reason: 'crc_mismatch' };

      entries.push({
        path,
        bytes: data,
        crc32: actualCrc,
        compressionMethod,
        dosTime,
        dosDate,
        generalPurposeFlag,
      });
    }
    return { ok: true, entries };
  } catch {
    return { ok: false, reason: 'parse_exception' };
  }
}

export interface ExpectedZipEntry {
  readonly path: string;
  readonly checksum: Sha256;
}

export type ZipVerificationFailureReason =
  | 'structural'
  | 'entry_count_mismatch'
  | 'duplicate_entry'
  | 'unordered_entries'
  | 'unsafe_path'
  | 'fixed_timestamp_violation'
  | 'fixed_metadata_violation'
  | 'missing_expected_entry'
  | 'unexpected_entry'
  | 'checksum_mismatch'
  | 'image_signature_detected';

export type ZipVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ZipVerificationFailureReason; readonly detail: string };

function hasImageSignature(bytes: Uint8Array): boolean {
  const matches = (signature: readonly number[]): boolean =>
    bytes.byteLength >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  return matches(PNG_SIGNATURE) || matches(JPEG_SIGNATURE);
}

/**
 * Full round-trip verification: structure, ordering, path safety, fixed ZIP
 * metadata, and per-entry checksum equality against the expected ledger.
 */
export function verifyPackageZip(
  bytes: Uint8Array,
  expected: readonly ExpectedZipEntry[],
): ZipVerificationResult {
  const parsed = parseZip(bytes);
  if (!parsed.ok) return { ok: false, reason: 'structural', detail: parsed.reason };

  if (parsed.entries.length !== expected.length) {
    return { ok: false, reason: 'entry_count_mismatch', detail: String(parsed.entries.length) };
  }

  const seenPaths = new Set<string>();
  for (let index = 0; index < parsed.entries.length; index += 1) {
    const entry = parsed.entries[index]!;
    if (seenPaths.has(entry.path)) {
      return { ok: false, reason: 'duplicate_entry', detail: entry.path };
    }
    seenPaths.add(entry.path);
    if (!isSafeZipPath(entry.path)) {
      return { ok: false, reason: 'unsafe_path', detail: entry.path };
    }
    if (index > 0) {
      const previous = parsed.entries[index - 1]!.path;
      if (compareUtf8(previous, entry.path) >= 0) {
        return { ok: false, reason: 'unordered_entries', detail: `${previous} >= ${entry.path}` };
      }
    }
    if (entry.dosDate !== 0x0021 || entry.dosTime !== 0x0000) {
      return { ok: false, reason: 'fixed_timestamp_violation', detail: entry.path };
    }
    if (entry.compressionMethod !== 0) {
      return { ok: false, reason: 'fixed_metadata_violation', detail: entry.path };
    }
    if (hasImageSignature(entry.bytes)) {
      return { ok: false, reason: 'image_signature_detected', detail: entry.path };
    }
  }

  const expectedByPath = new Map(expected.map((item) => [item.path, item.checksum]));
  for (const entry of parsed.entries) {
    const expectedChecksum = expectedByPath.get(entry.path);
    if (expectedChecksum === undefined) {
      return { ok: false, reason: 'unexpected_entry', detail: entry.path };
    }
    const actualChecksum = sha256Bytes(entry.bytes);
    if (actualChecksum !== expectedChecksum) {
      return { ok: false, reason: 'checksum_mismatch', detail: entry.path };
    }
  }
  for (const item of expected) {
    if (!seenPaths.has(item.path)) {
      return { ok: false, reason: 'missing_expected_entry', detail: item.path };
    }
  }

  return { ok: true };
}
