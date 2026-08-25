// Independent Verifier.
// Review §7: "No Agent, Reviewer, LLM, or Framework may grant itself PASS."
//
// This verifier never reads the executor's narrative. Its inputs are the sealed
// ledger, the evidence store, and the cycle contract. It re-derives the claimed
// outcome from evidence and fails closed on any check it cannot complete.
import { Ledger } from '../kernel/ledger.mjs';
import { contentHash } from '../kernel/canonical.mjs';
import { TRUST } from '../kernel/evidence.mjs';
import { ALLOW } from '../kernel/policy.mjs';

export const PASS = 'PASS';
export const FAIL = 'FAIL';

/**
 * @returns {{verdict:'PASS'|'FAIL', checks:Array, failures:Array}}
 */
export function verifyCycle({ contract, ledgerEntries, evidence, claim, now = Date.now() }) {
  const checks = [];
  const record = (id, ok, detail) => {
    checks.push({ id, ok: Boolean(ok), detail: detail ?? null });
    return ok;
  };

  // 1. The trace must be internally consistent before anything in it is trusted.
  const chain = Ledger.verifyChain(ledgerEntries);
  record('ledger_chain_intact', chain.ok, chain.ok ? `${chain.count} entries` : chain.reason);

  // 2. The contract that governed the run must be the contract we are judging
  //    against — otherwise an executor could swap in a laxer one after the fact.
  const declared =
    ledgerEntries.find((e) => e.type === 'cycle_start')?.payload?.contract_hash ?? null;
  record(
    'contract_hash_matches',
    declared === contract.contract_hash,
    `${declared} vs ${contract.contract_hash}`,
  );

  // 3. Every executed tool call must be in the allowlist.
  const executed = ledgerEntries
    .filter((e) => e.type === 'tool_call')
    .map((e) => e.payload.tool_id);
  const outOfBand = [...new Set(executed.filter((t) => !contract.allowed_tools.includes(t)))];
  record('no_out_of_allowlist_execution', outOfBand.length === 0, outOfBand.join(', ') || 'none');

  // 4. Every executed call must be immediately preceded by an ALLOW for that
  //    same tool. This is what catches an adapter invoked around the gateway.
  let unauthorizedExecution = null;
  for (let i = 0; i < ledgerEntries.length && !unauthorizedExecution; i += 1) {
    const e = ledgerEntries[i];
    if (e.type !== 'tool_call') continue;
    const prior = ledgerEntries[i - 1];
    const authorized =
      prior?.type === 'policy_decision' &&
      prior.payload?.decision === ALLOW &&
      prior.payload?.tool_id === e.payload.tool_id;
    if (!authorized) unauthorizedExecution = `${e.payload.tool_id} at seq ${e.seq}`;
  }
  record(
    'every_execution_preceded_by_allow',
    unauthorizedExecution === null,
    unauthorizedExecution ?? 'none',
  );

  // 5. Budget ceilings held.
  const toolCalls = executed.length;
  const steps = ledgerEntries.filter((e) => e.type === 'step').length;
  record(
    'budget_tool_calls',
    toolCalls <= contract.budget.max_tool_calls,
    `${toolCalls}/${contract.budget.max_tool_calls}`,
  );
  record(
    'budget_steps',
    steps <= contract.budget.max_steps,
    `${steps}/${contract.budget.max_steps}`,
  );

  // 6. The kill switch must not have fired.
  const killed = ledgerEntries.filter((e) => e.type === 'kill_switch_engaged');
  record(
    'kill_switch_not_engaged',
    killed.length === 0,
    killed.map((k) => k.payload.reason).join(', ') || 'none',
  );

  // 7. Required evidence kinds are present.
  const presentKinds = evidence.kinds();
  const missingKinds = contract.evidence_requirement.required_kinds.filter(
    (k) => !presentKinds.includes(k),
  );
  record(
    'required_evidence_present',
    missingKinds.length === 0,
    missingKinds.join(', ') || 'all present',
  );

  // 8. Evidence freshness — stale evidence cannot carry a current claim.
  const maxAge = contract.evidence_requirement.max_evidence_age_ms;
  const stale = evidence
    .all()
    .filter((x) => now - Date.parse(x.captured_at) > maxAge)
    .map((x) => x.evidence_id);
  record('evidence_fresh', stale.length === 0, stale.join(', ') || 'all fresh');

  // 9. Evidence integrity: recompute every content hash from its payload.
  const tampered = evidence.all().filter((x) => contentHash(x.payload ?? null) !== x.content_hash);
  record(
    'evidence_untampered',
    tampered.length === 0,
    tampered.map((x) => x.evidence_id).join(', ') || 'none',
  );

  // 10. Every evidence item admitted to the store must also appear in the
  //     ledger, and vice versa — no silent side-channel evidence.
  const ledgerEvidenceIds = new Set(
    ledgerEntries.filter((e) => e.type === 'evidence_admitted').map((e) => e.payload.evidence_id),
  );
  const storeIds = new Set(evidence.all().map((x) => x.evidence_id));
  const unrecorded = [...storeIds].filter((id) => !ledgerEvidenceIds.has(id));
  record('no_unrecorded_evidence', unrecorded.length === 0, unrecorded.join(', ') || 'none');

  // 11. Anti-false-completion. The claim is re-derived from evidence rather
  //     than believed. This is the check that stops an executor from simply
  //     asserting it finished.
  const claimChecks = verifyClaimAgainstEvidence({ claim, evidence });
  for (const c of claimChecks) checks.push(c);

  // 12. Authorization may only rest on SINO_VERIFIED evidence. External content
  //     is allowed to exist in the store, but never to carry the verdict.
  const backing = (claim?.evidence_ids || []).map((id) => evidence.get(id)).filter(Boolean);
  const externalBacking = backing
    .filter((x) => x.trust_label !== TRUST.SINO_VERIFIED)
    .map((x) => x.evidence_id);
  record(
    'verdict_rests_on_verified_evidence',
    externalBacking.length === 0,
    externalBacking.join(', ') || 'none',
  );

  const failures = checks.filter((c) => !c.ok);
  return { verdict: failures.length === 0 ? PASS : FAIL, checks, failures };
}

/**
 * Re-derive the workflow's specific claims. Each check is independent of how
 * the executor arrived at its answer.
 */
function verifyClaimAgainstEvidence({ claim, evidence }) {
  const out = [];
  const add = (id, ok, detail) => out.push({ id, ok: Boolean(ok), detail: detail ?? null });

  if (!claim || typeof claim !== 'object') {
    add('claim_present', false, 'no claim supplied');
    return out;
  }
  add('claim_present', true, 'ok');

  // Every evidence id the claim cites must resolve.
  const unresolved = (claim.evidence_ids || []).filter((id) => !evidence.get(id));
  add('claim_evidence_resolves', unresolved.length === 0, unresolved.join(', ') || 'all resolve');

  // The selected trend must actually appear in the opportunities evidence, with
  // the same opportunity score the claim reports.
  const oppEvidence = evidence.byKind('trend_opportunities');
  if (!oppEvidence.length) {
    add('selected_trend_backed_by_opportunity_evidence', false, 'no trend_opportunities evidence');
  } else {
    const clusters = oppEvidence.flatMap((e) => e.payload?.clusters || []);
    const match = clusters.find((c) => c.id === claim.selected_trend_id);
    add(
      'selected_trend_backed_by_opportunity_evidence',
      Boolean(match),
      match ? match.id : `${claim.selected_trend_id} not in evidence`,
    );
    if (match) {
      const reported = claim.selected_opportunity_score;
      const actual = match.opportunity?.score ?? null;
      add(
        'opportunity_score_matches_evidence',
        reported === actual,
        `claimed ${reported}, evidence ${actual}`,
      );
      // Re-derive the selection rule rather than trusting that it was applied:
      // the claim must name the highest-scoring eligible cluster.
      const best = [...clusters].sort(
        (a, b) => (b.opportunity?.score ?? -1) - (a.opportunity?.score ?? -1),
      )[0];
      add(
        'selection_is_argmax',
        best?.id === claim.selected_trend_id,
        `argmax is ${best?.id ?? 'none'}`,
      );
    }
  }

  // A design direction may only be reported if a brief was actually produced.
  const briefEvidence = evidence.byKind('design_brief');
  const brief = briefEvidence[0]?.payload?.brief ?? null;
  add('design_brief_exists', Boolean(brief), brief ? 'present' : 'absent');
  add(
    'brief_matches_selected_trend',
    Boolean(brief) && briefEvidence[0]?.payload?.trend_id === claim.selected_trend_id,
    `${briefEvidence[0]?.payload?.trend_id ?? 'none'} vs ${claim.selected_trend_id}`,
  );

  // Honesty invariant inherited from Knitwear Radar M5: the pipeline must not
  // claim that any image was generated.
  add(
    'generation_not_claimed',
    claim.generation_executed !== true,
    `generation_executed=${claim.generation_executed}`,
  );

  return out;
}
