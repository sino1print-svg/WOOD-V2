# Phase 2 Corrective Audit

Status: **Phase 2 corrective release — not yet re-approved.** Baseline: Phase 0 approved, Phase 1
approved, Phase 2 implemented-but-not-approved prior to this corrective pass. This document does
not approve Phase 2; it records what was found and fixed so the release can be re-reviewed.

Authoritative specifications remain the twelve files under `docs/spec/` (unchanged by this
release). No Phase 3 work, UI work, or persistence changes beyond what Issue 1/2 strictly required
were performed.

## How this audit was produced

Each of the seven corrective issues was investigated by reading the actual source
(`src/engines/rule-engine/*`), the actual test suite (`test/rule-engine/*`), and the actual
authoritative spec/error-catalog files — not by assumption. Findings below cite the exact files and
line-level evidence found.

**Verification limitation, disclosed up front:** this sandbox's `npm` is pointed at an internal
package gateway that returns `403 Forbidden` for `ajv` (a direct dependency, pulled in by both the
runtime schema validation and by `eslint`), so `npm ci`, `npm install`, `npm run test`,
`npm run typecheck`, `npm run lint`, `npm run build`, `npm audit`, and `npm run verify*` could not
be executed here. **None of the "Verification" or "total tests" numbers requested in the task were
produced by an actual test run** — producing fabricated pass/fail counts or a fabricated SHA-256
would be worse than not producing them. Section "What still needs to happen" gives the exact
commands to run locally where npm has real registry access.

---

## Issue 1 — Require vs Forbid precedence (cross-priority)

**Root cause.** `resolveBuckets` in `src/engines/rule-engine/engine.ts` only ran the
Forbid-vs-Require unsatisfiability check across rules tied at the bucket's `winningPriority`
(the `active` array). A `Require` at a _lower_ priority than a winning `Forbid`/`Lock` was pushed
into `dropped` with `reason: 'overridden_by_higher_priority'` and never re-checked — the engine
returned `ok: true` even though the Require's only target had just been removed. This exactly
matches the defect description and is directly demonstrated by the pre-existing test
`test/rule-engine/precedence.test.ts` ("higher priority wins and lower rule is traced as
overridden"), which asserted `result.ok === true` for a PrintArea `Forbid` outranking a
SceneAesthetic `Require` on the same target.

**Fix.** `resolveBuckets` now collects every `Require` in the _whole_ bucket (`lowerRequires`), not
just the winning-priority slice, and checks each one against the winning `Forbid`/`Lock`. If the
required target is forbidden outright, or excluded from the winning lock's intersection, the bucket
is marked `blocked`, a `RE_INTERNAL_CONFLICT` failure is emitted naming both the Require rule and
the specific rule that blocked it, and the trace entry for the Require rule gets
`overridden: true`, `overriddenBy: <blocking rule id>`, and
`note: 'blocking_conflict_require_removed_by_higher_priority'`.

**Regression tests** (`test/rule-engine/precedence.test.ts`):

- `CORRECTIVE #1: higher priority Forbid removing a lower-priority Require target blocks` — the
  exact defect reproduction, replacing the old test (see "Replaced tests" below).
- `higher priority Forbid still simply overrides a lower priority Forbid on the same target
(non-blocking case preserved)` — confirms ordinary priority override (no Require involved) still
  behaves as before.

---

## Issue 2 — Resolved-target bucketing

**Root cause.** `targetBucketKey` (`src/engines/rule-engine/resolve.ts`) keyed buckets on the
_unresolved_ `RuleTarget` expression (`literal:black` vs `contextRef:session.colorSelection.colorIds`),
called from `buildBuckets` in `engine.ts` using `item.rule.effect.targets[targetIndex]` (the source
expression), not the resolved value. Two rules resolving to the identical value never landed in the
same bucket if they used different `RuleTarget` kinds to get there.

**Fix.** `buildBuckets` now keys on `resolvedBucketKey(target.resolved)` — the sorted, joined
_resolved_ value array — combined with `rule.domain`. `targetBucketKey` is kept in `resolve.ts` only
as a documented historical reference; it is no longer imported or called by the engine.

**Regression tests** (`test/rule-engine/precedence.test.ts`):

- `CORRECTIVE #2: a ContextRef target and a Literal target that resolve to the same value conflict`
  — a Literal Forbid on `"black"` and a ContextRef Require resolving to `["black"]` now correctly
  conflict.
- `CORRECTIVE #2: distinct resolved values still land in different buckets and coexist` — confirms
  the fix didn't over-merge unrelated targets.

---

## Issue 3 — Priority ↔ Domain ownership

**Root cause.** `validateDomainIsolation` (`src/engines/rule-engine/domains.ts`) only rejected two
specific combinations (`Season` + `GarmentColor`, `PaletteLock` outside `GarmentColor`/`Palette`).
Every other `(RulePriorityClass, RuleDomain)` pair — including the example given in the corrective
brief, `priority: PrintArea, domain: Composition` — was accepted.

**Fix.** Added an authoritative `PRIORITY_DOMAINS` map and `priorityDomainAllowed()` check that
runs first in `validateDomainIsolation`, replacing the two ad-hoc checks. The map was **not**
derived from prose guesswork alone: it was cross-checked against every `(priorityClass, domain)`
pair actually declared for `RULE_*`, `EngineId.Rule`-owned entries in
`src/shared/errors/registry.ts` (36 catalog entries, 14 unique pairs), so the mapping cannot reject
any combination the authoritative error catalog itself already relies on. `PrintArea` is limited to
`PrintArea`/`Background`/`Output` (obstruction, background text, collage/blank-sale-image per the
"Governs" column of `04_RULE_ENGINE_REVISED.md §2`) — which still rejects `PrintArea + Composition`
as required.

**Regression tests** (`test/rule-engine/domain-isolation.test.ts`, new `describe` block
`CORRECTIVE #3`):

- The literal example from the brief (`PrintArea` + `Composition`) is rejected with `RULE_CFG_003`.
- An `it.each` table permits all 17 authoritative pairs.
- An `it.each` table rejects 8 representative invalid pairs.

---

## Issue 4 — Pre-flight validation

**Root cause.** `validateInput` already checked `session.audience`, `session.season`,
`session.colorSelection.colorIds`, and `session.requestedSceneCount` before evaluation, but not
`session.productIds`, despite `04_RULE_ENGINE_REVISED.md §4.2` listing `productIds` as part of the
mandatory session scope (`PRODUCT (scoped: productIds)`).

**Fix.** Added a `productIds` presence/non-empty check to `validateInput`, using the generic
`RULE_CFG_001` structural code (no dedicated catalog code exists for this specific gap; this is
consistent with how the function already handles other structural pre-flight failures).

_No dedicated regression test file was added for this one field_, because the field is exercised
implicitly by every existing test through the `context()` fixture; a targeted test should be added
in `test/rule-engine/schema-and-purity.test.ts` alongside the other pre-flight tests (see "What
still needs to happen").

---

## Issue 5 — CandidateSet contract

**Audit finding: already compliant, no code change made.** `04_RULE_ENGINE_REVISED.md §3.2` lists
`candidateSets: Map<Dimension, CandidateSet>` as an algorithm input, but `CandidateSet` is never
defined anywhere in `docs/spec/`, and `grep -rn "CandidateSet" src/` returns nothing — the
implementation never invents or pretends to implement candidate-set filtering.
`docs/PHASE2_RULE_ENGINE.md` already documents this precisely as `RULE_CANDIDATE_SET_CONTRACT_GAP`
("emit deterministic constraints only; do not invent candidates") and states explicitly
("It does not contain candidate scenes or generated selections. Applying the resolved constraints
to candidate sets is a later Scene/Palette integration boundary and is not implemented here.").
This already distinguishes Implemented (constraint resolution) from Deferred to later engine
(candidate filtering) and correctly has no "Blocked by specification" claim of full feasibility
support. No fix was required; the audit re-confirms the gap documentation is accurate against the
current code.

---

## Issue 6 — Rule result codes

**Root cause confirmed, not fixed in this release — see justification below.**
`resultCodeFromDescription` (`src/engines/rule-engine/failures.ts`) uses a regex
(`/\bRULE_[A-Z0-9]+_[A-Z0-9]+\b/g`) against `rule.description` to derive a result code, exactly the
practice the corrective brief forbids. `Rule` (`src/shared/domain-model/rules.ts`) has no dedicated
`resultCode` field — `description?: string` is the only free-text field on the type.

**Why this was not changed blind in this release.** This mechanism is not a stray shortcut; it is
already a consciously documented decision in `docs/PHASE2_RULE_ENGINE.md`
(`RULE_RESULT_CODE_FIELD_GAP`: "Rule has no explicit result-code field ... parse exact catalog token
from description and validate ownership/domain/priority"), and it is load-bearing for a large,
verified slice of the existing suite:

- `test/rule-engine/trace-and-errors.test.ts` — `it.each` over every `RULE_*`, `EngineId.Rule`-owned
  catalog entry constructs a rule via `description` and asserts `trace.resultCode` matches;
  `warning is bilingual, traced, and never mutates constraints`; `records matched, unmatched,
applied and deterministic ordering`.
- `test/rule-engine/schema-and-purity.test.ts` — `rejects a result code whose catalog
priority/domain do not match the Rule`; `rejects Validation-owned RULE_ codes as Rule Engine
configuration`.

Removing the mechanism outright, without the ability to run the suite in this sandbox (see
verification limitation above) and confirm what breaks, risks silently regressing all of the above
in a release explicitly scoped to _fix_ regressions. The mechanism is retained, and the validation
half of it (rejecting a description-embedded code whose catalog priority/domain/origin-engine don't
match the Rule) is a genuine safety net that softens — without eliminating — the risk of the
forbidden free-text parsing.

**Recommended real fix (not implemented here):** add an optional, typed `resultCode?: RuleResultCode`
field to `Rule` in `src/shared/domain-model/rules.ts`, bump `schemaVersions.ruleSet`, add the field
to `schemas/rule.schema.json`, and switch `resolveRules`/`validateInput` to read that field instead
of parsing `description`. That is a genuine (if narrow) schema change, which is why it was not done
as part of a release whose brief says "do not redesign architecture" and which cannot currently be
verified end-to-end here.

---

## Issue 7 — RuleTrace contract (`evaluatedAt`)

**Root cause.** `RuleTrace.evaluatedAt` (`src/shared/domain-model/evaluation.ts`) had been changed
from the authoritative `IsoTimestamp` (`03_DATA_MODELS_FINAL.md §3.14`,
`04_RULE_ENGINE_REVISED.md §15`) to a literal-`null` type, with a comment pointing at
`RULE_TRACE_EVALUATED_AT_CONTRADICTION`. This is a real, deliberately-made tradeoff (the pure core
cannot call a clock) — but it is also a schema redefinition, which the corrective brief explicitly
forbids ("Do not redefine schema").

**Fix.** Restored `RuleTrace.evaluatedAt: IsoTimestamp`. Added `evaluatedAt: IsoTimestamp` as a
**required field of `RuleEngineInput`** (`src/engines/rule-engine/types.ts`), supplied by the
caller. `engine.ts` now threads `input.evaluatedAt` through every trace it constructs (`emptyTrace`
and the final trace) instead of a literal `null`. The core function is still pure — same inputs,
including the same `evaluatedAt`, always produce the same output — and timestamps are excluded from
`contextHash`/fingerprints per `03_DATA_MODELS_FINAL.md §3`, so reproducibility is unaffected.

**Regression test** (`test/rule-engine/schema-and-purity.test.ts`):

- `CORRECTIVE #7: evaluatedAt echoes the caller-supplied IsoTimestamp (was: schema redefined to
null)`, replacing the old test (see "Replaced tests" below).

`docs/PHASE2_RULE_ENGINE.md` was updated (not `docs/spec/`) to describe the resolved contract and
the public `evaluateRules` signature now shown with `evaluatedAt`.

---

## Replaced tests (old expectation / new expectation / reason / source)

| Test                                                                                                                                            | Old expectation                                                                   | New expectation                                                                                                  | Reason                                                                                                                               | Source                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `precedence.test.ts` — "higher priority wins and lower rule is traced as overridden" → renamed `CORRECTIVE #1: ...`                             | `result.ok === true`; Require silently dropped as `overridden_by_higher_priority` | `result.ok === false`; `RE_INTERNAL_CONFLICT`; trace note `blocking_conflict_require_removed_by_higher_priority` | Encoded Issue 1's defect verbatim: a Require whose only target is forbidden by a higher-priority rule must block, not silently pass. | `docs/spec/04_RULE_ENGINE_REVISED.md` §3.3 step 5, §3.5                              |
| `schema-and-purity.test.ts` — "returns the deterministic null evaluatedAt placeholder required by the pure core" → renamed `CORRECTIVE #7: ...` | `trace.evaluatedAt === null`                                                      | `trace.evaluatedAt === data.evaluatedAt` (caller-supplied `IsoTimestamp`)                                        | Encoded the forbidden schema redefinition (Issue 7).                                                                                 | `docs/spec/03_DATA_MODELS_FINAL.md` §3.14; `docs/spec/04_RULE_ENGINE_REVISED.md` §15 |

Both replaced tests also had their original priority/domain combination
(`PrintArea` + `Composition`) changed to `PrintArea` + `Output` where needed, because Issue 3's fix
now correctly rejects `PrintArea` + `Composition` as an invalid rule configuration — the same
combination the corrective brief calls out as the concrete example that "must be rejected." Using it
in a Require/Forbid precedence test would no longer reach the precedence logic at all.

## New regression tests added

- `precedence.test.ts`: 4 new tests (Issues 1 and 2, see above).
- `domain-isolation.test.ts`: 3 new tests / `it.each` blocks, 26 total cases (Issue 3).

## Files changed

- `src/engines/rule-engine/engine.ts` — Issues 1, 2, 4, 7.
- `src/engines/rule-engine/resolve.ts` — Issue 2 (deprecated `targetBucketKey`, documented only).
- `src/engines/rule-engine/domains.ts` — Issue 3.
- `src/engines/rule-engine/types.ts` — Issue 7 (`RuleEngineInput.evaluatedAt`).
- `src/shared/domain-model/evaluation.ts` — Issue 7 (`RuleTrace.evaluatedAt` type restored).
- `test/rule-engine/fixtures.ts` — Issue 7 (`input()` now supplies a fixed `evaluatedAt`).
- `test/rule-engine/precedence.test.ts` — Issues 1, 2.
- `test/rule-engine/domain-isolation.test.ts` — Issue 3.
- `test/rule-engine/schema-and-purity.test.ts` — Issue 7.
- `docs/PHASE2_RULE_ENGINE.md` — Issues 5 (re-confirmed), 6 (flagged), 7 (documented resolution).

No file under `docs/spec/` was modified. No Phase 3, UI, or unrelated persistence code was touched.

## Remaining specification blockers (not fixed, by design)

1. **`RULE_RESULT_CODE_FIELD_GAP` (Issue 6)** — result codes are still derived from
   `Rule.description` via regex. Flagged as non-compliant with "no regex extraction from
   description"; not changed in this release for the reasons in Issue 6 above. Recommended fix:
   typed `resultCode` field, schema v4.
2. **`RULE_CANDIDATE_SET_CONTRACT_GAP` (Issue 5)** — re-confirmed, unchanged. `CandidateSet` remains
   undefined by the specifications; the engine correctly does not implement candidate filtering.

## What still needs to happen (could not be done in this sandbox)

Run, in an environment with real npm registry access:

```
npm ci
npm audit
npm audit --omit=dev
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run verify:determinism
npm run build
npm run verify
npm run verify:full
```

Given the scope of the changes (bucketing algorithm, blocking logic, a domain-model type change,
and a new required `RuleEngineInput` field), expect `typecheck` and `test` to be the first checks
that need a look — in particular, confirm no other caller of `RuleEngineInput` outside
`test/rule-engine/` needs the new `evaluatedAt` field (a repo-wide grep at the time of this audit
found none outside `src/engines/rule-engine/` and `test/rule-engine/`, but that should be
re-verified after `npm ci` succeeds). Only after a clean `npm run verify:full` should Phase 2 be
considered for re-approval, and only then should the `-fixed.zip` / SHA-256 values / final
corrective report be generated from an actually-verified tree.
