/**
 * Independent ZIP integrity verifier - EX section 3.10 (First Corrective F3/F4).
 *
 * Parses the produced archive bytes back from scratch (its own reader, not the
 * writer's bookkeeping): full local/central header reconciliation, single-disk
 * and no-ZIP64 structural enforcement, then semantic verification of
 * `checksums.sha256` and `manifest.json` *derived from the extracted bytes
 * themselves* - never solely from a caller-supplied expected ledger.
 */
import type { Sha256 } from '../../shared/domain-model';
import { validateExportManifestShape } from '../../shared/export-manifest-schema-validation';
import { crc32 } from './crc32';
import { sha256Bytes } from './checksum';
import { isSafeZipPath } from './path';
import { compareUtf8 } from '../runtime';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_FIXED_SIZE = 22;
const EXPECTED_VERSION_NEEDED = 20;
/** Full 16-bit "version made by" field: platform 0x00 (MS-DOS/FAT) + version 0x14 (2.0) = 0x0014. */
const EXPECTED_VERSION_MADE_BY = 0x0014;
const EXPECTED_GENERAL_PURPOSE_FLAG = 0x0800;
const EXPECTED_COMPRESSION_METHOD = 0;
const EXPECTED_DOS_TIME = 0x0000;
const EXPECTED_DOS_DATE = 0x0021;
const EXPECTED_EXTERNAL_ATTRIBUTES = 0;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;
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
  readonly externalAttributes: number;
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

function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Parse a ZIP archive from scratch. Never throws; fails closed on any
 * structural anomaly: multi-disk fields, ZIP64 sentinels/locator, a central
 * directory that does not end exactly at the EOCD (no trailing bytes),
 * local/central header disagreement, non-fixed flags/method/timestamp,
 * non-zero extra/comment fields, non-zero external attributes (incl. any
 * Unix symlink mode), directory entries, and CRC/size mismatches.
 */
export function parseZip(bytes: Uint8Array): ZipParseResult {
  try {
    const eocdOffset = findEndOfCentralDirectory(bytes);
    if (eocdOffset === null) return { ok: false, reason: 'missing_or_commented_eocd' };
    if (
      eocdOffset >= 20 &&
      readUint32(
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        eocdOffset - 20,
      ) === ZIP64_EOCD_LOCATOR_SIGNATURE
    ) {
      return { ok: false, reason: 'zip64_not_supported' };
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const diskNumber = readUint16(view, eocdOffset + 4);
    const centralDirectoryStartDisk = readUint16(view, eocdOffset + 6);
    const entriesOnThisDisk = readUint16(view, eocdOffset + 8);
    const totalEntries = readUint16(view, eocdOffset + 10);
    const centralDirectorySize = readUint32(view, eocdOffset + 12);
    const centralDirectoryOffset = readUint32(view, eocdOffset + 16);

    if (diskNumber !== 0 || centralDirectoryStartDisk !== 0) {
      return { ok: false, reason: 'multi_disk_not_supported' };
    }
    if (entriesOnThisDisk !== totalEntries) {
      return { ok: false, reason: 'inconsistent_entry_counts' };
    }
    if (
      totalEntries === ZIP64_SENTINEL_16 ||
      centralDirectorySize === ZIP64_SENTINEL_32 ||
      centralDirectoryOffset === ZIP64_SENTINEL_32
    ) {
      return { ok: false, reason: 'zip64_not_supported' };
    }
    if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
      return { ok: false, reason: 'central_directory_bounds_mismatch' };
    }

    const entries: ParsedZipEntry[] = [];
    // Third Corrective F3: track each entry's own local-file byte range so
    // the full local-entries region can be proven to be one exact,
    // contiguous, canonical sequence with no unaccounted bytes anywhere -
    // not merely that each entry's *own* referenced range is internally
    // consistent. Populated in central-directory order, checked afterward.
    const localRanges: { readonly localHeaderOffset: number; readonly dataEnd: number }[] = [];
    let cursor = centralDirectoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
      if (readUint32(view, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
        return { ok: false, reason: 'bad_central_directory_signature' };
      }
      // Second Corrective C4: compare the *complete* 16-bit "version made by"
      // field (platform high byte + version low byte). Masking with `& 0xff`
      // would silently accept any platform (e.g. 0x0314 Unix) as long as the
      // low version byte matched, which is exactly the writer's own choice
      // of platform we must lock, not merely its spec-version claim.
      const versionMadeBy = readUint16(view, cursor + 4);
      const versionNeeded = readUint16(view, cursor + 6);
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
      const diskNumberStart = readUint16(view, cursor + 34);
      const internalAttributes = readUint16(view, cursor + 36);
      const externalAttributes = readUint32(view, cursor + 38);
      const localHeaderOffset = readUint32(view, cursor + 42);

      if (extraLength !== 0) return { ok: false, reason: 'central_extra_field_present' };
      if (commentLength !== 0) return { ok: false, reason: 'central_file_comment_present' };
      if (diskNumberStart !== 0) return { ok: false, reason: 'multi_disk_not_supported' };
      if (internalAttributes !== 0) return { ok: false, reason: 'unexpected_internal_attributes' };
      if (versionMadeBy !== EXPECTED_VERSION_MADE_BY) {
        return { ok: false, reason: 'unexpected_version_made_by' };
      }
      if (versionNeeded !== EXPECTED_VERSION_NEEDED) {
        return { ok: false, reason: 'unexpected_version_needed' };
      }
      // Third Corrective F5: check the specific symlink-shaped case *before*
      // the generic non-zero-attributes rejection, so `symlink_entry_rejected`
      // is actually reachable (a symlink Unix mode is always non-zero, so the
      // generic check below would otherwise always fire first and silently
      // swallow this more precise diagnosis).
      if (((externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
        return { ok: false, reason: 'symlink_entry_rejected' };
      }
      if (externalAttributes !== EXPECTED_EXTERNAL_ATTRIBUTES) {
        return { ok: false, reason: 'unexpected_external_attributes' };
      }
      if (
        compressedSize === ZIP64_SENTINEL_32 ||
        uncompressedSize === ZIP64_SENTINEL_32 ||
        localHeaderOffset === ZIP64_SENTINEL_32
      ) {
        return { ok: false, reason: 'zip64_not_supported' };
      }

      const nameStart = cursor + 46;
      const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
      const path = decodeUtf8Strict(nameBytes);
      if (path === null) return { ok: false, reason: 'invalid_utf8_name' };
      if (path.length === 0) return { ok: false, reason: 'empty_entry_name' };
      if (path.endsWith('/')) return { ok: false, reason: 'directory_entry_rejected' };
      cursor = nameStart + nameLength + extraLength + commentLength;

      if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
        return { ok: false, reason: 'bad_local_header_signature' };
      }
      const localVersionNeeded = readUint16(view, localHeaderOffset + 4);
      const localFlag = readUint16(view, localHeaderOffset + 6);
      const localCompressionMethod = readUint16(view, localHeaderOffset + 8);
      const localDosTime = readUint16(view, localHeaderOffset + 10);
      const localDosDate = readUint16(view, localHeaderOffset + 12);
      const localCrc = readUint32(view, localHeaderOffset + 14);
      const localCompressedSize = readUint32(view, localHeaderOffset + 18);
      const localUncompressedSize = readUint32(view, localHeaderOffset + 22);
      const localNameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);

      if (localExtraLength !== 0) return { ok: false, reason: 'local_extra_field_present' };
      if (localVersionNeeded !== EXPECTED_VERSION_NEEDED) {
        return { ok: false, reason: 'unexpected_local_version_needed' };
      }

      const localNameStart = localHeaderOffset + 30;
      const localNameBytes = bytes.subarray(localNameStart, localNameStart + localNameLength);
      if (localNameLength !== nameLength || !bytesEqual(localNameBytes, nameBytes)) {
        return { ok: false, reason: 'local_central_filename_mismatch' };
      }
      if (localFlag !== generalPurposeFlag) {
        return { ok: false, reason: 'local_central_flag_mismatch' };
      }
      if (localCompressionMethod !== compressionMethod) {
        return { ok: false, reason: 'local_central_compression_mismatch' };
      }
      if (localDosTime !== dosTime || localDosDate !== dosDate) {
        return { ok: false, reason: 'local_central_timestamp_mismatch' };
      }
      if (localCrc !== crc) return { ok: false, reason: 'local_central_crc_mismatch' };
      if (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize) {
        return { ok: false, reason: 'local_central_size_mismatch' };
      }

      if (generalPurposeFlag !== EXPECTED_GENERAL_PURPOSE_FLAG) {
        return { ok: false, reason: 'unexpected_general_purpose_flag' };
      }
      if (compressionMethod !== EXPECTED_COMPRESSION_METHOD) {
        return { ok: false, reason: 'unsupported_compression_method' };
      }
      if (dosDate !== EXPECTED_DOS_DATE || dosTime !== EXPECTED_DOS_TIME) {
        return { ok: false, reason: 'fixed_timestamp_violation' };
      }
      if (compressedSize !== uncompressedSize) {
        return { ok: false, reason: 'store_size_mismatch' };
      }

      const dataStart = localNameStart + localNameLength;
      const dataEnd = dataStart + uncompressedSize;
      if (dataEnd > centralDirectoryOffset) return { ok: false, reason: 'entry_overruns_archive' };
      const data = bytes.slice(dataStart, dataEnd);
      const actualCrc = crc32(data);
      if (actualCrc !== crc) return { ok: false, reason: 'crc_mismatch' };
      localRanges.push({ localHeaderOffset, dataEnd });

      entries.push({
        path,
        bytes: data,
        crc32: actualCrc,
        compressionMethod,
        dosTime,
        dosDate,
        generalPurposeFlag,
        externalAttributes,
      });
    }
    if (cursor !== eocdOffset) {
      return { ok: false, reason: 'trailing_central_directory_bytes' };
    }

    // Third Corrective F3: the local-entries region (byte 0 through
    // centralDirectoryOffset) must be covered *exactly* by the entries'
    // own local byte ranges, laid out contiguously with no gaps, no
    // overlaps, and no bytes before the first header or after the last
    // entry's data - closing the "hidden bytes between entries or before
    // the central directory" gap that the per-entry-only checks above
    // cannot see on their own.
    const sortedRanges = [...localRanges].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
    const first = sortedRanges[0];
    if (first !== undefined && first.localHeaderOffset !== 0) {
      return { ok: false, reason: 'unexpected_archive_prefix' };
    }
    for (let index = 1; index < sortedRanges.length; index += 1) {
      const previous = sortedRanges[index - 1]!;
      const current = sortedRanges[index]!;
      if (current.localHeaderOffset === previous.localHeaderOffset) {
        return { ok: false, reason: 'local_offset_reused' };
      }
      if (current.localHeaderOffset < previous.dataEnd) {
        return { ok: false, reason: 'local_entry_overlap' };
      }
      if (current.localHeaderOffset > previous.dataEnd) {
        return { ok: false, reason: 'local_entry_gap' };
      }
    }
    const last = sortedRanges[sortedRanges.length - 1];
    if (last !== undefined && last.dataEnd !== centralDirectoryOffset) {
      return { ok: false, reason: 'bytes_before_central_directory' };
    }

    return { ok: true, entries };
  } catch {
    return { ok: false, reason: 'parse_exception' };
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export interface ExpectedZipEntry {
  readonly path: string;
  readonly kind: string;
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
  | 'image_signature_detected'
  | 'no_single_package_root'
  | 'manifest_not_found'
  | 'duplicate_manifest_entry'
  | 'checksums_file_not_found'
  | 'duplicate_checksums_entry'
  | 'checksums_utf8_decode_failed'
  | 'checksums_bom_present'
  | 'checksums_cr_present'
  | 'checksums_missing_trailing_lf'
  | 'checksums_malformed_line'
  | 'checksums_unsorted'
  | 'checksums_duplicate_path'
  | 'checksums_self_reference'
  | 'checksums_missing_path'
  | 'checksums_extra_path'
  | 'checksums_hash_mismatch'
  | 'manifest_utf8_decode_failed'
  | 'manifest_json_parse_failed'
  | 'manifest_schema_invalid'
  | 'manifest_self_reference'
  | 'manifest_missing_path'
  | 'manifest_extra_path'
  | 'manifest_size_mismatch'
  | 'manifest_checksum_mismatch'
  | 'manifest_kind_mismatch'
  | 'manifest_duplicate_path'
  | 'manifest_unsafe_path'
  | 'manifest_filesizes_extra_path'
  | 'manifest_checksums_extra_path';

export type ZipVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ZipVerificationFailureReason; readonly detail: string };

function hasImageSignature(bytes: Uint8Array): boolean {
  const matches = (signature: readonly number[]): boolean =>
    bytes.byteLength >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  return matches(PNG_SIGNATURE) || matches(JPEG_SIGNATURE);
}

const CHECKSUM_LINE_PATTERN = /^([a-f0-9]{64}) {2}(.+)$/u;

/** Independently parse and reconcile `checksums.sha256` against extracted bytes. */
function verifyChecksumsFile(
  checksumsEntry: ParsedZipEntry,
  contentEntries: readonly { readonly relativePath: string; readonly bytes: Uint8Array }[],
): ZipVerificationResult {
  const bytes = checksumsEntry.bytes;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: false, reason: 'checksums_bom_present', detail: checksumsEntry.path };
  }
  const text = decodeUtf8Strict(bytes);
  if (text === null) {
    return { ok: false, reason: 'checksums_utf8_decode_failed', detail: checksumsEntry.path };
  }
  if (text.includes('\r')) {
    return { ok: false, reason: 'checksums_cr_present', detail: checksumsEntry.path };
  }
  if (text.length > 0 && !text.endsWith('\n')) {
    return { ok: false, reason: 'checksums_missing_trailing_lf', detail: checksumsEntry.path };
  }
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = body.length === 0 ? [] : body.split('\n');

  const parsedLines: { readonly checksum: string; readonly path: string }[] = [];
  const seenPaths = new Set<string>();
  for (const line of lines) {
    const match = CHECKSUM_LINE_PATTERN.exec(line);
    if (!match) return { ok: false, reason: 'checksums_malformed_line', detail: line };
    const checksum = match[1]!;
    const path = match[2]!;
    if (path === 'checksums.sha256') {
      return { ok: false, reason: 'checksums_self_reference', detail: path };
    }
    if (seenPaths.has(path)) {
      return { ok: false, reason: 'checksums_duplicate_path', detail: path };
    }
    seenPaths.add(path);
    parsedLines.push({ checksum, path });
  }
  for (let index = 1; index < parsedLines.length; index += 1) {
    if (compareUtf8(parsedLines[index - 1]!.path, parsedLines[index]!.path) >= 0) {
      return { ok: false, reason: 'checksums_unsorted', detail: parsedLines[index]!.path };
    }
  }

  const contentByRelativePath = new Map(contentEntries.map((item) => [item.relativePath, item]));
  for (const { checksum, path } of parsedLines) {
    const content = contentByRelativePath.get(path);
    if (content === undefined) {
      return { ok: false, reason: 'checksums_extra_path', detail: path };
    }
    if (sha256Bytes(content.bytes) !== checksum) {
      return { ok: false, reason: 'checksums_hash_mismatch', detail: path };
    }
  }
  for (const content of contentEntries) {
    if (!seenPaths.has(content.relativePath)) {
      return { ok: false, reason: 'checksums_missing_path', detail: content.relativePath };
    }
  }
  return { ok: true };
}

interface ManifestJsonRecord {
  readonly includedFiles?: readonly { readonly path: unknown; readonly kind: unknown }[];
  readonly fileSizes?: Readonly<Record<string, unknown>>;
  readonly checksums?: Readonly<Record<string, unknown>>;
}

/** Independently parse, schema-validate, and reconcile `manifest.json`. */
function verifyManifestFile(
  manifestEntry: ParsedZipEntry,
  contentEntries: readonly {
    readonly relativePath: string;
    readonly bytes: Uint8Array;
    readonly kind: string;
  }[],
): ZipVerificationResult {
  const text = decodeUtf8Strict(manifestEntry.bytes);
  if (text === null) {
    return { ok: false, reason: 'manifest_utf8_decode_failed', detail: manifestEntry.path };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'manifest_json_parse_failed', detail: manifestEntry.path };
  }
  const schemaIssues = validateExportManifestShape(parsed);
  if (schemaIssues.length > 0) {
    return {
      ok: false,
      reason: 'manifest_schema_invalid',
      detail: schemaIssues.map((issue) => issue.jsonPointer).join(','),
    };
  }

  const manifest = parsed as ManifestJsonRecord;
  const includedFiles = manifest.includedFiles ?? [];
  const fileSizes = manifest.fileSizes ?? {};
  const checksums = manifest.checksums ?? {};

  const seenManifestPaths = new Set<string>();
  const kindByPath = new Map<string, string>();
  for (const file of includedFiles) {
    const path = file.path;
    if (typeof path !== 'string') return { ok: false, reason: 'manifest_missing_path', detail: '' };
    if (path === 'manifest.json' || path === 'checksums.sha256') {
      return { ok: false, reason: 'manifest_self_reference', detail: path };
    }
    if (!isSafeZipPath(path)) {
      return { ok: false, reason: 'manifest_unsafe_path', detail: path };
    }
    if (seenManifestPaths.has(path)) {
      return { ok: false, reason: 'manifest_duplicate_path', detail: path };
    }
    seenManifestPaths.add(path);
    kindByPath.set(path, typeof file.kind === 'string' ? file.kind : '');
  }

  // C2 (Second Corrective): `fileSizes`/`checksums` must carry exactly the
  // `includedFiles` path set - an extra bookkeeping key must be rejected even
  // when every included file itself checks out.
  for (const key of Object.keys(fileSizes)) {
    if (!seenManifestPaths.has(key)) {
      return { ok: false, reason: 'manifest_filesizes_extra_path', detail: key };
    }
  }
  for (const key of Object.keys(checksums)) {
    if (!seenManifestPaths.has(key)) {
      return { ok: false, reason: 'manifest_checksums_extra_path', detail: key };
    }
  }

  const contentByRelativePath = new Map(contentEntries.map((item) => [item.relativePath, item]));
  for (const path of seenManifestPaths) {
    const content = contentByRelativePath.get(path);
    if (content === undefined) {
      return { ok: false, reason: 'manifest_extra_path', detail: path };
    }
    const declaredSize = fileSizes[path];
    if (declaredSize !== content.bytes.byteLength) {
      return { ok: false, reason: 'manifest_size_mismatch', detail: path };
    }
    const declaredChecksum = checksums[path];
    if (declaredChecksum !== sha256Bytes(content.bytes)) {
      return { ok: false, reason: 'manifest_checksum_mismatch', detail: path };
    }
    if (kindByPath.get(path) !== content.kind) {
      return { ok: false, reason: 'manifest_kind_mismatch', detail: path };
    }
  }
  for (const content of contentEntries) {
    if (!seenManifestPaths.has(content.relativePath)) {
      return { ok: false, reason: 'manifest_missing_path', detail: content.relativePath };
    }
  }
  return { ok: true };
}

/**
 * Full round-trip verification: structure (single EOCD/disk, no ZIP64,
 * local/central header reconciliation), ordering, path safety, fixed ZIP
 * metadata, per-entry checksum equality against the caller-supplied ledger,
 * and independent semantic verification of `checksums.sha256` and
 * `manifest.json` derived from the extracted archive bytes.
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

  const expectedByPath = new Map(expected.map((item) => [item.path, item]));
  for (const entry of parsed.entries) {
    const expectedEntry = expectedByPath.get(entry.path);
    if (expectedEntry === undefined) {
      return { ok: false, reason: 'unexpected_entry', detail: entry.path };
    }
    const actualChecksum = sha256Bytes(entry.bytes);
    if (actualChecksum !== expectedEntry.checksum) {
      return { ok: false, reason: 'checksum_mismatch', detail: entry.path };
    }
  }
  for (const item of expected) {
    if (!seenPaths.has(item.path)) {
      return { ok: false, reason: 'missing_expected_entry', detail: item.path };
    }
  }

  // --- Independent semantic verification, derived from the archive itself ---
  const firstSlash = parsed.entries[0]?.path.indexOf('/') ?? -1;
  const packageRoot = firstSlash > 0 ? parsed.entries[0]!.path.slice(0, firstSlash) : null;
  if (
    packageRoot === null ||
    !parsed.entries.every((entry) => entry.path.startsWith(`${packageRoot}/`))
  ) {
    return { ok: false, reason: 'no_single_package_root', detail: String(packageRoot) };
  }
  const manifestPath = `${packageRoot}/manifest.json`;
  const checksumsPath = `${packageRoot}/checksums.sha256`;
  const manifestMatches = parsed.entries.filter((entry) => entry.path === manifestPath);
  if (manifestMatches.length === 0) {
    return { ok: false, reason: 'manifest_not_found', detail: manifestPath };
  }
  if (manifestMatches.length > 1) {
    return { ok: false, reason: 'duplicate_manifest_entry', detail: manifestPath };
  }
  const checksumsMatches = parsed.entries.filter((entry) => entry.path === checksumsPath);
  if (checksumsMatches.length === 0) {
    return { ok: false, reason: 'checksums_file_not_found', detail: checksumsPath };
  }
  if (checksumsMatches.length > 1) {
    return { ok: false, reason: 'duplicate_checksums_entry', detail: checksumsPath };
  }

  const rootPrefixLength = packageRoot.length + 1;
  const contentEntries = parsed.entries
    .filter((entry) => entry.path !== checksumsPath)
    .map((entry) => ({ relativePath: entry.path.slice(rootPrefixLength), bytes: entry.bytes }));

  const checksumsResult = verifyChecksumsFile(checksumsMatches[0]!, contentEntries);
  if (!checksumsResult.ok) return checksumsResult;

  const kindByExpectedPath = new Map(expected.map((item) => [item.path, item.kind]));
  const manifestContentEntries = parsed.entries
    .filter((entry) => entry.path !== manifestPath && entry.path !== checksumsPath)
    .map((entry) => ({
      relativePath: entry.path.slice(rootPrefixLength),
      bytes: entry.bytes,
      kind: kindByExpectedPath.get(entry.path) ?? '',
    }));
  const manifestResult = verifyManifestFile(manifestMatches[0]!, manifestContentEntries);
  if (!manifestResult.ok) return manifestResult;

  return { ok: true };
}
