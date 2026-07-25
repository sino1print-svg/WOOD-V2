# 12_IMPLEMENTATION_GUIDE.md

# Mockup Photoshoot Director — Final Implementation Guide

**Document type:** Implementation Roadmap (translation only)
**Sources of truth (only):** `01_PRD.md`, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`, `08_COVER_ENGINE.md`, `09_EXPORT_ENGINE.md`, `10_APP_WORKFLOW.md`, `11_TEST_PLAN.md`
**Status:** Final engineering reference.
**Scope note:** This guide explains **how** to build the application from the existing specifications. It **redesigns nothing, invents nothing, simplifies nothing**. Where behavior is needed, it cites the owning spec. No application code, HTML, CSS, React, or TypeScript implementation appears here. Everything remains deterministic and compatible with all eleven documents.

`§`=PRD, `ARCH`, `DM`=`03_DATA_MODELS_FINAL`, `RE`=`04`, `SE`=`05`, `PE`=`06`, `UI`=`07`, `CE`=`08`, `EX`=`09`, `WF`=`10`, `QA`=`11`.

---

## 1. Purpose

Give engineers an exact, ordered path to implement the specified system: what to build, in what order, with which dependencies, under which gates. The specs define *what*; this guide defines *build sequence, ownership, integration, and quality control*. Any conflict between this guide and a source spec is resolved in favor of the source spec.

## 2. Development Philosophy

Build **bottom-up along the acyclic dependency graph** (WF §20): pure leaf engines first, composite engines next, orchestration, then UI. Favor **pure, deterministic functions** with explicit inputs/outputs (RE §1.3; SE §7; §33). Domain knowledge lives in **data manifests**, not logic (ARCH §10.1). **Single-writer ownership** per field (DM §20; WF §24). **Test-alongside**: each module ships with its QA tests (QA §26). **No premature integration** — a module is "done" only when its unit + integration tests pass and its ownership boundary is verified.

## 3. Folder Structure

Adopt ARCH §2 verbatim as the build target (do not restructure):

```
app/{orchestrator,state,commands,validation-gate}
engines/{rule-engine,scene-engine,prompt-engine,cover-engine,print-area-engine,dedup-engine,palette-engine,validation-engine,export-engine}
libraries/{products,seasons,palettes,prompt-modules,rule-sets}      # data manifests
schemas/                                                            # JSON Schemas (ARCH §5)
persistence/{project-store,version-history,recent-projects,asset-store}
export/                                                             # formatters (EX)
ui/{screens,components,view-state}
shared/{domain-model,contracts,errors}
```

Additions this guide permits (non-redesign, infra only): `config/`, `logging/`, `telemetry/`, `ci/`, `docs/`, `test/` (fixtures, golden-masters). These hold cross-cutting infrastructure, never domain behavior.

## 4. Module Structure

Each engine module exposes a **single contract** (`shared/contracts`) and hides internals. Module boundaries mirror `EngineId` (DM §2.1). Shared domain types live once in `shared/domain-model` (the DM types); no engine redefines them. Errors live in `shared/errors` (namespaced `RULE_/PROMPT_/COVER_/EXPORT_`; RE §14, PE §21, CE §19, EX §19). A module may depend only on `shared/*` plus contracts it is explicitly allowed to call (§8).

## 5. Engine Structure

Every engine module has: a **contract** (declared inputs/outputs from its spec), a **pure core** (deterministic transforms), a **data-binding layer** (loads manifests by ID), and a **result type** (success value or structured failure `ValidationFailure`, DM §3.13). Leaf engines (Rule, Palette, Print-Area, Dedup, Persistence, Asset) contain **no** calls to other engines (WF §2.4). Composite engines (Scene, Validation) declare their permitted callees (WF §2.3). Terminal readers (Prompt, Cover, Export) call nothing.

## 6. State Management Strategy

Application state is the normalized, id-keyed model of DM §3 with explicit `*Order` arrays (DM §8). Mutations occur only through the Orchestrator/command layer (`app/commands`), enforcing single-writer ownership (DM §20). Runtime-only `EvaluationContext` and `Resolved*` are recreated per evaluation and **never** stored in app state or persistence (DM §3.15/§3.16; WF §0.6). Derived fields (`allOutputAReady`, fingerprints, hashes) are recomputed by their owner and cached (DM §22). The UI reads a projection of state; it never mutates directly (UI §0.1).

## 7. Data Flow

Follow the fixed pipeline (WF §0.3): selections → Rule → Palette → Scene (→Print-Area,→Dedup) → Validation gate → Prompt → Cover → Export. Data flows **downward** only; no engine mutates an upstream output (WF §20). Events (DM §3.19) flow upward to the Orchestrator, which updates state and relays notifications to the UI (WF §18/§22). Manifests flow in by ID from `libraries/` (read-only).

## 8. Dependency Injection Strategy

Engines are registered in the Orchestrator's **engine registry** (ARCH §10.2) with declared call permissions matching WF §2.3. Dependencies are injected as **contracts** (interfaces from `shared/contracts`), never concrete modules, so tests can substitute deterministic fakes. **Forbidden injections** (enforced by lint/architecture test): no engine receives the UI; leaves receive no engine; Prompt/Cover/Export receive no mutating engine; no cyclic injection (WF §2.4/§20). Injection graph must be a DAG at build time (verification EVP-005).

## 9. Engine Build Order

Bottom-up along the DAG. Each engine is fully unit-tested before the next depends on it.

```
0. shared/domain-model + shared/errors + schemas   (types, IDs, error codes)
1. Persistence (load/save/version) + Asset (artwork metadata)
2. Rule Engine        (pure; RE)          ← depends only on domain-model + rule-sets
3. Palette Engine     (pure)              ← colors/lock
4. Print-Area Engine  (measure facts)     ← leaf
5. Dedup Engine       (signatures)        ← leaf
6. Scene Engine       (SE)                ← calls Rule/Palette/Print-Area/Dedup
7. Validation Engine  (gate; RE §14/§7)   ← calls Rule/Print-Area (judge)
8. Prompt Engine      (PE)                ← reads scenes/constraints
9. Cover Engine       (CE)                ← reads cover metadata + Output A
10. Export Engine     (EX)                ← read-only over all
11. Orchestrator      (WF)                ← wires the pipeline + state machine
12. UI                (UI)                ← driven by Orchestrator
```

Rationale: matches WF §20 startup and pipeline order; each stage depends only on earlier stages.

## 10. UI Build Order

Build after the Orchestrator exposes state + intents. Order (UI §2/§7): shell + navigation gating → Project Hub (§21) → Session Builder stepper (UI §4) → Scene Planner (UI §5) → Product/Color/Group managers (UI §6/§7/§8) → Validation Review → Prompt Preview (UI §9) → Execution Center (UI §10) → Cover Manager (UI §3.9) → Export Center (UI §3.10) → Settings/Help/About. Each screen wired to its engine outputs read-only; button state machine (UI §12) implemented last per screen.

## 11. Persistence Build Order

Build first among infra (engines depend on load/save). Order: domain serialization (canonical, DM §10) → project-store (save/load) → version-history (snapshots, structural sharing, DM §3.14/§10.6) → recent-projects → asset-store (artwork metadata + bytes handle) → migration chain (v1→v3, DM §16). Autosave and restore (WF §12/§15) come after version-history.

## 12. Rule Engine Build Order

Per RE: (1) operators (`RuleOperator`, RE §12) → (2) `ConditionNode`/`ConditionGroup` evaluation (RE §5) → (3) `ContextRef`/`NumericExpression` resolution (DM §3.12) → (4) precedence + bucketing + conflict algorithm (RE §3) → (5) `RuleDomain` isolation guards (RE §6) → (6) `RuleTrace` (RE §15) → (7) error codes + Arabic messages (RE §14). Rule Engine is pure; build with golden-master traces (QA T056).

## 13. Scene Engine Build Order

Per SE: (1) library-item contract loading (SE §4) → (2) candidate generator + impossibility rejection (SE §6) → (3) feasibility precheck (SE §6.4) → (4) scoring formula + tie-break (SE §7) → (5) dedup + diversity (SE §8/§9) → (6) ordering, color (SE §14), view (SE §15) → (7) output pair placeholders (SE §17) → (8) fingerprints/hashes (DM §3.5) → (9) cover metadata prep (SE §19). Invokes Print-Area + Dedup via contracts.

## 14. Prompt Engine Build Order

Per PE: (1) module templates + composition order (PE §2) → (2) variable resolution (PE §2.4) → (3) Output A template (PE §4) → (4) Output B edit template + linkage (PE §5) → (5) missing-source states (PE §6) → (6) group plan (PE §16) + execution plan (PE §17) → (7) `PromptMetadata`/checksums (PE §19) → (8) error codes (PE §21). Enforce one-prompt-one-image in every template (PE §3).

## 15. Cover Engine Build Order

Per CE: (1) barrier check `allOutputAReady` (CE §2; RE §8) → (2) Output-A-only collection (CE §3) → (3) layout mapping + grid (CE §4) → (4) primaries (CE §11) → (5) typography/color-strip/badges (CE §6/§7/§8) → (6) cover module composition (CE §12) + `coverHash` → (7) validation + errors (CE §18/§19).

## 16. Export Engine Build Order

Per EX: (1) scope resolution (EX §3) → (2) validation-before-export (EX §17) → (3) ordering (EX §6) → (4) formatters TXT/MD/JSON (EX §8/§9/§10) → (5) checksums (EX §14) → (6) ZIP packaging (EX §11) + file naming (EX §12) → (7) manifest (EX §13) → (8) clipboard (EX §5) → (9) backup/restore (EX §15) + Prompt Pack (EX §16) → (10) events (EX §23).

## 17. Validation Engine Build Order

Per RE §14/§7: (1) presence checks (Phase 0) → (2) print-area predicates PA-PRED-1..3 (RE §7) → (3) cover barrier predicate COV-PRED-1 (RE §8) → (4) rule-judged checks (audience/season/palette/dedup/product/cover) → (5) `ValidationResult` assembly with diagnostics (DM §3.13). Validation mutates nothing; it only calls Rule/Print-Area to judge (WF §2.3).

## 18. Integration Order

Integration milestones (each gated by tests):

```
I1  Persistence + domain-model            → save/load round-trip (QA T176–T185)
I2  Rule + Palette                         → constraint resolution (QA T031–T060)
I3  Scene (+Print-Area,+Dedup)             → deterministic assembly (QA T061–T090)
I4  Validation gate                        → block/pass routing (QA T021–T030, T048–T054)
I5  Prompt                                 → A/B composition, one-image (QA T091–T120)
I6  Cover                                  → barrier + purity (QA T121–T145)
I7  Export                                 → byte-for-byte, deterministic ZIP (QA T146–T175)
I8  Orchestrator                           → full pipeline (QA T001–T010)
I9  UI                                      → screens + state machine (QA T011–T030)
I10 End-to-end + determinism + stress       → golden masters (QA T211–T240)
```

## 19. Feature Flags

Flags gate **incomplete** work behind the fixed spec, never alternate behavior. Permitted flags: `mode.professional` (progressive UI exposure, UI §1), `export.markdown`, `export.promptPack`, `autosave.enabled`, `telemetry.enabled`. Flags are deterministic (fixed per build/config), never A/B randomized. A flag never changes engine outputs — only availability of a surface. Removing a flag must not alter checksums of already-shipped scopes.

## 20. Configuration Management

Config is data in `config/` (versioned): schema versions, retention policy defaults (DM §3.14), autosave interval, default products/colors/groups/export (UI §22), warm-neutral cover defaults (CE §0), path/size limits (EX §11/§21). Config is loaded at startup (WF §3), validated against schema, and never mutated at runtime by engines. Config changes never retroactively mutate saved sessions (determinism).

## 21. Logging Strategy

Structured, leveled logs (`debug/info/warn/error`) with an `engineId`, `stage`, and correlation `exportId`/`sessionId`. Logs never contain prompt bytes, secrets, or local paths (EX §21). Deterministic runs produce deterministic log *content* (excluding timestamps). Rule traces (RE §15) and validation results are logged at `info` for explainability. No logging inside pure hot loops that would affect determinism.

## 22. Error Logging Strategy

Every structured failure (`ValidationFailure`, DM §3.13) is logged with `code`, `severity`, `originEngine`, `ruleId?`, `domain?`, and the triggering context field — never the raw prompt or user secrets. Blocking errors log at `error`, warnings at `warn`. Error logs map 1:1 to the namespaced registries (RE §14/PE §21/CE §19/EX §19) so support can trace any Arabic user message to its code and owning engine.

## 23. Performance Guidelines

Engines are O(n) over ordered artifacts; no quadratic scans in assembly/export (SE §10.2; EX §22). Precompute derived values once (DM §22). Virtualize large lists (UI §19). Lazy-load season libraries by active season (ARCH §10.3). Stream ZIP entries (EX §22). Budget: 50 scenes / 100 prompts pipeline within interactive time (QA T221–T222). Never recompute heavy state on scroll (QA T223).

## 24. Memory Management

Hold references (IDs) and metadata, not image bytes (EX §17/§21). Version snapshots use structural sharing, not deep copies (ARCH §10.6). Release candidate-space and `Resolved*`/`EvaluationContext` after each evaluation (runtime-only, DM §3.16). Cap uncompressed import size and compression ratio (bomb protection, EX §21). Bound clipboard payload assembly for 50-prompt copies (QA T095/§stress).

## 25. Caching Strategy

Cache by content hash: `sceneFingerprint`, `promptChecksum`, `coverHash`, `SessionFingerprint` (DM §3.5/§3.9/§3.17/§3.18). A cache entry is valid while its fingerprint is unchanged (idempotence, WF §27). Reuse the composed cover prompt when sources+layout+metadata are unchanged (CE §17). Caches are keyed deterministically and never time-based. Invalidate a scene's outputs when `sceneFingerprint` changes (DM §3.5; QA T074).

## 26. Versioning Strategy

Per-aggregate `schemaVersion` (DM §16); current: rule_set/rule = 3, others = 1. Prompt templates/modules carry `SemVer` (PE §19). `generatorVersion` and `applicationVersion` recorded in exports/manifests (EX §13). Bumping a module version is a deliberate, documented change that alters checksums (PE §19). Never mutate a shipped aggregate's shape without a version bump + migration.

## 27. Migration Strategy

Forward-only, lazy-on-read, additive-by-default (DM §10.2/§16). Migration chain v1→v2→v3 for rule_set/rule (DM §11/§16). On load: migrate below-current aggregates, write back; refuse newer-than-app (DM §10.2; QA T180/T191). Each migration records a `MigrationRecord` (DM §10). Restore runs backups through the same chain (EX §15). Migration functions are pure and tested against fixtures (QA T260/T264).

## 28. Git Workflow

Trunk-based with short-lived feature branches. `main` is always releasable (all P0 tests green). Each engine is developed on its own branch, merged only after its integration milestone (§18) passes. No direct commits to `main`. Spec documents are read-only inputs; changes to specs require a separate governance PR and are out of scope for feature branches.

## 29. Branch Strategy

`main` (releasable) · `develop` (integration) · `feat/<engine>-<slice>` · `fix/<code>` · `chore/<infra>` · `migration/<vN-vM>`. Branch naming references the owning engine or error code. A branch merges to `develop` after its unit + integration tests pass; `develop`→`main` after the release gates (§Release Gates) pass.

## 30. Commit Convention

Conventional Commits: `type(scope): summary`. Types: `feat, fix, refactor, test, docs, chore, perf, build, ci`. Scope = engine/module (`rule`, `scene`, `prompt`, `cover`, `export`, `ui`, `persistence`, `orchestrator`). Body cites the source-spec section and the test ID(s) covered. Breaking changes marked `!` and require a version-bump note. No commit references behavior not in the specs.

## 31. Pull Request Rules

Every PR: links its source-spec sections + covered QA test IDs; passes CI (lint, unit, integration, determinism); includes/updates golden masters if outputs changed (with justification); touches only its module's owned fields (single-writer, DM §20); adds no forbidden dependency (§8). PRs that change any deterministic output must show byte-diff justification. No PR merges with a failing P0 test.

## 32. Code Review Checklist

- [ ] Matches the cited spec exactly; no redesign/invention.
- [ ] Deterministic; no `Math.random`/time/locale in engine logic.
- [ ] Single-writer ownership respected (DM §20).
- [ ] No forbidden dependency; injection graph acyclic (WF §20).
- [ ] Runtime objects not persisted/exported (DM §3.15/§3.16).
- [ ] Errors structured + Arabic message + namespaced code.
- [ ] Print-area supremacy / one-image / cover-A-only preserved where relevant.
- [ ] Tests added; golden masters updated with justification.
- [ ] No secrets/paths in logs or exports.
- [ ] Docs/section references updated.

## 33. Coding Standards (32)

CS-1 Pure functions for engine cores. CS-2 No I/O in pure engines. CS-3 Immutable domain data; copy-on-write. CS-4 No `Math.random`/time/locale in deterministic paths. CS-5 Branded IDs never interchanged. CS-6 Single-writer per field. CS-7 No cyclic module deps. CS-8 Leaves import no engine. CS-9 UI never imported by engines. CS-10 Errors are structured values, not thrown strings. CS-11 All ordering lexicographic on IDs. CS-12 No hidden global state. CS-13 Contracts (interfaces) at boundaries. CS-14 Manifests loaded by ID, read-only. CS-15 No prompt-text mutation on export. CS-16 One-prompt-one-image invariant in templates. CS-17 Cover uses Output A only. CS-18 Runtime objects never serialized. CS-19 Timestamps excluded from content hashes. CS-20 Deterministic serialization (sorted keys). CS-21 No silent catch/ignore. CS-22 Explicit null handling (IsNull/Exists, not string). CS-23 Numeric vs count operators used correctly. CS-24 Feature flags never randomize. CS-25 No dead/commented behavior. CS-26 Small, single-responsibility modules. CS-27 Named constants for weights/thresholds (from specs). CS-28 No magic strings for codes (use registry). CS-29 RTL-safe string handling. CS-30 English prompt content isolated from Arabic UI. CS-31 No network calls in export/engines beyond authorized fetch. CS-32 All public functions covered by tests.

## 34. Documentation Standards (30)

DS-1 Every module has a README citing its spec. DS-2 Contracts documented with inputs/outputs. DS-3 Each error code documented (code, cause, message, owner). DS-4 Golden-master fixtures documented. DS-5 Migration steps documented. DS-6 Public API doc-comments reference spec sections. DS-7 State machine documented per screen. DS-8 Ownership table maintained (DM §20). DS-9 Dependency graph documented + kept acyclic. DS-10 Determinism guarantees stated per engine. DS-11 Config keys documented. DS-12 Feature flags documented (purpose, removal). DS-13 Event contracts documented. DS-14 Changelog per release with versions. DS-15 Test-to-spec traceability maintained (QA App. B). DS-16 Arabic message catalog documented. DS-17 Numbering scheme documented. DS-18 Cover layout mapping documented. DS-19 Scoring weights documented. DS-20 Print-area rules documented. DS-21 Copy-action semantics documented. DS-22 Export folder tree documented. DS-23 Checksum policy documented. DS-24 Backup/restore procedure documented. DS-25 Rollback procedure documented. DS-26 Accessibility notes per screen. DS-27 i18n/RTL notes. DS-28 Security notes per boundary. DS-29 Known limitations documented. DS-30 Onboarding guide references this file.

## 35. Testing Integration Strategy

Each module ships with its QA block (QA §9–§24). CI runs unit → integration → determinism (double-run byte compare) → security scan on every PR (§36). Golden masters (scenes/prompts/cover/export bytes) are the determinism oracle (QA §26). A module cannot merge to `develop` without its integration milestone (§18) green. Manual journeys (QA §27) run per release per mode.

## 36. CI/CD Pipeline

Stages: `lint` (standards §33, architecture/dep-graph check) → `unit` → `integration` → `determinism` (golden-master diff) → `security` (secret/path/traversal/bomb scan, EX §21) → `migration` (v1→v3) → `package` → `artifact`. Any stage failure blocks merge. Determinism stage compares two independent runs byte-for-byte; a diff fails the build (nondeterminism = defect).

## 37. Build Pipeline

Reproducible builds: pinned dependencies, fixed toolchain, no network in build beyond authorized fetch. Build emits the app bundle + a build manifest (versions, schema versions, module versions). Identical source ⇒ identical build manifest. No secrets in build output (§46).

## 38. Release Pipeline

`develop`→`main` after all Release Gates (below) pass. Release tags record `applicationVersion`, `generatorVersion`, aggregate `schemaVersion`s, and prompt-module `SemVer`s. Release notes list changed determinism outputs (if any) with justification. A release is immutable once tagged.

## 39. Deployment Strategy

Desktop-style local single-user app (DM §3.1 `LocalSingleUser`). Deployment ships the bundle + libraries + schemas + config. Data stays local (§46). Staged rollout: internal → limited → general, each gated (Deployment Gates below). No server-side generation is introduced (out of scope).

## 40. Rollback Strategy

Every release is revertible to the previous tag. User data forward-compatible: a rolled-back app refuses to open newer-than-app projects (DM §10.2) rather than corrupting them. Rollback never migrates data backward. Rollback triggers on any Rollback Scenario (below). Post-rollback, autosave/version history remains intact (WF §14).

## 41. Monitoring Strategy

Monitor (locally, privacy-safe): pipeline stage completions/failures via events (DM §3.19), export success/failure counts, validation-failure code frequencies, and determinism-check results in CI. No prompt content or user data is monitored. Alerts on: repeated blocking failures of the same code, checksum instability, migration failures.

## 42. Telemetry Strategy

Telemetry is **opt-in** (`telemetry.enabled` flag, §19), privacy-preserving, and contains **no** prompt bytes, secrets, local paths, or user identifiers (§46; EX §21). Only aggregate, anonymized counters (feature usage, error-code frequency, performance timings). Telemetry is deterministic-neutral: it never affects engine outputs.

## 43. Analytics Strategy

Product analytics (opt-in) at the event level (DM §3.19): sessions created, scenes generated (counts only), exports by scope/format, cover generations. No content, no PII. Analytics informs roadmap only; it never gates engine behavior. Disabled analytics must not change any output or checksum.

## 44. Plugin Architecture

Extend via the **registry pattern** (ARCH §10.2; WF §29): new engines register with declared call permissions (WF §2.3); new libraries (products/seasons/poses) register as data manifests (SE §20). Plugins may add data and additive enum values (with migration) but may not violate ownership, determinism, or the acyclic call graph. A plugin that would introduce a cycle or a second writer is rejected at registration.

## 45. Extension Points

Additive-only extension surfaces: new product/season/pose/library manifests; new rule domains/rules; new prompt modules/template versions; new export formats/scopes; new badges; new cover layouts (enum + migration); new event types; future rendered-image packaging (EX §27, future-only). Each extension is data or additive enum; none requires engine redesign (ARCH §10; SE §20; EX §27).

## 46. Security Guidelines

Local-first, no secrets in artifacts/logs/telemetry; no absolute paths; no user identifiers; artwork metadata not bytes in exports (EX §21). Safe JSON parsing; ZIP path-traversal + decompression-bomb protection on import; file-size/ratio caps; backup checksum validation before apply (EX §15/§21). No code evaluation from imported data. Runtime `EvaluationContext`/`Resolved*` never leave memory (DM §3.15/§3.16).

## 47. Accessibility Guidelines

Keyboard-only operation for every action; logical RTL focus order; visible focus; modal focus trap; Arabic ARIA labels/roles; live regions for toasts/validation/execution state; WCAG AA contrast; non-color-only status indicators; bidi isolation for English tokens (UI §18). Accessibility is a release gate, not an afterthought.

## 48. Internationalization Guidelines

UI is **Arabic-only, RTL**; prompt content is **English-only, LTR** (UI §18; PE §20). All UI strings from an Arabic catalog; no hardcoded UI text. Numerals/hashes/filenames render LTR within RTL via bidi isolation. NFC normalization for names; ASCII-safe slugs for paths with Arabic originals preserved in metadata (EX §12/§20). No locale-dependent sorting (byte order, EX §6).

## 49. Engineering Risk Register (see Appendix C — 62 risks)

Maintained live; each risk has owner, likelihood, impact, mitigation, and the gate that catches it. Top P0 risks: nondeterminism, silent overwrite/omission, cover-uses-B leakage, runtime-object export, print-area override, one-image violation, migration corruption.

## 50. Future Scalability

Data-driven libraries scale horizontally (ARCH §10.1/§10.3); mosaic cover formula generalizes beyond 50 (CE §4/§21); export streams for large bundles (EX §22); registry admits new engines without redesign (WF §29). Multi-user/cloud/signed-manifests are future-only extension points (EX §27; §45), gated and additive.

## 51. Technical Debt Strategy

Debt is tracked with a spec reference and a paydown gate. No debt may violate a P0 invariant (determinism, ownership, one-image, cover purity, no-silent-overwrite). Temporary shims behind feature flags must have removal criteria (§19). Debt that would change deterministic output is disallowed. Quarterly debt review against the risk register.

## 52. Maintenance Strategy

Golden masters are the regression backbone (QA §26); any output change requires an intentional golden-master update with justification. Migrations are cumulative and never removed. Error catalogs and Arabic messages are maintained centrally. Each maintenance change re-runs the full determinism + security + migration suites before release.

## 53. Acceptance Checklist — see Appendix A (128 acceptance criteria).

## 54. Engineering QA Checklist — see Appendix B (156 engineering verification points).

## 55. Final Implementation Readiness Checklist

- [ ] Build order (§9) followed; each engine's tests green before dependents.
- [ ] Dependency graph acyclic; no forbidden dependency (§8; WF §20).
- [ ] Single-writer ownership enforced (DM §20).
- [ ] Determinism suite (golden masters) green across double runs.
- [ ] Migration chain v1→v3 verified; newer-than-app refused.
- [ ] Security scan clean (secrets/paths/traversal/bomb/runtime-leak).
- [ ] Print-area supremacy, one-image, cover-A-only, no-silent-overwrite/omission verified.
- [ ] Accessibility + i18n gates passed.
- [ ] 50-scene/100-prompt stress passed.
- [ ] All Release/Deployment gates green; no release blocker open.
- [ ] Cross-document compatibility audit passed (all eleven specs).
- [ ] Lead Architect sign-off: implementation matches specifications with no redesign.

---

# Appendix A — Acceptance Criteria (128)

Foundational (A1–A20): A1 folder/module structure matches ARCH §2. A2 build order matches §9. A3 dependency graph acyclic. A4 no forbidden dependency. A5 single-writer ownership. A6 runtime objects never persisted. A7 runtime objects never exported. A8 deterministic serialization. A9 branded IDs as strings. A10 migration v1→v3 works. A11 newer-than-app refused. A12 config never mutates saved sessions. A13 feature flags never randomize. A14 no Math.random anywhere. A15 timestamps excluded from content hashes. A16 lexicographic ordering. A17 fingerprint idempotence. A18 golden masters stable. A19 error codes namespaced. A20 Arabic UI/English prompts.

Rule (A21–A33): A21 print-area supremacy. A22 lower never overrides higher. A23 season≠garment color. A24 palette lock actual colors. A25 dynamic scene limit. A26 count_* arrays only. A27 num_* scalars only. A28 real booleans. A29 IsNull for null. A30 ConditionGroup logic. A31 feasibility blocks count>space. A32 dup 4-tuple blocked. A33 rule trace complete.

Scene (A34–A46): A34 deterministic assembly. A35 exactly N scenes. A36 hard uniqueness. A37 diversity deterministic. A38 mood anchor cohesion. A39 color round-robin. A40 primary to hero. A41 view rules. A42 print-area-safe filtering. A43 A+B pair always. A44 fingerprint regen semantics. A45 hero/support ratios. A46 Kids no adult model.

Prompt (A47–A61): A47 one prompt one image. A48 A/B separate. A49 B edit-mode. A50 B needs A+PNG. A51 A blank. A52 no scene text. A53 no collage. A54 print-area clause firmest. A55 B preserves attributes. A56 artwork lock. A57 fabric integration. A58 numbering stable. A59 checksum deterministic. A60 two-phase plan. A61 Kids no adult wording.

Cover (A62–A74): A62 A-only. A63 cover-uses-B blocked. A64 source lock. A65 layout by count. A66 hero dominance. A67 primaries deterministic. A68 warm neutral/no green. A69 large images small text. A70 strip locked only. A71 badges by flags. A72 names from manifest. A73 coverHash deterministic. A74 emits prompt only.

Export (A75–A90): A75 byte-for-byte prompts. A76 A/B linkage. A77 numbering across formats. A78 ZIP deterministic. A79 fixed epoch. A80 checksum excludes timestamp. A81 no runtime objects. A82 no secrets/paths. A83 artwork metadata only. A84 cover export A only. A85 partial lists omissions. A86 clipboard banner. A87 clipboard fallback. A88 manifest complete. A89 safe filenames. A90 re-export idempotent.

Persistence/recovery/version (A91–A106): A91 save writes snapshot. A92 save confirmed post-write. A93 overwrite confirms. A94 migrate forward. A95 reject newer schema. A96 duplicate new IDs. A97 rename no fingerprint change. A98 append-only history. A99 retention safe. A100 restore forks. A101 restore transactional. A102 missing libraries flagged. A103 corrupted restore. A104 autosave non-destructive. A105 undo/redo deterministic. A106 no silent overwrite.

UI/state/workflow (A107–A120): A107 Generate button always present. A108 copy toasts. A109 copy pair separate. A110 gated nav tooltips. A111 RTL + LTR prompt. A112 mode switch lossless. A113 drag-drop snap-back. A114 keyboard-only. A115 blocking notification ordering. A116 unsaved dialog. A117 guarded transitions. A118 no hidden auto-advance. A119 nothing auto-generates images. A120 pipeline order fixed.

Engineering/process (A121–A128): A121 CI blocks on any P0 fail. A122 determinism stage byte-compares. A123 security scan clean. A124 PR cites spec + tests. A125 golden-master change justified. A126 no redesign in any PR. A127 accessibility gate passed. A128 full spec compatibility audit passed.

---

# Appendix B — Engineering Verification Points (156)

Structure/deps (EVP-1..20): EVP-1 folders per ARCH §2. EVP-2 shared/domain-model single source. EVP-3 shared/errors registry. EVP-4 contracts at boundaries. EVP-5 injection graph acyclic. EVP-6 leaves import no engine. EVP-7 UI not imported by engines. EVP-8 Prompt imports no engine. EVP-9 Cover imports no engine. EVP-10 Export imports no mutating engine. EVP-11 Validation calls only Rule/Print-Area. EVP-12 Scene calls only Rule/Palette/Print-Area/Dedup. EVP-13 Orchestrator sole pipeline driver. EVP-14 no module redefines DM types. EVP-15 manifests read-only. EVP-16 config validated at startup. EVP-17 schema versions declared. EVP-18 no cyclic import (lint). EVP-19 no global mutable state. EVP-20 build order enforced in CI.

Determinism (EVP-21..40): EVP-21 no Math.random. EVP-22 no Date/now in hashes. EVP-23 no locale sort. EVP-24 lexicographic tie-breaks. EVP-25 scene double-run identical. EVP-26 prompt double-run identical. EVP-27 cover double-run identical. EVP-28 export double-run identical. EVP-29 checksum stable across runs. EVP-30 fingerprint equal for equal inputs. EVP-31 timestamp change ⇒ content hash unchanged. EVP-32 prompt change ⇒ hash change. EVP-33 reorder ⇒ names change/content same. EVP-34 EvaluationContext recreated per run. EVP-35 Resolved* discarded post-run. EVP-36 golden masters present per engine. EVP-37 cross-OS identical bytes. EVP-38 no flaky tests tolerated. EVP-39 no wall-clock in ZIP. EVP-40 config-independent outputs.

Rule (EVP-41..58): EVP-41 operators correct. EVP-42 ConditionGroup logic. EVP-43 ContextRef resolves. EVP-44 NumericExpression arithmetic/min/max. EVP-45 precedence ladder. EVP-46 print-area highest. EVP-47 domain isolation guard. EVP-48 RULE_CFG_001/002/003. EVP-49 feasibility RULE_CNT_001. EVP-50 dup RULE_DUP_001. EVP-51 palette lock actual colors. EVP-52 season≠garment color. EVP-53 audience matrix. EVP-54 season matrix. EVP-55 product compat. EVP-56 trace overriddenBy. EVP-57 warnings non-mutating. EVP-58 print-area numeric = predicate.

Scene (EVP-59..76): EVP-59 candidate rejection. EVP-60 exclusions. EVP-61 requiredCompanions. EVP-62 scoring weights fixed. EVP-63 tie-break by hash. EVP-64 hard uniqueness. EVP-65 diversity caps deterministic. EVP-66 mood anchor. EVP-67 color round-robin. EVP-68 primary to hero. EVP-69 view assignment. EVP-70 print-area filtering. EVP-71 pair placeholders. EVP-72 fingerprints computed. EVP-73 totalScenes set. EVP-74 SceneCreated events. EVP-75 lock/replace behavior. EVP-76 no randomness.

Prompt (EVP-77..93): EVP-77 module order. EVP-78 variable resolution. EVP-79 one-image directive. EVP-80 A blank. EVP-81 B edit-mode. EVP-82 B needs A+PNG. EVP-83 preserve attributes. EVP-84 artwork lock. EVP-85 fabric clauses. EVP-86 multi-garment B single image. EVP-87 numbering stable. EVP-88 checksum deterministic. EVP-89 timestamp excluded. EVP-90 group plan not image. EVP-91 two-phase plan. EVP-92 error codes. EVP-93 English/Arabic split.

Cover (EVP-94..108): EVP-94 barrier. EVP-95 A-only collection. EVP-96 layout mapping. EVP-97 grid formula. EVP-98 hero 2×2. EVP-99 primaries mode+ID. EVP-100 warm neutral/no green. EVP-101 strip locked only. EVP-102 strip order. EVP-103 badges by flags. EVP-104 names from manifest. EVP-105 metadata counts. EVP-106 coverHash. EVP-107 prompt-only. EVP-108 error codes.

Export (EVP-109..128): EVP-109 byte-for-byte. EVP-110 linkage. EVP-111 numbering. EVP-112 ZIP deterministic. EVP-113 fixed epoch. EVP-114 entry order. EVP-115 checksum policy. EVP-116 no runtime objects. EVP-117 no secrets/paths. EVP-118 artwork metadata only. EVP-119 cover A only. EVP-120 partial omissions listed. EVP-121 clipboard banner. EVP-122 clipboard fallback. EVP-123 manifest complete. EVP-124 filename safety. EVP-125 Arabic name preserved. EVP-126 traversal/bomb blocked. EVP-127 Prompt Pack contents. EVP-128 re-export idempotent.

Persistence/recovery/version/UI (EVP-129..156): EVP-129 save snapshot. EVP-130 confirmed post-write. EVP-131 overwrite confirm. EVP-132 migrate forward. EVP-133 reject newer. EVP-134 duplicate new IDs. EVP-135 rename no fingerprint. EVP-136 append-only history. EVP-137 retention safe. EVP-138 restore forks. EVP-139 restore transactional. EVP-140 missing libs flagged. EVP-141 corrupted restore. EVP-142 checksum verify. EVP-143 autosave non-destructive. EVP-144 undo/redo deterministic. EVP-145 crash recover. EVP-146 Generate button present. EVP-147 gated nav tooltips. EVP-148 guarded transitions. EVP-149 no hidden auto-advance. EVP-150 nothing auto-generates images. EVP-151 RTL/LTR bidi. EVP-152 keyboard-only. EVP-153 blocking-order notifications. EVP-154 mode lossless. EVP-155 drag-drop snap-back. EVP-156 events append-only/ID-only.

---

# Appendix C — Engineering Risk Register (62)

R1 Nondeterminism from RNG/time (P0) — mitigate: ban RNG, determinism CI stage. R2 Locale-dependent sorting (P0) — byte order only. R3 Silent overwrite on save/restore (P0) — mandatory confirm. R4 Silent omission on export (P0) — omission lists. R5 Cover-uses-B leakage (P0) — type-level A-only + validation. R6 Runtime object exported (P0) — export whitelist + scan. R7 Print-area override (P0) — precedence tests. R8 One-image violation (P0) — template invariant + QA. R9 Migration corruption (P0) — fixtures + rollback. R10 Newer-than-app open (P0) — refuse. R11 Numbering drift (P1) — sceneOrder-derived + tests. R12 Wrong color allocation (P1) — round-robin tests. R13 Duplicate scenes (P1) — dedup tests. R14 Checksum instability (P1) — canonical serialization. R15 ZIP nondeterminism (P1) — fixed epoch + sorted. R16 Forbidden dependency introduced (P1) — dep-graph lint. R17 Multi-writer field (P1) — ownership lint. R18 Cyclic injection (P1) — DAG check. R19 Prompt text mutation on export (P1) — byte-compare. R20 Stale B treated current (P1) — isStale checks. R21 Feasibility deadlock (P1) — precheck. R22 Config affecting outputs (P1) — output-independence test. R23 Golden-master drift unjustified (P1) — PR gate. R24 Secrets in logs (P1) — log scrubber. R25 Path traversal on import (P1) — sanitizer. R26 Decompression bomb (P1) — caps. R27 Large-session memory blowup (P2) — streaming. R28 UI jank at 50 scenes (P2) — virtualization. R29 Clipboard failure UX (P2) — fallback. R30 Arabic RTL rendering bugs (P2) — bidi isolation. R31 Reserved filename crash on Windows (P1) — name policy. R32 Long Arabic name path overflow (P2) — truncation+hash. R33 Missing library silent drop (P1) — flagging. R34 Retention prunes current (P1) — retention tests. R35 Undo corrupts lineage (P1) — lineage tests. R36 Autosave churn (P2) — fingerprint gate. R37 Event leaks prompt bytes (P1) — event schema. R38 Telemetry PII leak (P0) — anonymized counters only. R39 Analytics affects output (P1) — no-op when disabled. R40 Plugin introduces cycle (P1) — registration guard. R41 Additive enum without migration (P1) — migration required. R42 Module redefines DM type (P1) — single source. R43 Hardcoded scene limit regression (P1) — dynamic-limit test. R44 String boolean/null regression (P1) — operator tests. R45 Placeholder ledger regression (P1) — isDuplicate boolean. R46 Cover green default regression (P1) — palette test. R47 Kids adult-model regression (P0) — audience test. R48 Gate bypass (P0) — state-machine tests. R49 Barrier bypass for cover (P1) — allOutputAReady test. R50 Print-area numeric modeled as rule (P1) — predicate layering. R51 Non-canonical JSON (P1) — sorted keys. R52 Missing Arabic message (P2) — catalog completeness. R53 Accessibility gap (P1) — a11y gate. R54 Focus-order errors (P2) — manual pass. R55 Build non-reproducible (P1) — pinned toolchain. R56 Rollback migrates backward (P1) — forbidden. R57 Feature flag randomization (P1) — deterministic flags. R58 Spec drift in code (P0) — review gate cites spec. R59 Test flakiness (P1) — treated as determinism defect. R60 Unbounded clipboard payload (P2) — bound. R61 Cross-OS byte differences (P1) — normalization. R62 Documentation rot (P2) — DS gates.

---

# Appendix D — Future Extension Points (52)

E1 new product manifest. E2 new season manifest. E3 new pose/model archetype. E4 new location vocab. E5 new lighting vocab. E6 new decor vocab. E7 new prop vocab. E8 new camera term. E9 new composition. E10 new display method (enum+migration). E11 new rule domain. E12 new rule. E13 new rule operator (additive). E14 new NumericExpression function. E15 new prompt module. E16 new prompt template version. E17 new global-clause version. E18 new cover layout (enum+migration). E19 new cover badge. E20 new typography element. E21 new export format. E22 new export scope. E23 new clipboard action. E24 new checksum algorithm (HashRef). E25 signed manifests. E26 cloud backup channel. E27 team/multi-user persistence mode. E28 rendered-image packaging (authorized source). E29 new event type. E30 new validation check. E31 new season compatibility entry. E32 new audience value. E33 new product view. E34 new palette. E35 new retention policy kind. E36 new UI mode. E37 new screen (additive nav). E38 new keyboard shortcut. E39 new notification type. E40 new settings default. E41 new group-by dimension. E42 new print-area position. E43 new obstruction type. E44 new library kind. E45 new manifest field (optional). E46 new telemetry counter. E47 new analytics event. E48 new plugin engine (registry). E49 new migration step. E50 new golden-master fixture. E51 new locale (future; currently Arabic-only). E52 new render integration (future-only). All additive; none redesigns engines.

---

# Appendix E — Gates & Scenarios

**Release Gates (20):** RG1 all P0/P1 tests green. RG2 determinism byte-identical double-run. RG3 golden masters match. RG4 migration v1→v3 verified. RG5 security scan clean. RG6 no forbidden dependency. RG7 ownership single-writer verified. RG8 print-area supremacy verified. RG9 one-image verified. RG10 cover-A-only verified. RG11 no-silent-overwrite/omission verified. RG12 accessibility gate passed. RG13 i18n/RTL gate passed. RG14 50-scene/100-prompt stress passed. RG15 cross-doc compatibility audit passed. RG16 error catalog complete (codes+Arabic). RG17 no S0/S1 open. RG18 build reproducible. RG19 release notes list versions. RG20 Architect sign-off.

**Deployment Gates (20):** DG1 release gates green. DG2 build manifest recorded. DG3 no secrets in artifact. DG4 config validated. DG5 schema versions pinned. DG6 module versions pinned. DG7 rollback tag available. DG8 data forward-compat verified. DG9 libraries bundled. DG10 schemas bundled. DG11 local-only confirmed. DG12 telemetry opt-in default off. DG13 staged rollout plan set. DG14 monitoring hooks live. DG15 support error-catalog published. DG16 accessibility smoke passed. DG17 Arabic UI smoke passed. DG18 export/import smoke passed. DG19 determinism smoke passed. DG20 deployment checklist signed.

**Rollback Scenarios (20):** RB1 nondeterminism detected in prod. RB2 silent overwrite reported. RB3 cover-B leak. RB4 runtime-object export. RB5 migration corruption. RB6 data loss on restore. RB7 numbering drift. RB8 wrong color allocation. RB9 duplicate scenes. RB10 checksum instability. RB11 print-area override. RB12 one-image violation. RB13 gate bypass. RB14 Kids adult-model. RB15 export secret leak. RB16 crash on load. RB17 Windows filename crash. RB18 Arabic rendering breakage. RB19 performance regression >budget. RB20 security vulnerability (traversal/bomb). Each triggers revert to previous tag; data untouched; incident logged.

**Release Blockers:** any open S0/S1; any P0 test failing; any determinism/security/migration stage red; any forbidden dependency; any ownership violation; any spec-drift not resolved.

---

# Appendix F — Non-Functional Requirement Sets

**Security Requirements (20):** SEC1 no secrets in exports/logs/telemetry. SEC2 no absolute paths. SEC3 no user identifiers. SEC4 artwork metadata not bytes. SEC5 safe JSON parse. SEC6 ZIP traversal protection. SEC7 decompression-bomb caps. SEC8 file-size/ratio limits. SEC9 backup checksum validation. SEC10 no code eval from data. SEC11 runtime objects stay in memory. SEC12 local-first data. SEC13 opt-in telemetry. SEC14 anonymized counters only. SEC15 import schema validation. SEC16 reject newer-than-app. SEC17 sanitized filenames. SEC18 no network beyond authorized fetch. SEC19 log scrubbing. SEC20 dependency pinning.

**Performance Requirements (20):** PERF1 O(n) assembly. PERF2 O(n) export. PERF3 50 scenes interactive. PERF4 100 prompts within budget. PERF5 virtualized lists. PERF6 lazy season libraries. PERF7 streamed ZIP. PERF8 cached fingerprints. PERF9 no recompute on scroll. PERF10 bounded clipboard. PERF11 structural-shared snapshots. PERF12 single-pass canonical JSON. PERF13 progress reporting. PERF14 responsive cancellation. PERF15 index-backed search. PERF16 debounced autosave. PERF17 bounded memory (IDs not bytes). PERF18 no quadratic scans. PERF19 deterministic under load. PERF20 stress-suite pass.

**Accessibility Requirements (20):** A11Y1 keyboard-only. A11Y2 RTL focus order. A11Y3 visible focus. A11Y4 modal focus trap. A11Y5 Arabic ARIA labels. A11Y6 roles for controls. A11Y7 live regions for toasts. A11Y8 live regions for validation. A11Y9 live regions for execution state. A11Y10 WCAG AA contrast. A11Y11 non-color-only status. A11Y12 bidi isolation. A11Y13 no keyboard traps. A11Y14 skip/landmarks. A11Y15 accessible dialogs. A11Y16 accessible drag alt (Move). A11Y17 accessible tables. A11Y18 error announcement. A11Y19 reduced-motion respect. A11Y20 a11y release gate.

**Internationalization Requirements (20):** I18N1 Arabic-only UI. I18N2 RTL layout. I18N3 English-only prompts. I18N4 LTR prompt rendering. I18N5 Arabic string catalog. I18N6 no hardcoded UI text. I18N7 bidi isolation for tokens. I18N8 NFC normalization. I18N9 ASCII-safe slugs. I18N10 Arabic name preserved in metadata. I18N11 no locale sort. I18N12 numerals render correctly. I18N13 hashes LTR isolated. I18N14 filenames cross-platform. I18N15 Arabic error messages complete. I18N16 date-neutral content. I18N17 mixed-direction safe. I18N18 catalog completeness gate. I18N19 future-locale extension point (E51). I18N20 no direction leakage into checksums.

---

*End of Final Implementation Guide. Sourced only from the eleven authoritative documents. Roadmap/translation only — no application code, HTML, CSS, React, or TypeScript implementation; no redesign, no invented behavior, no simplification. Build order, dependencies, forbidden dependencies, ownership, integration milestones, sprint/build order, and all review/quality/deployment/rollback gates are specified. Everything remains deterministic and compatible with 01–11. Totals: 128 acceptance criteria (≥120 ✔), 156 engineering verification points (≥150 ✔), 62 engineering risks (≥60 ✔), 52 future extension points (≥50 ✔), 32 coding standards (≥30 ✔), 30 documentation standards (✔), 20 release gates, 20 deployment gates, 20 rollback scenarios, 20 security, 20 performance, 20 accessibility, 20 internationalization requirements (all ✔).*
