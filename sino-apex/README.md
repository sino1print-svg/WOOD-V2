# SINO APEX — governed execution kernel

A deterministic, dependency-free kernel for running goals against SINO tools under
enforced authorization, with an independent verifier as the only issuer of PASS.

The architecture review that produced this, including why it is **not** a multi-agent
system, is in [`../SINO_APEX_ARCHITECTURE_REVIEW.md`](../SINO_APEX_ARCHITECTURE_REVIEW.md).

## The invariant

```text
Model proposes  →  Policy authorizes  →  Evidence proves  →  SINO decides PASS
```

No agent, reviewer, model or framework can grant itself PASS. `verifyCycle()` is the only
function that returns `PASS`, it is unreachable from any tool or adapter, and a workflow
releases its outcome only when the verdict is `PASS` — otherwise it returns a sealed trace
and `null`.

## Run

```bash
./gate.sh                       # hermetic: no network, no keys, no dependencies
```

Against a live Knitwear Radar instance:

```bash
KNITWEAR_RADAR_URL=http://127.0.0.1:8787 node test/live-integration.mjs
```

## Layout

| Path                                  | Role                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `kernel/canonical.mjs`                | Canonical JSON and SHA-256 hashing — every hash in the system derives from here       |
| `kernel/cycle.mjs`                    | Cycle Contract: goal, allowlist, scopes, risk ceiling, budget, evidence requirement   |
| `kernel/policy.mjs`                   | Deterministic security broker. Pure function, deny-by-default, no probabilistic input |
| `kernel/ledger.mjs`                   | Flight Recorder: append-only, hash-chained, tamper-evident                            |
| `kernel/evidence.mjs`                 | Evidence store with trust labels. Gateway-admitted only                               |
| `kernel/gateway.mjs`                  | Tool registry and permission gateway — the sole path to any adapter                   |
| `tools/knitwear-radar.mjs`            | Adapter over the Knitwear Radar v0.21.0 HTTP contract. Contains no Radar logic        |
| `workflow/opportunity-to-concept.mjs` | The first governed workflow: a 6-node deterministic task graph                        |
| `verify/verifier.mjs`                 | Independent verifier. Reads the ledger and evidence, never the executor's narrative   |

## Adding a tool

A Tool Contract declares what it is, what it costs, and what it may touch:

```js
registry.register({
  tool_id: 'example.read_thing',
  version: '1.0.0',
  capability: 'read',              // 'write' / 'external_fetch' / … gate on read_only cycles
  risk_class: 'LOW',               // checked against the cycle's risk ceiling
  required_scopes: ['example.read'],
  cost_units: 1,
  trust_label: 'SINO_VERIFIED',    // set here, never by the payload
  evidence_kind: 'thing',
  validate_input(input) { … },     // runs before the adapter is reached
  async invoke(input) { … },
});
```

Two rules the kernel enforces rather than documents: a tool the registry does not know is
unreachable even if allowlisted, and secrets live inside adapters — never in a contract,
ledger entry, evidence payload or claim.

## Placement

This directory sits outside `wood-v2`'s `src/` and `test/` trees and outside its ESLint,
TypeScript and Vitest scope, so it cannot affect that project's phase-gated verification.
The isolation is deliberate but temporary — see owner decision §19.2 of the review.
