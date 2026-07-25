import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { input, product, profile, scene } from './fixtures';

describe('Print Area prototype and own-property safety', () => {
  it('rejects a profile created with a custom prototype', () => {
    const p = Object.assign(Object.create({ inheritedUnknown: true }), profile());
    expect(
      measurePrintArea(input({ profile: p, product: product({ printAreaProfile: profile() }) })).ok,
    ).toBe(false);
  });

  it('rejects profiles whose required fields are inherited', () => {
    const inheritedAll = Object.create(profile());
    expect(measurePrintArea(input({ profile: inheritedAll })).ok).toBe(false);

    const base = profile();
    const own = { ...base } as Record<string, unknown>;
    delete own.minSizeRatio;
    const oneInherited = Object.assign(Object.create({ minSizeRatio: 0.5 }), own);
    expect(measurePrintArea(input({ profile: oneInherited as never })).ok).toBe(false);
  });

  it('rejects custom-prototype top-level input, product and observation', () => {
    const normal = input();
    const customInput = Object.assign(Object.create({}), normal);
    expect(measurePrintArea(customInput)).toEqual(expect.objectContaining({ ok: false }));

    const customProduct = Object.assign(Object.create({}), normal.product);
    expect(measurePrintArea(input({ product: customProduct }))).toEqual(
      expect.objectContaining({ ok: false }),
    );

    const customObservation = Object.assign(Object.create({}), normal.observation);
    expect(measurePrintArea(input({ observation: customObservation }))).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it('rejects class instances pretending to be profiles', () => {
    class PretendProfile {
      constructor() {
        Object.assign(this, profile());
      }
    }
    expect(measurePrintArea(input({ profile: new PretendProfile() as never })).ok).toBe(false);
  });

  it('rejects inherited accessors without executing them', () => {
    let calls = 0;
    const proto = Object.create(null);
    Object.defineProperty(proto, 'minSizeRatio', {
      enumerable: true,
      get() {
        calls += 1;
        return 0.5;
      },
    });
    const p = Object.create(proto) as Record<string, unknown>;
    for (const [key, value] of Object.entries(profile())) {
      if (key !== 'minSizeRatio') {
        Object.defineProperty(p, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    expect(measurePrintArea(input({ profile: p as never })).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('rejects a safely simulated enumerable Object.prototype pollution and restores it', () => {
    const key = '__phase4PollutionTest__';
    Object.defineProperty(Object.prototype, key, {
      value: true,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    try {
      expect(measurePrintArea(input()).ok).toBe(false);
    } finally {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
    expect(measurePrintArea(input()).ok).toBe(true);
  });

  it('rejects custom-prototype scene objects', () => {
    const customScene = Object.assign(Object.create({}), scene());
    expect(measurePrintArea(input({ scene: customScene }))).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });
});
