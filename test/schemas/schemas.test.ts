/**
 * Schema catalog structural check (deterministic).
 * The domain schema bundle must parse and declare a $def for every required
 * persisted entity (03_DATA_MODELS_FINAL), and must NOT declare runtime-only types.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = JSON.parse(
  readFileSync(path.join(ROOT, 'schemas', 'domain.schema.json'), 'utf8'),
) as {
  $defs: Record<string, unknown>;
};

const REQUIRED_DEFS = [
  'Project',
  'PhotoshootSession',
  'Product',
  'Season',
  'Scene',
  'OutputA',
  'OutputB',
  'Artwork',
  'MainCover',
  'CoverMetadata',
  'Group',
  'Color',
  'Palette',
  'ColorSelection',
  'ValidationResult',
  'ValidationFailure',
  'VersionSnapshot',
  'RetentionPolicy',
  'PromptMetadata',
  'SessionFingerprint',
  'Rule',
  'RuleSet',
  'PromptModule',
  'ExportManifest',
];

describe('domain schema bundle', () => {
  it('declares $schema, $id and title', () => {
    const b = bundle as unknown as Record<string, unknown>;
    expect(typeof b['$schema']).toBe('string');
    expect(typeof b['$id']).toBe('string');
    expect(typeof b['title']).toBe('string');
  });

  it('provides a $def for every required persisted entity', () => {
    const missing = REQUIRED_DEFS.filter((d) => !(d in bundle.$defs));
    expect(missing).toEqual([]);
  });

  it('does NOT declare runtime-only EvaluationContext / Resolved* $defs', () => {
    for (const banned of [
      'EvaluationContext',
      'ResolvedRule',
      'ResolvedCondition',
      'ResolvedTarget',
      'ResolvedEffect',
    ]) {
      expect(banned in bundle.$defs).toBe(false);
    }
  });
});
