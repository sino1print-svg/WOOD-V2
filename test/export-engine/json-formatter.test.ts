import { describe, expect, it } from 'vitest';
import { formatReadableJson, hasUtf8Bom } from '../../src/export';
import {
  cloneFormatterInput,
  createFormatterFixture,
  createMultiSceneFormatterFixture,
} from './formatter-fixtures';
import { CANONICAL_EXPORT_TIME, CANONICAL_PROJECT, CANONICAL_SCOPES } from './fixtures';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected JSON array');
  return value;
}

describe('Readable JSON formatter', () => {
  it('returns valid two-space-indented JSON with a final LF', () => {
    const result = formatReadableJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => JSON.parse(result.value.text)).not.toThrow();
    expect(result.value.text).toContain('\n  "');
    expect(result.value.text.endsWith('\n')).toBe(true);
    expect(result.value.text.endsWith('\n\n')).toBe(false);
    expect(result.value.format).toBe('readable_json');
    expect(result.value.mediaType).toBe('application/json');
  });

  it('uses UTF-8 without a BOM or CR framing', () => {
    const result = formatReadableJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hasUtf8Bom(result.value.bytes)).toBe(false);
    expect(result.value.text).not.toContain('\r');
    expect(result.value.byteLength).toBe(result.value.bytes.byteLength);
  });

  it('preserves prompt values exactly after JSON.parse', () => {
    const prompt = '  العربية 🎨\r\nline\n\n```html\n<div>\u2028</div>\ntrailing  ';
    const result = formatReadableJson(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const outputsA = array(parsed.outputsA);
    expect(record(outputsA[0]).promptText).toBe(prompt);
  });

  it('keeps Arabic and emoji readable instead of Unicode-escaping them', () => {
    const prompt = 'برومبت عربي 🎨';
    const result = formatReadableJson(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain(prompt);
    expect(result.value.text).not.toContain('\\u0628');
  });

  it('preserves A/B linkage and display numbering as plain strings', () => {
    const result = formatReadableJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const outputA = record(array(parsed.outputsA)[0]);
    const outputB = record(array(parsed.outputsB)[0]);
    expect(outputA.label).toBe('1A');
    expect(outputB.label).toBe('1B');
    expect(outputB.sourceOutputAId).toBe(outputA.id);
    expect(typeof outputA.id).toBe('string');
  });

  it('serializes only allowlisted artwork metadata', () => {
    const result = formatReadableJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const artwork = record(array(parsed.artworkMetadata)[0]);
    expect(Object.keys(artwork).sort()).toEqual(
      [
        'aspectRatio',
        'contentHash',
        'dpi',
        'format',
        'hasTransparency',
        'heightPx',
        'id',
        'projectId',
        'uploadedAt',
        'widthPx',
      ].sort(),
    );
    expect(result.value.text).not.toContain('pngAssetRef');
    expect(result.value.text).not.toContain('fileName');
    expect(result.value.text).not.toContain('iVBORw0KGgo');
  });

  it('never exposes project ownerRef or raw version projectState', () => {
    const result = formatReadableJson(
      createFormatterFixture({ ownerRef: 'accessToken=do-not-export' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).not.toContain('ownerRef');
    expect(result.value.text).not.toContain('accessToken');
    expect(result.value.text).not.toContain('projectState');
  });

  it('uses explicit nulls for meaningful readable optional metadata', () => {
    const result = formatReadableJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const product = record(array(parsed.products)[0]);
    expect(product.productHash).toBeNull();
    const session = record(array(parsed.sessions)[0]);
    expect(record(session.colorSelection).paletteId).toBeNull();
  });

  it('produces dense arrays in canonical Batch 10.2 order', () => {
    const result = formatReadableJson(createMultiSceneFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const outputsA = array(parsed.outputsA);
    const outputsB = array(parsed.outputsB);
    expect(outputsA).toHaveLength(2);
    expect(outputsB).toHaveLength(2);
    expect(outputsA.map((item) => record(item).label)).toEqual(['1A', '2A']);
    expect(outputsB.map((item) => record(item).label)).toEqual(['1B', '2B']);
    expect(Object.keys(outputsA)).toEqual(['0', '1']);
  });

  it('includes partial omissions with safe structured messages', () => {
    const result = formatReadableJson(createFormatterFixture({ omitOutputB: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    expect(parsed.partial).toBe(true);
    const omission = record(array(parsed.omissions)[0]);
    expect(omission.code).toBe('EXPORT_SCOPE_002');
    expect(omission.severity).toBe('blocking');
    expect(omission.entityId).toBeTypeOf('string');
    expect(omission.location).toBeTypeOf('string');
    expect(omission.messageEn).toBe('Empty export scope.');
  });

  it('retains allowed persisted timestamps in the readable variant', () => {
    const result = formatReadableJson(createFormatterFixture({ scope: CANONICAL_SCOPES[9] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    expect(record(parsed.project).createdAt).toBe(CANONICAL_PROJECT.createdAt);
    expect(record(array(parsed.outputsA)[0]).generatedAt).toBe(CANONICAL_EXPORT_TIME);
  });

  it('returns a typed failure when maxJsonBytes is exceeded', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    const result = formatReadableJson({
      planResult: input.planResult,
      limits: { ...input.limits, maxJsonBytes: 128 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_STORAGE_001']);
    expect('value' in result).toBe(false);
  });
});
