// First governed workflow (review §18):
//   "Find the best current knitwear opportunity and create an original
//    design direction."
//
// This is a deterministic task graph, not an agent loop. Every node is either a
// gated tool call or a pure function. No LLM is invoked, and the review explains
// why: nothing in this goal is ambiguous enough to need one. The reasoning port
// exists and stays unused, recorded as such in the ledger.
import { Ledger } from '../kernel/ledger.mjs';
import { EvidenceStore } from '../kernel/evidence.mjs';
import { Gateway } from '../kernel/gateway.mjs';
import { createCycleContract } from '../kernel/cycle.mjs';
import { verifyCycle } from '../verify/verifier.mjs';

export const DEFAULT_CONTRACT = Object.freeze({
  goal: 'Find the best current knitwear opportunity and produce an original design direction.',
  allowed_tools: [
    'knitwear_radar.opportunities',
    'knitwear_radar.trend_dna',
    'knitwear_radar.concepts',
    'knitwear_radar.brief',
  ],
  granted_scopes: ['knitwear.read'],
  risk_ceiling: 'LOW',
  read_only: true,
  approval_required_at_or_above: 'MEDIUM',
  budget: {
    max_steps: 8,
    max_tool_calls: 6,
    max_retries: 1,
    max_wall_ms: 30_000,
    max_cost_units: 20,
  },
  evidence_requirement: {
    required_kinds: ['trend_opportunities', 'trend_dna', 'design_concepts', 'design_brief'],
    max_evidence_age_ms: 3_600_000,
  },
  exit_condition: 'verifier_pass',
});

/**
 * Deterministic selection rule. Kept as a named pure function so the verifier
 * can re-derive it independently (see `selection_is_argmax`).
 */
export function selectBestOpportunity(clusters) {
  const eligible = clusters.filter((c) => c.opportunity && c.opportunity.decision !== 'AVOID');
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => {
    const byScore = (b.opportunity.score ?? -1) - (a.opportunity.score ?? -1);
    if (byScore !== 0) return byScore;
    // Stable tie-breaks, mirroring the house convention of explicit ordering.
    const byTrend = (b.score ?? 0) - (a.score ?? 0);
    if (byTrend !== 0) return byTrend;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

export async function runOpportunityToConcept({
  registry,
  cycleId,
  contractOverrides = {},
  approvals = [],
  clock = () => Date.now(),
  conceptIndex = 0,
}) {
  const contract = createCycleContract({
    ...DEFAULT_CONTRACT,
    ...contractOverrides,
    cycle_id: cycleId,
  });
  const ledger = new Ledger(cycleId);
  const evidence = new EvidenceStore();

  ledger.append('cycle_start', {
    contract_hash: contract.contract_hash,
    goal: contract.goal,
    allowed_tools: contract.allowed_tools,
    risk_ceiling: contract.risk_ceiling,
    read_only: contract.read_only,
  });
  // Recorded explicitly: this cycle resolved without probabilistic reasoning.
  ledger.append('reasoning_port', { invoked: false, reason: 'DETERMINISTIC_PATH_SUFFICIENT' });

  const gateway = new Gateway({ registry, contract, ledger, evidence, approvals, clock });
  const abort = (stage, detail) => {
    ledger.append('cycle_abort', { stage, detail });
    return finish({
      contract,
      ledger,
      evidence,
      gateway,
      claim: null,
      aborted: { stage, detail },
      clock,
    });
  };

  // Node 1 — acquire ranked opportunities.
  if (!gateway.step('fetch_opportunities')) return abort('fetch_opportunities', 'BUDGET');
  const opps = await gateway.call({
    tool_id: 'knitwear_radar.opportunities',
    input: { limit: 25 },
  });
  if (!opps.ok) return abort('fetch_opportunities', opps.decision?.reason ?? opps.error);

  // Node 2 — deterministic selection (pure function, no tool, no model).
  if (!gateway.step('select_opportunity')) return abort('select_opportunity', 'BUDGET');
  const selected = selectBestOpportunity(opps.result.clusters || []);
  if (!selected) return abort('select_opportunity', 'NO_ELIGIBLE_OPPORTUNITY');
  ledger.append('selection', {
    trend_id: selected.id,
    opportunity_score: selected.opportunity?.score ?? null,
    decision: selected.opportunity?.decision ?? null,
    rule: 'argmax(opportunity.score) over decision != AVOID',
  });

  // Node 3 — Trend DNA.
  if (!gateway.step('extract_dna')) return abort('extract_dna', 'BUDGET');
  const dna = await gateway.call({
    tool_id: 'knitwear_radar.trend_dna',
    input: { trend_id: selected.id },
  });
  if (!dna.ok) return abort('extract_dna', dna.decision?.reason ?? dna.error);

  // Node 4 — original concept directions.
  if (!gateway.step('generate_concepts')) return abort('generate_concepts', 'BUDGET');
  const concepts = await gateway.call({
    tool_id: 'knitwear_radar.concepts',
    input: { trend_id: selected.id },
  });
  if (!concepts.ok) return abort('generate_concepts', concepts.decision?.reason ?? concepts.error);

  // Node 5 — structured, provider-agnostic brief.
  if (!gateway.step('structured_brief')) return abort('structured_brief', 'BUDGET');
  const brief = await gateway.call({
    tool_id: 'knitwear_radar.brief',
    input: { trend_id: selected.id, concept: conceptIndex },
  });
  if (!brief.ok) return abort('structured_brief', brief.decision?.reason ?? brief.error);

  // Node 6 — assemble the claim. Note that the claim asserts nothing the
  // verifier cannot re-derive from the evidence ids it cites.
  const claim = {
    goal: contract.goal,
    selected_trend_id: selected.id,
    selected_trend_name: selected.name,
    selected_opportunity_score: selected.opportunity?.score ?? null,
    selected_decision: selected.opportunity?.decision ?? null,
    concept_index: conceptIndex,
    concept_name: concepts.result?.concept_engine?.concepts?.[conceptIndex]?.name ?? null,
    generation_executed: false,
    evidence_ids: [
      opps.evidence.evidence_id,
      dna.evidence.evidence_id,
      concepts.evidence.evidence_id,
      brief.evidence.evidence_id,
    ],
  };
  ledger.append('claim_submitted', {
    claim_summary: { trend_id: claim.selected_trend_id, concept_index: conceptIndex },
  });

  return finish({ contract, ledger, evidence, gateway, claim, aborted: null, clock });
}

/**
 * Single exit path. Verification happens here for every outcome — including
 * aborts — so a failed run still produces a sealed, checkable trace.
 */
function finish({ contract, ledger, evidence, gateway, claim, aborted, clock }) {
  const verification = verifyCycle({
    contract,
    ledgerEntries: ledger.entries(),
    evidence,
    claim,
    now: clock(),
  });
  ledger.append('verdict', {
    verdict: verification.verdict,
    failed_checks: verification.failures.map((f) => f.id),
    granted_by: 'independent_verifier',
  });
  const head = ledger.seal();
  return {
    cycle_id: contract.cycle_id,
    contract,
    aborted,
    claim,
    verification,
    // The outcome is released only on PASS. An unverified result is withheld
    // rather than returned with a caveat.
    outcome: verification.verdict === 'PASS' ? claim : null,
    trajectory: gateway.trajectory(),
    budget_state: { ...gateway.budgetState },
    ledger: { head, entries: ledger.entries() },
    // Metadata for reporting; the full store is returned separately so a
    // recovery or audit path can re-verify without the original process.
    evidence: evidence.all().map(({ payload: _payload, ...meta }) => meta),
    evidence_store: evidence,
  };
}
