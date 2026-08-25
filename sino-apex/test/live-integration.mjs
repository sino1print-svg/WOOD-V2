// Optional live integration against a real Knitwear Radar instance.
// Skips cleanly when KNITWEAR_RADAR_URL is unset so the default gate stays
// hermetic. Run it to confirm the adapter still matches the published contract:
//   KNITWEAR_RADAR_URL=http://127.0.0.1:8787 node sino-apex/test/live-integration.mjs
import { ToolRegistry } from '../kernel/gateway.mjs';
import { createKnitwearRadarTools } from '../tools/knitwear-radar.mjs';
import { runOpportunityToConcept } from '../workflow/opportunity-to-concept.mjs';
import { check, equal, report } from './harness.mjs';

const baseUrl = process.env.KNITWEAR_RADAR_URL;
if (!baseUrl) {
  console.log('live-integration: SKIP (KNITWEAR_RADAR_URL not set)');
  process.exit(0);
}

const registry = new ToolRegistry();
for (const t of createKnitwearRadarTools({
  baseUrl,
  operatorKey: process.env.OPERATOR_API_KEY || '',
}))
  registry.register(t);

const run = await runOpportunityToConcept({ registry, cycleId: 'cycle-live-001' });

equal('live run verdict is PASS', run.verification.verdict, 'PASS');
check('live outcome released', run.outcome !== null);
check('live trend id resolved', typeof run.claim.selected_trend_id === 'string');
check(
  'live brief produced',
  run.evidence.some((e) => e.kind === 'design_brief'),
);
equal('live generation not claimed', run.claim.generation_executed, false);
check('live budget respected', run.budget_state.tool_calls <= run.contract.budget.max_tool_calls);

console.log(
  `  selected: ${run.claim.selected_trend_id} (${run.claim.selected_trend_name}) opp=${run.claim.selected_opportunity_score} concept="${run.claim.concept_name}"`,
);
report('live-integration');
