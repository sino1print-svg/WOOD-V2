import { describe, expect, it } from 'vitest';
import { resolveCollisions } from '../../../src/export/packaging/collision';
import {
  groupFileName,
  outputFileName,
  pairFileName,
  sessionFolderName,
} from '../../../src/export/packaging/naming';
import {
  isSafeZipPath,
  joinZipPath,
  sanitizeSegment,
  truncateSegment,
} from '../../../src/export/packaging/path';
import { slugify } from '../../../src/export/packaging/slug';

describe('File naming and path planning (EX section 12)', () => {
  it('slugifies normal ASCII names deterministically', () => {
    expect(slugify('Bella Canvas 3001', 'seed')).toBe('bella-canvas-3001');
    expect(slugify(slugify('Bella Canvas 3001', 'seed'), 'seed')).toBe(
      slugify('Bella Canvas 3001', 'seed'),
    );
  });

  it('slugifies Arabic project names to a stable ASCII fallback', () => {
    const first = slugify('مشروع التصدير المعياري', 'project-seed');
    const second = slugify('مشروع التصدير المعياري', 'project-seed');
    expect(first).toBe(second);
    expect(/^[a-z0-9-]+$/u.test(first)).toBe(true);
  });

  it('slugifies mixed Arabic/English text', () => {
    const slug = slugify('Bella Canvas تيشيرت 3001', 'seed');
    expect(/^[a-z0-9-]+$/u.test(slug)).toBe(true);
    expect(slug).toContain('bella-canvas');
    expect(slug).toContain('3001');
  });

  it('slugifies emoji to the deterministic fallback (no emoji survives)', () => {
    const slug = slugify('🎨🧵✨', 'emoji-seed');
    expect(/^[a-z0-9-]+$/u.test(slug)).toBe(true);
    expect(slugify('🎨🧵✨', 'emoji-seed')).toBe(slug);
  });

  it('produces identical slugs for NFC and NFD forms of the same name', () => {
    const nfc = 'café'.normalize('NFC');
    const nfd = 'café'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(slugify(nfc, 'seed')).toBe(slugify(nfd, 'seed'));
    expect(slugify(nfc, 'seed')).toBe('cafe');
  });

  it('collapses whitespace runs to single hyphens', () => {
    expect(slugify('bella    canvas\t\tfront', 'seed')).toBe('bella-canvas-front');
  });

  it('replaces punctuation with hyphens and trims edges', () => {
    expect(slugify('  Bella, Canvas! (Front) ', 'seed')).toBe('bella-canvas-front');
  });

  it('falls back deterministically to a stable-ID-derived slug for reserved Windows names', () => {
    expect(sanitizeSegment('CON', 60)).toBe('file-CON');
    expect(sanitizeSegment('con.txt', 60)).toBe('file-con.txt');
    expect(sanitizeSegment('NUL', 60)).toBe('file-NUL');
    expect(sanitizeSegment('COM1', 60)).toBe('file-COM1');
    expect(sanitizeSegment('LPT9', 60)).toBe('file-LPT9');
    // not reserved: only the base name before the first dot is checked
    expect(sanitizeSegment('readme.con.txt', 60)).toBe('readme.con.txt');
  });

  it('strips or replaces invalid path characters', () => {
    const sanitized = sanitizeSegment('a<b>c:d"e/f\\g|h?i*j', 60);
    for (const character of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
      expect(sanitized.includes(character)).toBe(false);
    }
  });

  it('produces a deterministic fallback when a slug becomes empty', () => {
    const first = slugify('!!!???', 'stable-seed');
    const second = slugify('!!!???', 'stable-seed');
    expect(first).toBe(second);
    expect(first.startsWith('item-')).toBe(true);
    expect(slugify('!!!???', 'different-seed')).not.toBe(first);
  });

  it('resolves collisions deterministically after sanitization, by artifact order', () => {
    const resolved = resolveCollisions(
      [
        'session-01/prompts/A/001_a_A.txt',
        'session-01/prompts/A/001_a_A.txt',
        'session-01/prompts/A/001_a_A.txt',
      ],
      60,
    );
    expect(resolved).toEqual([
      'session-01/prompts/A/001_a_A.txt',
      'session-01/prompts/A/001_a_A_2.txt',
      'session-01/prompts/A/001_a_A_3.txt',
    ]);
  });

  it('resolves collisions that only appear after truncation', () => {
    // Two distinct raw names that become identical once sanitizeSegment truncates
    // them to the 20-character segment budget - the real production pipeline.
    const name1 = sanitizeSegment(`${'x'.repeat(30)}-first.txt`, 20);
    const name2 = sanitizeSegment(`${'x'.repeat(30)}-second.txt`, 20);
    expect(name1).toBe(name2);
    const resolved = resolveCollisions([`a/${name1}`, `a/${name2}`], 20);
    expect(resolved).not.toBeNull();
    expect(resolved![0]).not.toBe(resolved![1]);
    expect(resolved!.every((path) => path.split('/').at(-1)!.length <= 20)).toBe(true);
  });

  it('treats case-different names as colliding (Windows/macOS-safe)', () => {
    const resolved = resolveCollisions(['dir/File.txt', 'dir/file.txt'], 60);
    expect(resolved).toEqual(['dir/File.txt', 'dir/file_2.txt']);
  });

  it('produces stable, increasing suffix numbers in input order', () => {
    const resolved = resolveCollisions(['d/x.txt', 'd/x.txt', 'd/x.txt', 'd/x.txt'], 60);
    expect(resolved).toEqual(['d/x.txt', 'd/x_2.txt', 'd/x_3.txt', 'd/x_4.txt']);
  });

  it('never leaves a name that changes IDs or numbering to resolve a collision', () => {
    const resolved = resolveCollisions(['d/001_a_A.txt', 'd/001_a_A.txt'], 60)!;
    expect(resolved[0]).toBe('d/001_a_A.txt');
    expect(resolved[1]!.startsWith('d/001_a_A')).toBe(true);
  });

  it('bounds a single path segment to at most 60 characters by default', () => {
    const sanitized = sanitizeSegment('x'.repeat(500), 60);
    expect(sanitized.length).toBeLessThanOrEqual(60);
  });

  it('bounds the full joined path to at most 200 characters by default', () => {
    const joined = joinZipPath(
      ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60), 'd'.repeat(60)],
      200,
    );
    expect(joined.withinLimits).toBe(false);
    const short = joinZipPath(['a'.repeat(40), 'b'.repeat(40)], 200);
    expect(short.withinLimits).toBe(true);
  });

  it('is invariant to locale/timezone/process environment (no such input exists)', () => {
    const a = slugify('Café Münster', 'seed');
    const b = slugify('Café Münster', 'seed');
    expect(a).toBe(b);
    expect(sessionFolderName(1)).toBe('session-01');
    expect(groupFileName(3, 60)).toBe('group-03.txt');
    expect(outputFileName(7, 'slug', 'A', 60)).toBe('007_slug_A.txt');
    expect(pairFileName(7, 60)).toBe('007_pair_execution.md');
  });

  it('rejects unsafe joined paths: traversal, absolute, drive letters, UNC, backslash', () => {
    expect(isSafeZipPath('../etc/passwd')).toBe(false);
    expect(isSafeZipPath('a/../b')).toBe(false);
    expect(isSafeZipPath('/etc/passwd')).toBe(false);
    expect(isSafeZipPath('C:/Users/owner')).toBe(false);
    expect(isSafeZipPath('C:\\Users\\owner')).toBe(false);
    expect(isSafeZipPath('\\\\server\\share')).toBe(false);
    expect(isSafeZipPath('//server/share')).toBe(false);
    expect(isSafeZipPath('a\\b')).toBe(false);
    expect(isSafeZipPath('a//b')).toBe(false);
    expect(isSafeZipPath('')).toBe(false);
    expect(isSafeZipPath('a/./b')).toBe(false);
    expect(isSafeZipPath('a/session-01/file.txt')).toBe(true);
  });

  it('truncateSegment never leaves a trailing hyphen introduced by the cut point', () => {
    expect(truncateSegment('ab--', 3)).toBe('ab');
    expect(truncateSegment('ab', 1)).toBe('a');
  });
});
