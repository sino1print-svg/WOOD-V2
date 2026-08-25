// Deterministic Security Broker.
// This module contains no probabilistic reasoning of any kind. It is a pure
// function of (cycle contract, tool descriptor, requested call, budget state).
// Review §7: a model may propose; only this module authorizes.
import { RISK_ORDER } from './cycle.mjs';

export const DENY = 'DENY';
export const ALLOW = 'ALLOW';
export const NEEDS_APPROVAL = 'NEEDS_APPROVAL';

/**
 * Capabilities that mutate state or reach outside the process. A cycle marked
 * read_only may never use them regardless of its allowlist.
 */
const MUTATING_CAPABILITIES = new Set([
  'write',
  'external_fetch',
  'filesystem_write',
  'db_write',
  'memory_write',
  'network_send',
  'deploy',
  'publish',
  'delete',
  'purchase',
]);

/**
 * Authorize a single tool call. Deny-by-default: every path that is not an
 * explicit allow returns DENY with a machine-readable reason.
 */
export function authorize({ contract, tool, call, budgetState, approvals = [] }) {
  const base = { tool_id: call?.tool_id ?? null, cycle_id: contract.cycle_id };

  if (!call || typeof call.tool_id !== 'string' || !call.tool_id) {
    return { ...base, decision: DENY, reason: 'MALFORMED_CALL' };
  }
  // Unknown tool: the registry did not resolve it. Never fall through to an
  // adapter on an unresolved name.
  if (!tool) return { ...base, decision: DENY, reason: 'UNKNOWN_TOOL' };
  if (tool.tool_id !== call.tool_id)
    return { ...base, decision: DENY, reason: 'TOOL_IDENTITY_MISMATCH' };

  if (!contract.allowed_tools.includes(call.tool_id)) {
    return { ...base, decision: DENY, reason: 'TOOL_NOT_IN_ALLOWLIST' };
  }

  const missingScopes = (tool.required_scopes || []).filter(
    (s) => !contract.granted_scopes.includes(s),
  );
  if (missingScopes.length) {
    return {
      ...base,
      decision: DENY,
      reason: 'SCOPE_NOT_GRANTED',
      details: { missing: missingScopes },
    };
  }

  if (contract.read_only && MUTATING_CAPABILITIES.has(tool.capability)) {
    return { ...base, decision: DENY, reason: 'READ_ONLY_CYCLE' };
  }

  const risk = tool.risk_class ?? 'CRITICAL';
  if (!(risk in RISK_ORDER)) return { ...base, decision: DENY, reason: 'UNKNOWN_RISK_CLASS' };
  if (RISK_ORDER[risk] > RISK_ORDER[contract.risk_ceiling]) {
    return {
      ...base,
      decision: DENY,
      reason: 'RISK_CEILING_EXCEEDED',
      details: { risk, ceiling: contract.risk_ceiling },
    };
  }

  // Budget is part of authorization, not a soft advisory: an exhausted budget
  // is a hard deny (review §14, Forced Convergence).
  const budgetDenial = checkBudget(contract, budgetState);
  if (budgetDenial) return { ...base, decision: DENY, reason: budgetDenial };

  // Approval classes. A deterministic policy may not self-authorize a call at
  // or above the approval threshold; it needs a recorded human token.
  if (RISK_ORDER[risk] >= RISK_ORDER[contract.approval_required_at_or_above]) {
    const token = approvals.find(
      (a) => a.tool_id === call.tool_id && a.cycle_id === contract.cycle_id,
    );
    if (!token) {
      return {
        ...base,
        decision: NEEDS_APPROVAL,
        reason: 'HUMAN_APPROVAL_REQUIRED',
        details: { risk },
      };
    }
  }

  const inputVerdict = tool.validate_input ? tool.validate_input(call.input) : { ok: true };
  if (!inputVerdict.ok) {
    return {
      ...base,
      decision: DENY,
      reason: 'INPUT_CONTRACT_VIOLATION',
      details: inputVerdict.errors ?? null,
    };
  }

  return { ...base, decision: ALLOW, reason: 'AUTHORIZED', risk };
}

function checkBudget(contract, s) {
  if (!s) return 'BUDGET_STATE_MISSING';
  if (s.steps >= contract.budget.max_steps) return 'BUDGET_EXHAUSTED_STEPS';
  if (s.tool_calls >= contract.budget.max_tool_calls) return 'BUDGET_EXHAUSTED_TOOL_CALLS';
  if (s.cost_units >= contract.budget.max_cost_units) return 'BUDGET_EXHAUSTED_COST';
  if (s.elapsed_ms >= contract.budget.max_wall_ms) return 'BUDGET_EXHAUSTED_WALL_CLOCK';
  return null;
}

/**
 * Trajectory risk (review §14): cumulative exposure across a cycle, not just
 * per-call risk. A run made entirely of individually-permitted MEDIUM calls
 * can still be an unacceptable trajectory.
 */
export function trajectoryRisk(decisions) {
  const allowed = decisions.filter((d) => d.decision === ALLOW);
  const score = allowed.reduce((acc, d) => acc + RISK_ORDER[d.risk ?? 'LOW'], 0);
  const denials = decisions.filter((d) => d.decision === DENY).length;
  return {
    allowed_calls: allowed.length,
    denied_calls: denials,
    cumulative_risk: score,
    // Repeated denials mean the executor keeps asking for things it may not
    // have — a signal worth surfacing even when every denial held.
    denial_pressure: denials,
  };
}
