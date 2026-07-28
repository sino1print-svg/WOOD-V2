/**
 * Phase 10 Batch 10.4 controlled merge - pure on-disk reconciliation helpers.
 *
 * This module deliberately has no CLI entry point or process exit. The
 * external verifier imports it after extracting a ZIP with the system unzip
 * tool, so checksums and manifest bookkeeping are reconciled against actual
 * bytes on disk rather than trusted in-memory packaging data.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { compareUtf8 } from '../src/export/runtime';
import { validateExportManifestShape } from '../src/shared/export-manifest-schema-validation';
import type { ExportManifest } from '../src/shared/domain-model';
import type { ExportArtifactKind } from '../src/shared/contracts/export-contracts';

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isUnsafeArchivePath(candidate: string): boolean {
  const segments = candidate.split('/');
  return (
    candidate.length === 0 ||
    candidate.startsWith('/') ||
    /^[a-zA-Z]:/u.test(candidate) ||
    candidate.includes('\\') ||
    candidate.includes('//') ||
    /[\u0000-\u001f\u007f]/u.test(candidate) ||
    segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)
  );
}

/**
 * Lists regular files as forward-slash relative paths. Symbolic links and
 * every other non-regular filesystem object fail closed.
 */
export function listRegularFiles(root: string, relative = ''): string[] {
  const files: string[] = [];
  for (const name of readdirSync(path.join(root, relative)).sort(compareUtf8)) {
    const childRelative = relative.length === 0 ? name : `${relative}/${name}`;
    const status = lstatSync(path.join(root, ...childRelative.split('/')));
    if (status.isSymbolicLink()) {
      throw new Error(`symlink extracted: ${childRelative}`);
    }
    if (status.isDirectory()) {
      files.push(...listRegularFiles(root, childRelative));
    } else if (status.isFile()) {
      files.push(childRelative);
    } else {
      throw new Error(`non-regular extracted entry: ${childRelative}`);
    }
  }
  return files;
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((candidate, index) => candidate === right[index])
  );
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  return sameOrderedStrings([...left].sort(compareUtf8), [...right].sort(compareUtf8));
}

export function discoverPackageRoot(
  actualPaths: readonly string[],
  problems: string[],
  label: string,
): string | null {
  const roots = new Set(
    actualPaths.map((candidate) => {
      const separator = candidate.indexOf('/');
      return separator < 1 ? '' : candidate.slice(0, separator);
    }),
  );
  if (roots.size !== 1 || roots.has('')) {
    problems.push(`${label}: extracted files do not share exactly one package root`);
    return null;
  }
  return [...roots][0]!;
}

function expectedKindForPath(candidate: string): ExportArtifactKind | null {
  if (candidate === 'README.md') return 'readme';
  if (candidate === 'project/project.json') return 'project';
  if (/^project\/versions\/[^/]+\.json$/u.test(candidate)) return 'version_snapshot';
  if (/^assets\/artwork-metadata\/[^/]+\.json$/u.test(candidate)) {
    return 'artwork_metadata';
  }
  if (/^session-\d+\/session-summary\.md$/u.test(candidate)) return 'session_summary';
  if (/^session-\d+\/execution-plan\.txt$/u.test(candidate)) return 'execution_plan';
  if (/^session-\d+\/groups\/[^/]+\.txt$/u.test(candidate)) return 'group_plan';
  if (/^session-\d+\/prompts\/A\/[^/]+\.txt$/u.test(candidate)) return 'prompt_a';
  if (/^session-\d+\/prompts\/B\/[^/]+\.txt$/u.test(candidate)) return 'prompt_b';
  if (/^session-\d+\/prompts\/pairs\/[^/]+\.md$/u.test(candidate)) return 'prompt_pair';
  if (/^session-\d+\/cover\/cover-prompt\.txt$/u.test(candidate)) return 'cover_prompt';
  if (/^session-\d+\/cover\/cover-metadata\.json$/u.test(candidate)) {
    return 'cover_metadata';
  }
  if (/^session-\d+\/metadata\/prompt-metadata\.json$/u.test(candidate)) {
    return 'prompt_metadata';
  }
  if (/^session-\d+\/metadata\/validation\.json$/u.test(candidate)) return 'validation';
  return null;
}

/**
 * Parses the extracted checksums file as an ordered path-to-digest map,
 * reconciles its exact path set, and recomputes every digest from disk.
 */
export function verifyChecksumsFileOnDisk(
  extractDir: string,
  root: string,
  actualRelativePaths: readonly string[],
  problems: string[],
  label: string,
): void {
  const filePath = path.join(extractDir, root, 'checksums.sha256');
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    problems.push(`${label}: could not read extracted file`);
    return;
  }
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    problems.push(`${label}: unexpected BOM`);
  }
  if (text.includes('\r')) problems.push(`${label}: unexpected CR`);
  if (text.length > 0 && !text.endsWith('\n')) problems.push(`${label}: missing final LF`);

  const lines =
    text.length === 0 ? [] : text.slice(0, text.endsWith('\n') ? -1 : undefined).split('\n');
  const declarations: { readonly path: string; readonly digest: string }[] = [];
  const seen = new Set<string>();
  const linePattern = /^([a-f0-9]{64}) {2}(.+)$/u;
  for (const line of lines) {
    const match = linePattern.exec(line);
    if (!match) {
      problems.push(`${label}: malformed line: ${line}`);
      continue;
    }
    const digest = match[1]!;
    const declaredPath = match[2]!;
    if (declaredPath === 'checksums.sha256' || isUnsafeArchivePath(declaredPath)) {
      problems.push(`${label}: invalid or self-referencing path: ${declaredPath}`);
      continue;
    }
    if (seen.has(declaredPath)) problems.push(`${label}: duplicate path: ${declaredPath}`);
    seen.add(declaredPath);
    declarations.push({ path: declaredPath, digest });
  }

  const declaredOrder = declarations.map((item) => item.path);
  const sortedOrder = [...declaredOrder].sort(compareUtf8);
  if (!sameOrderedStrings(declaredOrder, sortedOrder)) {
    problems.push(`${label}: paths are not in exact byte-lexicographic order`);
  }
  const expectedPaths = actualRelativePaths.filter((candidate) => candidate !== 'checksums.sha256');
  if (!exactStringSet(declaredOrder, expectedPaths)) {
    problems.push(`${label}: declared path set differs from extracted path set`);
  }

  for (const declaration of declarations) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(extractDir, root, ...declaration.path.split('/')));
    } catch {
      problems.push(`${label}: missing declared file: ${declaration.path}`);
      continue;
    }
    if (sha256(bytes) !== declaration.digest) {
      problems.push(`${label}: digest mismatch: ${declaration.path}`);
    }
  }
}

/**
 * Runs the authoritative ExportManifest validator, then checks canonical
 * includedFiles order, exact path/kind and bookkeeping key sets, byte sizes,
 * and SHA-256 values against the extracted files.
 */
export function verifyManifestFileOnDisk(
  extractDir: string,
  root: string,
  actualRelativePaths: readonly string[],
  problems: string[],
  label: string,
): void {
  const filePath = path.join(extractDir, root, 'manifest.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    problems.push(`${label}: failed to parse as JSON`);
    return;
  }

  const schemaIssues = validateExportManifestShape(parsed);
  if (schemaIssues.length > 0) {
    problems.push(
      `${label}: authoritative ExportManifest schema validation failed (${schemaIssues
        .map((issue) => `${issue.jsonPointer}: ${issue.keyword}`)
        .join('; ')})`,
    );
    return;
  }
  const manifest = parsed as ExportManifest;

  const contentPaths = actualRelativePaths.filter(
    (candidate) => candidate !== 'checksums.sha256' && candidate !== 'manifest.json',
  );
  const expectedOrder = [...contentPaths].sort(compareUtf8);
  const includedPaths = manifest.includedFiles.map((item) => item.path);
  if (!sameOrderedStrings(includedPaths, expectedOrder)) {
    problems.push(`${label}: includedFiles is not the exact canonical extracted content sequence`);
  }
  if (new Set(includedPaths).size !== includedPaths.length) {
    problems.push(`${label}: includedFiles contains a duplicate path`);
  }
  if (!exactStringSet(Object.keys(manifest.fileSizes), contentPaths)) {
    problems.push(`${label}: fileSizes key set differs from extracted content`);
  }
  if (!exactStringSet(Object.keys(manifest.checksums), contentPaths)) {
    problems.push(`${label}: checksums key set differs from extracted content`);
  }

  for (const included of manifest.includedFiles) {
    const expectedKind = expectedKindForPath(included.path);
    if (
      isUnsafeArchivePath(included.path) ||
      expectedKind === null ||
      included.kind !== expectedKind
    ) {
      problems.push(`${label}: invalid path/kind pair: ${included.path}/${included.kind}`);
    }
  }
  for (const contentPath of contentPaths) {
    const bytes = readFileSync(path.join(extractDir, root, ...contentPath.split('/')));
    if (manifest.fileSizes[contentPath] !== bytes.byteLength) {
      problems.push(`${label}: fileSizes mismatch: ${contentPath}`);
    }
    if (manifest.checksums[contentPath] !== sha256(bytes)) {
      problems.push(`${label}: checksums mismatch: ${contentPath}`);
    }
  }
}

/** Reconciles both bookkeeping files against one freshly extracted package tree. */
export function verifyOnDiskBookkeeping(
  extractDir: string,
  problems: string[],
  label: string,
): void {
  let actualPaths: string[];
  try {
    actualPaths = listRegularFiles(extractDir);
  } catch (error) {
    problems.push(`${label}: ${error instanceof Error ? error.message : 'listing failed'}`);
    return;
  }
  const root = discoverPackageRoot(actualPaths, problems, label);
  if (root === null) return;
  const prefix = `${root}/`;
  const actualRelativePaths = actualPaths.map((candidate) => candidate.slice(prefix.length));

  if (!actualRelativePaths.includes('checksums.sha256')) {
    problems.push(`${label}: checksums.sha256 is missing`);
  } else {
    verifyChecksumsFileOnDisk(
      extractDir,
      root,
      actualRelativePaths,
      problems,
      `${root}/checksums.sha256`,
    );
  }
  if (!actualRelativePaths.includes('manifest.json')) {
    problems.push(`${label}: manifest.json is missing`);
  } else {
    verifyManifestFileOnDisk(
      extractDir,
      root,
      actualRelativePaths,
      problems,
      `${root}/manifest.json`,
    );
  }
}
