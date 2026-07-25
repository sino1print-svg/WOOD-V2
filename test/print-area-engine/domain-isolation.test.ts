import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { RuleDomain, type ResolvedConstraint } from '../../src/shared/domain-model';
import { input } from './fixtures';

function constraint(domain: RuleDomain, target: string): ResolvedConstraint {
  return {
    bucketKey: `${domain}:${target}`,
    domain,
    target,
    forbidden: true,
    lockedTo: null,
    limit: null,
    required: false,
    winningRuleIds: ['rule-x' as never],
  };
}

describe('Print-Area domain isolation', () => {
  it.each([RuleDomain.Palette, RuleDomain.GarmentColor, RuleDomain.Composition])(
    'does not let %s constraints alter measurements',
    (domain) => {
      const base = measurePrintArea(input());
      const withConstraint = measurePrintArea(
        input({ constraints: [constraint(domain, 'anything')] }),
      );
      expect(base.ok && withConstraint.ok).toBe(true);
      if (base.ok && withConstraint.ok) {
        expect(withConstraint.value.measurement).toEqual(base.value.measurement);
        expect(withConstraint.value.position).toBe(base.value.position);
      }
    },
  );

  it('does not rerun even PrintArea Rule constraints', () => {
    const result = measurePrintArea(
      input({ constraints: [constraint(RuleDomain.PrintArea, 'print_area_too_small')] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.measurement.sizeRatio).toBe(0.5);
  });

  it('human-readable text cannot affect behavior because raw rules are not accepted', () => {
    const polluted = input() as unknown as Record<string, unknown>;
    polluted.description = 'RULE_PA_006 front safe area crop resize';
    const result = measurePrintArea(polluted as never);
    expect(result.ok).toBe(true);
  });
});
