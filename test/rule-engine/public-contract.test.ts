import { describe, expect, it } from 'vitest';
import type { IsoTimestamp } from '../../src/shared/domain-model';
import { evaluateRules, ruleEngine, stableJson } from '../../src/engines/rule-engine';
import { context, FIXED_EVALUATED_AT, input, rule, ruleSet } from './fixtures';

describe('public RuleEngineContract evaluatedAt contract', () => {
  it('requires the caller-supplied evaluatedAt parameter and echoes it exactly', () => {
    const r = rule();
    const result = ruleEngine.evaluate(context(), [ruleSet([r])], [r], FIXED_EVALUATED_AT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trace.evaluatedAt).toBe(FIXED_EVALUATED_AT);
  });

  it('rejects malformed timestamps during pre-flight', () => {
    const data = input([rule()]);
    const result = evaluateRules({
      ...data,
      evaluatedAt: '2026-99-99T25:61:61.000Z' as IsoTimestamp,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.some((failure) => failure.field === 'evaluatedAt')).toBe(true);
  });

  it('threads the exact timestamp into every deterministic trace result', () => {
    const data = input([rule()]);
    const first = evaluateRules(data);
    const second = evaluateRules(data);
    expect(stableJson(first)).toBe(stableJson(second));
    if (first.ok) expect(first.value.trace.evaluatedAt).toBe(data.evaluatedAt);
  });

  it('cannot be called without evaluatedAt at compile time', () => {
    const r = rule();
    // @ts-expect-error The authoritative public contract requires evaluatedAt.
    ruleEngine.evaluate(context(), [ruleSet([r])], [r]);
  });
});
