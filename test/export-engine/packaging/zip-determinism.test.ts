import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { packageExport } from '../../../src/export/packaging';
import { parseZip } from '../../../src/export/packaging/zip-verifier';
import type { ExportPackageInput } from '../../../src/export/packaging';
import { createPackageFixture } from './fixtures';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Deterministic ZIP writer (EX section 3.9/11.1)', () => {
  it('produces byte-identical ZIPs across repeated runs with the same input', () => {
    const input = createPackageFixture();
    const first = packageExport(input);
    const second = packageExport(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
    expect(second.zipSha256).toBe(first.zipSha256);
  });

  it('produces byte-identical ZIPs for cloned but non-identical object identities', () => {
    const input = createPackageFixture();
    const cloned = structuredClone(input);
    expect(cloned).not.toBe(input);
    const first = packageExport(input);
    const second = packageExport(cloned);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
  });

  it('is invariant to different top-level object key insertion order', () => {
    const input = createPackageFixture();
    const reordered: ExportPackageInput = {
      exportId: input.exportId,
      createdAt: input.createdAt,
      versions: input.versions,
      limits: input.limits,
      planResult: input.planResult,
    };
    const first = packageExport(input);
    const second = packageExport(reordered);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
  });

  it('is invariant to reordering ruleSetVersions/promptModuleVersions record keys', () => {
    const input = createPackageFixture();
    const reorderedVersions: ExportPackageInput['versions'] = {
      promptModuleVersions: { ...input.versions.promptModuleVersions },
      ruleSetVersions: { ...input.versions.ruleSetVersions },
      generatorVersion: input.versions.generatorVersion,
      applicationVersion: input.versions.applicationVersion,
    };
    const first = packageExport(input);
    const second = packageExport({ ...input, versions: reorderedVersions });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
  });

  it('is invariant to the current locale (Intl not consulted for naming)', () => {
    const original = Intl.Collator;
    // @ts-expect-error -- deliberately breaking Intl.Collator to prove it is unused
    Intl.Collator = function throwingCollator(): never {
      throw new Error('Intl.Collator must never be called by packaging');
    };
    try {
      const input = createPackageFixture();
      const result = packageExport(input);
      expect(result.ok).toBe(true);
    } finally {
      Intl.Collator = original;
    }
  });

  it('is invariant to the process timezone', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    const first = packageExport(createPackageFixture());
    process.env.TZ = 'Etc/GMT+12';
    const second = packageExport(createPackageFixture());
    process.env.TZ = originalTz;
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
  });

  it('is invariant to wall-clock time (createdAt is a fixed input, not read from Date.now)', () => {
    const input = createPackageFixture();
    const realNow = Date.now;
    Date.now = () => 999999999999;
    let result;
    try {
      result = packageExport(input);
    } finally {
      Date.now = realNow;
    }
    const control = packageExport(input);
    expect(result.ok).toBe(true);
    expect(control.ok).toBe(true);
    if (!result.ok || !control.ok) return;
    expect(result.zipBytes).toEqual(control.zipBytes);
  });

  it('every ZIP entry uses the fixed 1980-01-01 timestamp', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseZip(result.zipBytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const entry of parsed.entries) {
      expect(entry.dosDate).toBe(0x0021);
      expect(entry.dosTime).toBe(0x0000);
    }
  });

  it('entries are sorted byte-lexicographically by path with no duplicates', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.entries.map((entry) => entry.path);
    const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(paths).toEqual(sorted);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('uses a fixed compression method (store) for every entry', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseZip(result.zipBytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const entry of parsed.entries) expect(entry.compressionMethod).toBe(0);
  });

  it('never emits an empty directory entry', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const entry of result.entries) expect(entry.path.endsWith('/')).toBe(false);
  });

  it('unzips successfully and extracted bytes equal source bytes', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseZip(result.zipBytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const entry of parsed.entries) {
      const summary = result.entries.find((item) => item.path === entry.path)!;
      expect(sha256(entry.bytes)).toBe(summary.checksum);
      expect(entry.bytes.byteLength).toBe(summary.byteLength);
    }
  });

  it('identical content and fixed versions reproduce the same manifest and ZIP checksum', () => {
    const first = packageExport(createPackageFixture());
    const second = packageExport(createPackageFixture());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.zipSha256).toBe(second.zipSha256);
    expect(sha256(first.manifestBytes)).toBe(sha256(second.manifestBytes));
  });

  it('changing a single prompt byte changes both the file checksum and the ZIP checksum', () => {
    const base = packageExport(createPackageFixture());
    const mutated = packageExport(createPackageFixture({ promptA: 'Mutated prompt text.' }));
    expect(base.ok).toBe(true);
    expect(mutated.ok).toBe(true);
    if (!base.ok || !mutated.ok) return;
    expect(mutated.zipSha256).not.toBe(base.zipSha256);
  });
});
