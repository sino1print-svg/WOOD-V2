import { describe, expect, it } from 'vitest';
import { composeCover, type CoverEngineInput } from '../../src/engines/cover-engine';
import { coverInput } from './fixtures';

function expectClosed(value: unknown, code = 'COVER_META_001'): void {
  expect(() => composeCover(value as CoverEngineInput)).not.toThrow();
  const result = composeCover(value as CoverEngineInput);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ code, severity: 'blocking', originEngine: 'cover' });
  }
}

describe('Cover Engine hostile runtime boundary', () => {
  it.each([null, undefined, true, 1, 'input', Symbol('input'), 1n])(
    'fails closed for primitive root %s',
    (value) => expectClosed(value),
  );

  it('does not execute an accessor-backed root property', () => {
    const input = coverInput() as unknown as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(input, 'metadata', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return coverInput().metadata;
      },
    });
    expectClosed(input);
    expect(reads).toBe(0);
  });

  it('does not execute an accessor-backed nested Output A field', () => {
    const input = coverInput();
    const output = { ...input.saleImages[0]!.output } as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(output, 'id', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 'hostile-a';
      },
    });
    const hostile = {
      ...input,
      saleImages: [{ ...input.saleImages[0]!, output }, ...input.saleImages.slice(1)],
    };
    expectClosed(hostile);
    expect(reads).toBe(0);
  });

  it('fails closed for a root Proxy reflection trap', () => {
    const hostile = new Proxy(coverInput(), {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
    });
    expectClosed(hostile);
  });

  it('rejects a transparent-looking Proxy before reading through it', () => {
    let reads = 0;
    const proxy = new Proxy(coverInput(), {
      get(target, property, receiver) {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expectClosed(proxy);
    expect(reads).toBe(0);
  });

  it('fails closed for a nested Proxy descriptor trap', () => {
    const base = coverInput();
    const hostileOutput = new Proxy(base.saleImages[0]!.output, {
      getOwnPropertyDescriptor() {
        throw new Error('hostile descriptor');
      },
    });
    expectClosed({
      ...base,
      saleImages: [{ ...base.saleImages[0]!, output: hostileOutput }, ...base.saleImages.slice(1)],
    });
  });

  it('rejects a symbol-keyed root field', () => {
    const base = coverInput() as CoverEngineInput & Record<symbol, unknown>;
    base[Symbol('hidden')] = 'hidden';
    expectClosed(base);
  });

  it('rejects a symbol-keyed nested field', () => {
    const base = coverInput();
    const metadata = base.metadata as typeof base.metadata & Record<symbol, unknown>;
    metadata[Symbol('hidden')] = 'hidden';
    expectClosed(base);
  });

  it('rejects a sparse source array', () => {
    const base = coverInput();
    const sparse = new Array(4) as CoverEngineInput['saleImages'][number][];
    sparse[0] = base.saleImages[0]!;
    sparse[3] = base.saleImages[3]!;
    expectClosed({ ...base, saleImages: sparse });
  });

  it('rejects a source array with a custom property', () => {
    const base = coverInput();
    const saleImages = [...base.saleImages] as CoverEngineInput['saleImages'] & {
      extra?: string;
    };
    saleImages.extra = 'hidden';
    expectClosed({ ...base, saleImages });
  });

  it('rejects non-enumerable hidden data', () => {
    const input = coverInput() as CoverEngineInput & { hidden?: string };
    Object.defineProperty(input, 'hidden', { value: 'secret', enumerable: false });
    expectClosed(input);
  });

  it('rejects a cyclic runtime graph', () => {
    const input = coverInput() as CoverEngineInput & { cycle?: unknown };
    input.cycle = input;
    expectClosed(input);
  });

  it('rejects a non-ordinary object prototype', () => {
    const input = Object.assign(Object.create(null), coverInput()) as CoverEngineInput;
    expectClosed(input);
  });

  it('rejects inherited runtime fields', () => {
    const input = Object.create({ inherited: true }) as CoverEngineInput;
    Object.assign(input, coverInput());
    expectClosed(input);
  });

  it('rejects an over-limit source collection without hanging', () => {
    const base = coverInput();
    const repeated = Array.from({ length: 1_001 }, () => base.saleImages[0]!);
    expectClosed({ ...base, saleImages: repeated });
  });

  it('rejects a Promise masquerading as metadata and consumes no asynchronous path', () => {
    const base = coverInput();
    expectClosed({ ...base, metadata: Promise.resolve(base.metadata) });
  });

  it('does not execute a hostile accessor inside cachedCover', () => {
    const base = coverInput();
    const first = composeCover(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cache = { ...first.value } as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(cache, 'promptText', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return first.value.promptText;
      },
    });
    expectClosed({ ...base, cachedCover: cache });
    expect(reads).toBe(0);
  });

  it('rejects a hostile array-index getter without invoking it', () => {
    const base = coverInput();
    const saleImages = [...base.saleImages];
    let reads = 0;
    Object.defineProperty(saleImages, '0', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return base.saleImages[0];
      },
    });
    expectClosed({ ...base, saleImages });
    expect(reads).toBe(0);
  });

  it('rejects an unknown root key', () => {
    expectClosed({ ...coverInput(), phase8: true });
  });

  it('rejects dangerous prototype-pollution structure', () => {
    const base = coverInput();
    const hostile = { ...base } as Record<string, unknown>;
    Object.defineProperty(hostile, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });
    expectClosed(hostile);
  });
});
