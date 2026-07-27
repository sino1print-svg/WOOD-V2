/**
 * Consolidated Final Corrective §21 - committed, reproducible external ZIP
 * verification support. This test's only job is to build every real golden
 * ZIP fixture (and one deliberately physically-reordered-but-Info-ZIP-
 * tolerated hostile archive) from the *current* code and write them, plus
 * their content ledgers, to a caller-supplied directory - `scripts/verify-
 * golden-zips-external.mjs` invokes this test with `GOLDEN_ZIP_DUMP_DIR`
 * set, then performs the actual external `unzip`-based verification itself
 * (a plain Node script, not the pure packaging core, may shell out).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGoldenZipCases } from './golden-fixtures';
import { packageExport } from '../../../src/export/packaging';
import { verifyPackageZip } from '../../../src/export/packaging/zip-verifier';
import { createPackageFixture } from './fixtures';
import { reorderLocalBlocks } from './zip-byte-helpers';

it('dumps every golden ZIP fixture, its ledger, and a reordered-hostile archive with its internal verification reason', () => {
  const outDir = process.env.GOLDEN_ZIP_DUMP_DIR;
  if (!outDir) {
    const cases = createGoldenZipCases();
    expect(cases).toHaveLength(10);
    for (const golden of cases) {
      const result = packageExport(golden.input);
      expect(result.ok, golden.name).toBe(true);
      if (!result.ok) continue;
      const verification = verifyPackageZip(
        result.zipBytes,
        result.entries.map((entry) => ({
          path: entry.path,
          kind: entry.kind,
          checksum: entry.checksum,
        })),
      );
      expect(verification, golden.name).toEqual({ ok: true });
    }
    return;
  }
  mkdirSync(outDir, { recursive: true });

  const ledger: Record<string, { path: string; kind: string; checksum: string }[]> = {};
  for (const golden of createGoldenZipCases()) {
    const result = packageExport(golden.input);
    if (!result.ok) throw new Error(`golden case ${golden.name} failed to package`);
    writeFileSync(`${outDir}/${golden.name}.zip`, result.zipBytes);
    ledger[golden.name] = result.entries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      checksum: entry.checksum,
    }));
  }
  writeFileSync(`${outDir}/ledger.json`, JSON.stringify(ledger, null, 2));

  const base = packageExport(createPackageFixture());
  if (!base.ok) throw new Error('base fixture failed to package');
  const entryCount = base.entries.length;
  const reversedOrder = Array.from({ length: entryCount }, (_, index) => entryCount - 1 - index);
  const reordered = reorderLocalBlocks(base.zipBytes, reversedOrder);
  writeFileSync(`${outDir}/reordered-hostile.zip`, reordered);
  const baseLedger = base.entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    checksum: entry.checksum,
  }));
  const verification = verifyPackageZip(reordered, baseLedger);
  writeFileSync(
    `${outDir}/reordered-hostile-verification.json`,
    JSON.stringify(
      verification.ok
        ? { ok: true }
        : { ok: false, reason: verification.reason, detail: verification.detail },
    ),
  );
});
