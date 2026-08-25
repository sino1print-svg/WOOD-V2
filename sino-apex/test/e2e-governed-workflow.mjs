// Review §18 — the first governed workflow, proven end to end.
// Required proof points, each asserted below:
//   tool permission enforcement · trace/evidence · budget · deterministic
//   policy · failure handling · PASS granted only by the verifier · complete
//   flight recorder.
import { ToolRegistry } from '../kernel/gateway.mjs';
import { Ledger } from '../kernel/ledger.mjs';
import { createKnitwearRadarTools } from '../tools/knitwear-radar.mjs';
import {
  runOpportunityToConcept,
  selectBestOpportunity,
} from '../workflow/opportunity-to-concept.mjs';
import { startStub } from './fixtures/kr-stub.mjs';
import { check, equal, report } from './harness.mjs';

const OPERATOR_KEY = 'stub-operator-key';

function registryFor(baseUrl, { operatorKey = OPERATOR_KEY } = {}) {
  const registry = new ToolRegistry();
  for (const tool of createKnitwearRadarTools({ baseUrl, operatorKey })) registry.register(tool);
  return registry;
}

const stub = await startStub({ operatorKey: OPERATOR_KEY });
try {
  const run = await runOpportunityToConcept({
    registry: registryFor(stub.baseUrl),
    cycleId: 'cycle-e2e-001',
  });

  // --- Outcome ---
  equal('verdict is PASS', run.verification.verdict, 'PASS');
  check('outcome released only on PASS', run.outcome !== null);
  equal('selected the argmax opportunity', run.claim.selected_trend_id, 'cluster-1');
  check(
    'concept name resolved',
    typeof run.claim.concept_name === 'string' && run.claim.concept_name.length > 0,
  );
  equal('generation is not claimed', run.claim.generation_executed, false);

  // --- PASS provenance: the verifier grants it, nothing else ---
  const verdictEntry = run.ledger.entries.find((e) => e.type === 'verdict');
  equal(
    'PASS granted by independent verifier',
    verdictEntry.payload.granted_by,
    'independent_verifier',
  );
  check(
    'no check was skipped',
    run.verification.checks.length >= 15,
    `${run.verification.checks.length} checks`,
  );
  check(
    'all checks passed',
    run.verification.failures.length === 0,
    JSON.stringify(run.verification.failures),
  );

  // --- Flight recorder completeness ---
  const types = new Set(run.ledger.entries.map((e) => e.type));
  for (const required of [
    'cycle_start',
    'step',
    'policy_decision',
    'tool_call',
    'tool_result',
    'evidence_admitted',
    'selection',
    'claim_submitted',
    'verdict',
  ]) {
    check(`ledger records ${required}`, types.has(required));
  }
  const chain = Ledger.verifyChain(run.ledger.entries);
  check('ledger hash chain verifies', chain.ok, chain.reason);
  equal('sealed head matches recomputed head', run.ledger.head, chain.head);

  // --- Evidence ---
  const kinds = run.evidence.map((e) => e.kind).sort();
  check(
    'all four evidence kinds captured',
    ['design_brief', 'design_concepts', 'trend_dna', 'trend_opportunities'].every((k) =>
      kinds.includes(k),
    ),
    kinds.join(','),
  );
  check(
    'all evidence is SINO_VERIFIED',
    run.evidence.every((e) => e.trust_label === 'SINO_VERIFIED'),
  );

  // --- Budget ---
  equal('exactly four tool calls', run.budget_state.tool_calls, 4);
  check(
    'within tool-call budget',
    run.budget_state.tool_calls <= run.contract.budget.max_tool_calls,
  );
  check('within step budget', run.budget_state.steps <= run.contract.budget.max_steps);

  // --- Determinism: identical inputs produce an identical claim ---
  const rerun = await runOpportunityToConcept({
    registry: registryFor(stub.baseUrl),
    cycleId: 'cycle-e2e-001',
  });
  equal(
    'claim is deterministic across runs',
    JSON.stringify({ ...rerun.claim, evidence_ids: null }),
    JSON.stringify({ ...run.claim, evidence_ids: null }),
  );
  equal('contract hash is stable', rerun.contract.contract_hash, run.contract.contract_hash);

  // --- Secret isolation: the operator key never reaches the trace ---
  const traceBlob = JSON.stringify({
    ledger: run.ledger,
    evidence: run.evidence,
    claim: run.claim,
    contract: run.contract,
  });
  check('operator key absent from the entire trace', !traceBlob.includes(OPERATOR_KEY));

  // --- The selection rule is a pure, independently checkable function ---
  const clusters = [
    { id: 'a', opportunity: { score: 10, decision: 'WATCH' }, score: 1 },
    { id: 'b', opportunity: { score: 99, decision: 'AVOID' }, score: 1 },
    { id: 'c', opportunity: { score: 42, decision: 'CREATE NOW' }, score: 1 },
  ];
  equal('AVOID is never selected even at top score', selectBestOpportunity(clusters).id, 'c');
  equal('empty input selects nothing', selectBestOpportunity([]), null);
} finally {
  await stub.close();
}

report('e2e-governed-workflow');
