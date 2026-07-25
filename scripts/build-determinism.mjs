/**
 * Deterministic build verification (12_IMPLEMENTATION_GUIDE §36; QA EVP-25..28).
 *
 * Builds the app twice into two fresh temporary directories (outside the repo so
 * the working tree is never polluted), computes SHA-256 of every output file's
 * CONTENT (not the filename), and compares file lists + content hashes byte-for-byte.
 * Exits non-zero on any difference. Works on a normal filesystem and in CI.
 *
 * This is a build-verification harness, NOT application/business logic.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const BUILD_TIMEOUT_MS = 120_000;

function build(outDir) {
  // Invoke the pinned local Vite CLI directly. Going through `npx` can leave an
  // intermediary process tree alive after repeated builds, which made the final
  // build in `verify:full` hang even though each individual build was valid.
  execFileSync(
    process.execPath,
    [viteBin, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: BUILD_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  );
}

function hashTree(root) {
  /** @type {Record<string, string>} */
  const hashes = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full).split(path.sep).join('/');
        hashes[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return hashes;
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// Keep both temporary output directories beneath the repository root. Vite emits
// source-map paths relative to outDir; using the OS temp directory would bake the
// absolute checkout path into map bytes and make hashes differ across clean copies.
const tempRoot = mkdtempSync(path.join(repoRoot, '.mpd-determinism-'));
const dir1 = path.join(tempRoot, 'a');
const dir2 = path.join(tempRoot, 'b');

let code = 0;
try {
  build(dir1);
  const h1 = hashTree(dir1);
  cleanup(dir1);

  build(dir2);
  const h2 = hashTree(dir2);
  cleanup(dir2);

  const files1 = Object.keys(h1).sort();
  const files2 = Object.keys(h2).sort();

  const listMatch = JSON.stringify(files1) === JSON.stringify(files2);
  const mismatches = files1.filter((f) => h1[f] !== h2[f]);
  const onlyIn1 = files1.filter((f) => !(f in h2));
  const onlyIn2 = files2.filter((f) => !(f in h1));

  console.log('Deterministic build verification');
  console.log('  output files:', files1.length);
  for (const f of files1) console.log(`  ${h1[f]}  ${f}`);

  if (!listMatch || mismatches.length > 0 || onlyIn1.length > 0 || onlyIn2.length > 0) {
    code = 1;
    console.error('\nNON-DETERMINISTIC BUILD DETECTED');
    if (onlyIn1.length) console.error('  only in run 1:', onlyIn1);
    if (onlyIn2.length) console.error('  only in run 2:', onlyIn2);
    for (const f of mismatches)
      console.error(`  hash differs: ${f}\n    run1 ${h1[f]}\n    run2 ${h2[f]}`);
  } else {
    console.log('\nBuild output is deterministic (identical file list + SHA-256 hashes).');
  }
} catch (err) {
  code = 2;
  console.error('Determinism build failed:', err instanceof Error ? err.message : String(err));
} finally {
  cleanup(tempRoot);
}

process.exit(code);
