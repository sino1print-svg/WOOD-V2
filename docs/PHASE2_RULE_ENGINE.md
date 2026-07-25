# Phase 2 — Rule Engine

## Scope and authority

This release implements **Phase 2 only**. The authoritative sources are the twelve unchanged
files under `docs/spec/`, principally:

- `03_DATA_MODELS_FINAL.md`
- `04_RULE_ENGINE_REVISED.md`
- `10_APP_WORKFLOW.md`
- `11_TEST_PLAN.md`
- `12_IMPLEMENTATION_GUIDE.md`

No Phase 3 engine, later engine, Orchestrator, UI, Rule editor, persistence business logic,
scene generation, prompt generation, cover/export generation, or image generation is included.

## Public contract

```ts
// Raw pure core (test/DI callers):
evaluateRules({
  context: EvaluationContext,
  activeRuleSets: readonly RuleSet[],
  rules: readonly Rule[],
  evaluatedAt?: IsoTimestamp, // OPTIONAL — see "evaluatedAt" section below (v2 refinement)
}): RuleEngineResult

// Approved public contract adapter (unchanged since Phase 0 — no evaluatedAt parameter):
ruleEngine.evaluate(context: EvaluationContext, activeRuleSets: readonly RuleSet[], rules: readonly Rule[]): RuleEngineResult
```

The `ruleEngine.evaluate(context, activeRuleSets, rules)` adapter implements the shared
`RuleEngineContract`. Rule and RuleSet are separate aggregates. Only rules referenced by active
RuleSets are evaluated. RuleSet version must equal the configured current version (`3`).

The core is pure:

- no mutation of context, rules, or rule sets;
- no persistence or Asset Store access;
- no network, filesystem, current time, randomness, locale ordering, logging, or global state;
- no `eval` or `Function` construction;
- no imports from another engine, UI, Orchestrator, or Persistence implementation.

## Structural validation

AJV 2020 validates the complete authoritative `Rule` and `RuleSet` definitions before any nested
field is read. Unexpected properties, malformed unions, missing fields, unsupported enum values,
and malformed numeric expressions return `RULE_CFG_001` with an exact slash path. Referential
checks then verify unique IDs, current RuleSet schema version, unique membership, and existence of
every RuleSet `ruleId`.

A `RULE_*` code found in `Rule.description` is accepted only when its registry entry:

- belongs to `EngineId.Rule`;
- has the same priority, when the catalog fixes one;
- has the same domain, when the catalog fixes one.

This prevents Rule Engine configuration from emitting Validation-owned `RULE_PA_005N`,
`RULE_PA_006`, or `RULE_PA_007` failures.

## Condition evaluation

### Groups

- `{ all: [...] }`: deterministic AND; empty `all` is true.
- `{ any: [...] }`: deterministic OR; empty `any` is false.
- `{ not: node }`: deterministic logical negation.

Nested evaluation is bounded by `APP_CONFIG.limits.ruleEngine.maxConditionDepth`.

### Operators

| Operator                                           | Semantics                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `eq`, `neq`                                        | strict same-type scalar comparison; string, finite number, or boolean only |
| `in`, `not_in`                                     | scalar string membership in a string array                                 |
| `includes`, `excludes`                             | string-array intersection / absence                                        |
| `count_eq`, `count_gte`, `count_lte`               | array length only                                                          |
| `num_eq`, `num_gte`, `num_lte`, `num_gt`, `num_lt` | finite numeric scalar only                                                 |
| `exists`                                           | own field exists and is non-null                                           |
| `is_null`                                          | field is null or absent                                                    |

There is no coercion between strings, numbers, booleans, null, and arrays. Missing is distinct
from null; `false`, `0`, and `[]` remain present values. Invalid operator/value/field-type
combinations fail deterministically with `RULE_CFG_001`. Unauthorized or missing ContextRefs fail
with `RULE_CFG_002` where the specification assigns that code.

## ContextRef resolution

Only the explicit paths represented by `EvaluationContext` are authorized. Resolution uses own
properties only and never traverses prototypes. Empty paths, overlong paths, unknown paths, and
segments named `__proto__`, `prototype`, or `constructor` are rejected. Missing, null, empty array,
false, and zero are represented distinctly.

## NumericExpression

Implemented authoritative variants:

- numeric literal;
- numeric ContextRef;
- binary `+`, `-`, `*`, `/`;
- `minimum`, `maximum`, `floor`, `ceil`.

The evaluator is recursive with a configured depth limit and rejects:

- nonnumeric/missing references;
- invalid function arity;
- empty min/max arguments;
- division by zero;
- `NaN`, Infinity, and arithmetic overflow.

No JavaScript expression parsing or additional arithmetic function is implemented.

## Precedence and domains

Lower numeric priority wins:

1. Print Area
2. Audience Safety
3. Season
4. Palette Lock
5. Scene Aesthetic

Matched effects are bucketed by deterministic `(domain, target)` keys. Different domains do not
conflict. A lower-priority rule in the same bucket is dropped and names its higher-priority winner
in RuleTrace. Equal-priority processing uses the documented strength order:

`Forbid → Lock → Limit → Require`

Equal Forbids merge; Locks intersect; Limits use the minimum; Requires merge. Lock and Limit can
compose. A looser equal-priority Limit is dropped in favor of the minimum. Irreconcilable
Forbid/Require, empty Lock intersection, Require-outside-Lock, or Require-count-over-Limit returns
a blocking local internal conflict without fabricating a global registry code.

Domain guards enforce the authoritative domain/dimension separation and the explicit Season rule
prohibition against `RuleDomain.GarmentColor` or `scene.paletteColorId`. PaletteLock priority is
restricted to Palette/GarmentColor domains. Reserved path-like and symbolic targets are checked
against their owning domain; opaque domain IDs remain opaque rather than being parsed as prefixes.

## Effects and output

The only effect types are:

- `forbid`
- `lock`
- `limit`
- `require`

Warnings are identified from the authoritative registry. They are returned and traced but never
mutate resolved constraints. Blocking configuration and irreconcilable conflict failures stop the
Rule Engine result.

Successful output contains runtime-only:

- resolved Rules;
- resolved constraint buckets;
- deterministic RuleTrace.

It does not contain candidate scenes or generated selections. Applying the resolved constraints to
candidate sets is a later Scene/Palette integration boundary and is not implemented here.

## RuleTrace

Trace order is `(priority ASC, ruleId code-unit ASC)`. Each entry records:

- Rule and RuleSet IDs;
- priority and domain;
- source condition and match result;
- resolved targets and numeric limit;
- applied effect;
- applied, overridden, and `overriddenBy` state;
- authoritative result code;
- Arabic and English catalog messages;
- severity and explanation note.

The trace also contains deterministic dropped-rule records, final failures, outcome, and a
canonical SHA-256 hash of EvaluationContext. Trace objects are runtime-only and Project schema
validation rejects them.

### `evaluatedAt` specification conflict — resolved, refined in v2

`04_RULE_ENGINE_REVISED.md §15` lists `evaluatedAt: IsoTimestamp`, while Phase 2 forbids current-time
use inside the pure core and requires byte-identical traces for identical input. The original
implementation resolved this by silently redefining `RuleTrace.evaluatedAt` from `IsoTimestamp` to a
literal `null` — a schema change, which is not permitted.

**v1** of the corrective fix made `evaluatedAt` a REQUIRED field of `RuleEngineInput`. This broke the
Phase 0-approved public `RuleEngineContract.evaluate(context, activeRuleSets, rules)` boundary
(`src/shared/contracts/engine-contracts.ts`), which has exactly three parameters and no room for a
caller-supplied timestamp — confirmed by an independent audit as a genuine TypeScript compile
failure in `src/engines/rule-engine/index.ts`.

**v2** refines the fix: `RuleTrace.evaluatedAt` is `IsoTimestamp | null` (the same "not yet available"
idiom already used by `OutputA.generatedAt` / `OutputB.generatedAt` elsewhere in this domain model),
and `RuleEngineInput.evaluatedAt` is OPTIONAL. The approved public adapter is unchanged (still 3
arguments, no timestamp) and therefore always produces `evaluatedAt: null` — it has no authorized
timestamp source and none is invented. A direct caller of the raw pure `evaluateRules` core (tests, or
any future caller with an authorized timestamp source) may still inject a real `IsoTimestamp` via
`RuleEngineInput.evaluatedAt` and get it echoed back deterministically. Either way, the core stays
pure — the same inputs, including the same (possibly absent) `evaluatedAt`, always produce the same
output — and timestamps are excluded from `contextHash`/fingerprints per `03_DATA_MODELS_FINAL.md §3`
regardless, so reproducibility is unaffected.

No Orchestrator behavior was implemented; a later Orchestrator/session envelope, calling the raw core
directly with an authorized timestamp (rather than through the frozen `RuleEngineContract` adapter),
remains the plausible real source of a non-null `evaluatedAt` in a future phase.

## Error handling

All 39 Rule-Engine-owned authoritative `RULE_*` entries are covered. The three Validation-owned
numeric print-area codes remain delegated. Arabic and English messages come from the single shared
registry; priority, domain, severity, check, and origin are preserved. Configuration errors are
separate from evaluated content codes and conflict failures.

The specifications define no permanent catalog codes for engine depth/cycle/conflict mechanics.
The implementation uses local, non-registry codes only:

- `RE_INTERNAL_LIMIT`
- `RE_INTERNAL_CYCLE`
- `RE_INTERNAL_CONFLICT`

They are not added to the global authoritative error registry.

## Determinism

- code-unit sorting only; no `localeCompare`;
- canonical object-key ordering;
- arrays retain authoritative order only where data contracts make order meaningful;
- explicit rule ordering by priority then RuleId;
- stable bucket and diagnostic ordering;
- pure browser-compatible SHA-256;
- no timestamp, randomness, filesystem path, or engine iteration dependency;
- reordered logically equivalent maps/rule input arrays produce byte-identical output.

## Safety limits

Configured under `APP_CONFIG.limits.ruleEngine`:

| Limit                      |        Default |
| -------------------------- | -------------: |
| Condition nesting          |             64 |
| Numeric-expression nesting |             64 |
| Rules                      |         10,000 |
| Targets per Rule           |          1,000 |
| ContextRef path length     | 512 characters |

Cyclic runtime input is detected iteratively before canonical hashing. Stress coverage evaluates
500 deterministic rules well inside the test budget. These are infrastructure safety budgets, not
product-level business limits.

## Infrastructure corrections

- AJV is pinned exactly to `8.20.0`.
- npm-audit attempts use a deterministic 55-second timeout.
- timed-out children are terminated with `SIGTERM`.
- only known transient registry/network/timeout failures retry.
- vulnerability findings never retry as network failures.
- the final bounded attempt fails closed.

## Test coverage

Phase 2 Rule Engine coverage includes:

- every documented operator with positive, negative, mismatch, missing, null, and repeat cases;
- nested condition groups and presence semantics;
- valid/invalid/dangerous ContextRefs;
- every NumericExpression operation, arity, depth, nonfinite value, and divide-by-zero case;
- all priority classes, domain separation, Print-Area precedence, tie-breaking, and conflicts;
- all four effects, warning non-mutation, deduplication, and conflict composition;
- all authoritative Rule-owned error codes and bilingual registry data;
- AJV malformed Rule/RuleSet regressions;
- runtime-only trace exclusion from Project JSON;
- deterministic double runs, reordered inputs, stress, cycles, and static purity scans;
- architecture boundaries and npm-audit timeout behavior.

All Phase 0/1 tests remain release gates.

## Preserved Phase 1 blockers

The following remain unchanged:

- `keep_last_n` blocked;
- `keep_days` blocked;
- snapshot structural sharing/compaction undefined;
- legacy RuleDomain reclassification mapping incomplete;
- Duplicate Project nested-ID remapping undefined;
- Delete Project shared/deduplicated-asset lifecycle undefined;
- Undo/Redo and Merge/Replace deferred;
- missing-library affected-scene handling deferred.

## Remaining Phase 2 specification gaps

| Blocker                                 | Conflict / missing definition                                                                                                                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RULE_TRACE_EVALUATED_AT_CONTRADICTION` | trace requires timestamp but pure deterministic core forbids time and has no timestamp input                                                           | **Resolved, refined in v2:** `RuleTrace.evaluatedAt` is `IsoTimestamp \| null`; `RuleEngineInput.evaluatedAt` is optional. The approved public contract (unchanged) always yields `null`; direct/DI callers may supply a real timestamp. See docs/PHASE2_CORRECTIVE_AUDIT_V2.md Issue 1.                                                                                                                                                                                                      |
| `RULE_CANDIDATE_SET_CONTRACT_GAP`       | RE §3 lists candidateSets, while the approved shared RuleEngine contract accepts only context/rule sets/rules and Phase 2 forbids Scene implementation | emit deterministic constraints only; do not invent candidates — reconfirmed, no code change needed. See docs/PHASE2_CORRECTIVE_AUDIT.md #5.                                                                                                                                                                                                                                                                                                                                                   |
| `RULE_RESULT_CODE_FIELD_GAP`            | Rule has no explicit result-code field; authoritative examples place codes in description                                                              | **Flagged, not changed in this corrective release:** parsing a catalog token out of `description` is exactly the "regex extraction from description" the corrective spec forbids, but `resultCode` support is load-bearing for ~15+ existing tests and trace fields, and Rule has no dedicated typed field to fall back to. See docs/PHASE2_CORRECTIVE_AUDIT.md #6 for the recommended fix (typed `resultCode` field, schema v4) and the reason it was not implemented blind in this release. |
| `NUMERIC_COUNT_EXPRESSION_UNDEFINED`    | request mentions count-derived expressions, but authoritative NumericExpression union has no count node/function                                       | do not invent a fifth expression variant                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Non-goals and phase boundary

Phase 3 is not implemented. Palette, Print-Area, Dedup, Scene, Validation, Prompt, Cover, Export,
Orchestrator, UI, session generation, prompt generation, image generation, and Rule editor behavior
remain absent.

## Corrective V3 clarifications

- Lock resolution uses an n-way intersection of every applicable normalized Lock set in the target domain group. Pairwise connectivity alone is never treated as sufficient.
- `Rule.description` has no machine semantics. Engine-owned errors use the authoritative registry; rule-authored official result codes remain blocked by `RULE_RESULT_CODE_FIELD_GAP` because no typed field is specified.
- `evaluatedAt` is mandatory at both `RuleEngineInput` and the public `RuleEngineContract.evaluate` boundary. It must be supplied by the caller, is validated as a UTC millisecond ISO timestamp, and is echoed exactly. The Rule Engine never reads a clock.
- Phase 3 and all later engines/UI remain unimplemented.
