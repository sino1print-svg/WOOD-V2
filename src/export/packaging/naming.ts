/**
 * File naming policy - EX section 12.1. Builds the fixed
 * `{{seq}}_{{slug}}_{{kind}}.{{ext}}` pattern and the small set of literal
 * folder/file names the ZIP tree requires, then runs every segment through the
 * shared sanitizer so nothing unsafe reaches a ZIP path.
 */
import { sanitizeSegment } from './path';
import { slugify } from './slug';

/** Zero-pad to at least `width` digits; never truncates a larger number. */
export function zeroPad(value: number, width: number): string {
  const text = String(Math.trunc(value));
  return text.length >= width ? text : '0'.repeat(width - text.length) + text;
}

export function sessionFolderName(oneBasedIndex: number): string {
  return `session-${zeroPad(oneBasedIndex, 2)}`;
}

export function groupFileName(groupNumber: number, maxSegment: number): string {
  return sanitizeSegment(`group-${zeroPad(groupNumber, 2)}.txt`, maxSegment);
}

export function outputSlug(rawName: string, fallbackSeed: string): string {
  return slugify(rawName, fallbackSeed);
}

export function outputFileName(
  sceneNumber: number,
  slug: string,
  kind: 'A' | 'B',
  maxSegment: number,
): string {
  return sanitizeSegment(`${zeroPad(sceneNumber, 3)}_${slug}_${kind}.txt`, maxSegment);
}

export function pairFileName(sceneNumber: number, maxSegment: number): string {
  return sanitizeSegment(`${zeroPad(sceneNumber, 3)}_pair_execution.md`, maxSegment);
}

export function jsonFileName(rawId: string, maxSegment: number): string {
  const slug = slugify(rawId, rawId);
  return sanitizeSegment(`${slug}.json`, maxSegment);
}
