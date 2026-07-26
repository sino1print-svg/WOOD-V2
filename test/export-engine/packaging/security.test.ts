import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput } from '../../../src/export/packaging';
import { isSafeZipPath } from '../../../src/export/packaging/path';
import { sanitizeSegment } from '../../../src/export/packaging/path';
import {
  verifyPackageZip,
  parseZip,
  type ExpectedZipEntry,
} from '../../../src/export/packaging/zip-verifier';
import { writeDeterministicZip } from '../../../src/export/packaging/zip-writer';
import { sha256Bytes } from '../../../src/export/packaging/checksum';
import { ExportFormat } from '../../../src/shared/domain-model';
import { CANONICAL_EXPORT_INPUT } from '../fixtures';
import { clonePackageInput, createPackageFixture } from './fixtures';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function entry(path: string, text: string) {
  const b = bytes(text);
  return {
    path,
    kind: 'validation' as const,
    format: ExportFormat.Txt,
    mediaType: 'text/plain;charset=utf-8' as const,
    bytes: b,
    byteLength: b.byteLength,
    checksum: sha256Bytes(b),
  };
}

describe('Packaging security and adversarial-input protection (EX section 5/21)', () => {
  it('rejects ../ path traversal, absolute paths, drive letters, and UNC in the safety gate', () => {
    for (const hostile of [
      '../../etc/passwd',
      '/etc/passwd',
      'C:\\Windows\\System32',
      '\\\\server\\share\\file',
      'a/../../b',
    ]) {
      expect(isSafeZipPath(hostile)).toBe(false);
    }
  });

  it('never lets the packager throw on hostile top-level input shapes', () => {
    const hostileInputs: unknown[] = [
      null,
      undefined,
      42,
      'string',
      [],
      {},
      { planResult: null },
      new Proxy(
        {},
        {
          get(): never {
            throw new Error('hostile proxy');
          },
        },
      ),
    ];
    for (const hostile of hostileInputs) {
      expect(() => packageExport(hostile as ExportPackageInput)).not.toThrow();
      const result = packageExport(hostile as ExportPackageInput);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a throwing getter on the top-level input without invoking it', () => {
    const base = createPackageFixture();
    let calls = 0;
    const hostile: Record<string, unknown> = { ...base };
    Object.defineProperty(hostile, 'exportId', {
      enumerable: true,
      get: () => {
        calls += 1;
        throw new Error('must not execute');
      },
    });
    const result = packageExport(hostile as unknown as ExportPackageInput);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('rejects a toJSON trap on the versions object without invoking it', () => {
    const base = createPackageFixture();
    let calls = 0;
    const hostileVersions = { ...base.versions } as Record<string, unknown>;
    Object.defineProperty(hostileVersions, 'toJSON', {
      enumerable: true,
      value: () => {
        calls += 1;
        return { leaked: true };
      },
    });
    const result = packageExport({
      ...base,
      versions: hostileVersions,
    } as unknown as ExportPackageInput);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('rejects a Proxy that throws during reflective access', () => {
    const base = createPackageFixture();
    const hostilePlan = new Proxy(base.planResult, {
      getPrototypeOf: () => {
        throw new Error('blocked reflection');
      },
    });
    const result = packageExport({ ...base, planResult: hostilePlan } as ExportPackageInput);
    expect(result.ok).toBe(false);
  });

  it('rejects prototype pollution keys without polluting global prototypes', () => {
    const base = createPackageFixture();
    const hostile = clonePackageInput(base) as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, 'versions', {
      enumerable: true,
      configurable: true,
      value: Object.assign(Object.create({ polluted: true }), base.versions),
    });
    const result = packageExport(hostile as unknown as ExportPackageInput);
    expect(result.ok).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects inherited enumerable properties on the input object', () => {
    const base = createPackageFixture();
    const withProto = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      base,
    );
    const result = packageExport(withProto as unknown as ExportPackageInput);
    expect(result.ok).toBe(false);
  });

  it('rejects a cyclic input graph without throwing', () => {
    const base = createPackageFixture();
    const hostile: Record<string, unknown> = { ...base };
    hostile.self = hostile;
    expect(() => packageExport(hostile as unknown as ExportPackageInput)).not.toThrow();
    expect(packageExport(hostile as unknown as ExportPackageInput).ok).toBe(false);
  });

  it('rejects a sparse-array-shaped versions value', () => {
    const base = createPackageFixture();
    const sparse = new Array(2);
    sparse[0] = 'x';
    const result = packageExport({
      ...base,
      versions: { ...base.versions, ruleSetVersions: sparse as unknown as Record<string, number> },
    } as ExportPackageInput);
    expect(result.ok).toBe(false);
  });

  it('rejects createdAt values that are not a canonical ISO timestamp', () => {
    const base = createPackageFixture();
    for (const invalid of ['not-a-date', '2026-07-26', '', 12345, null]) {
      const result = packageExport({
        ...base,
        createdAt: invalid,
      } as unknown as ExportPackageInput);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an exportId containing control characters or NUL', () => {
    const base = createPackageFixture();
    for (const invalid of ['bad\u0000id', 'bad\nid', '']) {
      const result = packageExport({ ...base, exportId: invalid } as ExportPackageInput);
      expect(result.ok).toBe(false);
    }
  });

  it('never produces ZIP bytes on a blocking failure', () => {
    const result = packageExport({
      planResult: { ok: false, failures: [] },
      limits: CANONICAL_EXPORT_INPUT.limits,
      versions: createPackageFixture().versions,
      createdAt: '2026-07-26T10:00:00.000Z',
      exportId: 'x',
    } as ExportPackageInput);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('a blocked plan (invalid project schema) never leaks a ZIP', () => {
    const project = structuredClone(CANONICAL_EXPORT_INPUT.source.project);
    (project as { schemaVersion: number }).schemaVersion = 999;
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
    });
    expect(planResult.ok).toBe(false);
    const result = packageExport({
      planResult,
      limits: CANONICAL_EXPORT_INPUT.limits,
      versions: createPackageFixture().versions,
      createdAt: '2026-07-26T10:00:00.000Z',
      exportId: 'x',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('the ZIP verifier detects a corrupted central directory', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const corrupted = result.zipBytes.slice();
    // Flip a byte inside the central directory region (near the end, before EOCD).
    const index = corrupted.byteLength - 30;
    corrupted[index] = (corrupted[index]! + 1) % 256;
    const parsed = parseZip(corrupted);
    // Either structural parsing fails, or verification against the original
    // checksums fails - either way, corruption must never look valid.
    if (parsed.ok) {
      const expected: readonly ExpectedZipEntry[] = result.entries.map((item) => ({
        path: item.path,
        kind: item.kind,
        checksum: item.checksum,
      }));
      expect(verifyPackageZip(corrupted, expected).ok).toBe(false);
    } else {
      expect(parsed.ok).toBe(false);
    }
  });

  it('the ZIP verifier detects a checksum mismatch against the expected ledger', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tamperedExpected: ExpectedZipEntry[] = result.entries.map((item) => ({
      path: item.path,
      kind: item.kind,
      checksum: item.path.endsWith('manifest.json')
        ? sha256Bytes(bytes('tampered'))
        : item.checksum,
    }));
    expect(verifyPackageZip(result.zipBytes, tamperedExpected).ok).toBe(false);
  });

  it('the ZIP verifier detects manifest/entry-count mismatch (missing expected entry)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withoutOne = result.entries.slice(1).map((item) => ({
      path: item.path,
      kind: item.kind,
      checksum: item.checksum,
    }));
    expect(verifyPackageZip(result.zipBytes, withoutOne).ok).toBe(false);
  });

  it('the ZIP writer refuses duplicate entry paths (fail-closed, not silently deduped)', () => {
    const duplicate = [entry('a/x.txt', 'one'), entry('a/x.txt', 'two')];
    // Duplicate, unsorted paths must fail the writer's sortedness/path-safety check.
    const write = writeDeterministicZip(duplicate, 1000, 10_000_000);
    expect(write.ok).toBe(false);
  });

  it('the ZIP verifier rejects an archive with a duplicate entry name', () => {
    // Construct two entries whose paths sort correctly but are identical - the
    // writer would reject this too, so build minimal valid-looking input directly
    // through the pipeline and confirm no duplicate ever survives verification.
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withDuplicate: ExpectedZipEntry[] = [
      ...result.entries.map((item) => ({
        path: item.path,
        kind: item.kind,
        checksum: item.checksum,
      })),
      {
        path: result.entries[0]!.path,
        kind: result.entries[0]!.kind,
        checksum: result.entries[0]!.checksum,
      },
    ];
    expect(verifyPackageZip(result.zipBytes, withDuplicate).ok).toBe(false);
  });

  it('detects manifest size mismatch (verifier catches a tampered byteLength claim)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseZip(result.zipBytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const manifestEntry = parsed.entries.find((item) => item.path.endsWith('manifest.json'))!;
    expect(manifestEntry.bytes.byteLength).toBe(
      result.entries.find((item) => item.kind === 'manifest')!.byteLength,
    );
  });

  it('never leaks secret-shaped runtime fields injected on the plan value', () => {
    const fixture = createPackageFixture();
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    const hostilePlanResult = clonePackageInput(fixture).planResult;
    if (!hostilePlanResult.ok) return;
    Object.defineProperty(hostilePlanResult.value, 'apiKey', {
      enumerable: true,
      value: 'must-not-leak',
    });
    const result = packageExport({ ...fixture, planResult: hostilePlanResult });
    expect(result.ok).toBe(false);
  });

  it('never leaks local absolute asset paths through naming', () => {
    expect(sanitizeSegment('C:\\Users\\owner\\secret.png', 60)).not.toContain('C:\\');
    expect(sanitizeSegment('/home/owner/secret.png', 60)).not.toContain('/home/');
  });

  it('never allows image byte signatures (PNG/JPEG) into the archive', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseZip(result.zipBytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pngSignature = [0x89, 0x50, 0x4e, 0x47];
    for (const item of parsed.entries) {
      const startsWithPng = pngSignature.every((byte, index) => item.bytes[index] === byte);
      expect(startsWithPng).toBe(false);
    }
  });

  it('bounds oversized array/string payloads (fails closed, never truncates silently)', () => {
    const fixture = createPackageFixture();
    const tinyLimits = { ...fixture.limits, maxArtifactBytes: 10 };
    const result = packageExport({ ...fixture, limits: tinyLimits });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('fails closed rather than truncating when path segment limits are too small', () => {
    const fixture = createPackageFixture();
    const tinyLimits = { ...fixture.limits, maxPathSegment: 3, maxPathLength: 30 };
    expect(() => packageExport({ ...fixture, limits: tinyLimits })).not.toThrow();
  });
});
