import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { PrintAreaObstruction } from '../../src/shared/domain-model';
import { input, profile, product, scene } from './fixtures';

describe('Print-Area Engine contract and resolution', () => {
  it('resolves the product-owned profile and normalizes measurements', () => {
    const result = measurePrintArea(
      input({
        observation: {
          overlaps: [
            PrintAreaObstruction.Shadows,
            PrintAreaObstruction.Hands,
            PrintAreaObstruction.Hands,
          ],
          sizeRatio: 0.5,
          centeringOffset: 0.02,
          shadowCoverage: 0.03,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.position).toBe('center_chest');
      expect(result.value.measurement.overlaps).toEqual(['hands', 'shadows']);
      expect(result.value.measurement.sizeRatio).toBe(0.5);
    }
  });

  it('rejects an unknown/mismatched product instead of substituting a default', () => {
    const result = measurePrintArea(
      input({ scene: scene({ productId: 'unknown-product' as never }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_PRODUCT');
  });

  it('rejects a profile not owned by the product', () => {
    const other = profile({ id: 'other-profile' as never });
    const result = measurePrintArea(input({ profile: other, product: product() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_PROFILE');
  });

  it('rejects a requested position unsupported by the product profile', () => {
    const result = measurePrintArea(input({ requestedPosition: 'center_back' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_POSITION');
  });

  it('keeps front and back profiles distinct', () => {
    const back = profile({ position: 'center_back' });
    const result = measurePrintArea(
      input({
        profile: back,
        product: product({ printAreaProfile: back }),
        scene: scene({ printAreaRulesRef: back.id }),
        requestedPosition: 'center_back',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.position).toBe('center_back');
  });
});
