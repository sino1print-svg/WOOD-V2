/**
 * RTL shell + bidi Unicode + mixed-content checks (deterministic).
 * Verifies the Arabic RTL frame and correct Unicode isolate characters, and that
 * isolating English content never mutates IDs / filenames / checksums / prompt text.
 * No screens or business behavior are added.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LRI, PDI, RLI, isolateLtr } from '../../src/shared/i18n';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('RTL application shell', () => {
  it('index.html declares lang="ar" and dir="rtl"', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<html[^>]*\blang="ar"/);
    expect(html).toMatch(/<html[^>]*\bdir="rtl"/);
  });

  it('the minimal shell is Arabic RTL', () => {
    const shell = readFileSync(path.join(ROOT, 'src', 'ui', 'app-shell', 'AppShell.tsx'), 'utf8');
    expect(shell).toMatch(/dir="rtl"/);
    expect(shell).toMatch(/lang="ar"/);
  });
});

describe('bidi Unicode isolates', () => {
  it('uses the correct Unicode isolate code points', () => {
    expect(LRI.codePointAt(0)).toBe(0x2066); // LEFT-TO-RIGHT ISOLATE
    expect(RLI.codePointAt(0)).toBe(0x2067); // RIGHT-TO-LEFT ISOLATE
    expect(PDI.codePointAt(0)).toBe(0x2069); // POP DIRECTIONAL ISOLATE
  });

  it('isolating English content preserves the exact inner substring', () => {
    for (const inner of [
      'scene_01',
      '001_bella-canvas-front_A.txt',
      'aa11ff00',
      'One prompt = one image.',
    ]) {
      const wrapped = isolateLtr(inner);
      expect(wrapped.slice(1, -1)).toBe(inner);
      expect(wrapped).toBe(`${LRI}${inner}${PDI}`);
    }
  });

  it('is deterministic', () => {
    expect(isolateLtr('X')).toBe(isolateLtr('X'));
  });
});
