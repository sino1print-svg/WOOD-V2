# 10_APP_WORKFLOW.md

# Mockup Photoshoot Director — Master Orchestration Specification

**Document type:** Master Orchestration / Deterministic Execution Workflow (specification only)
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`, `08_COVER_ENGINE.md`, `09_EXPORT_ENGINE.md`
**Status:** Authoritative master specification
**Scope note:** This is the **orchestration** contract — how every engine collaborates from startup to archive. It is not architecture, not UI, not implementation. No application code, no HTML/CSS/React, no TypeScript implementation. All names are those of `03_DATA_MODELS_FINAL.md` (DM). Everything is deterministic: identical state + versions ⇒ identical execution, order, and results (ARCH §1.3).

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `DM` = `03_DATA_MODELS_FINAL.md`. `RE` = `04_RULE_ENGINE_REVISED.md`. `SE` = `05_SCENE_ENGINE.md`. `PE` = `06_PROMPT_ENGINE.md`. `UI` = `07_UI_ENGINE.md`. `CE` = `08_COVER_ENGINE.md`. `EX` = `09_EXPORT_ENGINE.md`.

---

## 0. Orchestration Doctrine (non-negotiable)

1. **Single conductor.** The **Orchestrator** is the only component that drives the pipeline. Engines are called by the Orchestrator (or by an explicitly permitted parent, §2.3); they never self-trigger the pipeline.
2. **Acyclic calls.** The engine call graph is a DAG (§20). No engine ever calls upstream to mutate an upstream output; no cycles.
3. **Deterministic order.** The generation pipeline order is fixed (ARCH §3): **Rule → Palette → Scene (invokes Print-Area + Dedup) → Validation gate → Prompt → Cover → Export**.
4. **Blocking halts.** A blocking failure halts the pipeline before the next stage; warnings never mutate state (RE §13).
5. **Single-writer data.** Every field has exactly one Owner engine that may create/mutate it; all others are read-only (§23/§24; DM §20).
6. **No runtime leakage.** `EvaluationContext` and `Resolved*` are runtime-only, never persisted or exported (DM §3.15/§3.16).
7. **Nothing auto-generates images.** The app composes and copies prompt text; image generation is a manual user step (UI §0.2; PE §17).
8. **No silent overwrite / no silent omission** across save, restore, and export (UI §14; EX §0.8).
9. **Idempotence.** Re-running an unchanged `SessionFingerprint` reproduces identical scenes, prompts, cover, and exports (DM §3.18).

---

## 1. Overall Application Lifecycle

The application moves through eleven lifecycle states (UI §13), each mapped to `SessionStatus` (DM §2.1). The Orchestrator owns transitions; each is user-initiated or a deterministic engine-completion event.

```
Idle → Editing → Planning → Validating → Ready → Generating → (Paused) → Completed → Exporting → Finished → Archived
```

| Lifecycle state | `SessionStatus` | Driven by |
|---|---|---|
| Idle | (none active) | app boot / reset |
| Editing | `Draft` | user selections |
| Planning | `Draft`→ | Scene Engine assembling |
| Validating | `Validating`/`Blocked` | Validation gate |
| Ready | `Validating`(pass) | gate pass |
| Generating | `Generating` | Prompt Engine composing |
| Paused | `Generating` | user pause |
| Completed | `Generating`→`CoverBuild`→`Ready` | prompts composed, cover ready |
| Exporting | `Exported`(pending) | Export Engine |
| Finished | `Exported` | export done |
| Archived | `Exported`(archived) | user archive → snapshot |

The lifecycle is strictly forward through the gate; reopening an archived project forks a new version (DM §3.14) and returns to Editing.

---

## 2. Engine Orchestration

### 2.1 Engine roster (`EngineId`, DM §2.1) + the UI driver

| Engine | Role | Starts (pipeline) |
|---|---|---|
| **Orchestrator** | conductor; owns pipeline + transitions | boots first (after Persistence load) |
| **Persistence / Version Manager** | load/save/snapshot | first at startup |
| **Asset** | artwork upload/metadata | on demand |
| **Rule** | resolve constraints (pure) | pipeline stage 1 |
| **Palette** | resolve locked colors, `garmentColorAllowed` | stage 2 |
| **Scene** | assemble scenes | stage 3 (invokes Print-Area + Dedup) |
| **Print-Area** | measure print area (facts) | invoked by Scene/Validation |
| **Dedup** | compute signatures / uniqueness | invoked by Scene |
| **Validation** | blocking gate | stage 4 |
| **Prompt** | compose A/B/Group prompt text | stage 5 |
| **Cover** | compose cover prompt (Output A only) | stage 6 |
| **Export** | package artifacts (read-only) | stage 7 / on demand |
| **UI (driver)** | presents state, sends user intents | not an engine; never called by engines |

### 2.2 Which engine starts first

- **At application startup:** **Persistence** loads state, then the **Orchestrator** initializes (§3). No content engine runs until a session exists and generation is requested.
- **In the generation pipeline:** the **Rule Engine** is the first content engine to run (after selections), producing the `ResolvedConstraintSet` all later engines depend on.

### 2.3 Call-permission matrix (who may call whom)

`✓` = may call; `—` = never calls; leaf = calls nothing.

| Caller ↓ / Callee → | Orch | Rule | Palette | Scene | PrintArea | Dedup | Valid | Prompt | Cover | Export | Persist | Asset |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Orchestrator** | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Rule** (pure/leaf) | — | — | — | — | — | — | — | — | — | — | — | — |
| **Palette** (leaf) | — | — | — | — | — | — | — | — | — | — | — | — |
| **Scene** | — | ✓(filter) | ✓ | — | ✓(measure) | ✓(sign) | — | — | — | — | — | — |
| **Print-Area** (leaf) | — | — | — | — | — | — | — | — | — | — | — | — |
| **Dedup** (leaf) | — | — | — | — | — | — | — | — | — | — | — | — |
| **Validation** | — | ✓(judge) | — | — | ✓(judge) | — | — | — | — | — | — | — |
| **Prompt** | — | — | — | — | — | — | — | — | — | — | — | — |
| **Cover** | — | — | — | — | — | — | — | — | — | — | — | — |
| **Export** (read-only) | — | — | — | — | — | — | — | — | — | — | ✓(read) | — |
| **Persistence** (leaf) | — | — | — | — | — | — | — | — | — | — | — | — |
| **Asset** (leaf) | — | — | — | — | — | — | — | — | — | — | — | — |

### 2.4 Which engine may NEVER call another (explicit)

- **No engine calls the UI.** The UI only receives state/events.
- **Rule / Palette / Print-Area / Dedup / Persistence / Asset are leaves** — they call nothing (pure producers).
- **Prompt never calls Scene, Rule, or any engine** — it reads assembled scenes + resolved constraints and composes text.
- **Cover never calls Prompt, Scene, or any generation engine** — it composes the cover prompt from `CoverMetadata` using the shared `cover` module template (CE §1.5); it never generates or edits mockups and never touches Output B.
- **Export never calls any engine that mutates** — it is strictly read-only (EX §0.1) and may only read persisted state.
- **Validation never mutates** — it calls Rule/Print-Area only to *judge*, never to change data.
- **No cyclic calls** — the graph is acyclic (§20).

---

## 3. Startup Workflow

```
[1] App boot
[2] Persistence: load app config + recent projects + autosave marker
[3] Library load: product/season/palette/rule-set/prompt-module manifests (by ID)  [ARCH §10.1]
      → schema-version check per aggregate (DM §16); newer-than-app ⇒ block that item
[4] Orchestrator init: register engines (registry pattern, ARCH §10.2); build engine table
[5] Determine entry:
      • autosave present ⇒ offer Recover Session (UI §20)
      • else ⇒ Home (Idle)
[6] Emit AppStarted (audit); UI renders Idle/Home
```

No content engine runs at startup. Startup is deterministic: identical config + libraries ⇒ identical engine registry and entry state.

---

## 4. Project Workflow

```
Create/Open Project (Persistence)
   → Orchestrator sets activeProject; state = Editing
   → Project owns: sessions, versionHistory, artworks, isDigitalProduct, retention (DM §3.1)
Duplicate / Rename / Delete (Persistence, with confirm; UI §14)
Save / Save As (Persistence → VersionSnapshot; §11)
Recent Projects / History (Persistence read)
Archive (Persistence snapshot; state = Archived)
```

Only **Persistence** creates/mutates `Project`-level structural fields; the Orchestrator coordinates; all other engines read the active project. Rename never changes `SessionFingerprint` (names excluded, DM §3.18).

---

## 5. Session Workflow

```
New Session → PhotoshootSession (Draft); Orchestrator owns status
Configure (Editing):
   season → audience → productIds → colorSelection(+lock) → requestedSceneCount → groups
   (each selection is user intent via UI; Orchestrator writes the field; live validation chips)
Plan → Scene pipeline (§7)
Validate → Validation gate (§16)
Generate Prompts → Prompt pipeline (§8)
Cover → Cover pipeline (§9) after allOutputAReady
Export → Export pipeline (§10)
Archive
```

Session selection fields are **Owner = Orchestrator** (created from UI intent); engines read them. Transition rules are in §19.

---

## 6. Rule Evaluation Workflow (pipeline stage 1)

```
Orchestrator → Rule Engine.evaluate(context)
   [1] Build EvaluationContext (runtime, read-only; DM §3.15) from selections + measured facts
   [2] Scope-load active rule-sets (global/print-area/audience/season/palette/scene/product) (RE §4.1)
   [3] Collect matched rules; resolve ContextRefs + ConditionNodes (RE §3/§5)
   [4] Bucket by (domain,target); resolve conflicts by precedence ladder (RE §2/§3)
   [5] Produce ResolvedConstraintSet + RuleTrace (runtime; DM §3.16)
   → return to Orchestrator
```

Rule Engine is **pure**: it reads context, returns constraints + trace, mutates nothing, calls nothing. Print Area (priority 1) is absolute (RE §2). A blocking configuration error (`RULE_CFG_*`) halts here.

---

## 7. Scene Generation Workflow (pipeline stage 3)

```
Orchestrator → Palette Engine.resolve()   [stage 2: lock garment colors, garmentColorAllowed]
Orchestrator → Scene Engine.assemble(session, ResolvedConstraintSet)
   [1] Feasibility precheck: uniqueSpace ≥ requestedSceneCount else RULE_CNT_001 (halt) (SE §6.4)
   [2] Candidate generation (constrained cartesian product) (SE §6)
       - Scene → Rule (filter Forbid/Lock/Limit) ; Scene → Palette (color legality)
   [3] Candidate scoring (fixed formula, deterministic tie-break) (SE §7)
   [4] Per candidate: Scene → Print-Area (measure) ; Scene → Dedup (signature)
   [5] Duplicate elimination + diversity (SE §8/§9)
   [6] Ordering → sceneOrder ; assign colors (§14 SE) + views (§15 SE)
   [7] Create OutputA + OutputB placeholders (Pending) — one pair per scene (SE §17)
   [8] Compute sceneHash/sceneFingerprint/sceneVersion (DM §3.5)
   → emit SceneCreated events ; set GenerationProgress.totalScenes
```

Scene Engine owns `Scene.*`; it invokes Print-Area (measure) and Dedup (sign) and reads Rule/Palette outputs. It never calls Prompt/Cover/Export. Output of this stage is assembled scenes with empty output pairs.

---

## 8. Prompt Generation Workflow (pipeline stage 5)

```
[Gate] Validation must have passed (§16). Else no prompts composed.
Orchestrator → Prompt Engine.compose(scenes, ResolvedConstraintSet, modules)
   [1] For each scene in sceneOrder: compose OutputA prompt (Global→Product→Season→Scene→OutputA) (PE §2/§4)
   [2] For each scene: compose OutputB prompt (edit-mode; requires source A + PNG) (PE §5)
   [3] Compose Group prompts (execution plans, not images) (PE §16)
   [4] Attach PromptMetadata + promptHash + promptChecksum (PE §19)
   → emit generation-plan markers; state = Generating→Completed
```

Prompt Engine owns `OutputA/B.promptText`, `promptHash`, `promptMeta`, `Group.groupPromptText`. It reads scenes/constraints; it calls nothing. It never generates images and never combines A+B (PE §3). Missing-source Output B is **Planned/Blocked** (PE §6), not text-regenerated.

---

## 9. Cover Generation Workflow (pipeline stage 6)

```
[Barrier] allOutputAReady === (outputAGenerated === totalScenes) === true (RE §8) else COVER_BARRIER_001
Orchestrator → Cover Engine.compose(CoverMetadata, saleImagesA)
   [1] Collect Output A only (reject Output B) (CE §3)
   [2] Select layout by mockupCount (CE §4) ; compute primaries (deterministic modes) (CE/DM §3.9)
   [3] Typography + color strip (locked colors only) + badges (CE §6/§7/§8)
   [4] Fill shared cover module → MainCover.promptText + coverHash + promptMeta (CE §12)
   → emit CoverGenerated
```

Cover Engine owns `MainCover.*`. It reads `CoverMetadata` and Sale Images (Output A). It never calls Prompt/Scene, never uses Output B, never generates or edits images (CE §1.5/§3).

---

## 10. Export Workflow (pipeline stage 7 / on demand)

```
Orchestrator/UI → Export Engine.export(scope, formats)
   [1] Scope resolution (EX §3) → concrete artifact set
   [2] Validation before export (EX §17): blocking halts; warnings ⇒ partial (EX §18)
   [3] Artifact selection (read-only) → ordering (EX §6) → formatting (byte-for-byte) (EX §4/§8/§9/§10)
   [4] Checksums (SHA-256, timestamps excluded) (EX §14) → packaging (EX §11)
   [5] Deliver (clipboard/download) → emit ExportStarted/Completed/Failed (EX §23)
```

Export Engine is read-only; it mutates nothing and calls no mutating engine. It preserves prompt bytes, A/B linkage, numbering, and cover purity (EX §0).

---

## 11. Save Workflow

```
User Save (Ctrl+S) / stage completion
   → Orchestrator → Persistence.snapshot(project, reason)
   → VersionSnapshot written (stateHash) (DM §3.14); currentVersionId updated
   → dirty flag cleared only AFTER write confirmed (UI §21)
   → emit ProjectSaved
```

Only Persistence writes snapshots. Save is confirmed post-write (no premature clean state — UI §24). Overwrite confirms (UI §14).

---

## 12. Autosave Workflow

```
Timer (Settings interval, UI §22) OR significant edit
   → Orchestrator debounces → Persistence.autosnapshot (non-destructive)
   → autosave marker updated ; no user interruption
On next boot: autosave present ⇒ offer Recover Session (§15)
```

Autosave never overwrites a manual save silently; it writes to an autosave slot. Deterministic content (fingerprint-based) — an unchanged session doesn't churn snapshots.

---

## 13. Undo / Redo Workflow

```
Ctrl+Z Undo → Orchestrator → Persistence: step to previous VersionSnapshot (DM §3.14)
Ctrl+Y Redo → step forward
   - Undo/Redo operate on persisted version lineage (parentVersionId)
   - Reverting past a generation change re-marks affected outputs (sceneFingerprint compare)
```

Undo/Redo traverse the version lineage deterministically; they never fabricate state. Reverting a generation-affecting change sets dependent Output A → Pending, Output B → Stale (DM §3.5/§6).

---

## 14. Version History Workflow

```
Every Ready entry + manual save + duplicate → VersionSnapshot (reason) (DM §3.14)
Browse history (Persistence read) → Restore Preview (read-only) → confirm → fork new version
Retention policy prunes old snapshots except currentVersionId + referenced parents (DM §11/§3.14)
```

Version history is Persistence-owned, append-only, structurally shared (ARCH §10.6). Restore forks; it never overwrites silently (§15).

---

## 15. Recovery Workflow

```
Boot with autosave/crash marker → offer Recover Session (UI §20)
Corrupted project → Persistence checksum/structure check → restore last valid VersionSnapshot
Missing libraries → load data, flag dependent scenes blocked (no silent drop) (EX §15)
Version mismatch → migrate forward (DM §16) ; newer-than-app ⇒ reject (EX §15)
Restore (Merge/Replace) → transactional ; rollback on failure ; never silent overwrite (EX §15)
```

Recovery is Persistence + Orchestrator; it never applies partial state. All recovery paths name the cause and the next action (UI §20).

---

## 16. Validation Workflow (the gate)

```
Orchestrator → Validation Engine.validate(session)
   [Phase 0] presence: season/audience/products/colors/sceneCount (RE §14)
   [Predicates] Validation → Print-Area (PA-PRED-1..3), cover barrier (COV-PRED-1) (RE §7/§8)
   [Rules] Validation → Rule (judge) : audience/season/palette/dedup/product/cover (RE §14)
   → ValidationResult (passed, failures[]) with codes + Arabic messages + diagnostics (DM §3.13)
   passed=false ⇒ state=Blocked (halt) ; passed=true ⇒ Ready
```

The gate is the **only** path from Editing to Generation (RE §14). Validation reads and judges; it mutates nothing. Blocking failures halt; warnings pass with advisories (RE §13).

---

## 17. Error Workflow

```
Any engine detects a blocking condition → returns structured failure (code, severity, originEngine) (DM §3.13)
   → Orchestrator halts the current stage ; state → Blocked/Failed for that stage
   → no downstream stage runs ; no partial mutation committed
   → UI shows Arabic message + code + recovery action (UI §15)
Warnings → collected, attached to ValidationResult/manifest ; never halt ; never mutate (RE §13)
```

Error codes are namespaced per engine: `RULE_*` (RE §14), `PROMPT_*` (PE §21), `COVER_*` (CE §19), `EXPORT_*` (EX §19). The Orchestrator routes them uniformly.

---

## 18. Notification Workflow

```
Engine event/failure → Orchestrator → UI notification (Arabic) (UI §15)
Types: Toast / Warning / Blocking Error / Information / Progress / Success
Ordering: blocking errors first ; print-area blocking tops the stack (RE §2)
```

Notifications are presentation only; engines never call the UI directly (§2.4) — the Orchestrator relays.

---

## 19. State Transitions (deterministic; allowed vs blocked)

```
Idle ──create/open──▶ Editing
Editing ──edit──▶ Editing
Editing ──plan──▶ Planning ──assembled──▶ Validating
Validating ──fail──▶ Blocked ──fix──▶ Editing
Validating ──pass──▶ Ready
Ready ──generate prompts──▶ Generating
Generating ──pause──▶ Paused ──resume──▶ Generating
Generating ──all A prompts + Validation ok──▶ (Cover eligible when allOutputAReady) ──▶ Completed
Completed ──export──▶ Exporting ──done──▶ Finished
Finished ──archive──▶ Archived
Any ──reset(confirm)──▶ Idle (working state cleared; saved projects intact)
Archived ──reopen──▶ Editing (forks version)
```

**Allowed only when:** the guard holds (e.g. Validating→Ready requires `passed=true`; Cover requires `allOutputAReady`). **Blocked when:** a blocking failure exists (Editing↛Generating without the gate; Cover↛build before barrier). Every transition is user-initiated or a deterministic engine-completion; no hidden auto-advance (UI §13; §0.7).

---

## 20. Dependency Graph (acyclic)

```
Persistence ──loads──▶ Orchestrator
Orchestrator ──▶ Rule ──▶ (constraints)
Orchestrator ──▶ Palette ──▶ (locked colors)
Orchestrator ──▶ Scene ──▶ { Rule(filter), Palette, Print-Area(measure), Dedup(sign) }
Orchestrator ──▶ Validation ──▶ { Rule(judge), Print-Area(judge) }
Orchestrator ──▶ Prompt      (reads Scene + constraints)
Orchestrator ──▶ Cover       (reads CoverMetadata + Output A)
Orchestrator ──▶ Export      (reads persisted state)
Orchestrator ──▶ Persistence (snapshots)
Asset ──uploads──▶ (Output B dependency)
```

Properties: **acyclic**; leaves (Rule, Palette, Print-Area, Dedup, Persistence, Asset) call nothing; Prompt/Cover/Export are terminal readers; no upstream mutation. This guarantees no infinite loops and a single deterministic evaluation order (§27).

---

## 21. Complete Sequence Diagrams (textual)

### 21.1 Full generation (happy path)
```
UI → Orchestrator: requestGenerate(session)
Orchestrator → Rule: evaluate(context)            ← ResolvedConstraintSet + trace
Orchestrator → Palette: resolve()                 ← locked colors, garmentColorAllowed
Orchestrator → Scene: assemble()
   Scene → Rule: filter(dimension)                ← allowed values
   Scene → Print-Area: measure(candidate)         ← sizeRatio/overlaps/...
   Scene → Dedup: sign(candidate)                 ← dedupSignature, isDuplicate
   Scene → Palette: colorAllowed(scene)           ← garmentColorAllowed
Scene → Orchestrator: scenes[] + OutputA/B placeholders
Orchestrator → Validation: validate(session)
   Validation → Print-Area: PA-PRED-1..3          ← pass/fail
   Validation → Rule: judge(checks)               ← ValidationResult
Validation → Orchestrator: passed=true
Orchestrator → Prompt: compose(scenes, constraints)
Prompt → Orchestrator: OutputA/B.promptText + metadata
Orchestrator → Persistence: snapshot(Ready)
[user generates A images externally; marks done; uploads PNG; generates B images]
Orchestrator: allOutputAReady=true
Orchestrator → Cover: compose(CoverMetadata, salA)
Cover → Orchestrator: MainCover.promptText + coverHash
Orchestrator → Export: export(scope, formats)
Export → Orchestrator: package + manifest + checksums
Orchestrator → UI: Success (Arabic)
```

### 21.2 Blocked validation
```
Orchestrator → Validation: validate()
Validation → Rule/Print-Area: judge()
Validation → Orchestrator: passed=false, failures[RULE_*]
Orchestrator: state=Blocked ; halt (no Prompt stage)
Orchestrator → UI: Blocking error (Arabic + code)  [no mutation committed]
```

### 21.3 Output B blocked (missing PNG)
```
UI → Orchestrator: copy/execute B
Orchestrator → Prompt: state(B)                    ← Blocked (artworkId null) PE §6
Orchestrator → UI: PROMPT_PNG_001 (Arabic) + "upload PNG"   [B not dispatched]
```

### 21.4 Export with partial omission
```
UI → Orchestrator: export(session)
Orchestrator → Export: validateBeforeExport()      ← B not ready (no PNG) ⇒ warning
Export: emit A prompts + backup ; omit B ; list omissions (EX §18)
Export → UI: Success + warnings (Arabic)
```

### 21.5 Restore (safe)
```
UI → Orchestrator: restore(backup, mode)
Orchestrator → Persistence: preview(diff) → validate(schema, checksums)
   newer schema ⇒ EXPORT_RESTORE_002 (reject)
UI: confirm Merge/Replace
Persistence: apply transactionally ; on failure rollback (project unchanged)
Persistence → UI: RestoreCompleted / RestoreFailed(rolledBack)
```

---

## 22. Complete Event Flow

Events extend DM §3.19; each references entities by ID and excludes secrets/prompt bytes (EX §23).

```
AppStarted
ProjectOpened / ProjectSaved / ProjectArchived
SessionCreated
SceneCreated / SceneUpdated(fingerprintChanged)
ValidationCompleted(passed, blockingCount)
OutputGenerated(A|B, contentHash)          [user-confirmed image done]
ArtworkUploaded(contentHash)
CoverGenerated(coverHash)
ExportStarted / ExportCompleted / ExportFailed
BackupCreated / RestoreStarted / RestoreCompleted / RestoreFailed
ClipboardCopyCompleted / ClipboardCopyFailed
```

Flow: engine completes → emits event → Orchestrator updates state + relays a UI notification (§18). Events are append-only, timestamped (timestamps excluded from content checksums), and drive audit/version/observability.

---

## 23. Engine Ownership Matrix

Who **creates/mutates** vs **reads** each concern. (Detailed field ownership in DM §20.)

| Concern | Owner (create/mutate) | Readers |
|---|---|---|
| Pipeline order / state transitions | Orchestrator | UI |
| Session selections | Orchestrator (from UI intent) | Rule, Palette, Scene, Cover |
| Resolved constraints / RuleTrace | Rule (runtime) | Scene, Validation |
| Locked colors / `garmentColorAllowed` | Palette | Rule, Scene |
| `Scene.*`, `dedupSignature`, fingerprints | Scene (Dedup signs) | Prompt, Validation, Export |
| Print-area measurements | Print-Area | Rule, Validation, Scene |
| `OutputA/B.promptText`, promptHash, promptMeta | Prompt | Cover, Export, UI |
| Render/`renderHash` | Render step (external) | Export |
| `Artwork.*` (metadata) | Asset | Prompt(B), Cover, Export |
| `MainCover.*`, primaries, coverHash | Cover | Export, UI |
| `ValidationResult` | Validation | Orchestrator, UI, Export |
| `VersionSnapshot`, save state | Persistence | UI, Export |
| `ExportManifest`, checksums, packages | Export | user, Persistence(read) |
| `GenerationProgress`, `allOutputAReady` | Orchestrator | Cover(barrier), UI |
| `EvaluationContext`, `Resolved*` (runtime) | Rule (per run) | Rule only; never persisted/exported |

---

## 24. Data Ownership Matrix (single-writer guarantee)

| Data (DM) | Owner | May mutate | Read-only to |
|---|---|---|---|
| `Project` structure, `versionHistory` | Persistence | Persistence | all others |
| `PhotoshootSession` selections/status | Orchestrator | Orchestrator | Rule/Palette/Scene/Validation/Prompt/Cover/Export |
| `Scene` dimensions + metadata | Scene | Scene (Dedup signs) | Prompt/Validation/Export |
| `paletteColorId` legality | Palette (judge) / Scene (assign) | Palette/Scene | Rule |
| `OutputA` | Prompt (prompt), Orchestrator (status), Render (renderHash) | as noted | Cover/Export |
| `OutputB` | Prompt (prompt), Orchestrator (status) | as noted | Cover(never)/Export |
| `Artwork` | Asset | Asset | Prompt/Cover/Export |
| `MainCover` | Cover | Cover | Export/UI |
| `Rule/RuleSet` | data library (authored) | migration only | Rule |
| `ValidationResult` | Validation | Validation | all |
| `VersionSnapshot` | Persistence | — (immutable) | all |
| `EvaluationContext`/`Resolved*` | Rule (runtime) | Rule | none (never persisted) |

**Single-writer rule:** exactly one owner mutates each field; every other engine is read-only (DM §20). Violations are a design error, caught in review (QA T-ownership tests, §25).

---

## 25. User Journey (end to end)

```
Open App → (Recover?) → Home
   ↓
New Session (mode) → configure: season/products/colors(+lock)/audience/count/groups
   ↓
Plan (Rule→Palette→Scene) → review Scene Planner (reorder/replace/lock)
   ↓
Validate (gate) → must pass (Arabic reasons if blocked)
   ↓
Generate Prompts (Prompt) → English A/B text; nothing auto-generates images
   ↓
Copy (clipboard/Prompt Pack) → banners enforce one-image-per-request
   ↓
Generate Images (user, external): Phase 1 all A → mark done → upload PNG → Phase 2 each B using its A
   ↓
Generate Cover (Cover) → unlocks at allOutputAReady → Copy Cover (Output A only)
   ↓
Export (Export) → TXT/MD/JSON/ZIP/Prompt Pack + checksums + manifest
   ↓
Save / Version / Archive (Persistence)
```

Every arrow is an explicit user action or a deterministic engine completion (§0.7).

---

## 26. Internal Workflow Diagrams (text only)

### 26.1 Master pipeline
```
[Selections] → Rule → Palette → Scene(→PrintArea,→Dedup) → [Validation GATE]
   → Prompt → (user runs A, uploads PNG, runs B) → [Barrier allOutputAReady] → Cover → Export
```

### 26.2 Gate control
```
Editing ──request──▶ Validating ──pass──▶ Ready ──▶ Generating
                          └──fail──▶ Blocked ──fix──▶ Editing
```

### 26.3 Output pair dependency
```
Scene ⇒ OutputA(Pending) ─generate→ Generated ─artwork+source→ OutputB(Ready) ─generate→ Generated
OutputA changes ⇒ OutputB Stale ⇒ regenerate
```

### 26.4 Cover barrier
```
count(OutputA=Generated) == totalScenes ? ──yes──▶ Cover eligible
                                          └─no──▶ Cover Blocked (RULE_COV_002)
```

### 26.5 Export gate
```
scope → validateBeforeExport → blocking? ──yes──▶ halt (code)
                                          └─no──▶ (warnings? ⇒ partial+list) → package → deliver
```

---

## 27. Deterministic Execution Guarantees

- **Fixed order.** The pipeline order (§0.3) is invariant; engines run in the same sequence every time.
- **Pure producers.** Rule/Palette/Print-Area/Dedup are pure functions of inputs — no randomness, no time, no I/O side effects (RE §1.3; SE §7.2).
- **Lexicographic tie-breaks.** All ordering ends on stable branded IDs (SE §7.4; EX §6).
- **Fingerprint idempotence.** Identical `SessionFingerprint` + `sceneFingerprint` + rule-set/module versions ⇒ identical scenes, prompts, cover, exports, and checksums (DM §3.18; PE §20; CE §17; EX §14).
- **Timestamps excluded from content hashes** (§0; EX §14).
- **Acyclic, single-writer** (§20/§24) ⇒ no race, no nondeterministic interleaving in the logical model.
- **Runtime isolation.** `EvaluationContext`/`Resolved*` recreated per run, never persisted ⇒ no stale-cache nondeterminism (§0.6).

---

## 28. Failure Recovery

| Failure | Detection | Recovery |
|---|---|---|
| Blocking rule/validation | Validation gate (§16) | halt; show Arabic reason; user fixes; no mutation committed |
| Feasibility (count > space) | Scene precheck (SE §6.4) | `RULE_CNT_001`; user lowers count / widens options |
| Missing PNG / source A (B) | Prompt state (PE §6) | Blocked; upload/generate first; never invented |
| Stale Output B | `outputB.isStale` | regenerate from updated A |
| Cover barrier not met | `allOutputAReady` | wait for all A; Cover stays locked |
| Export blocking | Export validation (EX §17) | halt or partial+listed omissions |
| Clipboard denied | Export (EX §19) | TXT fallback, identical bytes |
| Corrupted project / checksum | Persistence/Export (EX §15) | restore last valid snapshot; partial recovery |
| Missing libraries | startup/restore | flag dependent scenes blocked; no silent drop |
| Version mismatch | schema check (DM §16) | migrate forward; reject newer-than-app |
| Crash mid-session | autosave marker | Recover Session offer (§15) |
| Restore conflict | Persistence (§15) | transactional; rollback; never silent overwrite |

Every recovery path is transactional and deterministic: on failure the system is left unchanged; nothing partial is committed.

---

## 29. Future Extensibility

- **New engine** → registers in the Orchestrator's engine table (registry pattern, ARCH §10.2) with declared call permissions (§2.3); the DAG (§20) grows without cycles.
- **New content (product/season/pose/library)** → data manifest; Scene/Prompt/Cover read by ID; no orchestration change (SE §20).
- **New rule domain / module / format / badge** → additive data + additive enum (DM §16 migration); pipeline order unchanged.
- **New event type** → append to the event model (DM §3.19); Orchestrator relays generically.
- **Rendered-image packaging / cloud / team / signed manifests** → future-only extension points behind existing contracts (EX §27); marked future-only, not current features.

All extension is additive and preserves determinism, single-writer ownership, and the acyclic call graph.

---

## 30. Acceptance Criteria (74)

- **AC-1** Persistence loads first at startup; Orchestrator initializes after.
- **AC-2** Rule Engine is the first content engine in the pipeline.
- **AC-3** Pipeline order is Rule→Palette→Scene→Validation→Prompt→Cover→Export, always.
- **AC-4** Only the Orchestrator drives the pipeline.
- **AC-5** The engine call graph is acyclic.
- **AC-6** Rule/Palette/Print-Area/Dedup/Persistence/Asset call no other engine.
- **AC-7** Scene may call Rule, Palette, Print-Area, Dedup only.
- **AC-8** Validation may call Rule, Print-Area only (to judge).
- **AC-9** Prompt calls no engine.
- **AC-10** Cover calls no engine and never uses Output B.
- **AC-11** Export calls no mutating engine (read-only).
- **AC-12** No engine calls the UI.
- **AC-13** Every field has exactly one Owner engine.
- **AC-14** Non-owners are read-only to a field.
- **AC-15** `EvaluationContext`/`Resolved*` are never persisted or exported.
- **AC-16** Validation gate is the only path to generation.
- **AC-17** Blocking failure halts the pipeline before the next stage.
- **AC-18** No partial mutation is committed on failure.
- **AC-19** Warnings never mutate state.
- **AC-20** Output A is composed/generated before Output B.
- **AC-21** One Scene always yields Output A + Output B.
- **AC-22** One prompt = one image everywhere.
- **AC-23** Output B requires source A + PNG; else Blocked (not invented).
- **AC-24** Cover eligible only when `allOutputAReady`.
- **AC-25** Cover references Output A only.
- **AC-26** Export preserves prompt text byte-for-byte.
- **AC-27** Export preserves A/B linkage and numbering.
- **AC-28** No silent overwrite in save/restore.
- **AC-29** No silent omission in export.
- **AC-30** Identical fingerprints+versions ⇒ identical scenes.
- **AC-31** … ⇒ identical prompts and checksums.
- **AC-32** … ⇒ identical cover prompt and coverHash.
- **AC-33** … ⇒ identical export bytes and manifest.
- **AC-34** No unseeded randomness anywhere.
- **AC-35** All ordering ends on stable branded IDs.
- **AC-36** Timestamps excluded from content checksums.
- **AC-37** State transitions occur only when their guard holds.
- **AC-38** Editing↛Generating without a passing gate.
- **AC-39** Reset clears working state, keeps saved projects.
- **AC-40** Archive writes a snapshot; reopen forks a version.
- **AC-41** Save confirmed only after write; dirty flag accurate.
- **AC-42** Autosave never overwrites a manual save slot.
- **AC-43** Undo/Redo traverse version lineage deterministically.
- **AC-44** Reverting a generation change re-marks outputs stale/pending.
- **AC-45** Version history is append-only, structurally shared.
- **AC-46** Retention prunes only non-current, non-referenced snapshots.
- **AC-47** Corrupted project triggers restore from last valid snapshot.
- **AC-48** Missing libraries flag dependent scenes, not silent drop.
- **AC-49** Newer-schema backup rejected; older migrated forward.
- **AC-50** Restore is transactional with rollback on failure.
- **AC-51** Feasibility precheck blocks impossible counts before assembly.
- **AC-52** Dedup uniqueness enforced (no duplicate 4-tuple).
- **AC-53** Palette lock closes garment color to selected IDs only.
- **AC-54** Season rule never alters garment color (domain isolation).
- **AC-55** Print-area rules highest priority in every stage.
- **AC-56** Print-area numeric checks are Validation predicates, not rules.
- **AC-57** Error codes namespaced per engine and routed uniformly.
- **AC-58** Arabic user messages; English prompt content.
- **AC-59** Notifications relayed by Orchestrator, never by engines.
- **AC-60** Blocking errors shown first; print-area blocking tops the stack.
- **AC-61** Events are append-only and reference entities by ID.
- **AC-62** Events contain no prompt bytes or secrets.
- **AC-63** Every export/restore emits start + terminal events.
- **AC-64** GenerationProgress.totalScenes set after assembly.
- **AC-65** allOutputAReady === (outputAGenerated === totalScenes).
- **AC-66** Group numbering stable across all channels.
- **AC-67** Reorder renumbers deterministically; linkage preserved.
- **AC-68** Nothing auto-generates images.
- **AC-69** New engine registers with declared call permissions; DAG stays acyclic.
- **AC-70** New content added as data; orchestration unchanged.
- **AC-71** Pipeline re-run is idempotent.
- **AC-72** Every transition is user-initiated or engine-completion; no hidden auto-advance.
- **AC-73** Single-conductor: no engine self-triggers the pipeline.
- **AC-74** Full document set is internally consistent (§30 appendix).

## 31. QA Test Plan (124)

```
Startup & orchestration
[ ] T001 Persistence loads before Orchestrator init.
[ ] T002 Libraries load by ID with schema check.
[ ] T003 Newer-than-app library ⇒ blocked item.
[ ] T004 Rule Engine runs first in pipeline.
[ ] T005 Pipeline order fixed Rule→Palette→Scene→Validation→Prompt→Cover→Export.
[ ] T006 Only Orchestrator invokes stages.
[ ] T007 Engine registry built at init.
[ ] T008 AppStarted event emitted.
[ ] T009 Autosave present ⇒ Recover offer.
[ ] T010 No content engine runs at Idle.

Call permissions
[ ] T011 Scene→Rule allowed.
[ ] T012 Scene→Print-Area allowed.
[ ] T013 Scene→Dedup allowed.
[ ] T014 Scene→Palette allowed.
[ ] T015 Scene→Prompt forbidden.
[ ] T016 Prompt→Scene forbidden.
[ ] T017 Cover→Prompt forbidden.
[ ] T018 Cover→Scene forbidden.
[ ] T019 Export→any mutation forbidden.
[ ] T020 Validation→Rule (judge) allowed.
[ ] T021 Validation→mutate forbidden.
[ ] T022 Rule calls nothing.
[ ] T023 Palette calls nothing.
[ ] T024 Print-Area calls nothing.
[ ] T025 Dedup calls nothing.
[ ] T026 No engine calls UI.
[ ] T027 Call graph acyclic (no cycle detected).

Data ownership
[ ] T028 Session selections owned by Orchestrator.
[ ] T029 Scene.* owned by Scene.
[ ] T030 dedupSignature signed by Dedup.
[ ] T031 promptText owned by Prompt.
[ ] T032 MainCover.* owned by Cover.
[ ] T033 ValidationResult owned by Validation.
[ ] T034 VersionSnapshot owned by Persistence.
[ ] T035 Non-owner write attempt rejected in review.
[ ] T036 EvaluationContext not persisted.
[ ] T037 Resolved* not exported.

Rule/Scene
[ ] T038 ResolvedConstraintSet produced before Scene.
[ ] T039 Feasibility precheck blocks count>space (RULE_CNT_001).
[ ] T040 Palette lock closes garment color.
[ ] T041 Season rule cannot target garment color.
[ ] T042 Dedup blocks duplicate 4-tuple.
[ ] T043 Print-area obstruction blocks candidate.
[ ] T044 Scene creates A+B placeholders.
[ ] T045 sceneFingerprint computed.
[ ] T046 totalScenes set post-assembly.
[ ] T047 Diversity rotation deterministic.

Validation gate
[ ] T048 Gate is only path to generation.
[ ] T049 Fail ⇒ Blocked, no Prompt stage.
[ ] T050 Pass ⇒ Ready.
[ ] T051 PA-PRED predicates run in Validation.
[ ] T052 Cover barrier predicate uses ===totalScenes.
[ ] T053 Failures carry code+Arabic+diagnostics.
[ ] T054 Warnings pass without mutation.

Prompt
[ ] T055 A composed before B.
[ ] T056 One prompt = one image.
[ ] T057 B is edit-mode requiring A+PNG.
[ ] T058 Missing PNG ⇒ Blocked (PROMPT_PNG_001).
[ ] T059 Missing source A ⇒ Blocked (PROMPT_SRC_001).
[ ] T060 promptChecksum deterministic.
[ ] T061 No synonyms/variance in wording.
[ ] T062 Group prompt is a plan, not one image.

Cover
[ ] T063 Cover locked until allOutputAReady.
[ ] T064 Cover uses Output A only.
[ ] T065 Cover-uses-B ⇒ blocked.
[ ] T066 Layout by mockupCount.
[ ] T067 Primaries deterministic (mode, ID tie-break).
[ ] T068 Warm neutral bg; never green default.
[ ] T069 coverHash deterministic.

Export
[ ] T070 Prompt text byte-for-byte.
[ ] T071 A/B linkage preserved.
[ ] T072 Numbering identical across formats.
[ ] T073 ZIP deterministic (sorted, fixed epoch).
[ ] T074 Checksums exclude timestamps.
[ ] T075 Partial export lists omissions.
[ ] T076 Cover export Output A only.
[ ] T077 No runtime objects exported.
[ ] T078 No secrets/local paths exported.
[ ] T079 Clipboard denied ⇒ TXT fallback.
[ ] T080 Re-export idempotent.

Save/Autosave/Undo/Version
[ ] T081 Save confirmed post-write.
[ ] T082 Overwrite confirms.
[ ] T083 Autosave non-destructive.
[ ] T084 Autosave slot ≠ manual slot.
[ ] T085 Undo steps to prior snapshot.
[ ] T086 Redo steps forward.
[ ] T087 Revert generation change ⇒ outputs stale/pending.
[ ] T088 Version history append-only.
[ ] T089 Retention keeps current + referenced parents.
[ ] T090 Restore Preview applies nothing.

Recovery
[ ] T091 Crash marker ⇒ Recover offer.
[ ] T092 Corrupted project ⇒ restore last valid.
[ ] T093 Missing libraries ⇒ flagged, not dropped.
[ ] T094 Newer schema ⇒ rejected.
[ ] T095 Older schema ⇒ migrated.
[ ] T096 Restore rollback on failure.
[ ] T097 No silent overwrite on restore.

State transitions
[ ] T098 Editing↛Generating without gate.
[ ] T099 Cover↛build before barrier.
[ ] T100 Reset clears working, keeps saved.
[ ] T101 Archive writes snapshot.
[ ] T102 Reopen archived forks version.
[ ] T103 Pause/Resume within Generating.
[ ] T104 Every transition guarded.

Determinism
[ ] T105 Identical fingerprints ⇒ identical scenes.
[ ] T106 … ⇒ identical prompts/checksums.
[ ] T107 … ⇒ identical cover.
[ ] T108 … ⇒ identical export bytes.
[ ] T109 No Math.random in any stage.
[ ] T110 Lexicographic tie-breaks only.
[ ] T111 Timestamps excluded from content hashes.

Errors/Events/Notifications
[ ] T112 Blocking halts current stage.
[ ] T113 Error codes namespaced per engine.
[ ] T114 Arabic messages, English prompts.
[ ] T115 Notifications relayed by Orchestrator only.
[ ] T116 Blocking print-area tops stack.
[ ] T117 Events append-only, ID-referenced.
[ ] T118 Events exclude prompt bytes/secrets.

Stress & extensibility
[ ] T119 50 scenes / 100 prompts pipeline deterministic.
[ ] T120 Large version history handled.
[ ] T121 New engine registers with permissions; DAG acyclic.
[ ] T122 New product/season added as data; no orchestration change.
[ ] T123 Multiple sessions ordered stably.
[ ] T124 Full re-run after no change ⇒ identical outputs.
```

## 32. Edge Cases (52)

1. Empty project (no sessions) → Home Idle; generation disabled.
2. Single scene → full pipeline; 1A/1B; cover Single layout.
3. Zero products selected → gate blocks (Products presence).
4. requestedSceneCount = 0 → `RULE_CNT_002`.
5. count > unique space → `RULE_CNT_001` before assembly.
6. Locked White+Black + Kids + small library → feasibility may fail; blocked with reason.
7. No PNG uploaded → all A generate; B blocked; partial export lists B.
8. One blocked B among many → others proceed; blocked listed.
9. Output A edited after B → B stale → regenerate.
10. Cover requested before all A ready → blocked (barrier).
11. Cover metadata missing → `COVER_META_001`.
12. Duplicate scene attempt → blocked (`RULE_DUP_001`).
13. Reorder scenes → renumber; content checksums unchanged.
14. Delete scene after prompts → renumber; totalScenes recompute; cover metadata updates.
15. Season change mid-edit → re-plan; foreign decor excluded.
16. Audience change to Kids with adult product → blocked (`RULE_PRD_001`).
17. Palette lock toggled off → colors reopen; scenes re-validated.
18. Sand+Navy lock → garment colors Sand/Navy only; cover strip Sand/Navy.
19. Multi-garment hero (father+son) → one B image, PNG on both garments.
20. Minimal Studio → no decor; cleanest cover canvas.
21. 50 scenes → mosaic cover; deterministic package.
22. Multiple sessions in one project → stable session order in export.
23. Corrupted version history → partial recovery of intact snapshots.
24. Newer-schema backup restore → rejected.
25. Older-schema project open → migrated forward on load.
26. Crash during generation → autosave recover; no partial commit.
27. Clipboard denied → TXT fallback identical bytes.
28. Insufficient storage during ZIP → `EXPORT_STORAGE_001`; no partial file.
29. Decompression bomb import → aborted.
30. ZIP path traversal import → rejected.
31. Very long Arabic project name → ASCII slug + hash; name preserved in metadata.
32. Reserved Windows filename → prefixed.
33. Unresolved prompt variable → `PROMPT_VAR_001`; export blocked.
34. Invalid module version → `PROMPT_MOD_001`.
35. Rule config error (season targets garment color) → `RULE_CFG_003`.
36. Bad ContextRef → `RULE_CFG_002`.
37. Two products, primary tie → smallest-ID primary.
38. All-back-view session → hero from available; cover intact.
39. Warning-only validation → passes; selections unchanged.
40. Undo past generation → outputs re-marked; deterministic.
41. Redo after edit → lineage fork handled deterministically.
42. Autosave then manual save → both slots consistent; no clobber.
43. Reset during Generating → confirm → Idle; saved intact.
44. Archive then reopen → new version lineage.
45. Export cancelled mid-ZIP → no artifact; ExportFailed.
46. Group with mixed groupBy → `EXPORT_GROUP_001`.
47. Cover count ≠ image count → `COVER_COUNT_001`/`EXPORT_COVERCOUNT_001`.
48. Missing library at restore → dependent scenes flagged blocked.
49. Digital=false → digital badges/lines suppressed in cover + export metadata.
50. Identical session cloned → identical SessionFingerprint → identical outputs.
51. New engine added (future) → registered; pipeline order unchanged; DAG acyclic.
52. New export format (future) → additive; existing scopes' bytes unchanged.

---

## 33. Compatibility Appendix

### 33.1 PRD (`01_PRD.md`)
- [x] Full workflow Project→Session→Products→Scenes→Prompts→Cover→Export orchestrated (§4–§10; §25 here).
- [x] Validation halts generation; save/version/reset; export scopes (§13/§14/§12; §11/§14/§10 here).

### 33.2 Architecture (`02_ARCHITECTURE.md`)
- [x] Layered engines; fixed pipeline order; registry expandability; deterministic (ARCH §1/§3/§10; §2/§20/§27 here).

### 33.3 Data Model (`03_DATA_MODELS_FINAL.md`)
- [x] Single-writer ownership (DM §20); runtime objects never persisted (DM §3.15/§3.16); fingerprints/hashes drive idempotence (DM §3.5/§3.18; §23/§24/§27 here).

### 33.4 Rule Engine (`04_RULE_ENGINE_REVISED.md`)
- [x] Rule first; pure; precedence ladder; print-area supremacy; blocking halts; domain isolation (RE §1–§8; §6/§16/§17 here).

### 33.5 Scene Engine (`05_SCENE_ENGINE.md`)
- [x] Scene invokes Print-Area+Dedup; feasibility; deterministic scoring/order; A+B pairing (SE §2–§17; §7 here).

### 33.6 Prompt Engine (`06_PROMPT_ENGINE.md`)
- [x] Composes after gate; one prompt=one image; A before B; B needs A+PNG; deterministic checksums (PE §2–§20; §8 here).

### 33.7 UI Engine (`07_UI_ENGINE.md`)
- [x] Lifecycle states mapped; nothing auto-generates; Arabic UI/English prompts; no hidden auto-advance (UI §13/§0; §1/§19/§18 here).

### 33.8 Cover Engine (`08_COVER_ENGINE.md`)
- [x] Cover after barrier; Output A only; layout by count; deterministic primaries; composes prompt only (CE §1–§18; §9 here).

### 33.9 Export Engine (`09_EXPORT_ENGINE.md`)
- [x] Read-only; byte-for-byte prompts; A/B linkage + numbering; deterministic packaging; no silent overwrite/omission (EX §0–§23; §10 here).

---

*End of master orchestration specification. Sourced only from `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`, `08_COVER_ENGINE.md`, and `09_EXPORT_ENGINE.md`. Specification only — no application code, HTML, CSS, React, or TypeScript implementation. Single conductor (Orchestrator); acyclic engine calls; fixed deterministic pipeline order; single-writer data ownership; validation gate is the only path to generation; one prompt = one image; A and B are separate requests; cover uses Output A only; runtime EvaluationContext/Resolved objects are never persisted or exported; no silent overwrite; no silent omission; Arabic UI, English prompt content; every transition deterministic.*
