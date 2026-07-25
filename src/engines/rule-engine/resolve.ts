import type { EvaluationContext, ResolvedTarget, RuleTarget } from '../../shared/domain-model';
import { failureFromCode } from './failures';
import { resolveContextPath } from './context';
import type { ResolutionResult, RuleEngineSafetyLimits } from './types';

/**
 * CORRECTIVE #2 (Phase 2 corrective release): bucketing MUST key on the
 * resolved target value(s), never on the unresolved RuleTarget expression.
 * A `{kind:'literal', value:'black'}` target and a
 * `{kind:'contextRef', ref:'session.colorSelection.colorIds'}` target that
 * both resolve to `['black']` are the SAME logical target and must land in
 * the same conflict bucket. See docs/PHASE2_CORRECTIVE_AUDIT.md #2.
 *
 * Superseded by `resolvedBucketKey` in engine.ts, which keys on the
 * resolved value array instead of the source expression kind. Retained only
 * as a documented historical reference for the defect; the engine no longer
 * calls this function.
 */
export function targetBucketKey(target: RuleTarget): string {
  if (target.kind === 'literal') return `literal:${target.value}`;
  if (target.kind === 'symbolic') return `symbolic:${target.symbol}`;
  if (target.kind === 'dimension') return `dimension:${target.dimension}`;
  return `contextRef:${target.ref.ref}`;
}

export function resolveRuleTarget(
  target: RuleTarget,
  context: EvaluationContext,
  limits: RuleEngineSafetyLimits,
): ResolutionResult<ResolvedTarget> {
  if (target.kind === 'literal')
    return { ok: true, value: { source: target, resolved: [target.value] } };
  if (target.kind === 'symbolic')
    return { ok: true, value: { source: target, resolved: [target.symbol] } };
  if (target.kind === 'dimension') {
    return { ok: true, value: { source: target, resolved: [target.dimension] } };
  }
  const resolution = resolveContextPath(context, target.ref.ref, limits);
  if (!resolution.ok) return resolution;
  if (!resolution.value.present) {
    return { ok: false, failure: failureFromCode('RULE_CFG_002', target.ref.ref, null) };
  }
  const value = resolution.value.value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return { ok: true, value: { source: target, resolved: [...value].sort() } };
  }
  if (typeof value === 'string') {
    return { ok: true, value: { source: target, resolved: [value] } };
  }
  return { ok: false, failure: failureFromCode('RULE_CFG_002', target.ref.ref, null) };
}
