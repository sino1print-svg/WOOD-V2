# Phase 2 Corrective Audit V3

## Scope

This corrective pass changes Phase 2 Rule Engine behavior only. Phase 3 and later engines/UI remain unimplemented. The twelve files under `docs/spec/` were not edited.

## Baseline

The supplied fixed-v2 tree installed successfully and npm reported zero vulnerabilities. Its initial `npm run verify:full` failed at `format:check` because seven tracked files were not formatted. The three reported implementation defects were then reproduced against the actual source and tests.

## Defect 1 — transitive Lock intersection

### Reproduction

The failing case was:

- A = `{white, black}`
- B = `{black, navy}`
- C = `{navy, red}`

A overlaps B and B overlaps C, but `A ∩ B ∩ C = ∅`. The previous implementation could return success.

### Root cause

Connectivity/union-find identified a connected component, but each literal target inside one Lock was represented as an independent node. This lost the semantic boundary of the Lock's complete allowed-value set. Disjoint Locks could also remain in different components and never be compared.

### Correction

Each effective Lock is now represented by one normalized allowed-value set. All applicable Locks in the same authoritative domain group are resolved together. The accumulator is recomputed after every Lock using a true n-way intersection. An empty accumulator produces a blocking `RE_INTERNAL_CONFLICT`, includes the sorted participating rule IDs in deterministic diagnostics, and emits no partial constraint.

Regression coverage includes two-set overlap, three-set empty and non-empty intersections, duplicate sets, disjoint sets, Literal plus ContextRef sets, and all input permutations.

## Defect 2 — description-based result-code parsing

`resultCodeFromDescription` and its `RULE_*` regex were removed from production. `Rule.description` is human-readable metadata only. Descriptions containing one code, multiple codes, translations, empty strings, or omission produce identical evaluation semantics.

### Implemented

Engine-owned structured validation and conflict failures continue to use the authoritative error registry.

### Blocked

`RULE_RESULT_CODE_FIELD_GAP` remains open: the specifications do not define an authoritative typed, machine-readable field for rule-authored official result codes. No schema v4 or new persisted field was invented.

Source-scan tests prove the Rule Engine production tree contains neither `resultCodeFromDescription` nor a regex/branch extracting `RULE_*` from `description`.

## Defect 3 — evaluatedAt contract

Explicit text in `03_DATA_MODELS_FINAL.md §3.14` and `04_RULE_ENGINE_REVISED.md §15` defines `RuleTrace.evaluatedAt: IsoTimestamp`. The public Rule Engine boundary now requires `evaluatedAt` explicitly. The exact supplied value is validated and threaded into every trace.

The engine uses no `Date.now`, `new Date`, `Date.parse`, `performance.now`, hidden clock, or fallback timestamp. Invalid timestamps fail pre-flight. Identical complete inputs remain byte-identical.

## Production files changed

- `src/engines/rule-engine/engine.ts`
- `src/engines/rule-engine/failures.ts`
- `src/engines/rule-engine/index.ts`
- `src/engines/rule-engine/types.ts`
- `src/shared/contracts/engine-contracts.ts`
- `src/shared/domain-model/evaluation.ts`

## Tests changed

- `test/rule-engine/public-contract.test.ts`
- `test/rule-engine/safety-and-determinism.test.ts`
- `test/rule-engine/schema-and-purity.test.ts`
- `test/rule-engine/trace-and-errors.test.ts`

## Tests added

- `test/rule-engine/lock-intersection-v3.test.ts`

## Remaining specification blockers

- `RULE_RESULT_CODE_FIELD_GAP`: no typed persisted source for rule-authored official result codes.
- Existing Phase 1 retention, structural-sharing, RuleDomain legacy migration, duplicate-ID remapping, shared-asset deletion, Undo/Redo, Merge/Replace, and missing-library blockers remain unchanged.

## Architecture

Rule Engine still imports no UI, Persistence implementation, Asset Store, Orchestrator, or other engine. It performs no filesystem/network access, logging side effect, randomness, clock access, eval, or Function-constructor execution.
