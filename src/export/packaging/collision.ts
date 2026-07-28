/**
 * Deterministic collision suffixing - EX section 12.2/11.1.
 *
 * Runs strictly after sanitization and truncation, compares case-insensitively
 * (Windows/macOS-safe), and resolves collisions in the caller's artifact order
 * rather than any filesystem discovery order. IDs, numbering, and prompt text are
 * never touched to resolve a collision - only the generated file name.
 */
import { truncateSegment } from './path';

const MAX_SUFFIX_ATTEMPTS = 100_000;

function splitBaseAndExtension(fileName: string): { readonly base: string; readonly ext: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { base: fileName, ext: '' };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

function splitDirectoryAndFile(path: string): { readonly dir: string; readonly file: string } {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return { dir: '', file: path };
  return { dir: path.slice(0, slash + 1), file: path.slice(slash + 1) };
}

function withSuffix(fileName: string, suffix: number, maxSegment: number): string {
  const { base, ext } = splitBaseAndExtension(fileName);
  const suffixText = `_${suffix}`;
  const budget = Math.max(1, maxSegment - suffixText.length - ext.length);
  const truncatedBase = truncateSegment(base, budget);
  return `${truncatedBase}${suffixText}${ext}`;
}

/**
 * Resolve duplicate full ZIP paths (case-insensitive) into a stable, unique
 * sequence, preserving input order. Returns `null` if a unique name cannot be
 * found within a bounded number of attempts (fail-closed, never an infinite loop).
 */
export function resolveCollisions(paths: readonly string[], maxSegment: number): string[] | null {
  const seenLower = new Set<string>();
  const output: string[] = [];
  for (const path of paths) {
    const { dir, file } = splitDirectoryAndFile(path);
    let candidate = path;
    let suffix = 1;
    let attempts = 0;
    while (seenLower.has(candidate.toLowerCase())) {
      suffix += 1;
      attempts += 1;
      if (attempts > MAX_SUFFIX_ATTEMPTS) return null;
      candidate = `${dir}${withSuffix(file, suffix, maxSegment)}`;
    }
    seenLower.add(candidate.toLowerCase());
    output.push(candidate);
  }
  return output;
}
