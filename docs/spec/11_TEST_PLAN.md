# 11_TEST_PLAN.md

# Mockup Photoshoot Director — QA Master Test Specification

**Document type:** QA Master Test Plan (specification only)
**Sources of truth (only):** `01_PRD.md`, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`, `08_COVER_ENGINE.md`, `09_EXPORT_ENGINE.md`, `10_APP_WORKFLOW.md`
**Status:** Authoritative single testing reference.
**Scope note:** Specification only — no code, HTML, CSS, React, or TypeScript. This document verifies every engine, workflow, state, rule, error, and transition. Every numbered test uses the five-field format: **Purpose · Setup · Steps · Expected · Fail if**. All behavior expected to be deterministic (identical inputs+versions ⇒ identical outputs).

`§`=PRD, `ARCH`, `DM`, `RE`, `SE`, `PE`, `UI`, `CE`, `EX`, `WF`=`10_APP_WORKFLOW.md`.

---

## 1. QA Philosophy

Testing verifies the documented contracts, not implementation guesses. Core tenets: (1) **Determinism first** — every feature must be reproducible; (2) **Contract fidelity** — behavior must match the authoritative specs exactly; (3) **Fail closed** — blocking conditions must halt, never silently pass; (4) **No silent mutation/omission** — warnings never change data, partial results are always listed; (5) **Print-area supremacy** — priority-1 rules are never overridden; (6) **One prompt = one image** — verified everywhere prompts appear; (7) **Traceability** — every test maps to a source section. A build ships only when every blocking test passes and the certification checklist (§30) is green.

## 2. Test Strategy

Layers: **Unit** (pure engine functions, rule evaluation, hashing), **Integration** (engine-to-engine handoffs along the pipeline), **Workflow** (end-to-end journeys), **UI/State** (transitions, button states, notifications), **Non-functional** (determinism, performance, stress, security), **Regression/Compatibility** (cross-document consistency, migrations). Test data is fixed and versioned so runs are reproducible. Every engine has a dedicated matrix (§3) and a dedicated test block (§9–§13). Priorities: **P0** blocking/safety (print area, gate, one-image, cover purity, no-overwrite), **P1** correctness (numbering, color, dedup, checksums), **P2** UX/perf, **P3** cosmetic.

## 3. Unit Testing Matrix

| Unit area | Source | Focus | Block |
|---|---|---|---|
| Branded IDs / serialization | DM §1 | ID string round-trip | §13 |
| RuleOperator semantics | RE §12 | eq/neq/in/includes/count*/num*/exists/isnull | §9 |
| ConditionGroup all/any/not | RE §5 | boolean logic | §9 |
| ContextRef / NumericExpression | DM §3.12 | dynamic resolve, arithmetic, min/max | §9 |
| Precedence ladder | RE §2 | print-area supremacy | §9 |
| DedupSignature hash | DM §3.5 | 4-tuple uniqueness | §10 |
| sceneFingerprint | DM §3.5 | generation-affecting only | §10/§19 |
| Scoring formula | SE §7 | weights, tie-break | §10 |
| Color round-robin | SE §14 | deterministic allocation | §10 |
| Prompt composition order | PE §2 | module ordering | §11 |
| promptChecksum | PE §19 | timestamp exclusion | §11/§19 |
| Cover layout mapping | CE §4 | count→grid | §12 |
| Cover primaries | CE §11/DM §3.9 | mode + ID tie-break | §12 |
| Canonical JSON / SHA-256 | EX §10/§14 | sorted keys, digest | §13 |
| File-name policy | EX §12 | safe/stable names | §13 |

## 4. Integration Testing Matrix

| Handoff | From→To | Verifies | Block |
|---|---|---|---|
| Constraints | Rule→Scene | filter application | §6/§10 |
| Colors | Palette→Scene | locked-set legality | §10 |
| Measurement | Scene→Print-Area | obstruction/size facts | §10/§16-testing |
| Signature | Scene→Dedup | uniqueness | §10 |
| Gate | Scene→Validation | pass/fail routing | §8/§9 |
| Prompts | Scene→Prompt | A/B pairing, numbering | §11 |
| Barrier | Orchestrator→Cover | allOutputAReady | §12 |
| Cover meta | Cover→Export | Output-A-only purity | §13 |
| Package | Prompt/Cover→Export | byte-for-byte | §13 |
| Snapshot | Orchestrator→Persistence | save/version | §14 |

---

## 5. Engine Testing (overview)

Each engine block below lists numbered tests (T###) in the five-field format. Blocks: Rule §9, Scene §10, Prompt §11, Cover §12, Export §13, Persistence §14, Recovery §15, Version §16, Autosave §17, Undo/Redo §18, Determinism §19, Performance §20, Stress §21, Security §22, Regression §23, Compatibility §24. Cross-engine workflow tests are in §6; UI in §7; state machine in §8.

## 6. Workflow Testing

**T001 Full happy-path pipeline** — Purpose: verify Rule→Palette→Scene→Validation→Prompt→Cover→Export end-to-end. Setup: valid session, colors locked, count feasible, PNG uploaded. Steps: run generate → mark A done → run B → cover → export. Expected: all stages complete in order; artifacts consistent. Fail if: any stage runs out of order or a stage auto-runs images.
**T002 Gate blocks generation** — Purpose: Editing↛Generating without pass. Setup: session missing audience. Steps: request generate. Expected: Validating→Blocked; no Prompt stage. Fail if: prompts composed.
**T003 A-before-B ordering** — Purpose: all A precede B. Setup: 3-scene session. Steps: inspect execution plan. Expected: Phase 1 (1A,2A,3A) then Phase 2 (1B..3B). Fail if: any B precedes its A.
**T004 Cover barrier** — Purpose: cover only after all A ready. Setup: 2 of 3 A generated. Steps: request cover. Expected: blocked `COVER_BARRIER_001`. Fail if: cover composed.
**T005 Nothing auto-generates images** — Purpose: manual image step. Setup: prompts composed. Steps: observe. Expected: no image generation triggered; user must run prompts. Fail if: app calls an image model.
**T006 Reset keeps saved projects** — Purpose: reset clears working only. Setup: saved project + edits. Steps: reset (confirm). Expected: Idle; saved project intact. Fail if: saved project altered.
**T007 Reopen archived forks version** — Purpose: archive→reopen. Setup: archived project. Steps: reopen. Expected: Editing; new version lineage. Fail if: overwrites prior snapshot.
**T008 Multi-session project order** — Purpose: stable session order. Setup: 2 sessions. Steps: export project. Expected: session-01, session-02 by sessionOrder. Fail if: order varies.
**T009 Idempotent re-run** — Purpose: unchanged fingerprint reproduces. Setup: completed session. Steps: re-run pipeline. Expected: identical scenes/prompts/cover/export. Fail if: any byte differs.
**T010 Warning-only passes** — Purpose: warnings don't halt. Setup: near-threshold print area (warning). Steps: validate. Expected: passed=true; advisory shown; selection unchanged. Fail if: blocked or mutated.

## 7. UI Testing

**T011 Generate button always present** — Purpose: never missing. Setup: any screen/breakpoint. Steps: inspect. Expected: button visible; Blocked/Disabled with reason when unusable. Fail if: hidden with no reason.
**T012 Copy A toast** — Purpose: clipboard confirm. Setup: composed 1A. Steps: Copy A. Expected: 1A on clipboard; Arabic success toast. Fail if: silent/no-op.
**T013 Copy Pair separate blocks** — Purpose: no combined request. Setup: scene 1. Steps: Copy Pair. Expected: 1A + 1B two blocks + banner "طلبان منفصلان". Fail if: single combined request implied.
**T014 Locked control tooltips** — Purpose: gated nav explained. Setup: pre-validation. Steps: hover Export. Expected: disabled + Arabic reason. Fail if: hidden or no reason.
**T015 RTL + English prompt LTR** — Purpose: bidi. Setup: Prompt Preview. Steps: view. Expected: Arabic UI RTL; English prompt LTR isolated. Fail if: reordering artifacts.
**T016 Mode switch lossless** — Purpose: Quick↔Professional. Setup: Quick session. Steps: switch to Professional. Expected: same data, more panes; no regeneration. Fail if: data changes.
**T017 Drag-drop invalid snap-back** — Purpose: valid reorder only. Setup: scene list. Steps: invalid drop. Expected: snap back; no change. Fail if: invalid order committed.
**T018 Keyboard-only flow** — Purpose: accessibility. Setup: no pointer. Steps: navigate/build via keys. Expected: every action reachable. Fail if: any control unreachable.
**T019 Blocking notification ordering** — Purpose: print-area tops stack. Setup: print-area + other blocking. Steps: validate. Expected: print-area error first. Fail if: lower error above it.
**T020 Unsaved-changes dialog** — Purpose: no silent loss. Setup: dirty session. Steps: navigate away. Expected: Save/Discard/Cancel dialog. Fail if: silent discard.

## 8. State Machine Testing

**T021 Idle→Editing** — Purpose: create/open. Setup: Home. Steps: new session. Expected: Editing/Draft. Fail if: skips to later state.
**T022 Editing→Validating→Blocked** — Purpose: fail path. Setup: invalid session. Steps: generate. Expected: Blocked banner. Fail if: proceeds.
**T023 Validating→Ready** — Purpose: pass path. Setup: valid session. Steps: validate. Expected: Ready. Fail if: not enabled.
**T024 Generating→Paused→Generating** — Purpose: pause/resume. Setup: generating. Steps: pause; resume. Expected: state toggles; no loss. Fail if: state lost.
**T025 Ready→Exporting→Finished** — Purpose: export path. Setup: artifacts. Steps: export. Expected: Finished. Fail if: stuck.
**T026 Any→Idle reset** — Purpose: guarded reset. Setup: any state. Steps: reset (confirm). Expected: Idle; working cleared. Fail if: no confirm or saved lost.
**T027 Guard enforcement** — Purpose: transitions need guards. Setup: cover before barrier. Steps: attempt. Expected: blocked. Fail if: transition allowed.
**T028 No hidden auto-advance** — Purpose: explicit transitions. Setup: Ready. Steps: idle-wait. Expected: no auto-move to Generating. Fail if: auto-advances.
**T029 Session status mapping** — Purpose: UI↔SessionStatus. Setup: each lifecycle state. Steps: inspect status. Expected: mapping per WF §1. Fail if: mismatch.
**T030 Snapshot on Ready** — Purpose: version written. Setup: reach Ready. Steps: check history. Expected: VersionSnapshot(reason=generated). Fail if: none.

## 9. Rule Engine Testing

**T031 Print-area supremacy** — Purpose: PA outranks season. Setup: season decor over print area. Steps: eval. Expected: PA Forbid wins; season dropped. Fail if: season effect applied over print area.
**T032 Audience > season** — Purpose: kids forbids adult model in season hero. Setup: Kids + season adult hero. Steps: eval. Expected: `RULE_AUD_001`. Fail if: adult model allowed.
**T033 Season vs palette disjoint** — Purpose: domain separation. Setup: season red decor + White/Black garment lock. Steps: eval. Expected: both apply; garment stays locked; decor allowed. Fail if: season alters garment color.
**T034 Palette lock actual colors** — Purpose: Sand+Navy. Setup: locked {Sand,Navy}. Steps: eval scene using White. Expected: `RULE_PAL_002`. Fail if: White accepted.
**T035 Dynamic scene limit** — Purpose: no hardcode. Setup: requestedSceneCount=7. Steps: eval limit rule. Expected: limit resolves to 7 via ContextRef. Fail if: fixed 3.
**T036 count_* on arrays only** — Purpose: operator correctness. Setup: count_gte on decorIds. Steps: eval. Expected: array length compared. Fail if: applied to scalar.
**T037 num_* on scalars only** — Purpose: numeric operator. Setup: num_lt on requestedSceneCount. Steps: eval. Expected: numeric compare. Fail if: count_* misused.
**T038 Boolean real value** — Purpose: no string bool. Setup: colorSelection.locked eq true. Steps: eval. Expected: real boolean match. Fail if: "true" string compared.
**T039 IsNull operator** — Purpose: null check. Setup: outputB.artworkId null. Steps: eval require. Expected: `RULE_PRV_001`. Fail if: "null" string compared.
**T040 ConditionGroup all** — Purpose: AND. Setup: season=fathers_day AND decor includes mothersday. Steps: eval. Expected: `RULE_SEA_001`. Fail if: fires on either alone.
**T041 Domain isolation config** — Purpose: season≠garment color. Setup: season rule targeting paletteColorId. Steps: load. Expected: `RULE_CFG_003`. Fail if: accepted.
**T042 Bad ContextRef** — Purpose: config guard. Setup: ref to unknown path. Steps: load. Expected: `RULE_CFG_002`. Fail if: silent pass.
**T043 Operator/value mismatch** — Purpose: schema guard. Setup: malformed condition. Steps: load. Expected: `RULE_CFG_001`. Fail if: accepted.
**T044 Feasibility block** — Purpose: count>space. Setup: tiny library, count 10. Steps: eval. Expected: `RULE_CNT_001` pre-assembly. Fail if: deadlock/random.
**T045 Duplicate signature** — Purpose: uniqueness. Setup: two identical 4-tuples. Steps: eval. Expected: `RULE_DUP_001`. Fail if: duplicate allowed.
**T046 Kids product requires kids audience** — Purpose: compat. Setup: Kids product + adult audience. Steps: eval. Expected: `RULE_PRD_001`. Fail if: allowed.
**T047 View legality** — Purpose: allowedViews. Setup: side view on front-only product. Steps: eval. Expected: `RULE_PRD_003`. Fail if: allowed.
**T048 Effect strength order** — Purpose: same-priority Forbid>Require. Setup: conflicting same-priority. Steps: resolve. Expected: Forbid wins; Require blocking if mandatory. Fail if: Require overrides.
**T049 Rule trace completeness** — Purpose: explainability. Setup: dropped rule. Steps: read trace. Expected: overriddenBy + reason logged. Fail if: missing.
**T050 Print-area numeric = predicate not rule** — Purpose: layering. Setup: sizeRatio below min. Steps: validate. Expected: PA-PRED-1 blocking, not a count rule. Fail if: modeled as count rule.
**T051 Warning severity** — Purpose: non-halting. Setup: artwork no alpha. Steps: eval. Expected: warning `RULE_ART_001`; passes. Fail if: blocks.
**T052 Minimal Studio no decor** — Purpose: season rule. Setup: minimal_studio + decor. Steps: eval. Expected: `RULE_SEA_004`. Fail if: decor allowed.
**T053 Excludes operator** — Purpose: negative membership. Setup: decorIds excludes set. Steps: eval. Expected: correct exclusion. Fail if: wrong.
**T054 NumericExpression arithmetic** — Purpose: n-1. Setup: limit = requestedSceneCount-1. Steps: resolve n=8. Expected: 7. Fail if: not 7.
**T055 minimum()/maximum()** — Purpose: functions. Setup: limit=minimum(count,cap). Steps: resolve. Expected: min value. Fail if: wrong.
**T056 Determinism of trace** — Purpose: reproducible. Setup: same context twice. Steps: eval. Expected: identical trace hash. Fail if: differs.
**T057 Precedence never overridden** — Purpose: invariant. Setup: any lower vs higher. Steps: eval many. Expected: higher always wins, lower dropped. Fail if: any inversion.
**T058 Blocking halts pipeline** — Purpose: gate. Setup: blocking rule. Steps: run. Expected: no downstream stage. Fail if: proceeds.
**T059 Warning no mutation** — Purpose: safety. Setup: warning. Steps: eval. Expected: selection unchanged. Fail if: changed.
**T060 Cover-uses-B rule** — Purpose: purity. Setup: cover refs B. Steps: eval. Expected: `RULE_COV_001`. Fail if: allowed.

## 10. Scene Engine Testing

**T061 Deterministic assembly** — Purpose: reproducible scenes. Setup: fixed session. Steps: assemble twice. Expected: identical scenes/order. Fail if: differs.
**T062 Candidate rejection (exclusions)** — Purpose: impossible combos. Setup: mutually exclusive items. Steps: generate. Expected: rejected. Fail if: included.
**T063 requiredCompanions** — Purpose: mandatory co-occur. Setup: item with companion forbidden. Steps: generate. Expected: candidate rejected. Fail if: emitted without companion.
**T064 Scoring tie-break** — Purpose: determinism. Setup: equal scores. Steps: order. Expected: dedupSignature.hash ascending. Fail if: random.
**T065 Hard uniqueness** — Purpose: no dup 4-tuple. Setup: 20 scenes. Steps: assemble. Expected: all signatures unique. Fail if: duplicate.
**T066 Soft diversity caps** — Purpose: variety. Setup: 20 scenes small pool. Steps: assemble. Expected: repeats minimized deterministically, penalties applied. Fail if: unbounded repetition or random fill.
**T067 Mood anchor cohesion** — Purpose: one photoshoot. Setup: 20 scenes. Steps: inspect. Expected: constant palette/product/season. Fail if: drift.
**T068 Color round-robin** — Purpose: allocation. Setup: colors [A,B,C], 6 scenes. Steps: assemble. Expected: A,B,C,A,B,C by sceneOrder. Fail if: uneven/random.
**T069 Primary color to hero** — Purpose: emphasis. Setup: hero scenes. Steps: assemble. Expected: hero gets primaryColor first. Fail if: not.
**T070 View assignment front dominant** — Purpose: visibility. Setup: mixed views. Steps: assemble. Expected: heroes Front. Fail if: back hero displaces front.
**T071 Print-area safe filtering** — Purpose: obstruction. Setup: prop over print area. Steps: assemble. Expected: excluded/rejected. Fail if: included.
**T072 Output pair creation** — Purpose: A+B always. Setup: any scene. Steps: assemble. Expected: OutputA + OutputB placeholders. Fail if: missing one.
**T073 sceneFingerprint stability** — Purpose: regen key. Setup: cosmetic edit (name). Steps: compare. Expected: fingerprint unchanged. Fail if: changes.
**T074 sceneFingerprint change** — Purpose: regen trigger. Setup: change pose. Steps: compare. Expected: fingerprint changes; A→Pending, B→Stale. Fail if: no regen mark.
**T075 Feasibility precheck** — Purpose: pre-assembly block. Setup: count>space. Steps: assemble. Expected: `RULE_CNT_001` before filtering. Fail if: partial assembly.
**T076 Hero/support ratio** — Purpose: composition. Setup: 20 scenes. Steps: assemble. Expected: ~30% hero per table. Fail if: ratio off.
**T077 Session size 4/8/12/20/40/50** — Purpose: scaling. Setup: each size. Steps: assemble. Expected: correct hero/support/views. Fail if: mismatch.
**T078 Kids no adult model** — Purpose: audience. Setup: Kids. Steps: assemble. Expected: only child/no-model poses. Fail if: adult model.
**T079 Diversity determinism** — Purpose: coverage rotation. Setup: same session. Steps: assemble twice. Expected: identical coverage. Fail if: differs.
**T080 Dedup ledger space size** — Purpose: precompute. Setup: known pool. Steps: compute. Expected: combinationSpaceSize correct. Fail if: wrong.
**T081 totalScenes set** — Purpose: progress. Setup: assemble N. Steps: check. Expected: totalScenes=N. Fail if: wrong.
**T082 SceneCreated events** — Purpose: audit. Setup: assemble. Steps: capture events. Expected: one per scene with fingerprint. Fail if: missing.
**T083 Replace Scene keeps uniqueness** — Purpose: swap. Setup: replace a scene. Steps: run. Expected: next-best unique candidate. Fail if: duplicate/constraint break.
**T084 Lock Scene excluded from re-plan** — Purpose: pinning. Setup: locked scene + re-plan. Steps: run. Expected: locked scene unchanged. Fail if: altered.
**T085 Decor domain vs garment color** — Purpose: separation. Setup: red decor, White/Black garment. Steps: assemble. Expected: decor allowed, garment locked. Fail if: garment recolored.
**T086 Empty decor (Minimal Studio)** — Purpose: valid empties. Setup: minimal_studio. Steps: assemble. Expected: empty decor/props valid. Fail if: forced decor.
**T087 Multi-product distribution** — Purpose: product slots. Setup: 2 products. Steps: assemble. Expected: deterministic split. Fail if: random.
**T088 Deterministic ordering across runs** — Purpose: sceneOrder. Setup: same session. Steps: assemble. Expected: identical sceneOrder. Fail if: differs.
**T089 No randomness** — Purpose: §2. Setup: instrument. Steps: assemble. Expected: no RNG/time seed. Fail if: any nondeterminism.
**T090 Diversity vs feasibility** — Purpose: fill under tight pool. Setup: tight pool exact count. Steps: assemble. Expected: fills exactly, hard-unique. Fail if: fails feasible case.

## 11. Prompt Engine Testing

**T091 One prompt one image (A)** — Purpose: single image. Setup: 1A. Steps: compose. Expected: one-image directive; no collage. Fail if: multi-image.
**T092 One prompt one image (B)** — Purpose: single edit. Setup: 1B. Steps: compose. Expected: one edited image. Fail if: multi.
**T093 A/B separate** — Purpose: no combined. Setup: pair. Steps: compose. Expected: separate prompts. Fail if: combined request.
**T094 B is edit-mode** — Purpose: reference. Setup: 1B. Steps: compose. Expected: uses 1A source + PNG. Fail if: text-to-image.
**T095 B requires source A** — Purpose: gate. Setup: A missing. Steps: attempt B. Expected: `PROMPT_SRC_001` Blocked. Fail if: composed/run.
**T096 B requires PNG** — Purpose: gate. Setup: no PNG. Steps: attempt B. Expected: `PROMPT_PNG_001` Blocked. Fail if: invented artwork.
**T097 Output A blank** — Purpose: no marks. Setup: 1A. Steps: compose. Expected: forbids artwork/logo/watermark/typography. Fail if: any allowed.
**T098 No readable scene text** — Purpose: §4. Setup: any A/B. Steps: compose. Expected: no-readable-text clause. Fail if: missing.
**T099 No collage** — Purpose: §3. Setup: any prompt. Steps: compose. Expected: no-collage clause. Fail if: collage requested.
**T100 Print-area last-and-firmest** — Purpose: supremacy. Setup: A/B. Steps: compose. Expected: print-area clause present, non-negotiable. Fail if: absent/softened.
**T101 B preserves all attributes** — Purpose: only-artwork-changes. Setup: 1B. Steps: compose. Expected: preserve model/face/pose/crop/camera/bg/light/product/color/folds/shadows/props/composition. Fail if: any omitted.
**T102 Artwork lock** — Purpose: no invention. Setup: 1B. Steps: compose. Expected: forbid redraw/recolor/replace/etc. Fail if: missing.
**T103 Fabric integration** — Purpose: realism. Setup: 1B. Steps: compose. Expected: wrinkle/drape/opacity/soft-edge; no sticker/flat/white-box/checkerboard. Fail if: missing.
**T104 Multi-garment B** — Purpose: father+son. Setup: 2-garment scene. Steps: compose B. Expected: PNG on each garment, one image. Fail if: multiple images.
**T105 Numbering stable** — Purpose: {n}A/{n}B. Setup: 3 scenes. Steps: compose+export. Expected: identical numbers everywhere. Fail if: drift.
**T106 Kids no adult wording** — Purpose: §11.1. Setup: Kids product. Steps: compose. Expected: no adult-model wording; `PROMPT_AUD_001` if forced. Fail if: adult wording.
**T107 View wording legal** — Purpose: allowedViews. Setup: illegal view. Steps: compose. Expected: `PROMPT_VIEW_001`. Fail if: composed.
**T108 Color wording locked** — Purpose: palette. Setup: illegal color. Steps: compose. Expected: `PROMPT_COLOR_001`. Fail if: composed.
**T109 promptChecksum deterministic** — Purpose: §20. Setup: same inputs+versions. Steps: compose twice. Expected: identical checksum. Fail if: differs.
**T110 Timestamp excluded from checksum** — Purpose: §19. Setup: different generatedAt. Steps: compose. Expected: checksum unchanged. Fail if: changes.
**T111 No synonyms** — Purpose: fixed wording. Setup: repeat compose. Expected: identical text. Fail if: variant wording.
**T112 Group prompt is plan** — Purpose: §16. Setup: group. Steps: compose. Expected: execution plan, not one image. Fail if: single-image directive.
**T113 Stale B** — Purpose: source changed. Setup: A edited post-B. Steps: revalidate. Expected: `PROMPT_STALE_001`. Fail if: treated current.
**T114 Unresolved variable** — Purpose: §21. Setup: missing var. Steps: compose. Expected: `PROMPT_VAR_001`; copy Blocked. Fail if: emitted.
**T115 Module version invalid** — Purpose: §21. Setup: bad module version. Steps: compose. Expected: `PROMPT_MOD_001`. Fail if: composed.
**T116 Module composition order** — Purpose: §2.2. Setup: A prompt. Steps: inspect. Expected: Global→Product→Season→Scene→OutputA. Fail if: reordered.
**T117 Precedence in prompt** — Purpose: §2.3. Setup: conflicting clauses. Steps: compose. Expected: higher-precedence clause kept, lower dropped. Fail if: inversion.
**T118 English prompt / Arabic UI** — Purpose: §20/UI. Setup: compose. Steps: inspect. Expected: prompt English; UI Arabic. Fail if: mixed wrongly.
**T119 Phase plan two-phase** — Purpose: §17. Setup: N scenes. Steps: build plan. Expected: all A then each B-using-A. Fail if: interleaved.
**T120 promptHash change on edit** — Purpose: §19. Setup: change scene dim. Steps: recompose. Expected: promptHash changes. Fail if: stale.

## 12. Cover Engine Testing

**T121 Sale Images A only** — Purpose: purity. Setup: cover. Steps: compose. Expected: only OutputA refs. Fail if: any B.
**T122 Cover-uses-B blocked** — Purpose: §18. Setup: force B ref. Steps: compose. Expected: `COVER_SRC_001`. Fail if: composed.
**T123 Source lock clause** — Purpose: §13. Setup: cover. Steps: compose. Expected: forbid regenerate/redraw/recolor/... Fail if: missing.
**T124 Layout by count 2** — Purpose: §4. Setup: 2 mockups. Steps: compose. Expected: Duo 2×1. Fail if: wrong.
**T125 Layout 4/6/8** — Purpose: §4. Setup: each. Steps: compose. Expected: 2×2 / 2×3 / 3×3(hero 2×2). Fail if: wrong.
**T126 Layout 10/20/50** — Purpose: mosaic. Setup: each. Steps: compose. Expected: 4×3 / 5×4 / 8×7 per formula. Fail if: wrong.
**T127 Hero dominance** — Purpose: §5. Setup: count≥8. Steps: compose. Expected: hero 2×2 span. Fail if: equal cells.
**T128 Primaries deterministic** — Purpose: §11. Setup: mixed products/colors. Steps: compose. Expected: mode + smallest-ID tie-break. Fail if: nondeterministic.
**T129 Warm neutral bg** — Purpose: doctrine. Setup: cover. Steps: compose. Expected: warm neutral; no green. Fail if: green default.
**T130 Green rejected** — Purpose: §19. Setup: green requested. Steps: compose. Expected: `COVER_GREENBG_001`/override. Fail if: green output.
**T131 Large images small type** — Purpose: doctrine. Setup: cover. Steps: compose. Expected: mockups dominant, small text. Fail if: text dominant.
**T132 Color strip locked only** — Purpose: §7. Setup: locked colors. Steps: compose. Expected: strip = locked set, primary-first. Fail if: extra color.
**T133 Strip order** — Purpose: §7.2. Setup: colors. Steps: compose. Expected: primary then lexicographic. Fail if: wrong order.
**T134 Badges by flags** — Purpose: §8. Setup: isDigitalProduct true/false. Steps: compose. Expected: digital badges only when true. Fail if: wrong.
**T135 Product name from manifest** — Purpose: §9. Setup: product. Steps: compose. Expected: `Product.name`, no hardcode. Fail if: hardcoded.
**T136 Season label from manifest** — Purpose: §10. Setup: season. Steps: compose. Expected: `Season.name`; Minimal Studio neutral. Fail if: wrong.
**T137 Metadata counts** — Purpose: §11. Setup: session. Steps: compose. Expected: mockup/view/color/product counts correct. Fail if: mismatch.
**T138 mockupCount = images** — Purpose: invariant. Setup: cover. Steps: compose. Expected: equal. Fail if: `COVER_COUNT_001`.
**T139 Layout mismatch** — Purpose: §18. Setup: wrong layout. Steps: validate. Expected: `COVER_LAYOUT_001`. Fail if: accepted.
**T140 coverHash deterministic** — Purpose: §17. Setup: same inputs. Steps: compose twice. Expected: identical coverHash. Fail if: differs.
**T141 Cover emits prompt only** — Purpose: mission. Setup: compose. Steps: observe. Expected: text only, no image. Fail if: image produced.
**T142 Duplicate image rejected** — Purpose: §18. Setup: repeated A id. Steps: compose. Expected: `COVER_DUP_001`. Fail if: accepted.
**T143 Missing metadata** — Purpose: §18. Setup: missing field. Steps: compose. Expected: `COVER_META_001`. Fail if: composed.
**T144 50-mockup uncluttered** — Purpose: §22. Setup: 50 A. Steps: compose. Expected: deterministic, uncluttered, hero dominant. Fail if: clutter.
**T145 Digital false suppresses badges** — Purpose: §8. Setup: isDigitalProduct false. Steps: compose. Expected: no digital badges. Fail if: shown.

## 13. Export Engine Testing

**T146 Byte-for-byte prompts** — Purpose: §0.2. Setup: export TXT. Steps: compare to stored. Expected: identical bytes. Fail if: reflow/trim.
**T147 A/B linkage preserved** — Purpose: §7. Setup: export JSON. Steps: inspect. Expected: sourceOutputAId present. Fail if: broken.
**T148 Numbering across formats** — Purpose: §7. Setup: export all formats. Steps: compare. Expected: identical numbers. Fail if: drift.
**T149 ZIP deterministic** — Purpose: §11. Setup: export ZIP twice. Steps: compare. Expected: identical archive checksum. Fail if: differs.
**T150 Fixed epoch timestamps** — Purpose: §11.1. Setup: ZIP. Steps: inspect entries. Expected: 1980-01-01 fixed. Fail if: wall-clock.
**T151 Entry order lexicographic** — Purpose: §6. Setup: ZIP. Steps: list. Expected: byte-lexicographic paths. Fail if: FS order.
**T152 Checksum excludes timestamp** — Purpose: §14. Setup: two exports different time. Steps: compare content checksums. Expected: equal. Fail if: differ.
**T153 Prompt change → checksum change** — Purpose: §14. Setup: edit prompt. Steps: export. Expected: that checksum changes. Fail if: stale.
**T154 Reorder → names change, content same** — Purpose: §14. Setup: reorder scenes. Steps: export. Expected: filenames change, prompt checksums same. Fail if: content checksum changes.
**T155 No runtime objects** — Purpose: §10.2. Setup: JSON export. Steps: search. Expected: no EvaluationContext/Resolved*. Fail if: present.
**T156 No secrets/paths** — Purpose: §21. Setup: export. Steps: scan. Expected: no local paths/keys/ids. Fail if: leaked.
**T157 Artwork metadata only** — Purpose: §21. Setup: export. Steps: inspect assets. Expected: metadata, no bytes. Fail if: image bytes.
**T158 Cover export A only** — Purpose: purity. Setup: export cover. Steps: inspect. Expected: OutputA refs only. Fail if: B.
**T159 Partial export lists omissions** — Purpose: §18. Setup: no PNG. Steps: export. Expected: A exported, B omitted+listed. Fail if: silent omission.
**T160 Clipboard banner** — Purpose: §5.1. Setup: Copy Group. Steps: paste. Expected: separate-request banner. Fail if: missing.
**T161 Clipboard denied fallback** — Purpose: §5.2. Setup: deny clipboard. Steps: copy. Expected: `EXPORT_CLIP_002` + TXT fallback identical bytes. Fail if: content lost.
**T162 Manifest completeness** — Purpose: §13. Setup: export. Steps: inspect manifest. Expected: files+sizes+checksums+versions+fingerprints. Fail if: missing.
**T163 Canonical JSON keys** — Purpose: §10.3. Setup: JSON. Steps: inspect. Expected: sorted keys; absent-optional omitted (checksum variant). Fail if: unstable.
**T164 Branded IDs as strings** — Purpose: §10.3. Setup: JSON. Steps: inspect. Expected: plain string IDs. Fail if: wrapped.
**T165 Filename safety** — Purpose: §12. Setup: export. Steps: inspect names. Expected: ASCII-safe, no reserved, ≤ limits. Fail if: invalid.
**T166 Arabic name preserved** — Purpose: §12/§20. Setup: Arabic project name. Steps: export. Expected: ASCII slug path; Arabic in metadata. Fail if: lost.
**T167 Reserved Windows name** — Purpose: §12. Setup: name "CON". Steps: export. Expected: prefixed. Fail if: unusable.
**T168 Collision suffix** — Purpose: §12. Setup: two identical slugs. Steps: export. Expected: _2 suffix deterministically. Fail if: overwrite.
**T169 ZIP path traversal import** — Purpose: §21. Setup: malicious zip. Steps: import. Expected: rejected. Fail if: escapes.
**T170 Decompression bomb** — Purpose: §21. Setup: bomb. Steps: import. Expected: aborted. Fail if: resource exhaustion.
**T171 Execution Plan two-phase** — Purpose: §16. Setup: export plan. Steps: inspect. Expected: Phase1 A, Phase2 B-using-A. Fail if: wrong.
**T172 Prompt Pack contents** — Purpose: §16. Setup: export pack. Steps: inspect. Expected: README+plan+A+B+group+cover+numbering map. Fail if: missing.
**T173 Cancellation no partial** — Purpose: §22. Setup: cancel mid-ZIP. Steps: cancel. Expected: no file; ExportFailed. Fail if: partial file.
**T174 Re-export idempotent** — Purpose: §0.9. Setup: no change. Steps: export twice. Expected: identical bytes/checksums. Fail if: differs.
**T175 Blocking export halts** — Purpose: §17. Setup: broken linkage. Steps: export. Expected: `EXPORT_LINK_001`. Fail if: exports broken data.

## 14. Persistence Testing

**T176 Save writes snapshot** — Purpose: §11. Setup: session. Steps: save. Expected: VersionSnapshot(stateHash). Fail if: none.
**T177 Save confirmed post-write** — Purpose: WF §11. Setup: save. Steps: observe dirty flag. Expected: clean only after write. Fail if: premature clean.
**T178 Overwrite confirms** — Purpose: no silent. Setup: existing name. Steps: save-as same. Expected: confirm dialog. Fail if: silent overwrite.
**T179 Load migrates** — Purpose: DM §16. Setup: v-old project. Steps: load. Expected: migrated forward. Fail if: corrupt/refuse.
**T180 Newer-than-app refused** — Purpose: DM §10.2. Setup: newer schema. Steps: load. Expected: refused, not corrupted. Fail if: silent drop.
**T181 Duplicate project** — Purpose: §21. Setup: project. Steps: duplicate. Expected: new IDs, copied state. Fail if: shared refs.
**T182 Rename no fingerprint change** — Purpose: DM §3.18. Setup: rename. Steps: compare fingerprint. Expected: unchanged. Fail if: changes.
**T183 Library update no session rewrite** — Purpose: normalization. Setup: update library. Steps: check sessions. Expected: unchanged. Fail if: mutated.
**T184 Structural sharing** — Purpose: ARCH §10.6. Setup: many versions. Steps: inspect storage. Expected: shared, not full copies. Fail if: bloat/duplication of content.
**T185 Recent projects list** — Purpose: §21. Setup: several projects. Steps: open. Expected: recent list correct order. Fail if: wrong.

## 15. Recovery Testing

**T186 Crash recover offer** — Purpose: §15. Setup: crash marker. Steps: boot. Expected: Recover Session offer. Fail if: silent loss.
**T187 Corrupted project restore** — Purpose: §15. Setup: corrupt data. Steps: open. Expected: restore last valid snapshot. Fail if: opens corrupt.
**T188 Missing libraries flagged** — Purpose: §15. Setup: absent library. Steps: open. Expected: dependent scenes blocked, others usable. Fail if: silent drop.
**T189 Restore transactional** — Purpose: §15. Setup: restore fails mid-way. Steps: restore. Expected: rollback; project unchanged. Fail if: partial applied.
**T190 Merge vs Replace confirm** — Purpose: §15. Setup: restore. Steps: choose. Expected: both confirm; no silent overwrite. Fail if: silent.
**T191 Newer backup rejected** — Purpose: §15. Setup: newer schema backup. Steps: restore. Expected: `EXPORT_RESTORE_002`. Fail if: applied.
**T192 Older backup migrated** — Purpose: §15. Setup: older backup. Steps: restore. Expected: migrated forward. Fail if: fails.
**T193 Partial recovery** — Purpose: §15. Setup: partly corrupt backup. Steps: restore. Expected: intact sessions recovered, rest listed. Fail if: all-or-nothing loss.
**T194 Checksum verify on restore** — Purpose: §15. Setup: tampered backup. Steps: restore. Expected: `EXPORT_CHECKSUM_001`. Fail if: applied.
**T195 Restore preview read-only** — Purpose: §15. Setup: preview. Steps: run. Expected: nothing applied. Fail if: mutates.

## 16. Version History Testing

**T196 Append-only** — Purpose: §14. Setup: edits. Steps: inspect history. Expected: snapshots appended, none overwritten. Fail if: mutation.
**T197 Parent lineage** — Purpose: DM §3.14. Setup: reopen archived. Steps: check parentVersionId. Expected: fork lineage recorded. Fail if: broken.
**T198 Retention pruning** — Purpose: DM §11. Setup: KeepLastN. Steps: exceed N. Expected: prune non-current/non-referenced. Fail if: prunes current/parent.
**T199 Restore forks** — Purpose: §14. Setup: restore old version. Steps: run. Expected: new version, old intact. Fail if: overwrite.
**T200 stateHash integrity** — Purpose: DM §3.14. Setup: snapshot. Steps: verify. Expected: hash matches state. Fail if: mismatch.

## 17. Autosave Testing

**T201 Autosave interval** — Purpose: §12. Setup: interval set. Steps: wait. Expected: autosnapshot written. Fail if: none.
**T202 Non-destructive** — Purpose: §12. Setup: manual save + autosave. Steps: run. Expected: separate slots. Fail if: clobber.
**T203 No churn on unchanged** — Purpose: determinism. Setup: idle. Steps: wait. Expected: no snapshot if fingerprint unchanged. Fail if: churns.
**T204 Autosave restore on boot** — Purpose: §12. Setup: autosave present. Steps: boot. Expected: recover offer. Fail if: ignored.
**T205 Autosave off** — Purpose: settings. Setup: disable. Steps: wait. Expected: no autosave. Fail if: still saves.

## 18. Undo/Redo Testing

**T206 Undo steps back** — Purpose: §13. Setup: edits. Steps: Ctrl+Z. Expected: prior snapshot. Fail if: wrong/none.
**T207 Redo steps forward** — Purpose: §13. Setup: after undo. Steps: Ctrl+Y. Expected: forward snapshot. Fail if: wrong.
**T208 Undo past generation** — Purpose: §13. Setup: revert dim change. Steps: undo. Expected: outputs stale/pending. Fail if: no re-mark.
**T209 Redo after edit fork** — Purpose: lineage. Setup: undo then edit. Steps: redo. Expected: deterministic fork handling. Fail if: corruption.
**T210 Undo determinism** — Purpose: reproducible. Setup: same steps. Steps: undo. Expected: identical state. Fail if: differs.

## 19. Determinism Testing

**T211 Scene determinism** — Purpose: §27. Setup: same session ×2. Steps: assemble. Expected: identical scenes. Fail if: differ.
**T212 Prompt determinism** — Purpose: §27. Setup: same. Steps: compose. Expected: identical text+checksum. Fail if: differ.
**T213 Cover determinism** — Purpose: §27. Setup: same. Steps: compose. Expected: identical prompt+coverHash. Fail if: differ.
**T214 Export determinism** — Purpose: §27. Setup: same. Steps: export. Expected: identical bytes/manifest. Fail if: differ.
**T215 Fingerprint idempotence** — Purpose: DM §3.18. Setup: identical selections. Steps: fingerprint. Expected: equal hashes. Fail if: differ.
**T216 No RNG** — Purpose: §2. Setup: instrument. Steps: full run. Expected: no random calls. Fail if: any.
**T217 Timestamp exclusion** — Purpose: §27. Setup: different times. Steps: hash. Expected: content hashes equal. Fail if: differ.
**T218 Lexicographic tie-break** — Purpose: §27. Setup: ties. Steps: order. Expected: ID-ascending. Fail if: nondeterministic.
**T219 Runtime isolation** — Purpose: §0.6. Setup: two runs. Steps: inspect. Expected: EvaluationContext recreated, not cached across. Fail if: stale reuse.
**T220 Cross-platform determinism** — Purpose: portability. Setup: two OS. Steps: export. Expected: identical bytes. Fail if: differ.

## 20. Performance Testing

**T221 50-scene assembly** — Purpose: §22. Setup: 50 scenes. Steps: assemble. Expected: completes within budget, deterministic. Fail if: jank/timeout.
**T222 100 prompts compose** — Purpose: §22. Setup: 50 scenes. Steps: compose A+B. Expected: within budget. Fail if: slow.
**T223 Virtualized scene list** — Purpose: UI §19. Setup: 50 scenes. Steps: scroll. Expected: no jank; cached derived fields. Fail if: recompute on scroll.
**T224 Large JSON export** — Purpose: §22. Setup: large project. Steps: export. Expected: single-pass canonical. Fail if: excessive memory.
**T225 ZIP streaming** — Purpose: §22. Setup: 50 scenes. Steps: export ZIP. Expected: bounded memory. Fail if: OOM.
**T226 Large version history** — Purpose: §22. Setup: many versions. Steps: browse/export. Expected: shared storage, responsive. Fail if: bloat.
**T227 Lazy library load** — Purpose: ARCH §10.3. Setup: active season. Steps: load. Expected: only active library loaded. Fail if: all loaded.
**T228 Progress reporting** — Purpose: §22. Setup: export. Steps: run. Expected: progress events/toasts. Fail if: none.
**T229 Cancellation responsiveness** — Purpose: §22. Setup: long export. Steps: cancel. Expected: prompt stop, no partial. Fail if: hangs.
**T230 Search/filter speed** — Purpose: UI §19. Setup: 50 scenes. Steps: filter. Expected: index-backed, fast. Fail if: slow.

## 21. Stress Testing

**T231 Max scenes (50)** — Purpose: upper bound. Setup: 50. Steps: full pipeline. Expected: deterministic, uncluttered cover. Fail if: failure.
**T232 Beyond 50 (future)** — Purpose: formula generality. Setup: 60. Steps: cover. Expected: ceil(sqrt) grid; hero 2×2. Fail if: breaks.
**T233 Many groups** — Purpose: grouping. Setup: many groups. Steps: export. Expected: stable order/numbering. Fail if: broken.
**T234 Deep version history** — Purpose: history. Setup: hundreds of versions. Steps: prune/export. Expected: retention correct. Fail if: loss/bloat.
**T235 Large artwork metadata set** — Purpose: assets. Setup: many artworks. Steps: export. Expected: metadata only, bounded. Fail if: bytes/bloat.
**T236 Rapid edits** — Purpose: autosave debounce. Setup: fast edits. Steps: edit rapidly. Expected: debounced snapshots, no churn. Fail if: thrash.
**T237 Concurrent copy actions** — Purpose: clipboard. Setup: repeated copies. Steps: copy fast. Expected: last payload correct + toast. Fail if: corruption.
**T238 Repeated re-export** — Purpose: idempotence at scale. Setup: 50 scenes. Steps: export ×5. Expected: identical each time. Fail if: drift.
**T239 Long Arabic name** — Purpose: naming. Setup: very long name. Steps: export. Expected: truncated slug + hash; preserved in metadata. Fail if: invalid path.
**T240 Full pipeline stress** — Purpose: end-to-end. Setup: 50 scenes, multi-product/color. Steps: full journey. Expected: deterministic success. Fail if: any nondeterminism/failure.

## 22. Security Testing

**T241 No secrets in export** — Purpose: §21. Setup: export. Steps: scan. Expected: none. Fail if: leaked.
**T242 No absolute paths** — Purpose: §21. Setup: export. Steps: scan. Expected: opaque tokens only. Fail if: paths.
**T243 No storage keys** — Purpose: §21. Setup: export. Steps: scan. Expected: none. Fail if: present.
**T244 ZIP traversal blocked** — Purpose: §21. Setup: `..` entry. Steps: import. Expected: rejected. Fail if: escapes.
**T245 Decompression bomb blocked** — Purpose: §21. Setup: bomb. Steps: import. Expected: aborted. Fail if: exhausts.
**T246 Safe JSON parse** — Purpose: §21. Setup: hostile JSON. Steps: import. Expected: rejected, no eval. Fail if: code exec.
**T247 File-size limits** — Purpose: §21. Setup: oversized. Steps: import/export. Expected: capped, error. Fail if: unbounded.
**T248 Backup validation** — Purpose: §21. Setup: tampered backup. Steps: restore. Expected: checksum fail. Fail if: applied.
**T249 No hidden identifiers** — Purpose: §21. Setup: export. Steps: scan. Expected: no user ids. Fail if: present.
**T250 Runtime objects never exported** — Purpose: §0.7. Setup: export. Steps: scan. Expected: no EvaluationContext/Resolved*. Fail if: present.

## 23. Regression Testing

**T251 Revised operator regressions** — Purpose: RE amendments. Setup: v2→v3 rules. Steps: eval. Expected: numeric/bool/null correct; no count-on-scalar. Fail if: old bug returns.
**T252 Palette count-lock regression** — Purpose: #3 fix. Setup: Sand+Navy. Steps: eval. Expected: locks actual colors. Fail if: White/Black assumed.
**T253 Hardcoded limit regression** — Purpose: #4 fix. Setup: count 5. Steps: eval. Expected: dynamic limit. Fail if: 3.
**T254 Placeholder regression** — Purpose: #9 fix. Setup: dedup. Steps: eval. Expected: scene.isDuplicate boolean. Fail if: "__ledger_seen__".
**T255 Numbering regression** — Purpose: past bug. Setup: save/load/export. Steps: compare numbers. Expected: stable. Fail if: drift.
**T256 Copy-button regression** — Purpose: past bug. Setup: all copy actions. Steps: run. Expected: all work + toast. Fail if: no-op.
**T257 Auto-generation regression** — Purpose: past bug. Setup: prompts ready. Steps: observe. Expected: no auto image gen. Fail if: auto-runs.
**T258 Cover-uses-B regression** — Purpose: purity. Setup: cover. Steps: compose/export. Expected: A only. Fail if: B leaks.
**T259 Silent overwrite regression** — Purpose: safety. Setup: save/restore. Steps: run. Expected: confirms. Fail if: silent.
**T260 Migration regression** — Purpose: DM §16. Setup: v1 data. Steps: load. Expected: migrates forward cleanly. Fail if: corruption.

## 24. Compatibility Testing

**T261 Cross-doc consistency** — Purpose: no conflicting types. Setup: all specs. Steps: audit enums/types. Expected: consistent. Fail if: conflict.
**T262 Windows filenames** — Purpose: EX §12. Setup: export. Steps: open on Windows. Expected: all files open. Fail if: invalid.
**T263 Arabic RTL rendering** — Purpose: UI §18. Setup: UI. Steps: inspect. Expected: RTL correct, English LTR isolated. Fail if: artifacts.
**T264 Schema migration chain** — Purpose: DM §16. Setup: v1/v2/v3. Steps: load each. Expected: forward migration. Fail if: break.
**T265 Engine call-graph acyclic** — Purpose: WF §20. Setup: call map. Steps: analyze. Expected: DAG, no cycles. Fail if: cycle.
**T266 Ownership single-writer** — Purpose: WF §24. Setup: field writes. Steps: audit. Expected: one owner per field. Fail if: multi-writer.

---

## 25. Acceptance Testing (108 acceptance criteria)

**Global/determinism (AC-1..20)** — AC-1 identical inputs⇒identical scenes; AC-2 ⇒identical prompts; AC-3 ⇒identical cover; AC-4 ⇒identical export; AC-5 no RNG anywhere; AC-6 lexicographic tie-breaks; AC-7 timestamps excluded from content hashes; AC-8 fingerprint idempotence; AC-9 runtime objects never persisted; AC-10 runtime objects never exported; AC-11 pipeline order fixed; AC-12 acyclic call graph; AC-13 single-writer ownership; AC-14 blocking halts; AC-15 warnings never mutate; AC-16 no silent overwrite; AC-17 no silent omission; AC-18 no hidden auto-advance; AC-19 nothing auto-generates images; AC-20 Arabic UI/English prompts.

**Rule (AC-21..35)** — AC-21 print-area supremacy; AC-22 lower never overrides higher; AC-23 season≠garment color; AC-24 palette lock uses actual colors; AC-25 dynamic scene limit; AC-26 count_* arrays only; AC-27 num_* scalars only; AC-28 real booleans; AC-29 IsNull for null; AC-30 ConditionGroup logic; AC-31 feasibility blocks count>space; AC-32 duplicate 4-tuple blocked; AC-33 config errors caught; AC-34 rule trace complete; AC-35 print-area numeric = predicate.

**Scene (AC-36..48)** — AC-36 deterministic assembly; AC-37 exactly N scenes; AC-38 hard uniqueness; AC-39 soft diversity deterministic; AC-40 mood anchor cohesion; AC-41 color round-robin; AC-42 primary color to hero; AC-43 view rules; AC-44 print-area safe filtering; AC-45 A+B pair always; AC-46 fingerprint regen semantics; AC-47 hero/support ratios; AC-48 Kids no adult model.

**Prompt (AC-49..63)** — AC-49 one prompt one image; AC-50 A/B separate; AC-51 B edit-mode; AC-52 B needs A+PNG; AC-53 A blank; AC-54 no readable scene text; AC-55 no collage; AC-56 print-area clause firmest; AC-57 B preserves all attributes; AC-58 artwork lock; AC-59 fabric integration; AC-60 numbering stable; AC-61 checksum deterministic; AC-62 two-phase plan; AC-63 Kids no adult wording.

**Cover (AC-64..76)** — AC-64 Sale Images A only; AC-65 cover-uses-B blocked; AC-66 source lock; AC-67 layout by count; AC-68 hero dominance; AC-69 primaries deterministic; AC-70 warm neutral bg/no green; AC-71 large images small text; AC-72 color strip locked only; AC-73 badges by flags; AC-74 names from manifest; AC-75 coverHash deterministic; AC-76 emits prompt only.

**Export (AC-77..92)** — AC-77 byte-for-byte prompts; AC-78 A/B linkage; AC-79 numbering across formats; AC-80 ZIP deterministic; AC-81 fixed epoch; AC-82 checksum excludes timestamp; AC-83 no runtime objects; AC-84 no secrets/paths; AC-85 artwork metadata only; AC-86 cover export A only; AC-87 partial lists omissions; AC-88 clipboard banner; AC-89 clipboard fallback; AC-90 manifest complete; AC-91 safe filenames; AC-92 re-export idempotent.

**Persistence/recovery/version (AC-93..108)** — AC-93 save writes snapshot; AC-94 save confirmed post-write; AC-95 overwrite confirms; AC-96 migrate forward; AC-97 reject newer schema; AC-98 duplicate new IDs; AC-99 rename no fingerprint change; AC-100 append-only history; AC-101 retention safe; AC-102 restore forks; AC-103 restore transactional; AC-104 missing libraries flagged; AC-105 corrupted restore; AC-106 autosave non-destructive; AC-107 undo/redo deterministic; AC-108 full document set internally consistent.

Acceptance gate: **all P0 acceptance criteria must pass** for release; any P0 failure blocks the build.

## 26. Automated Testing Strategy

Automate everything deterministic and high-volume: unit tests (operators, hashing, scoring, layout math, filenames), integration handoffs, determinism (double-run byte comparison of scenes/prompts/cover/export), checksum stability, migration chains, ZIP reproducibility, security scanners (secret/path/traversal/bomb), and regression suite (T251–T260). Automated runs execute on every change against fixed test data; a golden-master set of expected scenes/prompts/cover/export bytes detects any nondeterminism. Coverage target: 100% of P0/P1 tests automated. Flaky = treated as a determinism defect, not tolerated.

## 27. Manual Testing Strategy

Manual/exploratory for what automation can't fully judge: Arabic RTL rendering and bidi mixing, premium-cover visual quality (large images/small type/no clutter/no green), prompt readability for external image tools, drag-drop feel, accessibility (screen reader, keyboard-only), dialog clarity, and end-to-end user journeys across the three modes. Manual sessions follow scripted journeys (§25 UI/workflow tests) plus unscripted exploration. Each release: at least one full manual journey (open→configure→plan→validate→prompt→copy→cover→export→archive) per mode.

## 28. Bug Classification

| Severity | Definition | Examples | Action |
|---|---|---|---|
| **S0 Blocker** | violates a hard constraint / data safety | one-prompt-one-image broken, cover uses B, silent overwrite, runtime object exported, nondeterminism | block release; hotfix |
| **S1 Critical** | core correctness | wrong color allocation, broken numbering, duplicate scenes, checksum mismatch, gate bypass | block release |
| **S2 Major** | significant but bounded | partial-export omission unlisted, layout mismatch, missing validation message | fix before release |
| **S3 Minor** | limited impact | tooltip wording, minor spacing, non-blocking warning phrasing | schedule |
| **S4 Cosmetic** | polish | label casing, icon alignment | backlog |

Every bug records: severity, source-section reference, reproduction (deterministic), expected vs actual, and the failing test ID.

## 29. Release Checklist

- [ ] All S0/S1 bugs closed.
- [ ] All P0 acceptance criteria pass (§25).
- [ ] Determinism suite green (double-run byte-identical).
- [ ] Golden-master scenes/prompts/cover/export match.
- [ ] Migration chain (v1→v3) verified.
- [ ] Security scan clean (secrets/paths/traversal/bomb/runtime-leak).
- [ ] Windows filename + Arabic name export verified.
- [ ] 50-scene/100-prompt stress pass.
- [ ] Full manual journey per mode complete.
- [ ] Cross-document consistency audit passed.
- [ ] Cover purity (A-only) verified across UI/export.
- [ ] One-prompt-one-image verified across UI/prompt/export.
- [ ] No-silent-overwrite/omission verified.
- [ ] Release notes list schema versions + module versions.

## 30. Final QA Certification Checklist

- [ ] **Every engine verified** — Rule, Scene, Prompt, Cover, Export, Persistence, Validation, Print-Area, Dedup, Palette, Orchestrator (§9–§16).
- [ ] **Every workflow verified** — startup→archive journeys (§6).
- [ ] **Every state verified** — all transitions guarded (§8).
- [ ] **Every rule verified** — precedence, domains, operators, errors (§9).
- [ ] **Every error verified** — RULE_/PROMPT_/COVER_/EXPORT_ codes + Arabic messages (§17-era).
- [ ] **Every transition deterministic** (§19).
- [ ] **100+ acceptance criteria pass** (§25 = 108).
- [ ] **250+ QA tests pass** (§6–§24 = 266 tests, T001–T266).
- [ ] **100+ edge cases covered** (Appendix A = 104).
- [ ] **Determinism, security, performance, stress suites green.**
- [ ] **Sign-off:** Lead QA Architect certifies the build matches all ten authoritative specifications.

---

## Appendix A. Edge Cases (104)

1 One scene. 2 Zero products (gate block). 3 count=0. 4 count>space. 5 Single color. 6 White+Black lock. 7 Sand+Navy lock. 8 Locked single color. 9 No PNG uploaded. 10 One blocked B among many. 11 A edited after B (stale). 12 Cover before barrier. 13 Missing cover metadata. 14 Duplicate scene attempt. 15 Reorder scenes. 16 Delete scene after prompts. 17 Season change mid-edit. 18 Audience→Kids with adult product. 19 Palette lock toggled off. 20 Multi-garment hero (father+son). 21 Minimal Studio (no decor). 22 50 scenes. 23 Multiple sessions. 24 Corrupted version history. 25 Newer-schema backup. 26 Older-schema project. 27 Crash during generation. 28 Clipboard denied. 29 Insufficient storage in ZIP. 30 Decompression bomb import. 31 ZIP path traversal. 32 Very long Arabic name. 33 Reserved Windows filename. 34 Unresolved prompt variable. 35 Invalid module version. 36 Season targets garment color (config). 37 Bad ContextRef. 38 Two products primary tie. 39 All-back-view session. 40 Warning-only validation. 41 Undo past generation. 42 Redo after edit fork. 43 Autosave + manual save coexist. 44 Reset during Generating. 45 Archive then reopen. 46 Export cancelled mid-ZIP. 47 Mixed groupBy group. 48 Cover count ≠ images. 49 Missing library at restore. 50 Digital=false suppresses badges. 51 Identical cloned session. 52 New engine (future). 53 New export format (future). 54 Empty group. 55 Group with one scene. 56 Product with only front view. 57 Zip Hoodie split front print zone. 58 Polo left-chest zone. 59 Kids product child-scale print area. 60 Print area exactly at threshold. 61 Print area just below threshold. 62 Shadow coverage at limit. 63 Off-center beyond tolerance. 64 Readable text inside uploaded artwork (allowed). 65 Readable text in background (blocked). 66 Collage individual output (blocked). 67 Cover green requested (blocked). 68 50-mockup cover clutter check. 69 Two identical filenames (collision). 70 NFC normalization of names. 71 Extremely long project name truncation. 72 Empty decor/props valid. 73 Feasible tight pool exact-count fill. 74 Infeasible tight pool (block). 75 Duplicate only in pose (not full tuple → allowed). 76 Locked palette equals product defaults. 77 Product default conflicts lock (default ignored). 78 Multi-product cover naming (& More). 79 Season Minimal Studio neutral label. 80 Audience All (permissive). 81 Teen audience. 82 Unisex audience. 83 Single-scene execution plan. 84 60 scenes (beyond 50, future formula). 85 Deep version history pruning. 86 Rapid edits (autosave debounce). 87 Concurrent copies. 88 Repeated re-export identical. 89 Cross-platform export identical bytes. 90 Migration v1→v2→v3. 91 Restore Merge ID collision. 92 Restore Replace. 93 Partial recovery of intact sessions. 94 Missing font/library for Arabic (degrade gracefully). 95 Clipboard large payload (50 prompts). 96 Prompt Pack numbering map correctness. 97 Group plan A-before-B statement. 98 Cover source-lock under 50 images. 99 Export manifest checksum verify. 100 Timestamp-only change → checksum unchanged. 101 Prompt-only change → checksum changed. 102 Reorder → filenames change, content checksums unchanged. 103 Newer-than-app project open (refuse). 104 Full end-to-end determinism (double run identical).

Each edge case is tested via its corresponding numbered test or a dedicated exploratory pass; all are P0/P1 unless purely cosmetic.

---

## Appendix B. Test Traceability

| Area | Tests | Source |
|---|---|---|
| Workflow | T001–T010 | WF, PRD |
| UI | T011–T020 | UI |
| State machine | T021–T030 | UI §13, WF §19 |
| Rule | T031–T060 | RE |
| Scene | T061–T090 | SE |
| Prompt | T091–T120 | PE |
| Cover | T121–T145 | CE |
| Export | T146–T175 | EX |
| Persistence | T176–T185 | DM, WF |
| Recovery | T186–T195 | WF §15, EX §15 |
| Version | T196–T200 | DM §3.14 |
| Autosave | T201–T205 | UI §22, WF §12 |
| Undo/Redo | T206–T210 | WF §13 |
| Determinism | T211–T220 | WF §27 |
| Performance | T221–T230 | EX §22, UI §19 |
| Stress | T231–T240 | all |
| Security | T241–T250 | EX §21 |
| Regression | T251–T260 | RE/PE/CE/EX |
| Compatibility | T261–T266 | all |

**Totals:** 266 numbered QA tests (≥250 ✔), 108 acceptance criteria (≥100 ✔), 104 edge cases (≥100 ✔). Every test carries Purpose, Setup, Steps, Expected, and Fail-if fields.

---

*End of QA Master Test Specification. Sourced only from the ten authoritative documents. Specification only — no application code, HTML, CSS, React, or TypeScript. Every engine, workflow, state, rule, error, and transition is covered; all expected behavior is deterministic; print-area supremacy, one-prompt-one-image, cover-Output-A-only, no-silent-overwrite/omission, and runtime-object isolation are verified as blocking (P0) guarantees.*
