/**
 * Constraint Index — consumes `ResolvedConstraint[]` from the Rule Engine (RE §3) as an
 * opaque, already-correct authority. The Scene Engine never re-evaluates rules (§1.2);
 * it only asks, for a given dimension value, whether the Rule Engine forbade/locked/
 * required it. `ResolvedConstraint.target` is the Rule Engine's `|`-joined resolved
 * value set (engine.ts `resolvedBucketKey`); each token is indexed individually so a
 * per-value lookup is O(1) and never re-derives Rule Engine semantics.
 */
import type { ResolvedConstraint, RuleDomain } from '../../shared/domain-model';

export interface ConstraintIndex {
  readonly isForbidden: (value: string) => boolean;
  readonly isRequired: (value: string) => boolean;
  readonly lockedValues: (domain: RuleDomain) => ReadonlySet<string> | null;
  readonly limitFor: (value: string) => number | null;
  readonly requiredValues: () => readonly string[];
}

export function buildConstraintIndex(constraints: readonly ResolvedConstraint[]): ConstraintIndex {
  const forbidden = new Set<string>();
  const required = new Set<string>();
  const limitByValue = new Map<string, number>();
  const lockedByDomain = new Map<RuleDomain, Set<string>>();

  for (const constraint of constraints) {
    const tokens = constraint.target.split('|').filter((token) => token.length > 0);
    if (constraint.forbidden) {
      for (const token of tokens) forbidden.add(token);
      continue;
    }
    if (constraint.required) {
      for (const token of tokens) required.add(token);
    }
    if (constraint.lockedTo !== null) {
      const set = lockedByDomain.get(constraint.domain) ?? new Set<string>();
      for (const value of constraint.lockedTo) set.add(value);
      lockedByDomain.set(constraint.domain, set);
    }
    if (constraint.limit !== null) {
      for (const token of tokens) {
        const existing = limitByValue.get(token);
        limitByValue.set(
          token,
          existing === undefined ? constraint.limit : Math.min(existing, constraint.limit),
        );
      }
    }
  }

  return Object.freeze({
    isForbidden: (value: string) => forbidden.has(value),
    isRequired: (value: string) => required.has(value),
    lockedValues: (domain: RuleDomain) => lockedByDomain.get(domain) ?? null,
    limitFor: (value: string) => limitByValue.get(value) ?? null,
    requiredValues: () => [...required].sort(),
  });
}
