import { describe, expect, it } from 'vitest';
import { composeOutputA, composeOutputB } from '../../src/engines/prompt-engine';
import { inputA, inputB } from './fixtures';

function rejected(value: unknown): void {
  const result = composeOutputA(value as ReturnType<typeof inputA>);
  expect(result.ok).toBe(false);
}

describe('Prompt Engine adversarial validation', () => {
  it('rejects unknown and missing top-level properties', () => {
    rejected({ ...inputA(), unexpected: true });
    const missing = { ...inputA() } as Record<string, unknown>;
    delete missing.scene;
    rejected(missing);
  });

  it('rejects sparse arrays, boxed primitives, symbols, accessors, cycles and custom prototypes', () => {
    const sparse = inputA() as unknown as Record<string, unknown>;
    sparse.selectedColorIds = new Array(2);
    rejected(sparse);
    rejected({ ...inputA(), outputNumber: new Number(1) });
    const symbol = inputA() as unknown as Record<PropertyKey, unknown>;
    symbol[Symbol('x')] = true;
    rejected(symbol);
    const accessor = { ...inputA() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'outputNumber', { enumerable: true, get: () => 1 });
    rejected(accessor);
    const cyclic = inputA() as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    rejected(cyclic);
    const proto = Object.create({ hostile: true }) as Record<string, unknown>;
    Object.assign(proto, inputA());
    rejected(proto);
  });

  it('rejects inherited required fields and malformed relationships', () => {
    const base = inputA();
    const product = Object.create({ id: base.product.id }) as Record<string, unknown>;
    Object.assign(product, base.product);
    delete product.id;
    rejected({ ...base, product });
    rejected({ ...base, scene: { ...base.scene, productId: 'other' } });
    rejected({ ...base, scene: { ...base.scene, paletteColorId: 'black' } });
    rejected({ ...base, scene: { ...base.scene, view: 'side' } });
  });

  it('returns structured source and PNG failures for Output B', () => {
    const noSource = composeOutputB({ ...inputB(), sourceImageAttached: false });
    expect(noSource.ok).toBe(false);
    if (!noSource.ok) expect(noSource.failures[0]?.code).toBe('PROMPT_SRC_001');
    const noPng = composeOutputB({ ...inputB(), artworkAttached: false });
    expect(noPng.ok).toBe(false);
    if (!noPng.ok) expect(noPng.failures[0]?.code).toBe('PROMPT_PNG_001');
  });
});
