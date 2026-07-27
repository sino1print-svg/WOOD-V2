import { describe, expect, it } from 'vitest';
import {
  encodeCanonicalJson,
  formatCanonicalJson,
  formatReadableJson,
  hasUtf8Bom,
} from '../../src/export';
import type { ExportEngineInput } from '../../src/shared/contracts';
import {
  createFormatterFixture,
  createMultiSceneFormatterFixture,
  formatterInputFromEngine,
} from './formatter-fixtures';
import { createCanonicalMultiSceneExportInput } from './fixtures';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object');
  }
  return value as Record<string, unknown>;
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = a[index] ?? 0;
    const rightByte = b[index] ?? 0;
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return a.length - b.length;
}

describe('Canonical JSON formatter', () => {
  it('emits valid minified JSON without trailing whitespace', () => {
    const result = formatCanonicalJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => JSON.parse(result.value.text)).not.toThrow();
    expect(result.value.text.startsWith('{')).toBe(true);
    expect(result.value.text.endsWith('}')).toBe(true);
    expect(result.value.text.endsWith('\n')).toBe(false);
    expect(result.value.text).not.toContain('\n  ');
    expect(result.value.format).toBe('canonical_json');
  });

  it('sorts top-level keys by UTF-8 byte order', () => {
    const result = formatCanonicalJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort(compareUtf8));
  });

  it('sorts keys recursively while retaining array order', () => {
    const result = formatCanonicalJson(createMultiSceneFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const scope = record(parsed.scope);
    expect(Object.keys(scope)).toEqual([...Object.keys(scope)].sort(compareUtf8));
    const outputsA = parsed.outputsA;
    expect(Array.isArray(outputsA)).toBe(true);
    if (!Array.isArray(outputsA)) return;
    expect(outputsA.map((item) => record(item).label)).toEqual(['1A', '2A']);
  });

  it('excludes volatile persisted timestamps from canonical content', () => {
    const result = formatCanonicalJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const field of [
      '"createdAt"',
      '"updatedAt"',
      '"generatedAt"',
      '"uploadedAt"',
      '"evaluatedAt"',
      '"timestamp"',
      '"exportedAt"',
    ]) {
      expect(result.value.text).not.toContain(field);
    }
  });

  it('omits absent optional fields instead of serializing null', () => {
    const result = formatCanonicalJson(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const products = parsed.products;
    expect(Array.isArray(products)).toBe(true);
    if (!Array.isArray(products)) return;
    expect(record(products[0])).not.toHaveProperty('productHash');
    const sessions = parsed.sessions;
    expect(Array.isArray(sessions)).toBe(true);
    if (!Array.isArray(sessions)) return;
    expect(record(record(sessions[0]).colorSelection)).not.toHaveProperty('paletteId');
  });

  it('preserves JSON prompt round-trip in the canonical variant', () => {
    const prompt = '  e\u0301 العربية 🎨\r\n``` \n\n trailing  ';
    const result = formatCanonicalJson(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = record(JSON.parse(result.value.text) as unknown);
    const outputsA = parsed.outputsA;
    expect(Array.isArray(outputsA)).toBe(true);
    if (!Array.isArray(outputsA)) return;
    expect(record(outputsA[0]).promptText).toBe(prompt);
  });

  it('is independent of caller-supplied export time', () => {
    const firstEngineInput = createCanonicalMultiSceneExportInput();
    const secondEngineInput: ExportEngineInput = {
      ...createCanonicalMultiSceneExportInput(),
      createdAt: '2026-07-26T23:59:59.000Z' as ExportEngineInput['createdAt'],
    };
    const first = formatCanonicalJson(formatterInputFromEngine(firstEngineInput));
    const second = formatCanonicalJson(formatterInputFromEngine(secondEngineInput));
    expect(first).toEqual(second);
  });

  it('is independent of plan object key insertion order', () => {
    const input = createFormatterFixture();
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const plan = input.planResult.value;
    const reordered = {
      ok: true,
      value: {
        partial: plan.partial,
        issues: plan.issues,
        omissions: plan.omissions,
        provenance: plan.provenance,
        selection: plan.selection,
        groupNumbering: plan.groupNumbering,
        numbering: plan.numbering,
        scope: plan.scope,
      },
    } as const;
    expect(formatCanonicalJson(input)).toEqual(
      formatCanonicalJson({ planResult: reordered, limits: input.limits }),
    );
  });

  it('produces exactly the same bytes from frozen and cloned inputs', () => {
    const original = createFormatterFixture();
    const clone = structuredClone(original);
    const first = formatCanonicalJson(original);
    const second = formatCanonicalJson(clone);
    expect(first).toEqual(second);
  });

  it('keeps the byte-oriented alias identical to the formatter', () => {
    const input = createFormatterFixture();
    expect(encodeCanonicalJson(input)).toEqual(formatCanonicalJson(input));
  });

  it('uses UTF-8 without BOM', () => {
    const result = formatCanonicalJson(createFormatterFixture({ promptA: 'العربية 🎨' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hasUtf8Bom(result.value.bytes)).toBe(false);
    expect(result.value.byteLength).toBe(result.value.bytes.byteLength);
  });

  it('differs from readable bytes only according to the declared JSON policy', () => {
    const input = createFormatterFixture();
    const readable = formatReadableJson(input);
    const canonical = formatCanonicalJson(input);
    expect(readable.ok).toBe(true);
    expect(canonical.ok).toBe(true);
    if (!readable.ok || !canonical.ok) return;
    const readableParsed = record(JSON.parse(readable.value.text) as unknown);
    const canonicalParsed = record(JSON.parse(canonical.value.text) as unknown);
    expect(canonicalParsed.scope).toEqual(readableParsed.scope);
    expect(canonicalParsed.outputsA).toEqual(
      (readableParsed.outputsA as unknown[]).map((item) => {
        const output = { ...record(item) };
        delete output.generatedAt;
        return output;
      }),
    );
  });

  it('is byte-identical over consecutive runs', () => {
    const input = createFormatterFixture({ promptA: 'stable' });
    const first = formatCanonicalJson(input);
    const second = formatCanonicalJson(input);
    expect(first).toEqual(second);
  });
});
