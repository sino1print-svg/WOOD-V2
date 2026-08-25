// Cycle Contract (review §14).
// A cycle is the unit of governed execution. Nothing runs outside one.
// The contract is declared BEFORE execution and is immutable for its lifetime:
// it is the deterministic authority the policy engine reads from.
import { contentHash } from './canonical.mjs';

export const RISK_ORDER = Object.freeze({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });

const REQUIRED = [
  'goal',
  'allowed_tools',
  'granted_scopes',
  'risk_ceiling',
  'budget',
  'evidence_requirement',
];

/**
 * Build a frozen cycle contract. Throws on an ill-formed contract rather than
 * defaulting, because a permissive default here is a security failure.
 */
export function createCycleContract(spec) {
  for (const field of REQUIRED) {
    if (spec[field] === undefined || spec[field] === null) {
      throw new Error(`CYCLE_CONTRACT_INVALID: missing ${field}`);
    }
  }
  if (!Array.isArray(spec.allowed_tools))
    throw new Error('CYCLE_CONTRACT_INVALID: allowed_tools must be an array');
  if (!Array.isArray(spec.granted_scopes))
    throw new Error('CYCLE_CONTRACT_INVALID: granted_scopes must be an array');
  if (!(spec.risk_ceiling in RISK_ORDER))
    throw new Error(`CYCLE_CONTRACT_INVALID: unknown risk_ceiling ${spec.risk_ceiling}`);

  const budget = {
    max_steps: intOrThrow(spec.budget.max_steps, 'budget.max_steps'),
    max_tool_calls: intOrThrow(spec.budget.max_tool_calls, 'budget.max_tool_calls'),
    max_retries: intOrThrow(spec.budget.max_retries, 'budget.max_retries'),
    max_wall_ms: intOrThrow(spec.budget.max_wall_ms, 'budget.max_wall_ms'),
    max_cost_units: intOrThrow(spec.budget.max_cost_units, 'budget.max_cost_units'),
  };

  const contract = {
    cycle_id: String(spec.cycle_id || ''),
    goal: String(spec.goal),
    allowed_tools: [...spec.allowed_tools].sort(),
    granted_scopes: [...spec.granted_scopes].sort(),
    risk_ceiling: spec.risk_ceiling,
    budget,
    // Approval classes: risk levels that a deterministic policy may NOT
    // self-authorize; they require a recorded human approval token.
    approval_required_at_or_above: spec.approval_required_at_or_above ?? 'HIGH',
    read_only: spec.read_only === true,
    evidence_requirement: {
      required_kinds: [...(spec.evidence_requirement.required_kinds || [])].sort(),
      max_evidence_age_ms: intOrThrow(
        spec.evidence_requirement.max_evidence_age_ms ?? 3_600_000,
        'evidence_requirement.max_evidence_age_ms',
      ),
    },
    exit_condition: String(spec.exit_condition || 'verifier_pass'),
  };
  contract.contract_hash = contentHash(contract);
  return Object.freeze(Object.assign(contract, { budget: Object.freeze(budget) }));
}

function intOrThrow(v, name) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(`CYCLE_CONTRACT_INVALID: ${name} must be a non-negative integer`);
  return n;
}
