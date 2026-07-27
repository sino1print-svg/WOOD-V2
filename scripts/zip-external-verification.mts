/**
 * Consolidated Final Corrective §21 / Final Controlled Merge - independent,
 * testable on-disk reconciliation for an extracted export package.
 *
 * This module never trusts the writer's own bookkeeping: it re-derives every
 * fact (file list, digests, manifest cross-references) from what actually
 * landed on disk after extraction. It imports the project's own
 * `validateExportManifestShape` (the real ExportManifest JSON-Schema
 * validator, 09_EXPORT_ENGINE §13) and `compareUtf8` (the exact ordinal
 * byte-comparison packaging itself sorts entries with) rather than
 * reimplementing either locally - two independent local reimplementations
 * were the Two-Programmer-Comparison audit's finding against the prior
 * draft's external verifier.
 *
 * SHA-256 is deliberately still computed here via Node's own `node:crypto`,
 * not the project's hand-rolled `sha256Bytes` (EX §3.5/§14): reusing the
 * project's own digest implementation to verify the project's own output
 * would hide a bug in that implementation, defeating the point of an
 * independent external check.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { compareUtf8 } from '../src/export/runtime';
import { validateExportManifestShape } from '../src/shared/export-manifest-schema-validation';

export interface LedgerEntry {
  readonly path: string;
  readonly kind: string;
  readonly checksum: string;
}

function hasControlCharacter(candidate: string): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function isUnsafeListedPath(candidate: string): boolean {
  const segments = candidate.split('/');
  return (
    candidate.length === 0 ||
    candidate.startsWith('/') ||
    /^[a-zA-Z]:/.test(candidate) ||
    candidate.includes('\\') ||
    candidate.includes('//') ||
    hasControlCharacter(candidate) ||
    segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)
  );
}

/** Parses `unzip -l` output into an array of listed entry paths. */
export function parseUnzipListing(listingText: string): string[] {
  const lines = listingText.split('\n');
  // Header: "Archive: ...", "  Length ... Name", "--------- ... ----"
  // Footer: "---------  ... -------", "N     N files"
  const entryLines = lines.slice(3, -3);
  return entryLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/).slice(3).join(' '));
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function listRegularFiles(root: string, relative = ''): string[] {
  const files: string[] = [];
  for (const name of readdirSync(path.join(root, relative)).sort(compareUtf8)) {
    const childRelative = relative.length === 0 ? name : `${relative}/${name}`;
    const status = lstatSync(path.join(root, childRelative));
    if (status.isSymbolicLink()) {
      throw new Error(`symlink extracted: ${childRelative}`);
    }
    if (status.isDirectory()) files.push(...listRegularFiles(root, childRelative));
    else if (status.isFile()) files.push(childRelative);
    else throw new Error(`non-regular extracted entry: ${childRelative}`);
  }
  return files;
}

export function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((candidate, index) => candidate === right[index])
  );
}

export function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
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

export function expectedKindForPath(candidate: string): string | null {
  if (candidate === 'README.md') return 'readme';
  if (candidate === 'project/project.json') return 'project';
  if (/^project\/versions\/[^/]+\.json$/u.test(candidate)) return 'version_snapshot';
  if (/^assets\/artwork-metadata\/[^/]+\.json$/u.test(candidate)) return 'artwork_metadata';
  if (/^session-\d+\/session-summary\.md$/u.test(candidate)) return 'session_summary';
  if (/^session-\d+\/execution-plan\.txt$/u.test(candidate)) return 'execution_plan';
  if (/^session-\d+\/groups\/[^/]+\.txt$/u.test(candidate)) return 'group_plan';
  if (/^session-\d+\/prompts\/A\/[^/]+\.txt$/u.test(candidate)) return 'prompt_a';
  if (/^session-\d+\/prompts\/B\/[^/]+\.txt$/u.test(candidate)) return 'prompt_b';
  if (/^session-\d+\/prompts\/pairs\/[^/]+\.md$/u.test(candidate)) return 'prompt_pair';
  if (/^session-\d+\/cover\/cover-prompt\.txt$/u.test(candidate)) return 'cover_prompt';
  if (/^session-\d+\/cover\/cover-metadata\.json$/u.test(candidate)) return 'cover_metadata';
  if (/^session-\d+\/metadata\/prompt-metadata\.json$/u.test(candidate)) return 'prompt_metadata';
  if (/^session-\d+\/metadata\/validation\.json$/u.test(candidate)) return 'validation';
  return null;
}

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
  if (text.charCodeAt(0) === 0xfeff) problems.push(`${label}: unexpected BOM`);
  if (text.includes('\r')) problems.push(`${label}: unexpected CR`);
  if (text.length > 0 && !text.endsWith('\n')) problems.push(`${label}: missing final LF`);

  const lines =
    text.length === 0 ? [] : text.slice(0, text.endsWith('\n') ? -1 : undefined).split('\n');
  const declarations: { path: string; digest: string }[] = [];
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
    if (!declaredPath || declaredPath === 'checksums.sha256' || isUnsafeListedPath(declaredPath)) {
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
      bytes = readFileSync(path.join(extractDir, root, declaration.path));
    } catch {
      problems.push(`${label}: missing declared file: ${declaration.path}`);
      continue;
    }
    if (sha256(bytes) !== declaration.digest) {
      problems.push(`${label}: digest mismatch: ${declaration.path}`);
    }
  }
}

interface ParsedManifest {
  readonly includedFiles: readonly { path: string; kind: string }[];
  readonly fileSizes: Record<string, number>;
  readonly checksums: Record<string, string>;
}

function isParsedManifestShape(value: unknown): value is ParsedManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.includedFiles) &&
    typeof candidate.fileSizes === 'object' &&
    candidate.fileSizes !== null &&
    typeof candidate.checksums === 'object' &&
    candidate.checksums !== null
  );
}

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
    problems.push(`${label}: authoritative ExportManifest schema validation failed`);
    return;
  }
  if (!isParsedManifestShape(parsed)) {
    problems.push(`${label}: manifest shape unusable after schema validation`);
    return;
  }

  const contentPaths = actualRelativePaths.filter(
    (candidate) => candidate !== 'checksums.sha256' && candidate !== 'manifest.json',
  );
  const expectedOrder = [...contentPaths].sort(compareUtf8);
  const includedPaths = parsed.includedFiles.map((item) => item.path);
  if (!sameOrderedStrings(includedPaths, expectedOrder)) {
    problems.push(`${label}: includedFiles is not the exact canonical extracted content sequence`);
  }
  const sizeKeys = Object.keys(parsed.fileSizes);
  const checksumKeys = Object.keys(parsed.checksums);
  if (!exactStringSet(sizeKeys, contentPaths)) {
    problems.push(`${label}: fileSizes key set differs from extracted content`);
  }
  if (!exactStringSet(checksumKeys, contentPaths)) {
    problems.push(`${label}: checksums key set differs from extracted content`);
  }

  for (const included of parsed.includedFiles) {
    const expectedKind = expectedKindForPath(included.path);
    if (expectedKind === null || included.kind !== expectedKind) {
      problems.push(`${label}: invalid path/kind pair: ${included.path}/${included.kind}`);
    }
  }
  for (const contentPath of contentPaths) {
    const bytes = readFileSync(path.join(extractDir, root, contentPath));
    if (parsed.fileSizes[contentPath] !== bytes.byteLength) {
      problems.push(`${label}: fileSizes mismatch: ${contentPath}`);
    }
    if (parsed.checksums[contentPath] !== sha256(bytes)) {
      problems.push(`${label}: checksums mismatch: ${contentPath}`);
    }
  }
}

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
  if (!root) return;
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
