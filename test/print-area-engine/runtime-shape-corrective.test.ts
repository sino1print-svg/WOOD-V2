import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { PrintAreaObstruction } from '../../src/shared/domain-model';
import { input, profile } from './fixtures';

describe('Print-Area Phase 4 corrective runtime validation', () => {
  it.each(['yes', 1, 0, null, undefined, {}, []])(
    'rejects malformed centered value: %p',
    (centered) => {
      const malformed = profile() as unknown as Record<string, unknown>;
      malformed.centered = centered;
      const result = measurePrintArea(input({ profile: malformed as never }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures[0]?.code).toBe('PA_INTERNAL_PROFILE');
        expect(result.failures[0]?.field).toBe('profile.centered');
      }
    },
  );

  it.each([
    [['not-an-obstruction']],
    [[undefined]],
    [[null]],
    [[1]],
    [[{}]],
    [[PrintAreaObstruction.Hands, 'invalid']],
  ] as const)('rejects malformed forbiddenOverlaps elements: %p', (forbiddenOverlaps) => {
    const malformed = profile({ forbiddenOverlaps: forbiddenOverlaps as never });
    const result = measurePrintArea(input({ profile: malformed }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures[0]?.code).toBe('PA_INTERNAL_PROFILE');
      expect(result.failures[0]?.field).toBe('profile.forbiddenOverlaps');
    }
  });

  it('rejects sparse forbiddenOverlaps arrays', () => {
    const forbiddenOverlaps = new Array(2) as PrintAreaObstruction[];
    forbiddenOverlaps[1] = PrintAreaObstruction.Hands;
    const result = measurePrintArea(input({ profile: profile({ forbiddenOverlaps }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.field).toBe('input');
  });

  it('rejects invalid profile position enums', () => {
    const result = measurePrintArea(
      input({ profile: profile({ position: 'side_chest' as never }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_POSITION');
  });

  it('rejects invalid requested-position enums even when cast at runtime', () => {
    const result = measurePrintArea(input({ requestedPosition: 'side_chest' as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.field).toBe('requestedPosition');
  });

  it('accepts every authoritative obstruction enum in forbiddenOverlaps', () => {
    const forbiddenOverlaps = Object.values(PrintAreaObstruction);
    const result = measurePrintArea(input({ profile: profile({ forbiddenOverlaps }) }));
    expect(result.ok).toBe(true);
  });

  it('rejects accessor-based hostile objects without invoking the getter', () => {
    let invoked = false;
    const malformed = input() as unknown as Record<string, unknown>;
    Object.defineProperty(malformed, 'profile', {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error('hostile getter');
      },
    });

    const result = measurePrintArea(malformed as never);
    expect(invoked).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('rejects symbol-keyed hostile input', () => {
    const malformed = input() as unknown as Record<PropertyKey, unknown>;
    malformed[Symbol('hidden')] = 'hostile';
    const result = measurePrintArea(malformed as never);
    expect(result.ok).toBe(false);
  });

  it('public API returns structured failure and never throws for malformed runtime input', () => {
    const malformedInputs: unknown[] = [null, undefined, 1, 'input', [], Object.create(null)];
    for (const malformed of malformedInputs) {
      expect(() => measurePrintArea(malformed as never)).not.toThrow();
      expect(measurePrintArea(malformed as never).ok).toBe(false);
    }
  });
});
