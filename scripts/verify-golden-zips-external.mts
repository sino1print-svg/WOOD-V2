/**
 * Consolidated Final Corrective §21 / Final Controlled Merge - committed,
 * reproducible external ZIP verification.
 *
 * Generates all 10 locked golden ZIP fixtures (plus one deliberately
 * physically-reordered-but-Info-ZIP-tolerated hostile archive) from the
 * *current* code via `test/export-engine/packaging/golden-zip-dump.test.ts`,
 * then independently verifies every fixture using the system `unzip`
 * binary - never trusting the writer's own bookkeeping. Prints one PASS/FAIL
 * row per fixture and exits non-zero on any failure.
 *
 * This is a verification script, not the pure packaging core, so it may use
 * Node filesystem/process APIs and shell out to `unzip` directly. On-disk
 * reconciliation itself lives in `./zip-external-verification.mts`, an
 * independent, testable module - this file is orchestration only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverPackageRoot,
  isUnsafeListedPath,
  type LedgerEntry,
  listRegularFiles,
  parseUnzipListing,
  sha256,
  verifyOnDiskBookkeeping,
} from './zip-external-verification.mts';
import { compareUtf8 } from '../src/export/runtime';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface VerificationRow {
  readonly pass: boolean;
  readonly line: string;
}

function ensureUnzipAvailable(): void {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'pipe' });
  } catch {
    console.error(
      'BLOCKED: the system `unzip` binary is not available in this environment. ' +
        'External ZIP verification cannot run without it.',
    );
    process.exit(1);
  }
}

function verifyOneFixture(
  name: string,
  zipPath: string,
  entries: readonly LedgerEntry[],
  dumpDir: string,
): VerificationRow {
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
    if (isUnsafeListedPath(listedPath)) {
      problems.push(`unsafe path in unzip -l listing: ${listedPath}`);
    }
  }

  const expectedPaths = [...entries.map((entry) => entry.path)].sort(compareUtf8);
  const actualPaths = [...listedPaths].sort(compareUtf8);
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    problems.push(
      `entry path set mismatch (expected ${expectedPaths.length}, listed ${actualPaths.length})`,
    );
  }

  const extractDir = path.join(dumpDir, `${name}-extract`);
  try {
    execFileSync('unzip', ['-n', '-q', zipPath, '-d', extractDir], { stdio: 'pipe' });
  } catch {
    problems.push('no-overwrite extraction failed');
  }

  for (const entry of entries) {
    const filePath = path.join(extractDir, entry.path);
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
    } catch {
      problems.push(`missing extracted file: ${entry.path}`);
      continue;
    }
    const actualChecksum = sha256(bytes);
    if (actualChecksum !== entry.checksum) {
      problems.push(`checksum mismatch: ${entry.path}`);
    }
  }

  verifyOnDiskBookkeeping(extractDir, problems, name);

  const pass = problems.length === 0;
  return {
    pass,
    line: `${pass ? 'PASS' : 'FAIL'}  ${name}  (${entries.length} entries)${
      pass ? '' : ` - ${problems.join('; ')}`
    }`,
  };
}

function tamperVerificationRow(
  name: string,
  zipPath: string,
  dumpDir: string,
  tamper: (extractDir: string, root: string) => void,
  expectedProblem: string,
): VerificationRow {
  const extractDir = path.join(dumpDir, `${name}-extract`);
  const problems: string[] = [];
  try {
    execFileSync('unzip', ['-n', '-q', zipPath, '-d', extractDir], { stdio: 'pipe' });
    const actualPaths = listRegularFiles(extractDir);
    const discoveryProblems: string[] = [];
    const root = discoverPackageRoot(actualPaths, discoveryProblems, name);
    if (!root) throw new Error(discoveryProblems.join('; '));
    tamper(extractDir, root);
    verifyOnDiskBookkeeping(extractDir, problems, name);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'tamper exercise failed');
  }
  const pass = problems.some((problem) => problem.includes(expectedProblem));
  return {
    pass,
    line:
      `${pass ? 'PASS' : 'FAIL'}  ${name}  ` +
      `(tampered on-disk bookkeeping ${pass ? 'rejected' : 'was not rejected as required'})`,
  };
}

function verifyBookkeepingTamperCases(dumpDir: string): VerificationRow[] {
  const zipPath = path.join(dumpDir, 'a-b-pair.zip');
  const checksumRow = tamperVerificationRow(
    'tampered-checksums-with-unchanged-ledger',
    zipPath,
    dumpDir,
    (extractDir, root) => {
      const target = path.join(extractDir, root, 'checksums.sha256');
      const text = readFileSync(target, 'utf8');
      writeFileSync(target, text.replace(/^[a-f0-9]{64}/u, '0'.repeat(64)));
    },
    'digest mismatch',
  );
  const manifestRow = tamperVerificationRow(
    'tampered-manifest-with-unchanged-ledger',
    zipPath,
    dumpDir,
    (extractDir, root) => {
      const target = path.join(extractDir, root, 'manifest.json');
      const manifest = JSON.parse(readFileSync(target, 'utf8'));
      const firstPath = manifest.includedFiles[0].path;
      manifest.fileSizes[firstPath] += 1;
      writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    'fileSizes mismatch',
  );
  return [checksumRow, manifestRow];
}

function verifyReorderedHostileCase(dumpDir: string): VerificationRow {
  const zipPath = path.join(dumpDir, 'reordered-hostile.zip');
  let externalAccepted = false;
  try {
    execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
    externalAccepted = true;
  } catch {
    externalAccepted = false;
  }

  const verification = JSON.parse(
    readFileSync(path.join(dumpDir, 'reordered-hostile-verification.json'), 'utf8'),
  );
  const internalRejectedAsExpected =
    verification.ok === false &&
    verification.reason === 'structural' &&
    verification.detail === 'local_order_mismatch';

  const pass = externalAccepted && internalRejectedAsExpected;
  return {
    pass,
    line:
      `${pass ? 'PASS' : 'FAIL'}  reordered-hostile-external-compatibility  ` +
      `(external unzip -t: ${externalAccepted ? 'exit 0 (accepted)' : 'rejected'}; ` +
      `internal verifyPackageZip: ${
        verification.ok ? 'accepted' : `${verification.reason}/${verification.detail}`
      })`,
  };
}

function main(): void {
  ensureUnzipAvailable();

  const dumpDir = mkdtempSync(path.join(tmpdir(), 'golden-zip-external-'));
  let anyFailed = false;
  try {
    execFileSync('npx', ['vitest', 'run', 'test/export-engine/packaging/golden-zip-dump.test.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, GOLDEN_ZIP_DUMP_DIR: dumpDir },
    });

    const ledger: Record<string, LedgerEntry[]> = JSON.parse(
      readFileSync(path.join(dumpDir, 'ledger.json'), 'utf8'),
    );
    for (const [name, entries] of Object.entries(ledger)) {
      const zipPath = path.join(dumpDir, `${name}.zip`);
      const row = verifyOneFixture(name, zipPath, entries, dumpDir);
      console.log(row.line);
      if (!row.pass) anyFailed = true;
    }

    for (const row of verifyBookkeepingTamperCases(dumpDir)) {
      console.log(row.line);
      if (!row.pass) anyFailed = true;
    }

    const reorderedRow = verifyReorderedHostileCase(dumpDir);
    console.log(reorderedRow.line);
    if (!reorderedRow.pass) anyFailed = true;
  } finally {
    rmSync(dumpDir, { recursive: true, force: true });
  }

  process.exit(anyFailed ? 1 : 0);
}

main();
