/**
 * Consolidated Final Corrective §21 - committed, reproducible external ZIP
 * verification support. This test's only job is to build every real golden
 * ZIP fixture (and one deliberately physically-reordered-but-Info-ZIP-
 * tolerated hostile archive) from the *current* code and write them, plus
 * their content ledgers, to a directory - `scripts/verify-golden-zips-
 * external.mjs` invokes this test with `GOLDEN_ZIP_DUMP_DIR` set, then
 * performs the actual external `unzip`-based verification itself (a plain
 * Node script, not the pure packaging core, may shell out).
 *
 * Deficiency Closure §13: the frozen gate requires zero skipped tests, and
 * "by design" is not an acceptable excuse - `it.skipIf` (or any `.skip`
 * variant) is never used here. When `GOLDEN_ZIP_DUMP_DIR` is unset (every
 * ordinary `npm run test`/`verify`/`verify:full` run), this test still
 * performs the complete dump - to a throwaway directory it creates and
 * removes itself - and asserts real things about the result, so it is a
 * genuine passing regression test in every run, not a no-op.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGoldenZipCases } from './golden-fixtures';
import { packageExport } from '../../../src/export/packaging';
import { verifyPackageZip } from '../../../src/export/packaging/zip-verifier';
import { createPackageFixture } from './fixtures';
import { reorderLocalBlocks } from './zip-byte-helpers';

describe('Consolidated Final Corrective §21 / Deficiency Closure §13 - golden ZIP dump driver', () => {
  it('dumps every golden ZIP fixture, its ledger, and a reordered-hostile archive with its internal verification reason', () => {
    const externalDir = process.env.GOLDEN_ZIP_DUMP_DIR;
    const outDir = externalDir ?? mkdtempSync(path.join(tmpdir(), 'golden-zip-dump-'));
    mkdirSync(outDir, { recursive: true });

    try {
      const goldenCases = createGoldenZipCases();
      const ledger: Record<string, { path: string; kind: string; checksum: string }[]> = {};
      for (const golden of goldenCases) {
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
      const reversedOrder = Array.from(
        { length: entryCount },
        (_, index) => entryCount - 1 - index,
      );
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

      // Real assertions, not a no-op: every promised output file genuinely exists.
      expect(goldenCases.length).toBeGreaterThan(0);
      for (const golden of goldenCases) {
        expect(existsSync(`${outDir}/${golden.name}.zip`)).toBe(true);
      }
      expect(existsSync(`${outDir}/ledger.json`)).toBe(true);
      expect(existsSync(`${outDir}/reordered-hostile.zip`)).toBe(true);
      expect(existsSync(`${outDir}/reordered-hostile-verification.json`)).toBe(true);
      expect(verification.ok).toBe(false);
      if (verification.ok) return;
      expect(verification.reason).toBe('structural');
      expect(verification.detail).toBe('local_order_mismatch');
    } finally {
      if (externalDir === undefined) {
        rmSync(outDir, { recursive: true, force: true });
      }
    }
  });
});
