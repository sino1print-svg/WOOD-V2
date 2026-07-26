/**
 * Consolidated Final Corrective §21 - committed, reproducible external ZIP
 * verification.
 *
 * Generates all 10 locked golden ZIP fixtures (plus one deliberately
 * physically-reordered-but-Info-ZIP-tolerated hostile archive) from the
 * *current* code via `test/export-engine/packaging/golden-zip-dump.test.ts`,
 * then independently verifies every fixture using the system `unzip`
 * binary - never trusting the writer's own bookkeeping. Prints one PASS/FAIL
 * row per fixture and exits non-zero on any failure.
 *
 * This is a verification script, not the pure packaging core, so it may use
 * Node filesystem/process APIs and shell out to `unzip` directly.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ensureUnzipAvailable() {
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

function isUnsafeListedPath(candidate) {
  return (
    candidate.startsWith('/') ||
    candidate.includes('..') ||
    /^[a-zA-Z]:/.test(candidate) ||
    candidate.includes('\\') ||
    candidate.includes('//')
  );
}

/** Parses `unzip -l` output into an array of listed entry paths. */
function parseUnzipListing(listingText) {
  const lines = listingText.split('\n');
  // Header: "Archive: ...", "  Length ... Name", "--------- ... ----"
  // Footer: "---------  ... -------", "N     N files"
  const entryLines = lines.slice(3, -3);
  return entryLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/).slice(3).join(' '));
}

function verifyChecksumsFileOnDisk(text, problems, label) {
  if (text.length >= 3 && text.charCodeAt(0) === 0xfeff) {
    problems.push(`${label}: unexpected BOM`);
    return;
  }
  if (text.includes('\r')) {
    problems.push(`${label}: unexpected CR`);
    return;
  }
  const lines = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n');
  const linePattern = /^[a-f0-9]{64} {2}.+$/;
  for (const line of lines) {
    if (!linePattern.test(line)) {
      problems.push(`${label}: malformed line: ${line}`);
    }
  }
}

function verifyManifestFileOnDisk(text, problems, label) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) {
      problems.push(`${label}: parsed value is not an object`);
    }
  } catch {
    problems.push(`${label}: failed to parse as JSON`);
  }
}

function verifyOneFixture(name, zipPath, entries, dumpDir) {
  const problems = [];

  try {
    execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
  } catch {
    problems.push('unzip -t reported errors');
  }

  let listedPaths = [];
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
    const filePath = path.join(extractDir, entry.path);
    let bytes;
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

  const checksumsEntry = entries.find((entry) => entry.kind === 'checksums');
  if (checksumsEntry !== undefined) {
    try {
      const text = readFileSync(path.join(extractDir, checksumsEntry.path), 'utf8');
      verifyChecksumsFileOnDisk(text, problems, checksumsEntry.path);
    } catch {
      problems.push(`could not read ${checksumsEntry.path} for semantic verification`);
    }
  }

  const manifestEntry = entries.find((entry) => entry.kind === 'manifest');
  if (manifestEntry !== undefined) {
    try {
      const text = readFileSync(path.join(extractDir, manifestEntry.path), 'utf8');
      verifyManifestFileOnDisk(text, problems, manifestEntry.path);
    } catch {
      problems.push(`could not read ${manifestEntry.path} for semantic verification`);
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

function verifyReorderedHostileCase(dumpDir) {
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

function main() {
  ensureUnzipAvailable();

  const dumpDir = mkdtempSync(path.join(tmpdir(), 'golden-zip-external-'));
  let anyFailed = false;
  try {
    execFileSync('npx', ['vitest', 'run', 'test/export-engine/packaging/golden-zip-dump.test.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, GOLDEN_ZIP_DUMP_DIR: dumpDir },
    });

    const ledger = JSON.parse(readFileSync(path.join(dumpDir, 'ledger.json'), 'utf8'));
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
