import { RuleDomain, type ResolvedConstraint } from '../../src/shared/domain-model';
import { describe, expect, it } from 'vitest';
import { composeOutputA } from '../../src/engines/prompt-engine';
import { inputA } from './fixtures';

function validConstraint(): ResolvedConstraint {
  return {
    bucketKey: 'print-area',
    domain: RuleDomain.PrintArea,
    target: 'print.area',
    forbidden: false,
    lockedTo: ['center'],
    limit: 1,
    required: true,
    winningRuleIds: ['rule-1' as ResolvedConstraint['winningRuleIds'][number]],
  };
}

describe('Prompt Engine corrective — ResolvedConstraint runtime validation', () => {
  it.each([1, 'x', true, null, undefined, [], {}, new String('x')])(
    'rejects malformed element %#',
    (item) => {
      expect(composeOutputA({ ...inputA(), constraints: [item] as never }).ok).toBe(false);
    },
  );

  it.each([
    { ...validConstraint(), unexpected: true },
    { ...validConstraint(), domain: 'bad' },
    { ...validConstraint(), forbidden: 'false' },
    { ...validConstraint(), lockedTo: [1] },
    { ...validConstraint(), limit: -1 },
    { ...validConstraint(), winningRuleIds: [1] },
  ])('rejects malformed record %#', (item) => {
    expect(composeOutputA({ ...inputA(), constraints: [item] as never }).ok).toBe(false);
  });

  it('rejects duplicate bucket keys and sparse arrays', () => {
    expect(
      composeOutputA({ ...inputA(), constraints: [validConstraint(), validConstraint()] }).ok,
    ).toBe(false);
    const sparse = new Array(2);
    sparse[1] = validConstraint();
    expect(composeOutputA({ ...inputA(), constraints: sparse as never }).ok).toBe(false);
  });

  it('accepts a frozen valid constraint without mutation', () => {
    const constraint = Object.freeze(validConstraint());
    const before = structuredClone(constraint);
    expect(composeOutputA({ ...inputA(), constraints: Object.freeze([constraint]) }).ok).toBe(true);
    expect(constraint).toEqual(before);
  });
});
