import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve('src/engines/prompt-engine');
const source = readdirSync(dir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(path.join(dir, name), 'utf8'))
  .join('\n');

describe('Prompt Engine architecture scans', () => {
  it('does not import prohibited later-phase or infrastructure modules', () => {
    for (const token of [
      'cover-engine',
      'export-engine',
      'scene-engine',
      'ui/',
      'persistence/',
      'marketplace',
    ])
      expect(source).not.toContain(token);
  });
  it('does not use nondeterministic, network or filesystem APIs', () => {
    for (const token of [
      'Math.random',
      'Date.now',
      'randomUUID',
      'getRandomValues',
      'fetch(',
      'XMLHttpRequest',
      'node:fs',
      'node:path',
      'process.env',
    ])
      expect(source).not.toContain(token);
  });
  it('exports only validated public execution functions', () => {
    const index = readFileSync(path.join(dir, 'index.ts'), 'utf8');
    expect(index).toContain('composeOutputA');
    expect(index).toContain('composeOutputB');
    expect(index).not.toContain("from './validation'");
    expect(index).not.toContain("from './hash'");
  });
});
