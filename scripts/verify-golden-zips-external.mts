/**
 * Phase 10 Batch 10.4 controlled merge - committed external ZIP verifier.
 *
 * It generates ten locked golden archives from current source, verifies each
 * with the system unzip implementation, exercises two independently
 * repackaged bookkeeping-tamper archives whose outer ledgers are repaired,
 * and checks the reordered hostile archive. Exactly 13 rows are reported.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverPackageRoot,
  isUnsafeArchivePath,
  listRegularFiles,
  sha256,
  verifyOnDiskBookkeeping,
} from './zip-external-verification.mts';
import { compareUtf8 } from '../src/export/runtime';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface LedgerEntry {
  readonly path: string;
  readonly kind: string;
  readonly checksum: string;
}

interface VerificationRow {
  readonly pass: boolean;
  readonly line: string;
}

interface FixtureInspection {
  readonly problems: readonly string[];
  readonly entryCount: number;
}

function ensureExternalToolsAvailable(): void {
  for (const command of ['unzip', 'zip']) {
    try {
      execFileSync(command, ['-v'], { stdio: 'pipe' });
    } catch {
      console.error(
        `BLOCKED: the system \`${command}\` binary is unavailable; external ZIP verification cannot run.`,
      );
      process.exit(1);
    }
  }
}

/** Parses `unzip -l` output into the listed entry paths. */
function parseUnzipListing(listingText: string): string[] {
  const lines = listingText.split('\n');
  return lines
    .slice(3, -3)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/u).slice(3).join(' '));
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((candidate, index) => candidate === right[index])
  );
}

/**
 * Performs every external and extracted-byte check. For hostile fixtures the
 * caller inspects the returned problem list for the one required semantic
 * rejection; normal fixtures require an empty list.
 */
function inspectFixture(
  name: string,
  zipPath: string,
  entries: readonly LedgerEntry[],
  dumpDir: string,
): FixtureInspection {
  const problems: string[] = [];

  try {
    execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
  } catch {
    problems.push('unzip -t reported errors');
  }

  let listedPaths: string[] = [];
  try {
    const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
    listedPaths = parseUnzipListing(listing);
  } catch {
    problems.push('unzip -l failed to run');
  }
  for (const listedPath of listedPaths) {
    if (isUnsafeArchivePath(listedPath)) {
      problems.push(`unsafe path in unzip -l listing: ${listedPath}`);
    }
  }
  if (new Set(listedPaths).size !== listedPaths.length) {
    problems.push('duplicate path in unzip -l listing');
  }

  const expectedPaths = entries.map((entry) => entry.path).sort(compareUtf8);
  const actualPaths = [...listedPaths].sort(compareUtf8);
  if (!sameOrderedStrings(expectedPaths, actualPaths)) {
    problems.push(
      `entry path set mismatch (expected ${expectedPaths.length}, listed ${actualPaths.length})`,
    );
  }

  const extractDir = path.join(dumpDir, `${name}-verified-extract`);
  try {
    execFileSync('unzip', ['-n', '-q', zipPath, '-d', extractDir], { stdio: 'pipe' });
  } catch {
    problems.push('no-overwrite extraction failed');
  }

  for (const entry of entries) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(extractDir, ...entry.path.split('/')));
    } catch {
      problems.push(`missing extracted file: ${entry.path}`);
      continue;
    }
    if (sha256(bytes) !== entry.checksum) {
      problems.push(`outer ledger checksum mismatch: ${entry.path}`);
    }
  }
  verifyOnDiskBookkeeping(extractDir, problems, name);

  return { problems, entryCount: entries.length };
}

function verifyGoldenFixture(
  name: string,
  zipPath: string,
  entries: readonly LedgerEntry[],
  dumpDir: string,
): VerificationRow {
  const inspection = inspectFixture(name, zipPath, entries, dumpDir);
  const pass = inspection.problems.length === 0;
  return {
    pass,
    line: `${pass ? 'PASS' : 'FAIL'}  ${name}  (${inspection.entryCount} entries)${
      pass ? '' : ` - ${inspection.problems.join('; ')}`
    }`,
  };
}

function repairedLedger(
  extractDir: string,
  entries: readonly LedgerEntry[],
): readonly LedgerEntry[] {
  return entries.map((entry) => ({
    ...entry,
    checksum: sha256(readFileSync(path.join(extractDir, ...entry.path.split('/')))),
  }));
}

function repackRegularFiles(extractDir: string, zipPath: string): void {
  const relativePaths = listRegularFiles(extractDir);
  execFileSync('zip', ['-q', '-X', '-0', zipPath, ...relativePaths], {
    cwd: extractDir,
    stdio: 'pipe',
  });
}

function replaceManifestChecksum(extractDir: string, root: string): void {
  const manifestPath = path.join(extractDir, root, 'manifest.json');
  const checksumsPath = path.join(extractDir, root, 'checksums.sha256');
  const digest = sha256(readFileSync(manifestPath));
  const original = readFileSync(checksumsPath, 'utf8');
  const replaced = original.replace(
    /^[a-f0-9]{64} {2}manifest\.json$/mu,
    `${digest}  manifest.json`,
  );
  if (replaced === original) throw new Error('manifest checksum declaration was not found');
  writeFileSync(checksumsPath, replaced);
}

function verifyTamperedFixture(
  name: string,
  sourceZipPath: string,
  sourceEntries: readonly LedgerEntry[],
  dumpDir: string,
  tamper: (extractDir: string, root: string) => void,
  expectedProblem: string,
): VerificationRow {
  const sourceDir = path.join(dumpDir, `${name}-source-extract`);
  const discoveryProblems: string[] = [];
  try {
    execFileSync('unzip', ['-n', '-q', sourceZipPath, '-d', sourceDir], { stdio: 'pipe' });
    const sourcePaths = listRegularFiles(sourceDir);
    const root = discoverPackageRoot(sourcePaths, discoveryProblems, name);
    if (root === null) throw new Error(discoveryProblems.join('; '));
    tamper(sourceDir, root);

    // Recompute the caller-visible ledger after tampering. A superficial
    // verification against this repaired ledger must pass; only independent
    // semantic reconciliation of the extracted bookkeeping may reject.
    const entries = repairedLedger(sourceDir, sourceEntries);
    const tamperedZipPath = path.join(dumpDir, `${name}.zip`);
    repackRegularFiles(sourceDir, tamperedZipPath);
    const inspection = inspectFixture(name, tamperedZipPath, entries, dumpDir);
    const expectedProblems = inspection.problems.filter((problem) =>
      problem.includes(expectedProblem),
    );
    const unexpectedProblems = inspection.problems.filter(
      (problem) => !problem.includes(expectedProblem),
    );
    const pass = expectedProblems.length > 0 && unexpectedProblems.length === 0;
    return {
      pass,
      line:
        `${pass ? 'PASS' : 'FAIL'}  ${name}  ` +
        `(repaired outer ledger accepted; extracted semantic tamper ${
          pass ? 'rejected' : `not isolated as required: ${inspection.problems.join('; ')}`
        })`,
    };
  } catch (error) {
    return {
      pass: false,
      line: `FAIL  ${name}  (${error instanceof Error ? error.message : 'tamper exercise failed'})`,
    };
  }
}

function verifyBookkeepingTamperCases(
  dumpDir: string,
  ledger: Readonly<Record<string, readonly LedgerEntry[]>>,
): readonly VerificationRow[] {
  const sourceEntries = ledger['a-b-pair'];
  if (sourceEntries === undefined) {
    return [
      { pass: false, line: 'FAIL  tampered-checksums-repaired-ledger  (missing source ledger)' },
      { pass: false, line: 'FAIL  tampered-manifest-repaired-ledger  (missing source ledger)' },
    ];
  }
  const sourceZipPath = path.join(dumpDir, 'a-b-pair.zip');
  const checksumRow = verifyTamperedFixture(
    'tampered-checksums-repaired-ledger',
    sourceZipPath,
    sourceEntries,
    dumpDir,
    (extractDir, root) => {
      const target = path.join(extractDir, root, 'checksums.sha256');
      const text = readFileSync(target, 'utf8');
      writeFileSync(target, text.replace(/^[a-f0-9]{64}/u, '0'.repeat(64)));
    },
    'digest mismatch',
  );
  const manifestRow = verifyTamperedFixture(
    'tampered-manifest-repaired-ledger',
    sourceZipPath,
    sourceEntries,
    dumpDir,
    (extractDir, root) => {
      const target = path.join(extractDir, root, 'manifest.json');
      const manifest = JSON.parse(readFileSync(target, 'utf8')) as {
        includedFiles: readonly { readonly path: string }[];
        fileSizes: Record<string, number>;
      };
      const firstPath = manifest.includedFiles[0]?.path;
      if (firstPath === undefined || manifest.fileSizes[firstPath] === undefined) {
        throw new Error('manifest did not contain a mutable fileSizes target');
      }
      manifest.fileSizes[firstPath] += 1;
      writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
      // Repair the checksums declaration too, ensuring rejection reaches the
      // manifest's own byte-size reconciliation rather than stopping earlier.
      replaceManifestChecksum(extractDir, root);
    },
    'fileSizes mismatch',
  );
  return [checksumRow, manifestRow];
}

function verifyReorderedHostileCase(dumpDir: string): VerificationRow {
  const zipPath = path.join(dumpDir, 'reordered-hostile.zip');
  const evidence = JSON.parse(
    readFileSync(path.join(dumpDir, 'reordered-hostile-verification.json'), 'utf8'),
  ) as {
    readonly ok: boolean;
    readonly reason?: string;
    readonly detail?: string;
    readonly entries: readonly LedgerEntry[];
  };
  const inspection = inspectFixture(
    'reordered-hostile-external-compatibility',
    zipPath,
    evidence.entries,
    dumpDir,
  );
  const internalRejectedAsExpected =
    evidence.ok === false &&
    evidence.reason === 'structural' &&
    evidence.detail === 'local_order_mismatch';
  const pass = inspection.problems.length === 0 && internalRejectedAsExpected;
  return {
    pass,
    line:
      `${pass ? 'PASS' : 'FAIL'}  reordered-hostile-external-compatibility  ` +
      `(external unzip/list/extract/semantic checks: ${
        inspection.problems.length === 0 ? 'accepted' : inspection.problems.join('; ')
      }; internal verifyPackageZip: ${
        evidence.ok ? 'accepted' : `${evidence.reason}/${evidence.detail}`
      })`,
  };
}

function main(): void {
  ensureExternalToolsAvailable();
  const dumpDir = mkdtempSync(path.join(tmpdir(), 'golden-zip-external-'));
  const rows: VerificationRow[] = [];
  try {
    execFileSync('npx', ['vitest', 'run', 'test/export-engine/packaging/golden-zip-dump.test.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, GOLDEN_ZIP_DUMP_DIR: dumpDir },
    });

    const ledger = JSON.parse(readFileSync(path.join(dumpDir, 'ledger.json'), 'utf8')) as Record<
      string,
      readonly LedgerEntry[]
    >;
    for (const [name, entries] of Object.entries(ledger)) {
      rows.push(verifyGoldenFixture(name, path.join(dumpDir, `${name}.zip`), entries, dumpDir));
    }
    rows.push(...verifyBookkeepingTamperCases(dumpDir, ledger));
    rows.push(verifyReorderedHostileCase(dumpDir));
  } finally {
    rmSync(dumpDir, { recursive: true, force: true });
  }

  for (const row of rows) console.log(row.line);
  const passed = rows.filter((row) => row.pass).length;
  console.log(`${passed === 13 ? 'PASS' : 'FAIL'}  external-case-count  (${passed}/13 passed)`);
  process.exit(rows.length === 13 && passed === 13 ? 0 : 1);
}

main();
