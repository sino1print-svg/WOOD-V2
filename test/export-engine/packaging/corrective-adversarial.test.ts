/**
 * Batch 10.4 First Corrective - required adversarial tests (spec section 2).
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput } from '../../../src/export/packaging';
import { sha256Bytes } from '../../../src/export/packaging/checksum';
import { writeDeterministicZip } from '../../../src/export/packaging/zip-writer';
import {
  verifyPackageZip,
  type ExpectedZipEntry,
} from '../../../src/export/packaging/zip-verifier';
import { makeEntry, type PackageEntry } from '../../../src/export/packaging/package-entry';
import { ExportFormat, ExportScope } from '../../../src/shared/domain-model';
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

function mutateEntryData(
  zipBytes: Uint8Array,
  filenameSuffix: string,
  mutate: (data: Uint8Array) => void,
): Uint8Array {
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
  return bytes;
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
    const mutated = mutateEntryData(result.zipBytes, 'checksums.sha256', (data) => {
      const text = new TextDecoder().decode(data);
      const index = text.search(/[a-f0-9]{64}/u);
      expect(index).toBeGreaterThanOrEqual(0);
      const flipped = data[index] === 0x61 ? 0x62 : 0x61; // 'a' <-> 'b'
      data[index] = flipped;
    });
    expect(verifyPackageZip(mutated, ledgerFor(result)).ok).toBe(false);
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
    const mutated = mutateEntryData(result.zipBytes, 'manifest.json', (data) => {
      const text = new TextDecoder().decode(data);
      const target = '"session-01/prompts/A/001_tee-front_A.txt"';
      const replacement = '"session-01/prompts/A/zzzzzzzzzzzzzzzzzzz"';
      expect(replacement.length).toBe(target.length);
      const patched = text.replace(target, replacement);
      expect(patched).not.toBe(text);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    });
    expect(verifyPackageZip(mutated, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a manifest fileSizes mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mutated = mutateEntryData(result.zipBytes, 'manifest.json', (data) => {
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
    expect(verifyPackageZip(mutated, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a manifest checksums mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mutated = mutateEntryData(result.zipBytes, 'manifest.json', (data) => {
      const text = new TextDecoder().decode(data);
      const index = text.indexOf('"checksums"');
      const hashIndex = text.slice(index).search(/[a-f0-9]{64}/u) + index;
      expect(hashIndex).toBeGreaterThan(index);
      const flipped = data[hashIndex] === 0x61 ? 0x62 : 0x61;
      data[hashIndex] = flipped;
    });
    expect(verifyPackageZip(mutated, ledgerFor(result)).ok).toBe(false);
  });

  it('detects a manifest kind mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mutated = mutateEntryData(result.zipBytes, 'manifest.json', (data) => {
      const text = new TextDecoder().decode(data);
      // Same character count as "readme" so the JSON payload length is unchanged.
      const patched = text.replace('"kind": "readme"', '"kind": "readmf"');
      expect(patched).not.toBe(text);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    });
    expect(verifyPackageZip(mutated, ledgerFor(result)).ok).toBe(false);
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
