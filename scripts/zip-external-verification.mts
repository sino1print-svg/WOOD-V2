/**
 * Deficiency Closure §11 - pure on-disk semantic reconciliation helpers for
 * `scripts/verify-golden-zips-external.mts`. Kept in their own side-effect-
 * free module (no `main()`, no `process.exit`) so they can be imported and
 * exercised directly - by the external verifier script itself, or by a
 * one-off reproduction - without triggering the script's own CLI run.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { compareUtf8 } from '../src/export/runtime';
import { validateExportManifestShape } from '../src/shared/export-manifest-schema-validation';

/** Recursively lists every regular file under `root`, as forward-slash paths relative to `root`. */
export function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const fullPath = path.join(dir, name);
      const relativePath = prefix === '' ? name : `${prefix}/${name}`;
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (stats.isFile()) {
        out.push(relativePath);
      }
    }
  };
  walk(root, '');
  return out;
}

/** Finds the single file named `fileName` anywhere under `root`; returns its full path or `null`. */
export function findSingleFile(root: string, fileName: string): string | null {
  const matches = listFilesRecursive(root).filter((relativePath) =>
    relativePath.endsWith(`/${fileName}`),
  );
  if (matches.length !== 1) return null;
  return path.join(root, matches[0]!);
}

export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Deficiency Closure §11: parses the *extracted* `checksums.sha256` file
 * into an ordered path->digest map, requires exact byte-lexicographic order,
 * no duplicate/self-referencing path, an exact path set match against the
 * real extracted directory (minus `checksums.sha256` itself - `manifest.json`
 * is legitimately listed), and every digest recomputed fresh from the
 * extracted bytes - never merely syntax-checked, never merely compared to
 * the in-memory ledger.
 */
export function verifyChecksumsFileOnDisk(
  projectRoot: string,
  realExtractedPaths: ReadonlySet<string>,
  problems: string[],
): void {
  const checksumsPath = path.join(projectRoot, 'checksums.sha256');
  let text: string;
  try {
    text = readFileSync(checksumsPath, 'utf8');
  } catch {
    problems.push('checksums.sha256: could not read extracted file');
    return;
  }

  if (text.length >= 1 && text.charCodeAt(0) === 0xfeff) {
    problems.push('checksums.sha256: unexpected BOM');
    return;
  }
  if (text.includes('\r')) {
    problems.push('checksums.sha256: unexpected CR');
    return;
  }
  const lines = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n');
  const linePattern = /^([a-f0-9]{64}) {2}(.+)$/;
  const parsed: { readonly digest: string; readonly path: string }[] = [];
  for (const line of lines) {
    const match = linePattern.exec(line);
    if (!match) {
      problems.push(`checksums.sha256: malformed line: ${line}`);
      return;
    }
    parsed.push({ digest: match[1]!, path: match[2]! });
  }

  const seenPaths = new Set<string>();
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index]!;
    if (entry.path === 'checksums.sha256') {
      problems.push('checksums.sha256: illegal self-reference line');
    }
    if (seenPaths.has(entry.path)) {
      problems.push(`checksums.sha256: duplicate path: ${entry.path}`);
    }
    seenPaths.add(entry.path);
    if (index > 0) {
      const previous = parsed[index - 1]!;
      if (compareUtf8(previous.path, entry.path) >= 0) {
        problems.push(
          `checksums.sha256: paths not in strict byte-lexicographic order at ${previous.path} -> ${entry.path}`,
        );
      }
    }
  }

  // `checksums.sha256` legitimately lists `manifest.json` (it is a real
  // content-adjacent file whose own checksum is recorded), but never lists
  // itself (EX §3.6 self-reference policy) - the expected set here is every
  // extracted file except `checksums.sha256`.
  const expectedPaths = new Set([...realExtractedPaths].filter((p) => p !== 'checksums.sha256'));
  if (!setsEqual(seenPaths, expectedPaths)) {
    const missing = [...expectedPaths].filter((p) => !seenPaths.has(p));
    const extra = [...seenPaths].filter((p) => !expectedPaths.has(p));
    problems.push(
      `checksums.sha256: path set mismatch against extracted directory (missing: [${missing.join(', ')}], extra: [${extra.join(', ')}])`,
    );
  }

  for (const entry of parsed) {
    const filePath = path.join(projectRoot, ...entry.path.split('/'));
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
    } catch {
      problems.push(`checksums.sha256: listed path missing on disk: ${entry.path}`);
      continue;
    }
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    if (actualDigest !== entry.digest) {
      problems.push(
        `checksums.sha256: digest mismatch for ${entry.path} (file claims ${entry.digest}, extracted bytes hash to ${actualDigest})`,
      );
    }
  }
}

/**
 * Deficiency Closure §11: runs the same authoritative schema validator
 * packaging itself uses (`validateExportManifestShape`) against the
 * extracted `manifest.json`, then reconciles `includedFiles`/`fileSizes`/
 * `checksums` against the real extracted directory - exact path/kind sets,
 * no unexpected file, no missing file, every size and digest recomputed
 * fresh from the extracted bytes.
 */
export function verifyManifestFileOnDisk(
  projectRoot: string,
  realExtractedPaths: ReadonlySet<string>,
  problems: string[],
): void {
  const manifestPath = path.join(projectRoot, 'manifest.json');
  let text: string;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    problems.push('manifest.json: could not read extracted file');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    problems.push('manifest.json: failed to parse as JSON');
    return;
  }

  const issues = validateExportManifestShape(parsed);
  if (issues.length > 0) {
    problems.push(
      `manifest.json: failed authoritative schema validation (${issues
        .map((issue) => `${issue.jsonPointer}: ${issue.keyword}`)
        .join('; ')})`,
    );
    return;
  }

  const manifest = parsed as {
    includedFiles: readonly { path: string; kind: string }[];
    fileSizes: Readonly<Record<string, number>>;
    checksums: Readonly<Record<string, string>>;
  };

  const includedPaths = new Set(manifest.includedFiles.map((file) => file.path));
  if (includedPaths.size !== manifest.includedFiles.length) {
    problems.push('manifest.json: includedFiles contains a duplicate path');
  }

  const fileSizeKeys = new Set(Object.keys(manifest.fileSizes));
  if (!setsEqual(fileSizeKeys, includedPaths)) {
    problems.push('manifest.json: fileSizes key set disagrees with includedFiles path set');
  }
  const checksumKeys = new Set(Object.keys(manifest.checksums));
  if (!setsEqual(checksumKeys, includedPaths)) {
    problems.push('manifest.json: checksums key set disagrees with includedFiles path set');
  }

  const expectedPaths = new Set(
    [...realExtractedPaths].filter((p) => p !== 'manifest.json' && p !== 'checksums.sha256'),
  );
  if (!setsEqual(includedPaths, expectedPaths)) {
    const missing = [...expectedPaths].filter((p) => !includedPaths.has(p));
    const extra = [...includedPaths].filter((p) => !expectedPaths.has(p));
    problems.push(
      `manifest.json: includedFiles path set mismatch against extracted directory (missing: [${missing.join(', ')}], extra: [${extra.join(', ')}])`,
    );
  }

  for (const file of manifest.includedFiles) {
    const filePath = path.join(projectRoot, ...file.path.split('/'));
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
    } catch {
      problems.push(`manifest.json: listed path missing on disk: ${file.path}`);
      continue;
    }
    const expectedSize = manifest.fileSizes[file.path];
    if (expectedSize !== undefined && expectedSize !== bytes.byteLength) {
      problems.push(
        `manifest.json: fileSizes mismatch for ${file.path} (claims ${expectedSize}, extracted is ${bytes.byteLength})`,
      );
    }
    const expectedChecksum = manifest.checksums[file.path];
    const actualChecksum = createHash('sha256').update(bytes).digest('hex');
    if (expectedChecksum !== undefined && expectedChecksum !== actualChecksum) {
      problems.push(
        `manifest.json: checksums mismatch for ${file.path} (claims ${expectedChecksum}, extracted bytes hash to ${actualChecksum})`,
      );
    }
  }
}
