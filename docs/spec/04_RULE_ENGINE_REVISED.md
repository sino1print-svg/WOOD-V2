# 04_RULE_ENGINE_REVISED.md

# Mockup Photoshoot Director — Deterministic Rule Engine Specification (Revised)

**Document type:** Engine Specification (analysis / specification only)
**Supersedes:** `04_RULE_ENGINE.md`
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS.md`
**Status:** Corrected baseline for engineering
**Scope note:** No application code, engine implementation, React, HTML, or CSS. All TypeScript names, enums, and branded IDs are those in `03_DATA_MODELS.md`, extended only by the amendments consolidated in the Source Consistency Appendix (section 21), which amend **`03_DATA_MODELS.md`** exclusively.

Section references: `§` = `01_PRD.md`; `ARCH §` = `02_ARCHITECTURE.md`; `DM §` = `03_DATA_MODELS.md`.

---

## 0. Revision Summary (what changed and why)

This revision corrects ten type/semantic inconsistencies in `04_RULE_ENGINE.md`. Every fix preserves determinism, keeps Print Area as the highest-priority constraint, halts generation on blocking failures, and never lets warnings mutate selections.

| # | Defect in `04_RULE_ENGINE.md` | Resolution | Amends |
|---|---|---|---|
| 1 | `Count*` operators (array-length) misused on numeric scalars (`sizeRatio`, `requestedSceneCount`, `mockupCount`, …) | **Solution A**: add numeric operators `NumberEquals/Gte/Lte/Gt/Lt`; physical print-area numbers moved to Validation Engine predicates (section 7) | `03_DATA_MODELS.md` (RuleOperator) |
| 2 | `"true"`/`"null"` compared as strings | Extend `RuleCondition.value` with `boolean`/`null`; add `Exists`/`IsNull` operators | `03_DATA_MODELS.md` (RuleCondition, RuleOperator) |
| 3 | Palette lock keyed on `count == 2` (Sand+Navy would falsely lock to White/Black) | Lock keyed on `colorSelection.locked` and targets the **actual selected `ColorId`s** via `ContextRef` | Uses amendments from #2, #4 |
| 4 | Hardcoded `"limit": 3` | `RuleEffect.limit` and `targets` may carry a `ContextRef` resolving `session.requestedSceneCount` etc. | `03_DATA_MODELS.md` (RuleEffect, ContextRef) |
| 5 | Compound rules faked via scope only | Add `ConditionGroup { all / any / not }`; `Rule.condition` becomes `ConditionNode` | `03_DATA_MODELS.md` (Rule, ConditionGroup) |
| 6 | Season (3) beating Palette (4) could alter garment colors | Explicit **domain separation**: garment-color vs decor/background are disjoint target dimensions; a Season rule may never target the garment-color dimension | `03_DATA_MODELS.md` (RuleDomain) |
| 7 | Numeric measurement modeled as generic `Count` rules | Three-layer split: Print-Area Engine measures → Validation Engine predicates judge numbers → Rule Engine handles categorical rules | (classification only) |
| 8 | Cover barrier checked `> 0` | Barrier = `outputAGenerated === totalScenes`, exposed as derived boolean `generationProgress.allOutputAReady` | (derived context) |
| 9 | Invalid examples, placeholders (`"__ledger_seen__"`), string booleans/nulls, hardcoded counts | All 34 examples rewritten to conform to corrected types (section 18) | — |
| 10 | No amendment ledger | Source Consistency Appendix (section 21) | — |

---

## 1. Purpose and Responsibilities

### 1.1 Purpose

The Rule Engine is the deterministic constraint authority of the pipeline (ARCH §3, engine #1). It converts session selections and each candidate scene dimension into an **allowed / forbidden / required / locked / limited** constraint set, resolves conflicts by a **fixed precedence hierarchy**, and emits either a clean constraint set or a structured blocking failure that halts generation (§14). It optimizes for print-area visibility, Etsy conversion, commercial realism, consistency, and expandability — never randomness (§2). Identical input state always yields identical output and identical trace (ARCH §1.2).

### 1.2 Responsibilities

Owns: evaluating `Rule`/`ConditionNode` objects; enforcing precedence (section 2) and the conflict-resolution algorithm (section 3); applying the four effects (section 11); deterministic candidate filtering (section 10); structured error codes with severity and Arabic messages (section 14); the replayable rule trace (section 15).

Delegates: **numeric print-area measurement** (Print-Area Engine measures; Validation Engine judges — section 7); **duplicate hashing** (Dedup Engine computes `DedupSignature.hash`; the Rule Engine reads the derived boolean `scene.isDuplicate`); prompt composition (§10); persistence/versioning (§13).

### 1.3 Hard invariants (never violated)

1. Lower-priority rules may never override higher-priority rules (ARCH §1.3, §8.1).
2. Print Area rules always have the highest priority (`RulePriorityClass.PrintArea = 1`, §11).
3. Generation stops when a blocking rule fails (§14).
4. Warnings never silently modify user selections.
5. No unseeded randomness; all ordering is lexicographic on branded IDs (section 10.2).
6. **Domain isolation (new):** a rule may only affect the target dimension named in its `domain`; a Season-priority rule may never target the garment-color dimension (section 6).

---

## 2. Fixed Rule Precedence Hierarchy

Precedence is the `RulePriorityClass` enum (DM §2.1). **Lower numeric value = higher priority.**

| Priority | `RulePriorityClass` | Class | PRD | Governs |
|---|---|---|---|---|
| **1 (highest)** | `PrintArea` | Print Area | §11 | Obstruction presence, background text, collage prohibition, blank-Sale-Image |
| 2 | `AudienceSafety` | Audience/Safety | §8 | Kids-vs-adult models, audience legality |
| 3 | `Season` | Season | §7,§8 | Season decor/hero compatibility (decor & background domains only) |
| 4 | `PaletteLock` | Palette Lock | §8 | Garment-color lock/closure (garment-color domain only) |
| **5 (lowest)** | `SceneAesthetic` | Scene Aesthetic | §9 | Composition/pose/camera, dedup, counts, dependency/cover shaping |

Precedence law: for two rules targeting the **same domain+target**, if `r_hi.priority < r_lo.priority` then `r_hi` applies and `r_lo`'s conflicting effect is dropped. Rules in **different domains never conflict** (they land in disjoint buckets, section 3.3). Print Area (1) is absolute within its domain and, because obstruction/collage/text are physical-image concerns, no lower rule can reintroduce what it forbade.

---

## 3. Exact Conflict-Resolution Algorithm

Deterministic, total, terminating; no randomness, no backtracking-by-chance.

### 3.1 Definitions

- **Candidate**: one proposed value/set for a scene dimension (a `PropId`, `ColorId`, `PoseId`, …).
- **Matched rule**: a `Rule` whose `condition` (`ConditionNode`, section 5) evaluates `true` against the `EvaluationContext` (section 4.2, section 12).
- **Bucket**: matched rules grouped by `(domain, target)`. Buckets are independent.
- **Conflict**: two matched rules in the **same bucket** with incompatible effects.

### 3.2 Input

```
context        : EvaluationContext          (section 4.2)
activeRuleSets : readonly RuleSet[]          (scoped-loaded, section 4.1)
candidateSets  : Map<Dimension, CandidateSet>
```

### 3.3 Algorithm

```
1. COLLECT
   matched ← rules whose ConditionNode is TRUE (section 5, 12).
   Sort by (priority ASC, ruleId ASC lexicographic).            // stable, no randomness

2. BUCKET BY (domain, target)
   Index each matched rule under each element of effect.targets (ContextRefs resolved first, section 4.4),
   keyed by (rule.domain, target). Different domains ⇒ different buckets ⇒ no interaction.

3. RESOLVE EACH BUCKET
   a. winningPriority ← min(r.priority in bucket)                // highest priority wins
   b. active ← rules at winningPriority
   c. same-priority effect conflicts → effect-conflict table (3.5) / tie-break (3.4)
   d. drop rules with priority > winningPriority; record reason "overridden_by_higher_priority"

4. APPLY EFFECTS  (fixed order: Forbid → Lock → Limit → Require)
   Forbid  : remove target from candidate set.
   Lock    : intersect candidate set with the lock's allowed set (ContextRef resolved).
   Limit   : cap dimension count at resolved limit (ContextRef resolved).
   Require : mark target mandatory; if removed by a higher Forbid/Lock ⇒ BLOCKING (5).

5. DETECT UNSATISFIABLE
   Any Require target removed by higher priority, or Limit below a Require count ⇒ BLOCKING, HALT.

6. EMIT
   ResolvedConstraintSet + RuleTrace. Any blocking ⇒ passed=false, generation stops (§14).
```

### 3.4 Deterministic tie-break (same priority, same bucket)

1. Effect-strength order: `Forbid` > `Lock` > `Limit` > `Require`.
2. Identical types: more restrictive value wins (smaller resolved `limit`; smaller `Lock` set).
3. Final: lexicographically smallest `ruleId`.

### 3.5 Effect-conflict table (single priority)

| A \ B | Forbid | Lock | Limit | Require |
|---|---|---|---|---|
| **Forbid** | union | Forbid wins | Forbid wins | Forbid wins → Require blocking |
| **Lock** | Forbid wins | intersection | Lock then Limit | Require must be inside lock else blocking |
| **Limit** | Forbid wins | Lock then Limit | min(limit) | Require must fit limit |
| **Require** | Forbid wins → blocking | inside lock | fit limit | union |

Cross-priority conflicts never reach this table (resolved at step 3).

---

## 4. Rule Evaluation Lifecycle

### 4.1 Scoped rule-set loading

Scoping is an **optimization and safety filter**, not the mechanism for compound logic (that is now `ConditionGroup`, section 5). A season's rule-set loads only when that season is active (ARCH §7 independence), so foreign-season decor never enters candidates.

```
GLOBAL           (always)                 classes 1–5
PRINT-AREA       (always)                 class 1
AUDIENCE         (scoped: audience)       class 2
SEASON           (scoped: season)         class 3   domains: decor, background
PALETTE          (scoped: colorSelection) class 4   domain: garment_color
SCENE-AESTHETIC  (always)                 class 5
PRODUCT          (scoped: productIds)     classes 2–5
```

### 4.2 Evaluation context (revised)

Read-only projection; the engine never mutates it. Fields are addressed by dotted `condition.field` paths. **Measured** = supplied by Print-Area/Vision. **Derived** = precomputed boolean by the named engine (so rules use real booleans, not string hacks or field-to-field comparison).

```
session.audience                 : Audience
session.season                   : SeasonId
session.productIds               : readonly ProductId[]
session.colorSelection.colorIds  : readonly ColorId[]
session.colorSelection.locked    : boolean
session.requestedSceneCount      : number

scene.productId                  : ProductId
scene.decorIds                   : readonly DecorId[]
scene.propIds                    : readonly PropId[]
scene.poseId                     : PoseId
scene.cameraAngle                : CameraAngle
scene.compositionId              : CompositionId
scene.displayMethod              : DisplayMethod
scene.paletteColorId             : ColorId              // garment color
scene.view                       : GarmentView
scene.modelType                  : 'adult_model'|'teen_model'|'child_model'|'none'  (derived: Scene Engine)
scene.isDuplicate                : boolean              (derived: Dedup Engine)  // replaces "__ledger_seen__"
scene.garmentColorAllowed        : boolean              (derived: Palette Engine) // color ∈ locked selection

printArea.overlaps               : readonly PrintAreaObstruction[]  (measured)
printArea.sizeRatio              : number               (measured; judged by Validation predicate, section 7)
printArea.centeringOffset        : number               (measured; Validation predicate)
printArea.shadowCoverage         : number               (measured; Validation predicate)

background.hasReadableText       : boolean              (measured/derived: Vision)
output.isCollage                 : boolean              (derived)
output.saleImageHasMarks         : boolean              (derived: Output A contamination)

outputB.sourceOutputAId          : OutputAId | null
outputB.artworkId                : ArtworkId | null
outputB.isStale                  : boolean              (derived: sourceContentHash mismatch, DM §6.3)
artwork.format                   : string
artwork.hasTransparency          : boolean

generationProgress.outputAGenerated : number
generationProgress.totalScenes      : number
generationProgress.allOutputAReady  : boolean           (derived: outputAGenerated === totalScenes)  // barrier, #8

cover.sourceRefKinds             : readonly ('outputA'|'outputB')[]
cover.hasPreviewRefs             : boolean              (derived: sourceRefKinds includes 'outputB')
cover.layout                     : CoverLayout
cover.mockupCount                : number
cover.layoutMatchesCount         : boolean              (derived: Cover Engine, per DM [R3] mapping)
```

### 4.3 Lifecycle phases

```
Phase 0 PRE-FLIGHT   presence (season, audience, products, colors, sceneCount ≥ 1). §14
Phase 1 SCOPE LOAD   assemble activeRuleSets.
Phase 2 SESSION      evaluate session.* rules.
Phase 3 CANDIDATE    per-dimension filtering (section 10).
Phase 4 SCENE        print-area obstruction, dedup, dependency rules.
Phase 5 OUTPUT       Output A/B invariants, cover purity, collage/text bans.
Phase 6 RESOLVE      algorithm section 3.
Phase 7 EMIT         ResolvedConstraintSet + ValidationResult + RuleTrace.
```

A blocking failure at any phase halts before prompt generation (§14; ARCH §6 `Blocked`).

### 4.4 ContextRef resolution (new)

A `ContextRef` = `{ ref: <dotted context path> }`. Before bucketing/effect application, every `ContextRef` in `effect.targets`/`effect.limit` is resolved against the read-only context to a concrete value (an array of IDs, or a number). Resolution is pure and deterministic. A `ref` to a missing/invalid path is a configuration error → blocking `RULE_CFG_002`.

---

## 5. Condition Model (compound conditions — correction #5)

`Rule.condition` is a `ConditionNode`:

```
ConditionNode = RuleCondition | ConditionGroup
ConditionGroup = { all?: ConditionNode[] } | { any?: ConditionNode[] } | { not?: ConditionNode }
```

Semantics (deterministic, evaluated in array order):

- `all` ⇒ logical AND; TRUE iff every child is TRUE. Empty `all` ⇒ TRUE.
- `any` ⇒ logical OR; TRUE iff at least one child is TRUE. Empty `any` ⇒ FALSE.
- `not` ⇒ negation of its single child.
- A group carries exactly one of `all`/`any`/`not` (enforced by schema). Nesting is permitted and finite.
- Evaluation is total and side-effect-free; ordering never affects the boolean result, so no runtime assumption is undocumented.

This replaces reliance on scope-only compounding. Example: *Father's Day AND decor includes Mother's-Day decor* is one rule with `all: [ {season eq fathers_day}, {decorIds includes mothersday_decor} ]` (section 18).

---

## 6. Domain Separation (correction #6)

Two color concerns are **different domains** and therefore never conflict:

- **Garment-color domain** (`RuleDomain.GarmentColor`): the color of the garment itself — `scene.paletteColorId`. Governed only by the Palette Lock class (priority 4, §8). The White+Black lock (§8) closes this domain to the user's selected garment colors.
- **Decor/background domain** (`RuleDomain.Decor`, `RuleDomain.Background`): seasonal decor and backdrop palettes — `scene.decorIds`, backdrop terms. Governed by the Season class (priority 3, §7).

Hard rules:

1. A Season-priority rule **may not** carry `domain: GarmentColor` and **may not** target `scene.paletteColorId`. Enforced structurally (schema + load-time check; violation ⇒ `RULE_CFG_003`).
2. A Palette-Lock rule targets only `scene.paletteColorId` (garment color); it never restricts decor/background palettes.
3. Because the two domains are disjoint target dimensions, the section-3 bucketing places them in separate buckets — so "Season (3) vs Palette (4)" is **not a real conflict**: both apply, each within its own domain. The precedence ladder only adjudicates same-domain collisions.

Consequence: a seasonal decor accent color can appear in the background even under a White+Black **garment** lock, because the lock constrains the garment only. A season rule can never change the selected garment color.

---

## 7. Print-Area Measurement Layering (correction #7)

Three layers, no generic `Count` operators on measurements:

| Concern | Owner | Mechanism | Example |
|---|---|---|---|
| Physical measurement of the rendered image | **Print-Area Engine** | produces measured facts into context | `printArea.sizeRatio = 0.31`, `overlaps = ['hands']` |
| Numeric threshold judgment | **Validation Engine** | **predicate** comparing measured value to `PrintAreaProfile` (DM §3.3), not a `Rule` object | `sizeRatio >= profile.minSizeRatio` ; `centeringOffset <= profile.centeringTolerance` ; `shadowCoverage <= profile.maxShadowCoverage` |
| Categorical / declarative policy | **Rule Engine** | `Rule` with valid operators | `printArea.overlaps includes 'hands'` (Includes); `background.hasReadableText eq true` (boolean) |

Validation predicates (blocking, `PrintRules`, priority-1 semantics) — expressed as predicates, **not** JSON rules:

```
PA-PRED-1  sizeRatio        >= profile.minSizeRatio        else RULE_PA_006
PA-PRED-2  centeringOffset  <= profile.centeringTolerance  else RULE_PA_007
PA-PRED-3  shadowCoverage   <= profile.maxShadowCoverage   else RULE_PA_005N
```

These compare a measured number to a per-product profile number (two dynamic operands), which is precisely why they are predicates, not condition-vs-literal rules. Should numeric thresholds ever be authored as declarative rules against a fixed literal, the new numeric operators (section 12) are used — never `Count*`.

---

## 8. Cover Barrier (correction #8)

The cover barrier requires **all** Sale Images to exist, not merely one:

- Derived context boolean `generationProgress.allOutputAReady = (outputAGenerated === totalScenes)` is computed by the Orchestrator.
- Rule `rule_cov_barrier_all_a_ready` (priority 5) fires when `allOutputAReady eq false` and **forbids** `cover_build` → `RULE_COV_002` (blocking). Session stays in `Generating` (ARCH §6.3).
- Equivalent Validation predicate `COV-PRED-1: outputAGenerated === totalScenes` guards the `CoverBuild` transition. Either form uses exact equality of the two counts, never `> 0`.

---

## 9. Explicit Prevention Rules

Each enforces an existing PRD constraint (no new feature). Priority/severity fixed.

1. Wrong models (`AUD`, 2, blocking) — adult/teen models forbidden for Kids; child models forbidden for adult audiences (§8, section 7 matrix).
2. Wrong garment colors (`PAL`, 4, blocking) — when locked, `scene.garmentColorAllowed` must be true; garment color must be in the selected set (§8, domain = GarmentColor).
3. Wrong seasons (`SEA`, 3, blocking) — foreign-season decor/hero forbidden (§7, section 6 matrix; domain = Decor/Background).
4. Artwork on Sale Image (`CLG`/`PA`, 1, blocking) — Output A blank: no artwork/logo/watermark/typography (§4; `output.saleImageHasMarks`).
5. Previews (`PRV`, 5, blocking) — Output B requires a generated source Output A and an uploaded artwork; differs only by artwork (§4).
6. Covers (`COV`, 5, blocking) — Output A only; barrier = all Output A ready (section 8, §5).
7. Duplicates (`DUP`, 5, blocking) — `scene.isDuplicate` must be false (§8; full four-part signature, DM §3.5).
8. Print-area obstruction (`PA`, 1, blocking) — no hands/hair/props/deep folds/shadows over print area (§11; categorical rules) plus numeric predicates (section 7).
9. Readable background text (`TXT`, 1, blocking) — `background.hasReadableText` must be false (§4 typography ban / §2 realism).
10. Collage outputs (`CLG`, 1, blocking) — `output.isCollage` must be false for individual A/B; only `MainCover` may be multi-image, over Output A only (§2, §4, §5).

---

## 10. Deterministic Candidate Filtering

### 10.1 Pipeline

```
seedCandidates(dimension)            // active season library + product manifest
  → applyForbid   (remove forbidden targets)
  → applyLock     (intersect with resolved locked set)     // ContextRef resolved
  → applyLimit    (cap count at resolved limit)             // ContextRef resolved
  → checkRequire  (unsatisfiable ⇒ blocking)
  → sortDeterministic(candidates)                            // section 10.2
  → dedupFilter   (drop where scene.isDuplicate would be true)  // §8
  → select        (first N by sorted order; N = resolved requestedSceneCount)
```

### 10.2 Determinism

Ordering is lexicographic ascending on branded IDs. No `Math.random`, no shuffling, no time seeding. Identical state ⇒ identical selection ⇒ identical trace (idempotent, ARCH §1.3).

### 10.3 Feasibility pre-check (blocking, `CNT`)

```
uniqueSpace = | distinct (sceneTemplateId, poseId, cameraAngle, compositionId) tuples
                surviving Forbid/Lock/Limit across selected products × active season library |
IF uniqueSpace < session.requestedSceneCount → BLOCKING RULE_CNT_001 (before filtering)
```

`session.requestedSceneCount` is read from context; the per-session scene limit is always the resolved `ContextRef` to it (correction #4) — never a literal.

---

## 11. Rule Effects

Exactly `RuleEffectType` (DM §2.1). `targets` and `limit` may be literals or `ContextRef` (amendment, section 21).

- **Forbid** — remove each resolved target from the candidate set. Strongest effect.
- **Require** — mark each resolved target mandatory-present; unsatisfiable after higher Forbid/Lock ⇒ blocking.
- **Lock** — intersect the dimension with the resolved allowed set (e.g. `{ ref: "session.colorSelection.colorIds" }` for garment color, correction #3).
- **Limit** — cap dimension count at the resolved `limit` (e.g. `{ ref: "session.requestedSceneCount" }`, correction #4).

Within a priority: Forbid → Lock → Limit → Require.

---

## 12. Condition Operators and Evaluation Semantics (corrected)

Operators are `RuleOperator` after the amendment (section 21). `value` is `string | number | boolean | null | readonly string[]`.

| `RuleOperator` | JSON | Semantics | `value` |
|---|---|---|---|
| `Equals` | `"eq"` | `ctx[field] === value` (string/number/boolean) | scalar |
| `NotEquals` | `"neq"` | `ctx[field] !== value` | scalar |
| `In` | `"in"` | `value.includes(ctx[field])` (scalar field, set value) | string[] |
| `NotIn` | `"not_in"` | `!value.includes(ctx[field])` | string[] |
| `Includes` | `"includes"` | array field contains value (scalar) or intersects (array) | scalar or string[] |
| `Excludes` | `"excludes"` | array field contains none of value | scalar or string[] |
| `CountEquals` | `"count_eq"` | `ctx[field].length === value` (**array length only**) | number |
| `CountGte` | `"count_gte"` | `ctx[field].length >= value` (**array length**) | number |
| `CountLte` | `"count_lte"` | `ctx[field].length <= value` (**array length**) | number |
| `NumberEquals` | `"num_eq"` | numeric `ctx[field] === value` (**scalar number**) | number |
| `NumberGte` | `"num_gte"` | numeric `ctx[field] >= value` | number |
| `NumberLte` | `"num_lte"` | numeric `ctx[field] <= value` | number |
| `NumberGt` | `"num_gt"` | numeric `ctx[field] > value` | number |
| `NumberLt` | `"num_lt"` | numeric `ctx[field] < value` | number |
| `Exists` | `"exists"` | `ctx[field]` is present and non-null | value ignored (`null`) |
| `IsNull` | `"is_null"` | `ctx[field]` is null or absent | value ignored (`null`) |

Semantics: pure functions of context; no locale/time/randomness. `Count*` apply **only** to array fields; `Number*` apply **only** to scalar numbers; booleans compared with `Equals` against real `true`/`false`; null tested with `IsNull`/`Exists` (never `"null"` string). Operator/field/value shape mismatch ⇒ blocking `RULE_CFG_001` at load (schema-validated, DM §10).

---

## 13. Blocking Errors vs Warnings

`ValidationSeverity` (DM §2.1).

**Blocking** — halts at its phase; no prompts generated (§14; ARCH §6 → `Blocked`); appended to `ValidationResult.failures` with `severity:"blocking"`; `passed=false`. All priority-1..4 violations plus dedup, scene-count feasibility, preview-dependency, cover-purity, and cover-barrier are blocking.

**Warning** — never halts, never mutates a selection. Annotates trace/`ValidationResult` only. Examples: near-threshold print area on constrained products; artwork aspect mismatch or missing transparency (DM [R8]); aesthetically weak but legal composition. Warning-only ⇒ `passed=true`, generation proceeds with original selections.

Determinism: same state ⇒ same blocking/warning set in the same order (`priority ASC, code ASC`).

---

## 14. Structured Error Codes with Arabic Messages

`RULE_<PREFIX>_<NNN>` → `ValidationCheck`, `ValidationSeverity`, `RulePriorityClass`. Reference data, not code. Error objects conform to `ValidationFailure` (DM §3.14).

| Code | Check | Severity | Priority | messageAr | messageEn |
|---|---|---|---|---|---|
| `RULE_PA_001` | PrintRules | blocking | 1 | منطقة الطباعة محجوبة بأيدٍ فوقها؛ يجب أن تبقى واضحة. | Print area obstructed by hands. |
| `RULE_PA_002` | PrintRules | blocking | 1 | منطقة الطباعة محجوبة بالشعر؛ يجب أن تبقى واضحة. | Print area obstructed by hair. |
| `RULE_PA_003` | PrintRules | blocking | 1 | عناصر (إكسسوارات) تغطي منطقة الطباعة؛ غير مسموح. | Props overlap the print area. |
| `RULE_PA_004` | PrintRules | blocking | 1 | ثنيات عميقة تشوّه منطقة الطباعة؛ غير مسموح. | Deep folds distort the print area. |
| `RULE_PA_005` | PrintRules | blocking | 1 | ظلال تغطي منطقة الطباعة؛ غير مسموح. | Shadows cover the print area. |
| `RULE_PA_005N` | PrintRules | blocking | 1 | نسبة الظل فوق منطقة الطباعة تتجاوز الحد المسموح. | Shadow coverage exceeds the profile limit. (Validation predicate PA-PRED-3) |
| `RULE_PA_006` | PrintRules | blocking | 1 | منطقة الطباعة أصغر من الحد الأدنى المطلوب. | Print area below minSizeRatio. (PA-PRED-1) |
| `RULE_PA_007` | PrintRules | blocking | 1 | منطقة الطباعة غير متمركزة ضمن الحد المسموح. | Print area off-center beyond tolerance. (PA-PRED-2) |
| `RULE_TXT_001` | PrintRules | blocking | 1 | يوجد نص مقروء في الخلفية؛ غير مسموح في صور المنتج. | Readable background text detected. |
| `RULE_CLG_001` | PrintRules | blocking | 1 | المخرج الفردي عبارة عن كولاج؛ يجب أن يكون صورة منتج واحدة متماسكة. | Individual output is a collage. |
| `RULE_CLG_002` | PrintRules | blocking | 1 | صورة البيع (A) تحتوي على تصميم/شعار/علامة مائية/نص؛ يجب أن تكون فارغة. | Sale Image (A) is not blank. |
| `RULE_AUD_001` | Audience | blocking | 2 | لا يُسمح بعارضين بالغين مع جمهور الأطفال. | Adult models forbidden for Kids audience. |
| `RULE_AUD_002` | Audience | blocking | 2 | لا يُسمح بعارضين بالغين مع منتجات الأطفال. | Adult models forbidden for Kids products. |
| `RULE_AUD_003` | Audience | blocking | 2 | نوع الجمهور غير محدد أو غير صالح. | Audience missing or invalid. |
| `RULE_AUD_004` | Audience | blocking | 2 | لا يُسمح بعارضين أطفال مع جمهور البالغين. | Child models forbidden for adult audiences. |
| `RULE_PRD_001` | Products | blocking | 2 | هذا المنتج مخصص للأطفال فقط ويجب اختيار جمهور الأطفال. | Kids-only product requires Kids audience. |
| `RULE_PRD_002` | Products | blocking | 2 | الجمهور المختار غير مسموح لهذا المنتج. | Selected audience not allowed for product. |
| `RULE_PRD_003` | Products | blocking | 5 | زاوية العرض غير مدعومة لهذا المنتج. | View not supported by product. |
| `RULE_PRD_004` | Products | warning | 5 | مساحة الطباعة لهذا المنتج قريبة من الحد الأدنى. | Product print zone near minimum. |
| `RULE_SEA_001` | Season | blocking | 3 | لا يُسمح بديكور عيد الأم في جلسة عيد الأب. | Mother's-Day decor forbidden on Father's Day. |
| `RULE_SEA_002` | Season | blocking | 3 | لا يُسمح بمشاهد (الأم والطفل) في جلسة عيد الأب. | Mother/Child hero forbidden on Father's Day. |
| `RULE_SEA_003` | Season | blocking | 3 | لا يُسمح بديكور من موسم آخر داخل هذا الموسم. | Foreign-season decor forbidden. |
| `RULE_SEA_004` | Season | blocking | 3 | وضع الاستوديو البسيط لا يسمح بأي ديكور موسمي. | Minimal Studio forbids seasonal decor. |
| `RULE_SEA_005` | Season | blocking | 3 | الموسم غير محدد أو غير صالح. | Season missing or invalid. |
| `RULE_PAL_001` | Colors | blocking | 4 | لون القطعة خارج الألوان المقفلة المختارة. | Garment color outside the locked selection. |
| `RULE_PAL_002` | Colors | blocking | 4 | لون المشهد خارج مجموعة الألوان المختارة. | Scene garment color not in selected set. |
| `RULE_PAL_003` | Colors | blocking | 4 | لم يتم اختيار أي لون. | No color selected. |
| `RULE_DUP_001` | DuplicateScenes | blocking | 5 | يوجد مشهد مكرر (نفس المشهد والوضعية وزاوية الكاميرا والتكوين). | Duplicate scene signature. |
| `RULE_CNT_001` | SceneCount | blocking | 5 | عدد المشاهد الفريدة الممكنة أقل من العدد المطلوب. | Unique space < requested count. |
| `RULE_CNT_002` | SceneCount | blocking | 5 | عدد المشاهد المطلوب يجب أن يكون واحدًا على الأقل. | Requested count must be ≥ 1. |
| `RULE_PRV_001` | Products | blocking | 5 | صورة المعاينة تتطلب صورة PNG مرفوعة. | Preview requires uploaded PNG. |
| `RULE_PRV_002` | Products | blocking | 5 | يجب أن تعتمد صورة المعاينة على صورة البيع (A). | Preview must derive from Output A. |
| `RULE_PRV_003` | Products | blocking | 5 | صورة المعاينة قديمة؛ تم تعديل صورة البيع المصدر. | Preview stale; source A changed. |
| `RULE_COV_001` | CoverData | blocking | 5 | الغلاف يستخدم صور البيع (A) فقط ولا يستخدم صور المعاينة (B). | Cover must use A only. |
| `RULE_COV_002` | CoverData | blocking | 5 | لا يمكن إنشاء الغلاف قبل اكتمال جميع صور البيع (A). | Cover blocked until all A ready. |
| `RULE_COV_003` | CoverData | blocking | 5 | تخطيط الغلاف لا يطابق عدد الموك أب. | Cover layout ≠ mockup count. |
| `RULE_ART_001` | Products | warning | 5 | ملف التصميم لا يحتوي على شفافية (Alpha). | Artwork lacks transparency. |
| `RULE_ART_002` | Products | warning | 5 | نسبة أبعاد التصميم لا تطابق منطقة الطباعة. | Artwork aspect mismatch. |
| `RULE_ART_003` | Products | blocking | 5 | صيغة الملف غير مدعومة؛ يجب أن تكون PNG. | Unsupported format; PNG required. |
| `RULE_CFG_001` | — | blocking | — | خطأ في إعداد القواعد؛ شرط أو مُعامل غير صالح. | Invalid condition/operator shape. |
| `RULE_CFG_002` | — | blocking | — | مرجع سياق غير صالح في تأثير القاعدة. | Invalid ContextRef in effect. |
| `RULE_CFG_003` | — | blocking | — | قاعدة موسم تستهدف لون القطعة؛ غير مسموح. | Season rule targets garment color (forbidden). |

Example failure object:

```json
{ "check": "audience", "field": "session.audience", "code": "RULE_AUD_001",
  "message": "لا يُسمح بعارضين بالغين مع جمهور الأطفال.", "severity": "blocking" }
```

---

## 15. Rule Tracing and Explainability

```
RuleTrace:
  contextHash       : Sha256
  evaluatedAt       : IsoTimestamp
  entries           : readonly RuleTraceEntry[]     // sorted (priority ASC, ruleId ASC)
  droppedByPriority : readonly DroppedRule[]
  outcome           : 'passed' | 'blocked'
  failures          : readonly ValidationFailure[]  // DM §3.14

RuleTraceEntry:
  ruleId        : RuleId
  priority      : RulePriorityClass
  domain        : RuleDomain
  condition     : ConditionNode
  matched       : boolean
  resolvedTargets : readonly string[]   // after ContextRef resolution
  resolvedLimit : number | null
  effectApplied : RuleEffectType | null
  resultCode    : string | null
  note          : string

DroppedRule:
  ruleId       : RuleId
  priority     : RulePriorityClass
  overriddenBy : RuleId
  reason       : 'overridden_by_higher_priority' | 'lost_tiebreak'
```

Guarantees: full precedence audit (every dropped rule names its higher-priority winner); reproducibility (`contextHash` + rule-set versions determine the trace byte-for-byte); resolved dynamic values (ContextRef results) are recorded so a dynamic limit/lock is fully explainable.

---

## 16. Season Compatibility Matrix

Domain = Decor/Background only (never garment color, section 6). `✗` = forbidden (blocking, `Season`=3, `ValidationCheck.Season`).

| Active Season ↓ / Foreign category → | MothersDay decor | FathersDay decor | Halloween decor | Christmas decor | Valentine decor | BackToSchool decor | Summer decor | Winter decor | Mother/Child hero | Father/Child hero | Romantic hero | Spooky hero |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Halloween** | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Christmas** | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Valentine's Day** | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Mother's Day** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **Father's Day** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| **Back to School** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Summer** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Fall** | ✗ | ✗ | ✓(muted) | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Winter** | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Teacher** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Minimal Studio** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Named PRD constraints are the Father's Day / Mother's Day rows (§8). Minimal Studio forbids all seasonal decor (§7).

---

## 17. Audience & Product Compatibility

### 17.1 Audience matrix (`AudienceSafety`=2, `ValidationCheck.Audience`)

| Audience ↓ / Model → | Adult model | Teen model | Child model | No model |
|---|---|---|---|---|
| **Kids** | ✗ (§8) | ✗ | ✓ | ✓ |
| **Adult** | ✓ | ✓ | ✗ | ✓ |
| **Teen** | ✗ | ✓ | ✗ | ✓ |
| **Unisex** | ✓ | ✓ | ✗ | ✓ |
| **All** | ✓ | ✓ | ✓ | ✓ |

### 17.2 Product compatibility (§6; `Product.audienceConstraints`, `allowedViews`, DM §3.3)

- **P-1 (blocking, 2):** `kidsOnly` product ⇒ audience must be `Kids` (`RULE_PRD_001`).
- **P-2 (blocking, 2):** product `allowedAudiences` present ⇒ session audience ∈ it (`RULE_PRD_002`).
- **P-3 (blocking, 5):** `scene.view` ∈ product `allowedViews` (`RULE_PRD_003`).
- **P-4 (warning, 5):** constrained print zones (Zip Hoodie, Polo, Hoodie pocket) near `minSizeRatio` → `RULE_PRD_004`; the priority-1 predicates still govern hard failure.
- **P-5:** palette lock overrides product `defaultColors` (garment-color domain; ARCH §8.3). Defaults are seeds only.

---

## 18. Complete JSON Rule Examples (34, corrected)

All conform to the corrected types: valid operators, real boolean/null handling, `ConditionGroup` for compounds, `ContextRef` for dynamic values, `domain` metadata, no placeholders, no hardcoded counts. `priority`: 1=PrintArea, 2=AudienceSafety, 3=Season, 4=PaletteLock, 5=SceneAesthetic.

**Print Area — obstruction (priority 1, `Includes`)**

```json
{ "id": "rule_pa_no_hands", "priority": 1, "domain": "print_area",
  "condition": { "field": "printArea.overlaps", "operator": "includes", "value": "hands" },
  "effect": { "type": "forbid", "targets": ["hands"] },
  "description": "No hands over print area (§11). RULE_PA_001." }
```
```json
{ "id": "rule_pa_no_hair", "priority": 1, "domain": "print_area",
  "condition": { "field": "printArea.overlaps", "operator": "includes", "value": "hair" },
  "effect": { "type": "forbid", "targets": ["hair"] },
  "description": "No hair over print area (§11). RULE_PA_002." }
```
```json
{ "id": "rule_pa_no_props", "priority": 1, "domain": "print_area",
  "condition": { "field": "printArea.overlaps", "operator": "includes", "value": "props" },
  "effect": { "type": "forbid", "targets": ["props"] },
  "description": "No props over print area (§11). RULE_PA_003." }
```
```json
{ "id": "rule_pa_no_deep_folds", "priority": 1, "domain": "print_area",
  "condition": { "field": "printArea.overlaps", "operator": "includes", "value": "deep_folds" },
  "effect": { "type": "forbid", "targets": ["deep_folds"] },
  "description": "No deep folds over print area (§11). RULE_PA_004." }
```
```json
{ "id": "rule_pa_no_shadows", "priority": 1, "domain": "print_area",
  "condition": { "field": "printArea.overlaps", "operator": "includes", "value": "shadows" },
  "effect": { "type": "forbid", "targets": ["shadows"] },
  "description": "No shadows over print area (§11). RULE_PA_005." }
```

**Print Area — background text & collage (priority 1, real booleans)**

```json
{ "id": "rule_txt_no_readable_background", "priority": 1, "domain": "background",
  "condition": { "field": "background.hasReadableText", "operator": "eq", "value": true },
  "effect": { "type": "forbid", "targets": ["readable_background_text"] },
  "description": "No readable background text (§4/§2). RULE_TXT_001." }
```
```json
{ "id": "rule_clg_no_collage_output", "priority": 1, "domain": "output",
  "condition": { "field": "output.isCollage", "operator": "eq", "value": true },
  "effect": { "type": "forbid", "targets": ["collage_output"] },
  "description": "Individual outputs must be single coherent photos (§2/§4). RULE_CLG_001." }
```
```json
{ "id": "rule_clg_sale_image_blank", "priority": 1, "domain": "output",
  "condition": { "field": "output.saleImageHasMarks", "operator": "eq", "value": true },
  "effect": { "type": "forbid", "targets": ["artwork", "logo", "watermark", "typography"] },
  "description": "Output A must be blank (§4). RULE_CLG_002." }
```

**Audience / model (priority 2)**

```json
{ "id": "rule_aud_kids_no_adult_models", "priority": 2, "domain": "model",
  "condition": { "field": "session.audience", "operator": "eq", "value": "kids" },
  "effect": { "type": "forbid", "targets": ["adult_model", "teen_model"] },
  "description": "Kids audience forbids adult/teen models (§8). RULE_AUD_001." }
```
```json
{ "id": "rule_aud_adult_no_child_models", "priority": 2, "domain": "model",
  "condition": { "field": "session.audience", "operator": "in", "value": ["adult", "unisex", "teen"] },
  "effect": { "type": "forbid", "targets": ["child_model"] },
  "description": "Adult/teen/unisex forbid child models (§2). RULE_AUD_004." }
```
```json
{ "id": "rule_prd_kids_product_requires_kids_audience", "priority": 2, "domain": "model",
  "condition": { "all": [
    { "field": "session.productIds", "operator": "includes", "value": "prod_kids" },
    { "field": "session.audience", "operator": "neq", "value": "kids" } ] },
  "effect": { "type": "forbid", "targets": ["generation"] },
  "description": "Kids product requires Kids audience (§6/§8). RULE_PRD_001." }
```
```json
{ "id": "rule_prd_kids_product_forbid_adult_models", "priority": 2, "domain": "model",
  "condition": { "field": "session.productIds", "operator": "includes", "value": "prod_kids" },
  "effect": { "type": "forbid", "targets": ["adult_model"] },
  "description": "Kids product forbids adult models (§8). RULE_AUD_002." }
```

**Season — compound conditions (priority 3, `ConditionGroup`, domain = decor)**

```json
{ "id": "rule_sea_fathers_no_mothersday_decor", "priority": 3, "domain": "decor",
  "condition": { "all": [
    { "field": "session.season", "operator": "eq", "value": "fathers_day" },
    { "field": "scene.decorIds", "operator": "includes", "value": ["decor_mothersday_flowers", "decor_mothersday_hearts"] } ] },
  "effect": { "type": "forbid", "targets": ["decor_mothersday_flowers", "decor_mothersday_hearts"] },
  "description": "Father's Day AND Mother's-Day decor ⇒ forbid (§8). RULE_SEA_001." }
```
```json
{ "id": "rule_sea_fathers_no_mother_child_hero", "priority": 3, "domain": "decor",
  "condition": { "all": [
    { "field": "session.season", "operator": "eq", "value": "fathers_day" },
    { "field": "scene.poseId", "operator": "in", "value": ["pose_mother_child_hero"] } ] },
  "effect": { "type": "forbid", "targets": ["pose_mother_child_hero"] },
  "description": "Father's Day forbids Mother/Child hero (§8). RULE_SEA_002." }
```
```json
{ "id": "rule_sea_mothers_no_fathersday_decor", "priority": 3, "domain": "decor",
  "condition": { "all": [
    { "field": "session.season", "operator": "eq", "value": "mothers_day" },
    { "field": "scene.decorIds", "operator": "includes", "value": ["decor_fathersday_tools", "decor_fathersday_ties"] } ] },
  "effect": { "type": "forbid", "targets": ["decor_fathersday_tools", "decor_fathersday_ties"] },
  "description": "Mother's Day forbids Father's-Day decor (§8). RULE_SEA_003." }
```
```json
{ "id": "rule_sea_halloween_no_christmas_decor", "priority": 3, "domain": "decor",
  "condition": { "all": [
    { "field": "session.season", "operator": "eq", "value": "halloween" },
    { "field": "scene.decorIds", "operator": "includes", "value": ["decor_christmas_tree", "decor_christmas_lights"] } ] },
  "effect": { "type": "forbid", "targets": ["decor_christmas_tree", "decor_christmas_lights"] },
  "description": "Halloween forbids Christmas decor (§7). RULE_SEA_003." }
```
```json
{ "id": "rule_sea_minimal_studio_no_seasonal_decor", "priority": 3, "domain": "decor",
  "condition": { "all": [
    { "field": "session.season", "operator": "eq", "value": "minimal_studio" },
    { "field": "scene.decorIds", "operator": "count_gte", "value": 1 } ] },
  "effect": { "type": "forbid", "targets": ["seasonal_decor"] },
  "description": "Minimal Studio forbids seasonal decor; count_gte on array length is valid (§7). RULE_SEA_004." }
```
```json
{ "id": "rule_sea_christmas_no_halloween_decor", "priority": 3, "domain": "decor",
  "condition": { "all": [
    { "field": "session.season", "operator": "eq", "value": "christmas" },
    { "field": "scene.decorIds", "operator": "includes", "value": ["decor_halloween_pumpkin", "decor_halloween_spider"] } ] },
  "effect": { "type": "forbid", "targets": ["decor_halloween_pumpkin", "decor_halloween_spider"] },
  "description": "Christmas forbids Halloween decor (§7). RULE_SEA_003." }
```

**Palette lock — garment-color domain, dynamic target (priority 4, corrections #3/#4/#6)**

```json
{ "id": "rule_pal_lock_to_selected_garment_colors", "priority": 4, "domain": "garment_color",
  "condition": { "field": "session.colorSelection.locked", "operator": "eq", "value": true },
  "effect": { "type": "lock", "targets": [ { "ref": "session.colorSelection.colorIds" } ] },
  "description": "When locked, close garment color to the ACTUAL selected ColorIds (not a count). Sand+Navy locks to Sand+Navy, White+Black to White+Black (§8). RULE_PAL_001." }
```
```json
{ "id": "rule_pal_scene_color_must_be_allowed", "priority": 4, "domain": "garment_color",
  "condition": { "field": "scene.garmentColorAllowed", "operator": "eq", "value": false },
  "effect": { "type": "forbid", "targets": ["scene.paletteColorId"] },
  "description": "Scene garment color must be in the selected set (derived boolean, §8). RULE_PAL_002." }
```
```json
{ "id": "rule_pal_require_color_selected", "priority": 4, "domain": "garment_color",
  "condition": { "field": "session.colorSelection.colorIds", "operator": "count_eq", "value": 0 },
  "effect": { "type": "forbid", "targets": ["generation"] },
  "description": "At least one color must be selected; count_eq on array length is valid (§8/§14). RULE_PAL_003." }
```

**Duplicate & scene count (priority 5, no placeholder, dynamic limit)**

```json
{ "id": "rule_dup_no_duplicate_signature", "priority": 5, "domain": "composition",
  "condition": { "field": "scene.isDuplicate", "operator": "eq", "value": true },
  "effect": { "type": "forbid", "targets": ["scene.dedupSignature"] },
  "description": "No duplicate scene/pose/angle/composition; uses derived boolean, no ledger placeholder (§8). RULE_DUP_001." }
```
```json
{ "id": "rule_cnt_limit_to_requested", "priority": 5, "domain": "composition",
  "condition": { "field": "session.requestedSceneCount", "operator": "num_gte", "value": 1 },
  "effect": { "type": "limit", "targets": ["scene"], "limit": { "ref": "session.requestedSceneCount" } },
  "description": "Generate exactly the requested count; dynamic limit via ContextRef, no hardcoded 3 (§8). RULE_CNT." }
```
```json
{ "id": "rule_cnt_min_one", "priority": 5, "domain": "composition",
  "condition": { "field": "session.requestedSceneCount", "operator": "num_lt", "value": 1 },
  "effect": { "type": "forbid", "targets": ["generation"] },
  "description": "Requested count must be ≥ 1; numeric operator on a scalar (§8/§14). RULE_CNT_002." }
```

**Preview dependency & artwork (priority 5, `IsNull`/booleans)**

```json
{ "id": "rule_prv_requires_artwork", "priority": 5, "domain": "output",
  "condition": { "field": "outputB.artworkId", "operator": "is_null", "value": null },
  "effect": { "type": "require", "targets": ["outputB.artworkId"] },
  "description": "Output B requires uploaded PNG artwork; IsNull, not string 'null' (§4). RULE_PRV_001." }
```
```json
{ "id": "rule_prv_requires_source_output_a", "priority": 5, "domain": "output",
  "condition": { "field": "outputB.sourceOutputAId", "operator": "is_null", "value": null },
  "effect": { "type": "require", "targets": ["outputB.sourceOutputAId"] },
  "description": "Output B must derive from Output A (§4). RULE_PRV_002." }
```
```json
{ "id": "rule_prv_stale_forbid", "priority": 5, "domain": "output",
  "condition": { "field": "outputB.isStale", "operator": "eq", "value": true },
  "effect": { "type": "forbid", "targets": ["outputB.publish"] },
  "description": "Stale preview (source A changed) forbidden until regenerated (§4; DM §6.3). RULE_PRV_003." }
```
```json
{ "id": "rule_art_require_png", "priority": 5, "domain": "output",
  "condition": { "field": "artwork.format", "operator": "neq", "value": "png" },
  "effect": { "type": "forbid", "targets": ["artwork.upload"] },
  "description": "Only PNG artwork accepted (§4). RULE_ART_003." }
```
```json
{ "id": "rule_art_warn_no_transparency", "priority": 5, "domain": "output",
  "condition": { "field": "artwork.hasTransparency", "operator": "eq", "value": false },
  "effect": { "type": "require", "targets": ["artwork.transparency"] },
  "description": "Warning-only: missing alpha may affect preview (DM [R8]). RULE_ART_001 (warning)." }
```

**Cover purity, barrier, layout (priority 5, correction #8)**

```json
{ "id": "rule_cov_output_a_only", "priority": 5, "domain": "cover",
  "condition": { "field": "cover.hasPreviewRefs", "operator": "eq", "value": true },
  "effect": { "type": "forbid", "targets": ["outputB_in_cover"] },
  "description": "Cover uses Output A only, never Preview (§5). RULE_COV_001." }
```
```json
{ "id": "rule_cov_barrier_all_a_ready", "priority": 5, "domain": "cover",
  "condition": { "field": "generationProgress.allOutputAReady", "operator": "eq", "value": false },
  "effect": { "type": "forbid", "targets": ["cover_build"] },
  "description": "Barrier: cover blocked unless outputAGenerated === totalScenes (derived boolean), not > 0 (§5). RULE_COV_002." }
```
```json
{ "id": "rule_cov_layout_matches_count", "priority": 5, "domain": "cover",
  "condition": { "field": "cover.layoutMatchesCount", "operator": "eq", "value": false },
  "effect": { "type": "forbid", "targets": ["cover.publish"] },
  "description": "Cover layout must match mockup count via derived boolean (§5; DM [R3]). RULE_COV_003." }
```

**Product view & compatibility (priority 5 / 2)**

```json
{ "id": "rule_prd_view_allowed_bella", "priority": 5, "domain": "composition",
  "condition": { "all": [
    { "field": "scene.productId", "operator": "eq", "value": "prod_bella3001" },
    { "field": "scene.view", "operator": "not_in", "value": ["front", "back"] } ] },
  "effect": { "type": "forbid", "targets": ["scene.view"] },
  "description": "Scene view must be within product allowedViews (§6). RULE_PRD_003." }
```
```json
{ "id": "rule_prd_audience_allowed_comfortcolors", "priority": 2, "domain": "model",
  "condition": { "all": [
    { "field": "session.productIds", "operator": "includes", "value": "prod_comfortcolors" },
    { "field": "session.audience", "operator": "not_in", "value": ["adult", "unisex"] } ] },
  "effect": { "type": "forbid", "targets": ["generation"] },
  "description": "Comfort Colors allowedAudiences = adult/unisex (§6). RULE_PRD_002." }
```
```json
{ "id": "rule_pa_require_min_size_guard", "priority": 1, "domain": "print_area",
  "condition": { "field": "printArea.sizeRatio", "operator": "num_lt", "value": 0.2 },
  "effect": { "type": "forbid", "targets": ["print_area_too_small"] },
  "description": "Categorical hard floor guard using numeric operator on a scalar; fine-grained per-profile check is Validation predicate PA-PRED-1 (§11). RULE_PA_006." }
```

(34 examples: 5 obstruction + 3 text/collage + 4 audience + 6 season + 3 palette + 3 count/dup + 5 preview/artwork + 3 cover + 3 product/print-area guard.)

---

## 19. Conflict-Resolution Examples (22, corrected)

Each shows the precedence outcome; a lower-priority rule is always dropped, never overriding a higher one.

1. **Print Area vs Season decor (same physical target).** Season decor overlaps print area; `rule_pa_no_props` (1) forbids the overlap → Print Area wins, decor dropped; `RULE_PA_003` if forced.
2. **Print Area vs aesthetic pose.** Aesthetic hand-on-chest pose vs `rule_pa_no_hands` (1) → pose dropped; `RULE_PA_001`.
3. **Audience vs Season hero.** Kids audience (2) forbids adult model; season hero uses one → Audience wins; `RULE_AUD_001`.
4. **Audience vs aesthetic.** Adult editorial pose vs Kids audience (2) → Audience wins.
5. **Season vs Palette — NOT a conflict (domain separation, #6).** Season (3) targets `scene.decorIds` (decor domain); Palette lock (4) targets `scene.paletteColorId` (garment-color domain). Disjoint buckets → both apply. A red seasonal decor accent may appear in the background while the garment stays White/Black. The season rule can never touch garment color (`RULE_CFG_003` if attempted).
6. **Palette lock vs product default color.** Product default Red vs lock {white,black} → defaults are seeds (ARCH §8.3); Red never enters garment candidates. No rule conflict.
7. **Two same-priority Season Forbids.** Flowers + hearts both forbidden → union; both removed.
8. **Same-priority Forbid vs Require.** Priority-5 Forbid beats Require (strength order); if the Require was mandatory it becomes a blocking failure.
9. **Dedup vs aesthetic selection.** Aesthetic picks a signature where `scene.isDuplicate` is true; `rule_dup_no_duplicate_signature` (5) forbids → next candidate by lexicographic order; if none, `RULE_CNT_001`.
10. **Scene-count Limit vs extra scene.** `rule_cnt_limit_to_requested` limit = `ref(requestedSceneCount)`; aesthetic wants one more → dynamic limit governs; extra dropped.
11. **Cover purity vs including a Preview.** Aesthetic wants Output B in cover; `rule_cov_output_a_only` (5) forbids (also type-impossible, DM §7.3) → `RULE_COV_001`.
12. **Cover barrier vs early build.** `allOutputAReady` false; `rule_cov_barrier_all_a_ready` forbids → `RULE_COV_002`; stays `Generating`.
13. **Preview require artwork vs null.** `outputB.artworkId` IsNull → Require unsatisfiable → blocking `RULE_PRV_001`.
14. **Product audience require vs session audience.** Compound Kids-product + non-Kids audience → forbid generation → `RULE_PRD_001`.
15. **Print-area numeric predicate vs product warning.** `sizeRatio < minSizeRatio` (PA-PRED-1 blocking) overrides P-4 warning → halts (`RULE_PA_006`); warning never suppresses a blocking predicate.
16. **Minimal Studio purity.** Compound season=minimal_studio + decorIds count_gte 1 → forbid seasonal_decor; `RULE_SEA_004` if forced.
17. **Two Locks intersect.** Lock {white,black} ∩ lock {black,navy} = {black}; scene needing white → `RULE_PAL_002`.
18. **Independent targets, no interaction.** Kids-product require (model domain) + Kids audience forbid adult (model domain, different target) → both apply; illustrates per-bucket independence.
19. **Collage ban vs multi-view aesthetic.** Aesthetic 2-panel composite vs `rule_clg_no_collage_output` (1) → Print Area class wins; `RULE_CLG_001`.
20. **Background text vs decor signage.** Legible signboard decor vs `rule_txt_no_readable_background` (1) → Print Area class wins; decor dropped; `RULE_TXT_001`.
21. **Duplicate tie-break.** Two identical-effect priority-5 rules → lexicographically smallest `ruleId` recorded; outcome identical; zero randomness.
22. **Season Forbid vs Palette Require, cross-domain.** Even if a Palette rule "required" a decor color accent, it cannot — Palette domain is garment-color only. Such a rule is a configuration error (`RULE_CFG_003`), so the collision cannot arise. Domains stay separated.

---

## 20. Edge Cases

1. Empty candidate set after filtering for a required dimension → blocking dimension code; never a random pick.
2. `requestedSceneCount < 1` → `RULE_CNT_002` (numeric operator) at Phase 0.
3. `requestedSceneCount > uniqueSpace` → `RULE_CNT_001` before filtering (10.3).
4. Single-color locked selection → lock closes garment color to that one ID; others → `RULE_PAL_002`.
5. Sand+Navy selection → lock targets exactly {Sand, Navy} via ContextRef; White/Black would fail `RULE_PAL_002` (correction #3 verified).
6. Minimal Studio scene with empty decor/props → valid.
7. Kids product + adult-only product together → `RULE_PRD_001`/`RULE_PRD_002` blocking.
8. Artwork uploaded before Output A generated → Output B stays `Pending`; Require deferred; no premature block.
9. Output A edited after B → `outputB.isStale` true → `RULE_PRV_003`; forces regeneration.
10. Cover with 10+ mockups → `Mosaic`; `cover.layoutMatchesCount` validates; mismatch → `RULE_COV_003`.
11. Pose-only repeat (full tuple differs) → `scene.isDuplicate` false → passes (DM [R5]).
12. Unknown context field in a condition → evaluates FALSE (rule inert); malformed operator/value shape → `RULE_CFG_001`; bad `ContextRef` → `RULE_CFG_002`.
13. Two active seasons → impossible by model (one `season`, DM §3.2); migrated bad data → `RULE_SEA_005`.
14. Readable text inside the uploaded artwork (Output B design) → allowed; the ban targets background text and Output A only.
15. Print area exactly at threshold → PA-PRED-1 uses `>=`, so equal passes; strictly below fails `RULE_PA_006`.
16. Warning-only session → `passed=true`; selections unchanged; generation proceeds.
17. Season rule authored against garment color → rejected at load with `RULE_CFG_003` (domain isolation).
18. Season with empty scene library → uniqueSpace 0 → `RULE_CNT_001`; never an empty photoshoot.

---

## 21. Source Consistency Appendix

### 21.1 Which document is amended

**Only `03_DATA_MODELS.md` is amended.** `01_PRD.md` and `02_ARCHITECTURE.md` are unchanged. All amendments are additive and backward-compatible (existing rule objects that used valid operators remain valid); `schemaVersion` increments for the rule/condition schema (DM §10 migration applies).

### 21.2 Amendment A1 — extend `RuleOperator` (corrections #1, #2)

Reason: `Count*` are array-length operators and were misused on numeric scalars; boolean/null were compared as strings. Add numeric and presence operators.

```typescript
// AMENDS DM §2.1 RuleOperator — replace the enum with:
export enum RuleOperator {
  // existing
  Equals      = 'eq',
  NotEquals   = 'neq',
  In          = 'in',
  NotIn       = 'not_in',
  Includes    = 'includes',
  CountEquals = 'count_eq',   // array length only
  CountGte    = 'count_gte',  // array length only
  CountLte    = 'count_lte',  // array length only
  // NEW — array negative membership
  Excludes    = 'excludes',
  // NEW — numeric scalar comparison (correction #1, Solution A)
  NumberEquals = 'num_eq',
  NumberGte    = 'num_gte',
  NumberLte    = 'num_lte',
  NumberGt     = 'num_gt',
  NumberLt     = 'num_lt',
  // NEW — presence / null (correction #2)
  Exists       = 'exists',
  IsNull       = 'is_null',
}
```

### 21.3 Amendment A2 — extend `RuleCondition.value` and make conditions composable (corrections #2, #5)

Reason: allow real `boolean`/`null` values; introduce deterministic compound conditions.

```typescript
// AMENDS DM §3.12 RuleCondition.value type:
export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value: string | number | boolean | null | readonly string[];  // + boolean, null
}

// NEW — compound condition model (correction #5)
export type ConditionNode = RuleCondition | ConditionGroup;

export type ConditionGroup =
  | { readonly all: readonly ConditionNode[] }   // AND
  | { readonly any: readonly ConditionNode[] }   // OR
  | { readonly not: ConditionNode };             // NOT

// AMENDS DM §3.12 Rule.condition type:
export interface Rule {
  readonly id: RuleId;
  priority: RulePriorityClass;
  domain: RuleDomain;              // NEW (correction #6)
  condition: ConditionNode;        // was RuleCondition
  effect: RuleEffect;
  description?: string;
}
```

### 21.4 Amendment A3 — dynamic effect values via `ContextRef` (corrections #3, #4)

Reason: eliminate hardcoded `"limit": 3` and enable the palette lock to target the actual selected `ColorId`s.

```typescript
// NEW
export interface ContextRef {
  /** Dotted path into the read-only EvaluationContext, e.g. "session.requestedSceneCount". */
  readonly ref: string;
}

// AMENDS DM §3.12 RuleEffect:
export interface RuleEffect {
  type: RuleEffectType;
  /** Literal target IDs and/or a dynamic reference resolving to an ID array. */
  targets: readonly (string | ContextRef)[];
  /** Literal cap or a dynamic reference resolving to a number. */
  limit?: number | ContextRef;
}
```

### 21.5 Amendment A4 — `RuleDomain` for domain separation (corrections #6, #7)

Reason: keep garment-color, decor/background, model, print-area, output, cover, composition concerns disjoint so cross-domain "conflicts" cannot occur and season rules cannot alter garment color.

```typescript
// NEW
export enum RuleDomain {
  PrintArea    = 'print_area',
  Background   = 'background',
  Output       = 'output',
  Model        = 'model',
  Decor        = 'decor',
  GarmentColor = 'garment_color',
  Composition  = 'composition',
  Cover        = 'cover',
}
```

Structural constraint (schema + load-time): a rule with `priority === RulePriorityClass.Season` must NOT have `domain === RuleDomain.GarmentColor` and must NOT target `scene.paletteColorId` → else `RULE_CFG_003`.

### 21.6 Derived context fields (no persisted-model change)

These live in the Rule Engine's `EvaluationContext` (a computed projection), not in persisted entities, so they are **not** DM amendments — documented here for completeness: `scene.isDuplicate` (Dedup Engine), `scene.garmentColorAllowed` (Palette Engine), `scene.modelType` (Scene Engine), `outputB.isStale` (from `sourceContentHash`, DM §6.3), `generationProgress.allOutputAReady` (= `outputAGenerated === totalScenes`), `cover.hasPreviewRefs`, `cover.layoutMatchesCount` (Cover Engine, DM [R3]).

### 21.7 Validation predicates (Validation Engine, not Rule objects — correction #7)

`PA-PRED-1..3` (print-area numeric thresholds vs `PrintAreaProfile`) and `COV-PRED-1` (`outputAGenerated === totalScenes`) are Validation Engine predicates. They compare two dynamic operands (measured value vs profile value, or count vs count) and therefore are not condition-vs-literal `Rule` objects.

### 21.8 Error-code additions

`RULE_PA_005N` (shadow-coverage predicate), `RULE_CFG_002` (bad ContextRef), `RULE_CFG_003` (season rule targeting garment color) added to the registry (section 14).

### 21.9 Internal-consistency confirmation

- **Operators:** every JSON example uses `Count*` only on array fields (`decorIds`, `colorIds`), `Number*` only on scalar numbers (`requestedSceneCount`, `printArea.sizeRatio`), booleans via `Equals` against real `true`/`false`, and null via `IsNull`. No string booleans or string nulls remain. ✔
- **Palette lock:** keyed on `locked` and targets `{ ref: "session.colorSelection.colorIds" }` — verifies actual ColorIds, not count; Sand+Navy locks to Sand+Navy. ✔ (edge case 5)
- **Scene count:** limit is `{ ref: "session.requestedSceneCount" }`; no literal `3` anywhere. ✔
- **Compound conditions:** all season/product multi-factor rules use `ConditionGroup.all`; no undocumented scope assumption. ✔
- **Domain separation:** garment-color and decor/background are disjoint domains; season rules cannot target garment color (`RULE_CFG_003`); "Season vs Palette" is no longer a real conflict. ✔ (conflict examples 5, 22)
- **Print-area layering:** obstruction = categorical rules; numeric thresholds = Validation predicates; measurements = Print-Area Engine. No `Count*` on measurements. ✔
- **Cover barrier:** uses `allOutputAReady` (=== totalScenes), not `> 0`. ✔
- **Determinism preserved; Print Area highest; blocking halts; warnings never mutate.** ✔
- **No placeholders** (`"__ledger_seen__"` replaced by derived boolean `scene.isDuplicate`). ✔

`04_RULE_ENGINE_REVISED.md` is internally consistent and consistent with `01_PRD.md`, `02_ARCHITECTURE.md`, and `03_DATA_MODELS.md` as amended by A1–A4.

---

*End of revised Rule Engine specification. Specification, matrices, error registry, and JSON rule data only — no application code, engine implementation, React, HTML, or CSS. All types/enums/branded IDs are those of `03_DATA_MODELS.md` as amended in section 21.*
