/**
 * Consolidated Final Corrective §21 / Deficiency Closure §11 - committed,
 * reproducible external ZIP verification.
 *
 * Generates all 10 locked golden ZIP fixtures (plus one deliberately
 * physically-reordered-but-Info-ZIP-tolerated hostile archive) from the
 * *current* code via `test/export-engine/packaging/golden-zip-dump.test.ts`,
 * then independently verifies every fixture using the system `unzip` binary
 * - never trusting the writer's own in-memory bookkeeping. Prints one
 * PASS/FAIL row per fixture and exits non-zero on any failure.
 *
 * Deficiency Closure §11 closes F8: the on-disk `checksums.sha256` is parsed
 * into an ordered path->digest map and reconciled against SHA-256 digests
 * freshly recomputed from the *extracted* bytes on disk (not the in-memory
 * packaging ledger); the on-disk `manifest.json` is validated with the same
 * authoritative schema validator packaging itself uses
 * (`validateExportManifestShape`) and its `includedFiles`/`fileSizes`/
 * `checksums` are reconciled against the real extracted directory listing.
 * Either bookkeeping file being tampered on disk - independent of whatever
 * the in-memory ledger still says - must be caught here. The pure
 * reconciliation logic lives in `scripts/zip-external-verification.mts`.
 *
 * This is a verification script, not the pure packaging core, so it may use
 * Node filesystem/process APIs, shell out to `unzip`, and run under
 * `vite-node` (a script, not a public packaging function - the "never
 * throws" boundary applies to `src/export/packaging`, not to this CLI tool).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findSingleFile,
  listFilesRecursive,
  verifyChecksumsFileOnDisk,
  verifyManifestFileOnDisk,
} from './zip-external-verification.mts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface LedgerEntry {
  readonly path: string;
  readonly kind: string;
  readonly checksum: string;
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

function isUnsafeListedPath(candidate: string): boolean {
  return (
    candidate.startsWith('/') ||
    candidate.includes('..') ||
    /^[a-zA-Z]:/.test(candidate) ||
    candidate.includes('\\') ||
    candidate.includes('//')
  );
}

/** Parses `unzip -l` output into an array of listed entry paths. */
function parseUnzipListing(listingText: string): string[] {
  const lines = listingText.split('\n');
  // Header: "Archive: ...", "  Length ... Name", "--------- ... ----"
  // Footer: "---------  ... -------", "N     N files"
  const entryLines = lines.slice(3, -3);
  return entryLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/).slice(3).join(' '));
}

function verifyOneFixture(
  name: string,
  zipPath: string,
  entries: readonly LedgerEntry[],
  dumpDir: string,
): { readonly pass: boolean; readonly line: string } {
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

  const expectedPaths = [...entries.map((entry) => entry.path)].sort();
  const actualPaths = [...listedPaths].sort();
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
    const filePath = path.join(extractDir, ...entry.path.split('/'));
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
    } catch {
      problems.push(`missing extracted file: ${entry.path}`);
      continue;
    }
    const actualChecksum = createHash('sha256').update(bytes).digest('hex');
    if (actualChecksum !== entry.checksum) {
      problems.push(`checksum mismatch: ${entry.path}`);
    }
  }

  // Deficiency Closure §11: independent, on-disk semantic reconciliation of
  // the extracted bookkeeping files - never relying solely on the in-memory
  // ledger above.
  const checksumsEntry = entries.find((entry) => entry.kind === 'checksums');
  const manifestEntry = entries.find((entry) => entry.kind === 'manifest');
  if (checksumsEntry !== undefined || manifestEntry !== undefined) {
    const projectRootFile =
      checksumsEntry !== undefined
        ? findSingleFile(extractDir, 'checksums.sha256')
        : findSingleFile(extractDir, 'manifest.json');
    if (projectRootFile === null) {
      problems.push('could not locate the project root folder in the extracted archive');
    } else {
      const projectRoot = path.dirname(projectRootFile);
      const realExtractedPaths = new Set(listFilesRecursive(projectRoot));
      if (checksumsEntry !== undefined) {
        verifyChecksumsFileOnDisk(projectRoot, realExtractedPaths, problems);
      }
      if (manifestEntry !== undefined) {
        verifyManifestFileOnDisk(projectRoot, realExtractedPaths, problems);
      }
    }
  }

  const pass = problems.length === 0;
  return {
    pass,
    line: `${pass ? 'PASS' : 'FAIL'}  ${name}  (${entries.length} entries)${
      pass ? '' : ` - ${problems.join('; ')}`
    }`,
  };
}

function verifyReorderedHostileCase(dumpDir: string): {
  readonly pass: boolean;
  readonly line: string;
} {
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
  ) as { ok: boolean; reason?: string; detail?: string };
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

    const ledger = JSON.parse(readFileSync(path.join(dumpDir, 'ledger.json'), 'utf8')) as Record<
      string,
      LedgerEntry[]
    >;
    for (const [name, entries] of Object.entries(ledger)) {
      const zipPath = path.join(dumpDir, `${name}.zip`);
      const row = verifyOneFixture(name, zipPath, entries, dumpDir);
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
