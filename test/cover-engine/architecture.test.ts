import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeCover } from '../../src/engines/cover-engine';
import type { CoverEngineContract } from '../../src/shared/contracts';

const directory = path.resolve('src/engines/cover-engine');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const source = files.map((name) => readFileSync(path.join(directory, name), 'utf8')).join('\n');

describe('Cover Engine architecture boundaries', () => {
  it('implements the shared Cover Engine contract', () => {
    const contract: CoverEngineContract = { compose: composeCover };
    expect(contract.compose).toBe(composeCover);
  });

  it('imports no engine implementation', () => {
    for (const engine of [
      'rule-engine',
      'palette-engine',
      'print-area-engine',
      'dedup-engine',
      'scene-engine',
      'validation-engine',
      'prompt-engine',
      'export-engine',
    ]) {
      expect(source).not.toContain(engine);
    }
  });

  it('imports no UI, persistence, application, or infrastructure layer', () => {
    for (const token of [
      "from '../../ui",
      "from '../../persistence",
      "from '../../app",
      'marketplace',
      'clipboard',
      'localStorage',
    ]) {
      expect(source).not.toContain(token);
    }
  });

  it('uses no randomness, wall clock, network, filesystem, or environment access', () => {
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
      'setTimeout(',
      'setInterval(',
    ]) {
      expect(source).not.toContain(token);
    }
  });

  it('contains no Phase 8 work, placeholders, TODOs, or feature flags', () => {
    for (const token of ['Phase 8', 'PHASE8', 'TODO', 'FIXME', 'placeholder', 'featureFlag']) {
      expect(source).not.toContain(token);
    }
  });

  it('exports only the validated public compose function and public types', () => {
    const index = readFileSync(path.join(directory, 'index.ts'), 'utf8');
    expect(index).toContain("export { composeCover } from './engine'");
    expect(index).not.toContain("from './validation'");
    expect(index).not.toContain("from './runtime'");
    expect(index).not.toContain("from './hash'");
    expect(index).not.toContain("from './layout'");
  });
});
