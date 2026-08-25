// Tool & Permission Gateway.
// The single chokepoint between anything that decides and anything that acts:
//   caller -> Tool Contract -> Gateway (policy) -> Adapter -> real service
// There is deliberately no second path. A tool the registry does not know is
// unreachable, and an unauthorized call never touches an adapter.
import { authorize, ALLOW, DENY, NEEDS_APPROVAL, trajectoryRisk } from './policy.mjs';
import { contentHash } from './canonical.mjs';
import { TRUST } from './evidence.mjs';

export class ToolRegistry {
  #tools = new Map();

  register(tool) {
    for (const field of ['tool_id', 'version', 'capability', 'risk_class', 'invoke']) {
      if (tool?.[field] === undefined) throw new Error(`TOOL_CONTRACT_INVALID: missing ${field}`);
    }
    if (this.#tools.has(tool.tool_id)) throw new Error(`TOOL_ALREADY_REGISTERED: ${tool.tool_id}`);
    this.#tools.set(tool.tool_id, Object.freeze({ required_scopes: [], ...tool }));
    return this;
  }

  get(toolId) {
    return this.#tools.get(toolId) ?? null;
  }

  list() {
    return [...this.#tools.values()].map(
      ({ invoke: _invoke, validate_input: _v, ...meta }) => meta,
    );
  }
}

export class Gateway {
  #decisions = [];

  constructor({ registry, contract, ledger, evidence, approvals = [], clock = () => Date.now() }) {
    this.registry = registry;
    this.contract = contract;
    this.ledger = ledger;
    this.evidence = evidence;
    this.approvals = approvals;
    this.clock = clock;
    this.startedAt = clock();
    this.budgetState = { steps: 0, tool_calls: 0, retries: 0, cost_units: 0, elapsed_ms: 0 };
    this.killed = false;
    this.kill_reason = null;
  }

  /** Kill switch (review §8). Once engaged, every subsequent call is denied. */
  kill(reason) {
    this.killed = true;
    this.kill_reason = String(reason || 'KILLED');
    this.ledger.append('kill_switch_engaged', { reason: this.kill_reason });
  }

  #refreshBudget() {
    this.budgetState.elapsed_ms = this.clock() - this.startedAt;
  }

  /**
   * Invoke a tool through policy. Never throws on denial — a denial is a
   * first-class, recorded result, because a thrown denial is easy to swallow.
   */
  async call(call) {
    this.#refreshBudget();
    const tool = this.registry.get(call?.tool_id);

    if (this.killed) {
      const d = { tool_id: call?.tool_id ?? null, decision: DENY, reason: 'KILL_SWITCH_ENGAGED' };
      this.#decisions.push(d);
      this.ledger.append('policy_decision', d);
      return { ok: false, denied: true, decision: d };
    }

    const decision = authorize({
      contract: this.contract,
      tool,
      call,
      budgetState: this.budgetState,
      approvals: this.approvals,
    });
    this.#decisions.push(decision);
    this.ledger.append('policy_decision', decision);

    if (decision.decision !== ALLOW) {
      // NEEDS_APPROVAL is an escalation, not a failure; both stop execution.
      return {
        ok: false,
        denied: decision.decision === DENY,
        needs_approval: decision.decision === NEEDS_APPROVAL,
        decision,
      };
    }

    this.budgetState.tool_calls += 1;
    this.budgetState.cost_units += Number(tool.cost_units ?? 1);

    this.ledger.append('tool_call', {
      tool_id: tool.tool_id,
      tool_version: tool.version,
      input_hash: contentHash(call.input ?? null),
    });

    let result;
    try {
      result = await tool.invoke(call.input, {
        contract: this.contract,
        budget: { ...this.budgetState },
      });
    } catch (e) {
      const failure = { tool_id: tool.tool_id, error: String(e?.message || e).slice(0, 300) };
      this.ledger.append('tool_error', failure);
      return { ok: false, error: failure.error, decision };
    }

    const outputHash = contentHash(result ?? null);
    this.ledger.append('tool_result', { tool_id: tool.tool_id, output_hash: outputHash });

    // Trust label is a property of the tool contract, never of the payload.
    // External content cannot self-declare that it is trustworthy.
    const item = this.evidence.admit({
      kind: tool.evidence_kind ?? tool.tool_id,
      source_tool: tool.tool_id,
      trust_label: tool.trust_label ?? TRUST.EXTERNAL_UNTRUSTED,
      payload: result,
      captured_at: new Date(this.clock()).toISOString(),
    });
    this.ledger.append('evidence_admitted', {
      evidence_id: item.evidence_id,
      kind: item.kind,
      trust_label: item.trust_label,
      content_hash: item.content_hash,
    });

    return { ok: true, result, evidence: item, decision };
  }

  step(name) {
    this.budgetState.steps += 1;
    this.#refreshBudget();
    this.ledger.append('step', { name: String(name), index: this.budgetState.steps });
    if (this.budgetState.steps > this.contract.budget.max_steps) {
      this.kill('BUDGET_EXHAUSTED_STEPS');
      return false;
    }
    if (this.budgetState.elapsed_ms >= this.contract.budget.max_wall_ms) {
      this.kill('BUDGET_EXHAUSTED_WALL_CLOCK');
      return false;
    }
    return true;
  }

  decisions() {
    return this.#decisions.map((d) => ({ ...d }));
  }

  trajectory() {
    return trajectoryRisk(this.#decisions);
  }
}
