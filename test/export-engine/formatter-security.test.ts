import { describe, expect, it } from 'vitest';
import {
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
  type ExportFormatResult,
  type ExportFormatterInput,
} from '../../src/export';
import { cloneFormatterInput, createFormatterFixture } from './formatter-fixtures';

const FORMATTERS: readonly ((input: ExportFormatterInput) => ExportFormatResult)[] = [
  formatTxt,
  formatMarkdown,
  formatReadableJson,
  formatCanonicalJson,
];

function expectCorrupt(input: ExportFormatterInput): void {
  for (const formatter of FORMATTERS) {
    const result = formatter(input);
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_CORRUPT_001']);
    expect('value' in result).toBe(false);
  }
}

function successfulTexts(input: ExportFormatterInput): string[] {
  return FORMATTERS.map((formatter) => formatter(input)).flatMap((result) =>
    result.ok ? [result.value.text] : [],
  );
}

describe('Formatter hostile-input and leakage protection', () => {
  it('rejects a malicious toJSON hook without invoking it', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    let calls = 0;
    Object.defineProperty(input.planResult.value, 'toJSON', {
      enumerable: true,
      value: () => {
        calls += 1;
        return { apiKey: 'leaked' };
      },
    });
    expectCorrupt(input);
    expect(calls).toBe(0);
  });

  it('rejects a throwing getter without executing it', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    let calls = 0;
    Object.defineProperty(input.planResult.value, 'leak', {
      enumerable: true,
      get: () => {
        calls += 1;
        throw new Error('getter must not execute');
      },
    });
    expectCorrupt(input);
    expect(calls).toBe(0);
  });

  it('rejects a getter that would return a secret without executing it', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    let calls = 0;
    const product = input.planResult.value.selection.products[0];
    expect(product).toBeDefined();
    if (!product) return;
    Object.defineProperty(product, 'apiKey', {
      enumerable: true,
      get: () => {
        calls += 1;
        return 'do-not-leak';
      },
    });
    expectCorrupt(input);
    expect(calls).toBe(0);
  });

  it('rejects polluted object prototypes', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    Object.setPrototypeOf(input.planResult.value, { polluted: true });
    expectCorrupt(input);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects circular references', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    Object.defineProperty(input.planResult.value, 'cycle', {
      enumerable: true,
      value: input.planResult.value,
    });
    expectCorrupt(input);
  });

  it('rejects excessive nesting before projection', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 70; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    Object.defineProperty(input.planResult.value, 'extension', {
      enumerable: true,
      value: root,
    });
    expectCorrupt(input);
  });

  it('rejects sparse arrays', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const sparse = new Array(2);
    sparse[0] = input.planResult.value.selection.outputsA[0];
    Object.defineProperty(input.planResult.value.selection, 'outputsA', {
      enumerable: true,
      configurable: true,
      value: sparse,
    });
    expectCorrupt(input);
  });

  it('rejects NaN, Infinity, negative zero, BigInt, symbols, and functions', () => {
    const hostileValues: readonly unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      BigInt(1),
      Symbol('hostile'),
      () => 'hostile',
    ];
    for (const value of hostileValues) {
      const input = cloneFormatterInput(createFormatterFixture());
      expect(input.planResult.ok).toBe(true);
      if (!input.planResult.ok) continue;
      Object.defineProperty(input.planResult.value, 'hostileValue', {
        enumerable: true,
        value,
      });
      expectCorrupt(input);
    }
  });

  it('rejects forbidden secret-bearing metadata keys', () => {
    for (const key of ['apiKey', 'accessToken', 'refreshToken', 'password', 'credential']) {
      const input = cloneFormatterInput(createFormatterFixture());
      expect(input.planResult.ok).toBe(true);
      if (!input.planResult.ok) continue;
      Object.defineProperty(input.planResult.value, key, {
        enumerable: true,
        value: 'must-not-leak',
      });
      expectCorrupt(input);
    }
  });

  it('rejects path-like data in non-prompt metadata', () => {
    const input = createFormatterFixture();
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok || input.planResult.value.selection.project === null) return;
    const clone = cloneFormatterInput(input);
    if (!clone.planResult.ok || clone.planResult.value.selection.project === null) return;
    Object.defineProperty(clone.planResult.value.selection.project, 'name', {
      enumerable: true,
      configurable: true,
      value: 'C:\\Users\\owner\\secret.txt',
    });
    expectCorrupt(clone);
  });

  it('preserves forbidden-looking words and paths when they are legitimate prompt text', () => {
    const prompt =
      'Keep literal words: secret apiKey accessToken process.env file:///home/user node_modules blob:';
    const input = createFormatterFixture({ promptA: prompt });
    const texts = successfulTexts(input);
    expect(texts).toHaveLength(FORMATTERS.length);
    for (const text of texts) expect(text).toContain(prompt);
  });

  it('fails closed on extra runtime metadata instead of serializing it', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    Object.defineProperty(input.planResult.value, 'diagnosticLabel', {
      enumerable: true,
      value: 'INTERNAL-DIAGNOSTIC-MUST-NOT-LEAK',
    });
    expectCorrupt(input);
  });

  it('fails closed on extra nested metadata even when the key is not secret-bearing', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const product = input.planResult.value.selection.products[0];
    expect(product).toBeDefined();
    if (!product) return;
    Object.defineProperty(product, 'diagnosticLabel', {
      enumerable: true,
      value: 'NESTED-RUNTIME-DIAGNOSTIC',
    });
    expectCorrupt(input);
  });

  it('fails closed on a wrong primitive type in an allowlisted field', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const product = input.planResult.value.selection.products[0];
    expect(product).toBeDefined();
    if (!product) return;
    Object.defineProperty(product, 'name', {
      enumerable: true,
      configurable: true,
      value: 17,
    });
    expectCorrupt(input);
  });

  it('rejects a blocked plan with an empty failure list as corrupt', () => {
    const fixture = createFormatterFixture();
    const input: ExportFormatterInput = {
      planResult: { ok: false, failures: [] },
      limits: fixture.limits,
    };
    expectCorrupt(input);
  });

  it('excludes all known non-allowlisted persistence and runtime fields', () => {
    const texts = successfulTexts(
      createFormatterFixture({ ownerRef: 'credential=runtime-owner-secret' }),
    );
    expect(texts).toHaveLength(FORMATTERS.length);
    for (const text of texts) {
      for (const forbidden of [
        'ownerRef',
        'pngAssetRef',
        'projectState',
        'EvaluationContext',
        'ResolvedConstraint',
        'credential=runtime-owner-secret',
        'iVBORw0KGgo',
        'blob:',
        'file://',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it('converts a throwing Proxy boundary into a typed failure', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    const proxy = new Proxy(input.planResult, {
      getPrototypeOf: () => {
        throw new Error('reflection denied');
      },
    });
    Object.defineProperty(input, 'planResult', {
      enumerable: true,
      configurable: true,
      value: proxy,
    });
    expectCorrupt(input);
  });
});
