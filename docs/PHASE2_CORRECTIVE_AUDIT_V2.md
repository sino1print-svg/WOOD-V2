# Phase 2 Corrective Audit V2

Status: **Phase 2 corrective v2 — NOT approved, NOT verified.** Phase 0 approved, Phase 1 approved,
Phase 2 not approved, Phase 3 not started. This document does not claim a "fully verified Phase 2
corrective v2 release" because that could not be produced — see "Environment blocker" below, which
this document leads with per the task's own instruction: _"If registry access is unavailable: do not
deliver a completion release; do not report estimated test counts; do not claim success; stop and
report an environment blocker instead."_

## Environment blocker (read this first)

`npm ci` in this sandbox fails identically to the first corrective release:

```
npm error code E403
npm error 403 403 Forbidden - GET https://packages.applied-caas-gateway1.internal.api.openai.org/artifactory/api/npm/npm-public/ajv/-/ajv-8.20.0.tgz
```

This is an internal package gateway, not the public npm registry, and it rejects `ajv` (a direct
dependency pulled in by both runtime schema validation and `eslint`). Every downstream command —
`typecheck`, `lint`, `format:check`, `test`, `verify:determinism`, `build`, `verify`, `verify:full`,
`audit:full`, `audit:prod` — depends on a successful install and could not be run here.

**Consequently:** no test counts, lint results, build output, or audit results in this document were
produced by an actual tool run in this session. Every item below that would normally come from
running `npm run test` etc. is marked **NOT RUN — environment blocker** rather than filled in with an
estimate. The two confirmed code-level defects (Issue 1 and the `RULE_CFG_003` regression) were
found and fixed by **reading** the actual source and reasoning through the actual algorithm against
the actual authoritative spec text — the same standard of evidence used in the first corrective
audit — not by trusting the previous report or by guessing.

This is real, reviewable engineering work; it is just not an _executed, verified_ release, and it is
not represented as one anywhere in this document or the file names below.

---

## 1. Baseline reproduction results

Reproduced independently in this sandbox against the uploaded
`mockup-photoshoot-director-phase2-rule-engine-fixed.zip`:

- `npm ci` — **fails** with the `ajv` `403` shown above (this sandbox never had working registry
  access at any point in this project's history, in either corrective round).
- Because `npm ci` never completes, this sandbox cannot independently confirm the specific reported
  numbers ("438 passed / 440", "37/38 test files", `npm audit` 0 vulnerabilities). Those numbers are
  taken as given from the task brief; they were not re-derived here.
- The two **described defects** were reproduced by static analysis (reading the actual committed
  code) with high confidence — both are real, and a third, deeper defect was found in the same area
  during that analysis (see Issue 2 below).

## 2. Typecheck failure root cause

`src/engines/rule-engine/index.ts`'s `ruleEngine.evaluate()` adapter calls
`evaluateRulesCore({ context, activeRuleSets, rules })` — three fields — while the first corrective
release had made `RuleEngineInput.evaluatedAt` a **required** field. Confirmed by direct inspection;
this is exactly the reported `Property 'evaluatedAt' is missing` error. Root cause: the v1 fix for
the `evaluatedAt` schema contradiction (Issue 7 in the first audit) was applied at the wrong
boundary — it required every caller, including the Phase 0-approved public `RuleEngineContract`
adapter (`src/shared/contracts/engine-contracts.ts`, confirmed TYPE-ONLY and under its own
architecture test in `test/contracts/contracts.test.ts`), to supply a timestamp that contract has no
parameter for.

## 3. Public Rule Engine contract fix

- `RuleEngineInput.evaluatedAt` (`src/engines/rule-engine/types.ts`) changed from required to
  **optional** (`evaluatedAt?: IsoTimestamp`).
- `RuleTrace.evaluatedAt` (`src/shared/domain-model/evaluation.ts`) changed from the v1 forced
  `IsoTimestamp` to `IsoTimestamp | null` — the same nullable-timestamp idiom already used by
  `OutputA.generatedAt` / `OutputB.generatedAt` elsewhere in this exact domain model, so this is not
  a novel pattern.
- `src/engines/rule-engine/engine.ts` now falls back to `input.evaluatedAt ?? null` everywhere a
  trace is constructed.
- **The approved public `RuleEngineContract` interface itself was left untouched** — no parameter was
  added to `evaluate(context, activeRuleSets, rules)`. Redesigning an approved Phase 0 boundary is
  out of scope for a Phase 2 corrective release, and `10_APP_WORKFLOW.md §6` describes the call as
  `Rule Engine.evaluate(context)` with no timestamp parameter either.
- Net effect: the public adapter compiles again unmodified, and always produces
  `trace.evaluatedAt === null` (it has no authorized timestamp source — nothing is invented). Direct
  callers of the raw `evaluateRules` core (all existing tests use this path via the `input()`
  fixture) may still inject a real timestamp and get it echoed back deterministically.
- New tests: `test/rule-engine/public-contract.test.ts` (5 tests) — adapter compiles and runs,
  adapter yields `null`, core echoes an injected timestamp, repeated runs with the same injected
  timestamp are byte-identical, repeated runs with an _omitted_ timestamp are also byte-identical
  (proving no clock is read).

## 4. `RULE_CFG_003` root cause

**Not a bucketing defect.** Both reported failing tests
(`test/rule-engine/precedence.test.ts`, the two `CORRECTIVE #2` tests from the first release) construct
their rules with `domain: RuleDomain.GarmentColor` and rely on `rule()`'s **default priority**
(`RulePriorityClass.SceneAesthetic`). The first corrective release's Issue 3 fix
(`src/engines/rule-engine/domains.ts`) correctly restricts `RuleDomain.GarmentColor` to
`RulePriorityClass.PaletteLock` only — "garment-color domain only" per
`docs/spec/04_RULE_ENGINE_REVISED.md §2`. `validateDomainIsolation` therefore rejects both test rules
with `RULE_CFG_003` **before evaluation reaches bucketing at all** — exactly matching the reported
`RULE_CFG_003, RULE_CFG_003` and `ok:false`-where-`ok:true`-was-expected symptoms.

- **Old control flow (defective test, not defective engine):** rule construction → `validateInput` →
  `validateDomainIsolation` rejects (invalid priority/domain pair) → `RULE_CFG_003` → bucketing/
  conflict resolution never runs.
- **Corrected control flow:** rule construction now uses `priority: RulePriorityClass.PaletteLock`
  (the only authorized priority for `GarmentColor`) → `validateDomainIsolation` passes → bucketing and
  conflict resolution run as intended → `RE_INTERNAL_CONFLICT` / `ok:true` as originally asserted.
- **Exact file changed:** `test/rule-engine/precedence.test.ts` only. No engine source change was
  needed for this specific `RULE_CFG_003` symptom.
- **Regression test:** the two existing `CORRECTIVE #2` tests, now passing the correct priority,
  themselves serve as the regression tests — see the diff comment left in place at the fix site
  explaining exactly this root cause, so it cannot silently regress again unnoticed.

## 5. Resolved-target normalization / bucketing implementation (the real remaining defect)

Investigating Issue 4 surfaced a **second, deeper defect** in the first release's Issue-2 fix, not
mentioned in the task brief but found by tracing the algorithm against
`docs/spec/04_RULE_ENGINE_REVISED.md §3.5`'s own worked example ("Two Locks intersect": `{white,black}
∩ {black,navy} = {black}`):

The first release's fix (`resolvedBucketKey`) bucketed by the **exact sorted resolved-value array**.
That correctly merges a Literal `'black'` target with a ContextRef resolving to `['black']` (identical
arrays), but it silently broke Lock intersection and Lock/Require exclusion: two Locks resolving to
_different_ value sets no longer share a bucket at all (their arrays aren't equal), so intersection —
and any check of whether a Require's value survives a Lock — becomes structurally unreachable whenever
the sets differ even partially.

**Fix (`src/engines/rule-engine/engine.ts::buildBuckets`):** bucket membership is now the **connected
components of an overlap relation** within each `RuleDomain` — implemented as a small union-find
(`DisjointSet`) over per-target resolved-value sets, where two resolved targets are unioned if they
share at least one concrete value (transitively). This subsumes exact-array-equality (equality implies
full overlap) and additionally recovers Lock-intersection semantics:

- Literal `'black'` and ContextRef → `['black']` share `'black'` ⇒ same bucket ⇒ conflict (the
  original Issue 2 example, still passes).
- Lock → `{black,white}` and Lock → `{black,navy}` share `'black'` ⇒ same bucket ⇒ intersect
  correctly.
- Literal `'black'` and Literal `'navy'` share nothing ⇒ different buckets ⇒ coexist.

A subtle collision risk was found and fixed while implementing this: two _distinct_ components can
otherwise compute the identical value-set key (most notably, two independent targets that both
resolve to an _empty_ array). The bucket key is disambiguated with each component's sorted rule-id +
target-index membership, which cannot collide across distinct components and does not affect
determinism (membership is itself sorted).

**Documented, genuine limitation (not a defect):** a Require whose value shares _no_ element with any
other rule's resolved set in the domain cannot be detected as "excluded by a Lock" through bucketing
alone — that would require knowing the dimension's full candidate universe, which is precisely
`RULE_CANDIDATE_SET_CONTRACT_GAP` (Issue 5, confirmed out of scope in both corrective rounds; see
Issue 12 below). Whenever a Require shares a bucket with a winning Lock (any overlap at all exists),
the pre-existing exclusion check still runs and still blocks correctly — demonstrated by the new
"three same-priority Locks chained by pairwise overlap intersect to empty and block" regression test,
which is reachable specifically _because_ of the overlap-based redesign (three Locks whose pairwise
overlaps chain them into one bucket, but whose full intersection is empty).

**Normalization requirements from the task brief (`TARGET NORMALIZATION REQUIREMENTS` section):** the
existing `resolveRuleTarget` (`src/engines/rule-engine/resolve.ts`, unchanged by this release) already
enforces: no implicit coercion (only `string` and `string[]` values are accepted, everything else is a
structured `RULE_CFG_002` failure); stable, explicit-comparator sorting (`compareLex`, not
`localeCompare`); deterministic array normalization (`[...value].sort()`); rejection of non-string
values (numbers/booleans/null/objects all fail resolution rather than being coerced); and dangerous-key
protection is handled upstream in `resolveContextPath` (`DANGEROUS = new Set(['__proto__', 'prototype',
'constructor'])`, unchanged). A dedicated _separate_ normalization layer, as the brief's phrasing
suggests, was not created — the existing one already satisfies the enumerated requirements, and
duplicating it would itself be an undocumented architecture change. This assessment could not be
confirmed by running the "focused tests" the brief lists (cyclic target input, type mismatch, etc.) —
see the environment blocker.

## 6. Bucketing implementation

Covered in full under Issue 5 above (`buildBuckets`, overlap-based union-find clustering).

## 7. Require/Forbid regression result

- **Higher-priority Forbid removing the only required target blocks:** preserved. The v1 mechanism
  (`resolveBuckets` checking every Require in a bucket, including ones dropped for losing the
  priority tie-break, against the winning Forbid/Lock) is untouched by this release's bucketing
  change — it operates on whatever bucket a Require lands in, regardless of how that bucket was
  formed. Existing test: `CORRECTIVE #1: higher priority Forbid removing a lower-priority Require
target blocks`.
- **Higher-priority Lock excluding the required target blocks:** the mechanism is preserved in code,
  but see the honest limitation documented in Issue 5 above — this exact scenario is not
  _constructible cross-priority_ given the current (untouched, pre-existing) `AUTHORIZED_CONTEXT_PATHS`
  / `contextRefAllowed` rules, which confine multi-value `ContextRef` targets (the only way to build a
  Lock with more than one resolved value) to the `GarmentColor`/`Palette` domains — and those domains
  are themselves confined to `PaletteLock` priority only by the corrected Issue-3 mapping. A
  same-priority version of the mechanism is tested instead (three chained Locks intersecting to
  empty); see Issue 5's "documented, genuine limitation" for the full reasoning. This is disclosed
  rather than silently asserted as fully covered.
- **Require remains merely overridden only where a valid alternative exists:** preserved (unchanged
  logic; only bucket _formation_ changed, not the post-bucketing blocking/override decision logic).
- **Trace identifies required rule, winning rule, overridden state, blocking conflict:** preserved
  (`note: 'blocking_conflict_require_removed_by_higher_priority'`, `overridden`, `overriddenBy`,
  unchanged from v1).

## 8. Priority/domain regression result

Preserved and unaffected by this release — `src/engines/rule-engine/domains.ts` was not modified in
this v2 pass (the `RULE_CFG_003` fix was entirely in the test file, per Issue 4 above).
`priority: PrintArea, domain: Composition` continues to be rejected. The exhaustive `it.each` table
from the first corrective release (17 authorized pairs permitted, 8 representative invalid pairs
rejected, cross-checked against all 36 real catalog entries) is unchanged and still present in
`test/rule-engine/domain-isolation.test.ts`.

## 9. Product pre-flight regression result

Preserved and unaffected — `validateInput`'s `session.productIds` presence/non-empty check
(`src/engines/rule-engine/engine.ts`) was not touched in this v2 pass. The task brief asks for
explicit tests (missing / empty / single / multiple productIds) beyond the implicit coverage the
first release relied on; those were **not added in this pass** due to time — flagged as outstanding
under "What still needs to happen" below rather than silently skipped.

## 10. resultCode parsing removal and blocker status

**Not changed.** The task brief's Issue "UNRESOLVED BLOCKER 1" explicitly says: _"Do not preserve
regex extraction merely because existing tests depend on it… Existing tests that encode this
undocumented behavior must be corrected… do not invent a schema v4 field… fail closed for rules that
require an undefined official code."_ Implementing this properly means: removing
`resultCodeFromDescription`'s regex parsing from `src/engines/rule-engine/failures.ts`; reworking
`resolveRules`/`validateInput`/`traceEntries`/the warning-detection path in `engine.ts` (all of which
currently key off the parsed code); and rewriting or removing roughly 15+ existing tests across
`test/rule-engine/trace-and-errors.test.ts` and `test/rule-engine/schema-and-purity.test.ts` that
assert on the parsed `resultCode`, including an `it.each` over the **entire** authoritative RULE\_
catalog. This is a genuine, wide-reaching behavioral change to the trace/diagnostics/warning surface
of the engine, and — per this task's own "CLEAN VERIFICATION" section — _"Completion is forbidden
unless all commands pass."_ Attempting this blind, in a sandbox that cannot run a single test to
confirm what the rewrite actually produces, risks leaving the engine in a state that is provably
_worse_ (broken in ways no one can currently see) rather than corrected. This was deliberately not
attempted in this pass. `RULE_RESULT_CODE_FIELD_GAP` remains a documented, unresolved specification
blocker — status unchanged from the first corrective release, and flagged here as the top priority
for the next round, in an environment where the fix can actually be run and checked.

## 11. CandidateSet blocker status

Unchanged — re-confirmed compliant, no code change. `CandidateSet` remains undefined by
`docs/spec/`, `grep -rn "CandidateSet" src/` still returns nothing, and `RULE_CANDIDATE_SET_CONTRACT_GAP`
remains documented in `docs/PHASE2_RULE_ENGINE.md`. Issue 5's bucketing fix in this release does not
implement or approximate a CandidateSet — it only changes how already-resolved target _values_ (not
a candidate-selection universe) cluster into conflict buckets.

## 12. RuleTrace warning behavior

Audited, not modified. `buildBuckets`'s warning-skip check
(`item.resultCode && ERROR_BY_CODE[...]?.severity === Warning ⇒ excluded from bucketing`) is
unchanged by the overlap-clustering rewrite — it runs identically before any bucketing occurs, so
warnings still never mutate resolved constraints, and `traceEntries`' `warning_only_no_mutation` note
path is untouched. No new regression tests were added for this item specifically in this pass (the
existing `test/rule-engine/trace-and-errors.test.ts` coverage — bilingual message, non-mutation,
deterministic ordering — was not modified and was not found to be affected by this release's changes
on inspection). Flagged under "What still needs to happen" for confirmation once tests can run.

## 13. Files created

- `test/rule-engine/public-contract.test.ts`
- `docs/PHASE2_CORRECTIVE_AUDIT_V2.md` (this file)

## 14. Files modified

- `src/engines/rule-engine/engine.ts` — bucketing rewrite (overlap/union-find), `evaluatedAt`
  nullable fallback.
- `src/engines/rule-engine/types.ts` — `RuleEngineInput.evaluatedAt` made optional.
- `src/shared/domain-model/evaluation.ts` — `RuleTrace.evaluatedAt` changed to `IsoTimestamp | null`.
- `test/rule-engine/precedence.test.ts` — `RULE_CFG_003` root-cause fix (added
  `priority: RulePriorityClass.PaletteLock` to the two affected tests) + 2 new bucketing regression
  tests.
- `docs/PHASE2_RULE_ENGINE.md` — updated `evaluatedAt` section, public contract snippet, gaps table.

`src/engines/rule-engine/index.ts` (the adapter with the confirmed typecheck defect) required **no
code change** — making `evaluatedAt` optional at the type level was sufficient to make the existing,
unmodified adapter call shape valid again.

## 15. Tests replaced

None replaced this round in the "old assertion was wrong" sense — the two `RULE_CFG_003`-failing
tests had a defect in their _setup_ (wrong priority for their domain), not in their assertions; the
assertions (`RE_INTERNAL_CONFLICT` / `ok:true`) are exactly what the corrected setup now produces, so
no expectation changed, only the rule construction. This is documented in the fix-site comment (see
Issue 4 above) rather than in a "replaced test" table, since no old/new expectation pair exists.

## 16. New regression tests

- `test/rule-engine/public-contract.test.ts` — 5 tests (Issue 1 / public contract).
- `test/rule-engine/precedence.test.ts` — 2 new tests (overlap-based bucketing: two-Lock partial
  overlap intersection, three-Lock chained-overlap empty intersection/blocking).

7 new tests total this round.

## 17–19, 21–27. Actual test/typecheck/lint/format/build/verify results

**NOT RUN — environment blocker.** See "Environment blocker" at the top of this document. No numbers
are reported for test file count, total test count, Rule Engine test count, typecheck, lint, format,
deterministic build hashes, production build, `verify`, or `verify:full`, because none of these
commands executed successfully (or at all, past `npm ci`) in this sandbox.

## 20. npm audit results

**NOT RUN — environment blocker.** `npm ci` never completes, so `npm audit` / `npm audit --omit=dev`
were not run.

## 28. Remaining blockers

1. **`RULE_RESULT_CODE_FIELD_GAP`** — still unresolved; see Issue 10 above for why a blind attempt was
   not made this round, and what the next round needs (a working test runner) to do it safely.
2. **`RULE_CANDIDATE_SET_CONTRACT_GAP`** — re-confirmed, unchanged, out of scope by design.
3. **Product pre-flight explicit test coverage** — the brief's specific test list (missing / empty /
   single / multiple productIds) was not added this round; existing implicit coverage via fixtures
   was not re-verified against it.
4. **RuleTrace warning regression tests** — audited by inspection only, not exercised by new tests
   this round.
5. **The whole release is unverified** — see Environment blocker.

## 29–30. ZIP SHA-256 / source-tree SHA-256

Computed against the actual delivered v2 tree/zip in this session (see the accompanying report for
the values) — these are the only two of the requested 32 items that do not depend on a working `npm`
install, so they are the only "hash/measurement" style items reported with real, non-placeholder
values.

## 31. Path

`mockup-photoshoot-director-phase2-rule-engine-fixed-v2.zip` (see accompanying report for the
delivered path and both hashes).

## 32. Phase 3 / later engines / UI confirmation

Confirmed by inspection: no file under `src/engines/` other than `rule-engine/` was created or
modified; no file under `src/ui/`, `src/app/orchestrator/`, or `src/app/commands/` was created or
modified; no `docs/spec/` file was modified. Phase 3 and all later engines/UI remain unimplemented.
