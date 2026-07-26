/**
 * Batch 10.4 First Corrective - required adversarial tests (spec section 2).
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput } from '../../../src/export/packaging';
import { packageExportWithHooksForTesting } from '../../../src/export/packaging/package';
import { sha256Bytes } from '../../../src/export/packaging/checksum';
import { writeDeterministicZip } from '../../../src/export/packaging/zip-writer';
import {
  verifyPackageZip,
  type ExpectedZipEntry,
} from '../../../src/export/packaging/zip-verifier';
import { makeEntry, type PackageEntry } from '../../../src/export/packaging/package-entry';
import { ExportFormat, ExportScope, ValidationSeverity } from '../../../src/shared/domain-model';
import { APP_CONFIG } from '../../../src/config/app-config';
import { CANONICAL_EXPORT_INPUT, CANONICAL_SESSION_ID } from '../fixtures';
import { createPackageFixture } from './fixtures';
import {
  crc32Of,
  findCentralHeaderOffset,
  findEocdOffset,
  localHeaderOffsetFor,
  readU16,
  readU32,
  writeU16,
  writeU32,
} from './zip-byte-helpers';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

interface EntryMutationResult {
  readonly zipBytes: Uint8Array;
  /** The mutated entry's own content bytes, post-mutation. */
  readonly mutatedBytes: Uint8Array;
}

function mutateEntryData(
  zipBytes: Uint8Array,
  filenameSuffix: string,
  mutate: (data: Uint8Array) => void,
): EntryMutationResult {
  const bytes = zipBytes.slice();
  const centralOffset = findCentralHeaderOffset(bytes, filenameSuffix);
  const localOffset = localHeaderOffsetFor(bytes, centralOffset);
  const localNameLength = readU16(bytes, localOffset + 26);
  const localExtraLength = readU16(bytes, localOffset + 28);
  const uncompressedSize = readU32(bytes, centralOffset + 24);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const data = bytes.subarray(dataStart, dataStart + uncompressedSize);
  mutate(data);
  const crc = crc32Of(bytes.slice(dataStart, dataStart + uncompressedSize));
  writeU32(bytes, localOffset + 14, crc);
  writeU32(bytes, centralOffset + 16, crc);
  return { zipBytes: bytes, mutatedBytes: data.slice() };
}

function ledgerFor(
  result: Extract<ReturnType<typeof packageExport>, { ok: true }>,
): ExpectedZipEntry[] {
  return result.entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    checksum: entry.checksum,
  }));
}

/**
 * Second Corrective C3: every internal-document mutation test must prove the
 * *semantic* verifier layer rejects the tamper independently of the outer
 * per-entry checksum ledger. Updating exactly the mutated entry's ledger
 * checksum to match its new bytes makes the outer ledger check pass, so any
 * remaining rejection can only come from `verifyChecksumsFile`/
 * `verifyManifestFile` reconciling the mutated document's own internal
 * claims against the real extracted content.
 */
function ledgerWithUpdatedChecksum(
  ledger: readonly ExpectedZipEntry[],
  pathSuffix: string,
  mutatedBytes: Uint8Array,
): ExpectedZipEntry[] {
  const newChecksum = sha256Bytes(mutatedBytes);
  const updated = ledger.map((entry) =>
    entry.path.endsWith(pathSuffix) ? { ...entry, checksum: newChecksum } : entry,
  );
  expect(updated.some((entry) => entry.path.endsWith(pathSuffix))).toBe(true);
  return updated;
}

/**
 * `checksums.sha256` checksums every real content entry, including
 * manifest.json itself. A manifest.json mutation test that only fixes the
 * outer ledger would still be rejected first by `verifyChecksumsFile`
 * (manifest.json's own checksums.sha256 line would stop matching), which
 * proves nothing about `verifyManifestFile`. This helper additionally
 * re-syncs the checksums.sha256 entry's manifest.json line and its own
 * ledger checksum, isolating the rejection to the manifest semantic layer.
 */
function mutateManifestAndRetargetLedger(
  result: Extract<ReturnType<typeof packageExport>, { ok: true }>,
  mutateManifest: (data: Uint8Array) => void,
): { zipBytes: Uint8Array; ledger: ExpectedZipEntry[] } {
  const manifestMutation = mutateEntryData(result.zipBytes, 'manifest.json', mutateManifest);
  const newManifestChecksum = sha256Bytes(manifestMutation.mutatedBytes);
  const manifestLinePattern = /^[a-f0-9]{64}( {2}manifest\.json)$/mu;
  const checksumsMutation = mutateEntryData(
    manifestMutation.zipBytes,
    'checksums.sha256',
    (data) => {
      const text = new TextDecoder().decode(data);
      expect(manifestLinePattern.test(text)).toBe(true);
      const patched = text.replace(manifestLinePattern, `${newManifestChecksum}$1`);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    },
  );
  let ledger = ledgerFor(result);
  ledger = ledgerWithUpdatedChecksum(ledger, 'manifest.json', manifestMutation.mutatedBytes);
  ledger = ledgerWithUpdatedChecksum(ledger, 'checksums.sha256', checksumsMutation.mutatedBytes);
  return { zipBytes: checksumsMutation.zipBytes, ledger };
}

/** Minimal hand-built two-content-file package, for direct checksums/manifest surgery. */
function buildMinimalPackage(checksumsText: string, manifestBytes: Uint8Array) {
  const promptA = makeEntry(
    'proj/session-01/prompts/A/001_x_A.txt',
    'prompt_a',
    ExportFormat.Txt,
    'text/plain;charset=utf-8',
    encode('Prompt A content.'),
  );
  const readme = makeEntry(
    'proj/README.md',
    'readme',
    'markdown',
    'text/markdown;charset=utf-8',
    encode('# Readme'),
  );
  const manifestEntry = makeEntry(
    'proj/manifest.json',
    'manifest',
    ExportFormat.Json,
    'application/json',
    manifestBytes,
  );
  const checksumsEntry = makeEntry(
    'proj/checksums.sha256',
    'checksums',
    ExportFormat.Txt,
    'text/plain;charset=utf-8',
    encode(checksumsText),
  );
  const entries: PackageEntry[] = [promptA, readme, manifestEntry, checksumsEntry].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const written = writeDeterministicZip(entries, 1000, 50_000_000);
  return { entries, written };
}

describe('First Corrective F1 - reject backup and Prompt Pack scopes', () => {
  const versions = createPackageFixture().versions;

  function packageForScope(scope: ExportPackageInput['planResult']) {
    return packageExport({
      planResult: scope,
      limits: APP_CONFIG.limits.export,
      versions,
      createdAt: '2026-07-26T10:00:00.000Z',
      exportId: 'export-corrective',
    });
  }

  it('rejects a full-project backup plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: { baseScope: ExportScope.All, scopeDetail: 'backup', backupType: 'full_project' },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects a session backup plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: {
        baseScope: ExportScope.All,
        scopeDetail: 'backup',
        backupType: 'session',
        sessionId: CANONICAL_SESSION_ID,
      },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects an all-project Prompt Pack plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: { baseScope: ExportScope.All, scopeDetail: 'prompt_pack' },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects a session Prompt Pack plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: {
        baseScope: ExportScope.Session,
        scopeDetail: 'prompt_pack',
        sessionId: CANONICAL_SESSION_ID,
      },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });
});

describe('First Corrective F3 - checksums.sha256 semantic verification', () => {
  it('detects a checksums.sha256 line changed while the CRC is recomputed for it', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Flip one hex character within the checksums.sha256 body text itself; the
    // CRC of the (mutated) checksums.sha256 entry is recomputed so the ZIP
    // structure alone looks valid - only semantic reconciliation catches this.
    const { zipBytes, mutatedBytes } = mutateEntryData(
      result.zipBytes,
      'checksums.sha256',
      (data) => {
        const text = new TextDecoder().decode(data);
        const index = text.search(/[a-f0-9]{64}/u);
        expect(index).toBeGreaterThanOrEqual(0);
        const flipped = data[index] === 0x61 ? 0x62 : 0x61; // 'a' <-> 'b'
        data[index] = flipped;
      },
    );
    // C3: update the ledger's own checksums.sha256 checksum to match the
    // mutated bytes, so the outer per-entry ledger check passes and the
    // rejection can only come from the semantic checksums.sha256 layer.
    const ledger = ledgerWithUpdatedChecksum(ledgerFor(result), 'checksums.sha256', mutatedBytes);
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('checksums_hash_mismatch');
  });

  it('detects a missing checksum line', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    // Deliberately omit the README.md line.
    const text = `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n`;
    void readmeChecksum;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });

  it('detects an extra (unexpected) checksum line', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    const bogusChecksum = sha256Bytes(encode('bogus'));
    const text =
      `${readmeChecksum}  README.md\n` +
      `${bogusChecksum}  nonexistent-file.txt\n` +
      `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n`;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });

  it('detects a duplicate checksum path', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    const text =
      `${readmeChecksum}  README.md\n` +
      `${readmeChecksum}  README.md\n` +
      `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n`;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });

  it('detects unsorted checksum paths', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    // 'session-01/...' sorts after 'README.md' byte-lexicographically; reverse it.
    const text =
      `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n` + `${readmeChecksum}  README.md\n`;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });
});

describe('First Corrective F3 - manifest.json semantic verification', () => {
  it('detects a manifest included-file path mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      // Target the `includedFiles[].path` field specifically (the `"path": `
      // prefix disambiguates it from the same string used as a bare object
      // key in the alphabetically-earlier `checksums`/`fileSizes` sections).
      const target = '"path": "session-01/prompts/A/001_tee-front_A.txt"';
      const replacement = '"path": "session-01/prompts/A/zzzzzzzzzzzzzzzzzzz"';
      expect(replacement.length).toBe(target.length);
      const patched = text.replace(target, replacement);
      expect(patched).not.toBe(text);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    // Renaming an includedFiles[].path leaves the OLD path as a now-orphaned
    // key in fileSizes/checksums (C2: an extra bookkeeping key is rejected on
    // its own, even before the renamed/bogus path is checked against real
    // content), and fileSizes is reconciled ahead of checksums.
    expect(verification.reason).toBe('manifest_filesizes_extra_path');
  });

  it('detects a manifest fileSizes mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      const match = /"README\.md":\s*(\d+)/u.exec(text);
      expect(match).not.toBeNull();
      const original = match![1]!;
      const replacement = String(Number(original) + 1).padStart(original.length, '0');
      expect(replacement.length).toBe(original.length);
      const patched = text.replace(`"README.md": ${original}`, `"README.md": ${replacement}`);
      expect(patched).not.toBe(text);
      data.set(new TextEncoder().encode(patched));
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_size_mismatch');
  });

  it('detects a manifest checksums mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      const index = text.indexOf('"checksums"');
      const hashIndex = text.slice(index).search(/[a-f0-9]{64}/u) + index;
      expect(hashIndex).toBeGreaterThan(index);
      const flipped = data[hashIndex] === 0x61 ? 0x62 : 0x61;
      data[hashIndex] = flipped;
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_checksum_mismatch');
  });

  it('detects a manifest kind mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      // Same character count as "readme" so the JSON payload length is unchanged.
      const patched = text.replace('"kind": "readme"', '"kind": "readmf"');
      expect(patched).not.toBe(text);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_kind_mismatch');
  });
});

const README_BYTES = encode('# Readme');
const PROMPT_A_BYTES = encode('Prompt A content.');
const README_PATH = 'README.md';
const PROMPT_A_PATH = 'session-01/prompts/A/001_x_A.txt';

interface MinimalManifestFields {
  readonly includedFiles: readonly { readonly path: string; readonly kind: string }[];
  readonly fileSizes: Readonly<Record<string, number>>;
  readonly checksums: Readonly<Record<string, string>>;
}

function omitPath<T>(record: Readonly<Record<string, T>>, path: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== path));
}

/** A schema-valid manifest DTO covering exactly `README.md` + the one prompt-A file. */
function baseManifestFields(): MinimalManifestFields {
  return {
    includedFiles: [
      { path: README_PATH, kind: 'readme' },
      { path: PROMPT_A_PATH, kind: 'prompt_a' },
    ],
    fileSizes: {
      [README_PATH]: README_BYTES.byteLength,
      [PROMPT_A_PATH]: PROMPT_A_BYTES.byteLength,
    },
    checksums: {
      [README_PATH]: sha256Bytes(README_BYTES),
      [PROMPT_A_PATH]: sha256Bytes(PROMPT_A_BYTES),
    },
  };
}

function fullManifestObject(fields: MinimalManifestFields): Record<string, unknown> {
  return {
    exportId: 'export-corrective',
    schemaVersion: 1,
    projectId: 'project-corrective',
    sessionIds: ['session-01'],
    exportScope: 'session',
    scopeDetail: 'session',
    exportFormats: ['zip'],
    createdAt: '2026-07-26T10:00:00.000Z',
    applicationVersion: '0.1.0',
    generatorVersion: '0.1.0',
    ruleSetVersions: {},
    promptModuleVersions: {},
    includedFiles: fields.includedFiles,
    fileSizes: fields.fileSizes,
    checksums: fields.checksums,
    warnings: [],
    sourceFingerprints: { sessionFingerprint: 'a'.repeat(64) },
  };
}

/**
 * Builds a minimal package whose `checksums.sha256` fully and correctly
 * reconciles (README.md, the prompt-A file, and manifest.json itself), so
 * that any rejection can only come from `verifyManifestFile` reconciling the
 * given (possibly defective) manifest fields - never the checksums layer.
 */
function buildManifestReconciliationCase(fields: MinimalManifestFields): {
  readonly zipBytes: Uint8Array;
  readonly expected: ExpectedZipEntry[];
} {
  const manifestBytes = encode(JSON.stringify(fullManifestObject(fields)));
  const manifestChecksum = sha256Bytes(manifestBytes);
  const lines = [
    { path: README_PATH, checksum: sha256Bytes(README_BYTES) },
    { path: 'manifest.json', checksum: manifestChecksum },
    { path: PROMPT_A_PATH, checksum: sha256Bytes(PROMPT_A_BYTES) },
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const checksumsText = lines.map((line) => `${line.checksum}  ${line.path}\n`).join('');
  const { entries, written } = buildMinimalPackage(checksumsText, manifestBytes);
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error('unreachable');
  const expected: ExpectedZipEntry[] = entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    checksum: entry.checksum,
  }));
  return { zipBytes: written.bytes, expected };
}

describe('Second Corrective C2 - manifest map exactness (extra/missing bookkeeping keys, unsafe paths)', () => {
  it('rejects an extra fileSizes key not present in includedFiles', () => {
    const fields = baseManifestFields();
    const { zipBytes, expected } = buildManifestReconciliationCase({
      ...fields,
      fileSizes: { ...fields.fileSizes, 'bogus-extra.txt': 5 },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_filesizes_extra_path');
  });

  it('rejects an extra checksums key not present in includedFiles', () => {
    const fields = baseManifestFields();
    const { zipBytes, expected } = buildManifestReconciliationCase({
      ...fields,
      checksums: { ...fields.checksums, 'bogus-extra.txt': 'a'.repeat(64) },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_checksums_extra_path');
  });

  it('rejects a missing fileSizes key for an included path', () => {
    const fields = baseManifestFields();
    const fileSizes = omitPath(fields.fileSizes, README_PATH);
    const { zipBytes, expected } = buildManifestReconciliationCase({ ...fields, fileSizes });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_size_mismatch');
  });

  it('rejects a missing checksums key for an included path', () => {
    const fields = baseManifestFields();
    const checksums = omitPath(fields.checksums, README_PATH);
    const { zipBytes, expected } = buildManifestReconciliationCase({ ...fields, checksums });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_checksum_mismatch');
  });

  it('rejects an included path absent from both fileSizes and checksums', () => {
    const fields = baseManifestFields();
    const fileSizes = omitPath(fields.fileSizes, README_PATH);
    const checksums = omitPath(fields.checksums, README_PATH);
    const { zipBytes, expected } = buildManifestReconciliationCase({
      ...fields,
      fileSizes,
      checksums,
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_size_mismatch');
  });

  it('rejects a real content path (README.md) absent from includedFiles/fileSizes/checksums entirely', () => {
    const fields = baseManifestFields();
    const { zipBytes, expected } = buildManifestReconciliationCase({
      includedFiles: fields.includedFiles.filter((file) => file.path !== README_PATH),
      fileSizes: Object.fromEntries(
        Object.entries(fields.fileSizes).filter(([path]) => path !== README_PATH),
      ),
      checksums: Object.fromEntries(
        Object.entries(fields.checksums).filter(([path]) => path !== README_PATH),
      ),
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_missing_path');
  });

  it('rejects an unsafe (backslash) bookkeeping path in includedFiles', () => {
    // `..`/leading-`/` are already rejected by the manifest JSON schema's own
    // `path` pattern (-> manifest_schema_invalid); a backslash passes that
    // pattern but is still unsafe as a ZIP-relative path, so it specifically
    // exercises the defense-in-depth `isSafeZipPath` check in the semantic
    // verifier itself.
    const fields = baseManifestFields();
    const unsafePath = 'evil\\backslash.txt';
    const { zipBytes, expected } = buildManifestReconciliationCase({
      includedFiles: [
        { path: unsafePath, kind: 'readme' },
        { path: PROMPT_A_PATH, kind: 'prompt_a' },
      ],
      fileSizes: {
        [unsafePath]: fields.fileSizes[README_PATH]!,
        [PROMPT_A_PATH]: fields.fileSizes[PROMPT_A_PATH]!,
      },
      checksums: {
        [unsafePath]: fields.checksums[README_PATH]!,
        [PROMPT_A_PATH]: fields.checksums[PROMPT_A_PATH]!,
      },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_unsafe_path');
  });

  it('rejects a manifest schema-invalid path-traversal bookkeeping path (schema layer)', () => {
    const fields = baseManifestFields();
    const traversalPath = '../../etc/evil.txt';
    const { zipBytes, expected } = buildManifestReconciliationCase({
      includedFiles: [
        { path: traversalPath, kind: 'readme' },
        { path: PROMPT_A_PATH, kind: 'prompt_a' },
      ],
      fileSizes: {
        [traversalPath]: fields.fileSizes[README_PATH]!,
        [PROMPT_A_PATH]: fields.fileSizes[PROMPT_A_PATH]!,
      },
      checksums: {
        [traversalPath]: fields.checksums[README_PATH]!,
        [PROMPT_A_PATH]: fields.checksums[PROMPT_A_PATH]!,
      },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_schema_invalid');
  });
});

describe('First Corrective F4 - local/central header reconciliation and fixed metadata', () => {
  it('detects local filename differing from central filename', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'checksums.sha256');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    const nameLength = readU16(bytes, localOffset + 26);
    const nameStart = localOffset + 30;
    // Flip the last character of the local filename only (same length).
    bytes[nameStart + nameLength - 1] = bytes[nameStart + nameLength - 1]! ^ 0x20;
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects local general-purpose flag differing from central flag', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    writeU16(bytes, localOffset + 6, 0x0000);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a non-fixed general-purpose flag shared by both headers', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    writeU16(bytes, localOffset + 6, 0x0000);
    writeU16(bytes, centralOffset + 8, 0x0000);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a non-zero central extra field length', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 30, 4);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a non-zero local extra field length', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    writeU16(bytes, localOffset + 28, 4);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a non-zero file comment length', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 32, 4);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects central-directory trailing bytes', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const original = result.zipBytes;
    const eocd = findEocdOffset(original);
    const junkSize = 4;
    const bytes = new Uint8Array(original.length + junkSize);
    bytes.set(original.slice(0, eocd), 0);
    bytes.set(new Uint8Array(junkSize).fill(0xaa), eocd);
    bytes.set(original.slice(eocd), eocd + junkSize);
    const newEocd = eocd + junkSize;
    const originalSize = readU32(original, eocd + 12);
    writeU32(bytes, newEocd + 12, originalSize + junkSize);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a symlink-shaped external attributes value', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    // Unix mode 0o120777 (symlink, S_IFLNK) in the upper 16 bits.
    writeU32(bytes, centralOffset + 38, (0o120777 << 16) >>> 0);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(false);
  });
});

describe('Second Corrective C4 - full 16-bit "version made by" platform lock', () => {
  it('rejects a 0x0314 Unix platform sharing the same low version byte', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0314);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_version_made_by');
  });

  it('rejects another non-zero platform high byte (0x0114) with the same low version byte', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0114);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_version_made_by');
  });

  it('rejects an altered low version byte (0x0013) on the canonical MS-DOS platform', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0013);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_version_made_by');
  });

  it('accepts the unchanged canonical 0x0014 value', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0014);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(true);
  });
});

describe('First Corrective F6 - omissions/warnings preserved on post-plan failure', () => {
  it('preserves plan.omissions when a packaging failure occurs after a partial plan', () => {
    const fixture = createPackageFixture({ omitOutputB: true });
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    expect(fixture.planResult.value.partial).toBe(true);
    expect(fixture.planResult.value.omissions.length).toBeGreaterThan(0);

    // Force a post-plan failure (manifest/checksums overflow) via a tiny byte budget.
    const tinyLimits = { ...fixture.limits, maxJsonBytes: 1 };
    const result = packageExport({ ...fixture, limits: tinyLimits });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.omissions).toEqual(fixture.planResult.value.omissions);
    expect(result.omissions.length).toBeGreaterThan(0);
  });

  it('preserves plan.omissions when ZIP writing itself fails after a partial plan', () => {
    const fixture = createPackageFixture({ omitOutputB: true });
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    // A tiny archive-size cap does not affect the earlier hostile-input bound
    // checks (those key off maxJsonDepth/maxZipEntries), so this fails inside
    // writeDeterministicZip itself, after a valid partial plan was prepared.
    const tinyLimits = { ...fixture.limits, maxArchiveBytes: 100 };
    const result = packageExport({ ...fixture, limits: tinyLimits });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.omissions).toEqual(fixture.planResult.value.omissions);
    expect(result.omissions.length).toBeGreaterThan(0);
  });
});

describe('Second Corrective C6 - the outer catch path preserves known warnings/omissions', () => {
  it('preserves warnings/omissions when an unexpected exception occurs after a valid plan is prepared', () => {
    const fixture = createPackageFixture({ omitOutputB: true });
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    expect(fixture.planResult.value.omissions.length).toBeGreaterThan(0);

    const injected = new Error('injected-post-plan-fault');
    const result = packageExportWithHooksForTesting(fixture, {
      afterPlanPrepared: () => {
        throw injected;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.some((failure) => failure.code === 'EXPORT_CORRUPT_001')).toBe(true);
    // The whole point of C6: these must be the REAL values from the plan
    // that was already known-good before the injected exception, not empty
    // arrays reset by a naive catch-all.
    expect(result.warnings).toEqual(
      fixture.planResult.value.issues.filter(
        (issue) => issue.severity === ValidationSeverity.Warning,
      ),
    );
    expect(result.omissions).toEqual(fixture.planResult.value.omissions);
    expect(result.omissions.length).toBeGreaterThan(0);
  });
});

describe('First Corrective F10 - semantic calendar validation', () => {
  it('rejects impossible calendar timestamps even when they match the text pattern', () => {
    const base = createPackageFixture();
    for (const invalid of [
      '2026-13-01T00:00:00.000Z',
      '2026-02-30T00:00:00.000Z',
      '2026-01-01T24:00:00.000Z',
      '2026-01-01T00:60:00.000Z',
      '2026-01-01T00:00:60.000Z',
      '2026-00-01T00:00:00.000Z',
      '2026-01-00T00:00:00.000Z',
    ]) {
      const result = packageExport({ ...base, createdAt: invalid });
      expect(result.ok).toBe(false);
    }
  });

  it('accepts valid edge-case calendar timestamps (leap day, year boundary)', () => {
    const base = createPackageFixture();
    for (const valid of ['2024-02-29T23:59:59.999Z', '2026-01-01T00:00:00.000Z']) {
      const result = packageExport({ ...base, createdAt: valid });
      expect(result.ok).toBe(true);
    }
  });
});
