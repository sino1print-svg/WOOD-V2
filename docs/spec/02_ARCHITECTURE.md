# 02_ARCHITECTURE.md

# Mockup Photoshoot Director — Software Architecture

**Document type:** Architecture Specification (analysis only)
**Source of truth:** `01_PRD.md` v1.0
**Status:** Baseline for engineering
**Scope note:** This document analyzes and structures the requirements in the PRD. It introduces no product features beyond the PRD. Structural, infrastructural, and non-functional concerns (persistence, validation orchestration, versioning) are architectural obligations already implied by PRD sections 8, 13, 14, and 15.

---

## 1. Complete Software Architecture

### 1.1 Architectural style

The system is a **modular, engine-driven, rule-governed content pipeline**. The PRD explicitly frames it as a *director*, not a generator (§1, §2), which dictates a **deterministic orchestration core** surrounded by **replaceable domain engines** and **declarative data libraries** (products, seasons, scenes). Expandability without code restructuring (§6, §15) is a hard architectural constraint, so all domain knowledge lives in **data, not in logic**.

Recommended layering (strict inward dependency — outer layers depend on inner, never the reverse):

```
┌──────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER (UI screens, state views, export UI)      │
├──────────────────────────────────────────────────────────────┤
│  APPLICATION LAYER (workflow orchestrator, session state,     │
│  command handlers, validation gate, export coordinator)       │
├──────────────────────────────────────────────────────────────┤
│  DOMAIN ENGINE LAYER (Rule, Scene, Prompt, Cover, Dedup,      │
│  Print-Area, Validation, Palette engines)                     │
├──────────────────────────────────────────────────────────────┤
│  DATA / LIBRARY LAYER (Product Library, Season→Scene          │
│  Libraries, Palette Library, Rule Sets, Prompt Modules)       │
├──────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER (project store, version history,           │
│  recent projects, artwork/PNG asset store)                    │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Core execution pipeline

The workflow in PRD §3 becomes a **staged, gated pipeline**. Each stage is a pure transformation over the project state with an explicit precondition (validation gate, §14) that can halt execution.

```
Project ─▶ Photoshoot Session ─▶ Product Set ─▶ Scene Assembly
   ─▶ [VALIDATION GATE] ─▶ Prompt Generation (Output A + Output B)
   ─▶ Main Cover Assembly ─▶ Export
```

Key architectural rules derived from the PRD:

- **Output A before Output B (§4):** Output B consumes Output A as a source. Output B can never be generated independently — enforced as a pipeline data dependency, not a UI convention.
- **Cover after all Sale Images (§5):** Cover assembly is a barrier stage; it cannot start until every scene has produced its Output A. Cover reads Sale Images only and must be structurally forbidden from touching Preview images.
- **Validation halts generation (§14):** The validation gate is a blocking node, not advisory. A failed validation stops the pipeline before any prompt is emitted.
- **Determinism over randomness (§2):** No engine may use unseeded randomness. Any variation (pose, angle, composition) is drawn from a **deterministic selection strategy with a de-duplication ledger** (§8), so a given project state always yields the same photoshoot.

### 1.3 Cross-cutting concerns

- **Rule precedence:** Print Area Rules are the highest-priority rule class (§11). The Rule Engine must resolve conflicts with a fixed precedence order (see §8 of this doc) rather than last-writer-wins.
- **Immutability of generated artifacts:** Once generated, Output A / B / Cover prompts are versioned snapshots tied to the project's Version History (§13).
- **Idempotent regeneration:** Re-running generation over an unchanged state produces identical output (supports "minimal editing" success criterion, §15).

---

## 2. Folder Structure

Domain knowledge is data-driven; engines are code. The split below keeps libraries expandable without touching engine code (§6, §15).

```
mockup-photoshoot-director/
├── app/
│   ├── orchestrator/            # workflow pipeline, stage runner, barrier gates
│   ├── state/                   # application state store, reducers, selectors
│   ├── commands/                # save/load/duplicate/reset/export command handlers
│   └── validation-gate/         # pre-generation gate wiring (§14)
│
├── engines/
│   ├── rule-engine/             # §8 conditional rules + precedence resolver
│   ├── scene-engine/            # §9 dynamic scene assembly
│   ├── prompt-engine/           # §10 modular prompt composition
│   ├── cover-engine/            # §5 cover layout + auto-read metadata
│   ├── print-area-engine/       # §11 highest-priority constraints
│   ├── dedup-engine/            # §8 uniqueness ledger (scene/pose/angle/composition)
│   ├── palette-engine/          # color selection + color-lock rules (§8)
│   └── validation-engine/       # §14 validators (pure predicates)
│
├── libraries/                   # DECLARATIVE DATA — no logic
│   ├── products/                # one manifest per product (§6)
│   │   ├── bella-canvas-3001.json
│   │   ├── classic-tshirt.json
│   │   ├── comfort-colors.json
│   │   ├── oversized.json
│   │   ├── hoodie.json
│   │   ├── crewneck.json
│   │   ├── kids.json
│   │   ├── tank.json
│   │   ├── polo.json
│   │   ├── raglan.json
│   │   └── zip-hoodie.json
│   ├── seasons/                 # each season owns an independent scene library (§7)
│   │   ├── halloween/
│   │   │   ├── season.json
│   │   │   └── scenes/*.json
│   │   ├── christmas/
│   │   ├── valentines-day/
│   │   ├── mothers-day/
│   │   ├── fathers-day/
│   │   ├── back-to-school/
│   │   ├── summer/
│   │   ├── fall/
│   │   ├── winter/
│   │   ├── teacher/
│   │   └── minimal-studio/
│   ├── palettes/                # named color sets
│   ├── prompt-modules/          # §10 module templates (global/product/season/scene/A/B/cover/group)
│   └── rule-sets/               # §8 declarative rule definitions
│
├── schemas/                     # JSON Schema definitions (see §5 of this doc)
│
├── persistence/
│   ├── project-store/           # save/load/duplicate (§13)
│   ├── version-history/         # §13 versioning
│   ├── recent-projects/         # §13
│   └── asset-store/             # uploaded PNG artwork (§4 Output B)
│
├── export/                      # §12 formatters: txt / json / zip / clipboard copiers
│
├── ui/
│   ├── screens/                 # screen hierarchy (see §7 of this doc)
│   ├── components/
│   └── view-state/
│
└── shared/
    ├── domain-model/            # entity definitions (see §4 of this doc)
    ├── contracts/               # engine interfaces
    └── errors/                  # validation + pipeline error types
```

---

## 3. Engine List

The PRD names or implies the following engines. Each is a single-responsibility unit with a declared contract.

| # | Engine | PRD source | Responsibility | Key inputs | Key outputs |
|---|--------|-----------|----------------|-----------|-------------|
| 1 | **Rule Engine** | §8 | Evaluate conditional rules, enforce constraints and precedence | Session selections, rule-sets | Allowed/forbidden constraint set |
| 2 | **Scene Engine** | §9 | Assemble a scene dynamically from 11 dimensions | Product, season library, constraints | Resolved Scene entity |
| 3 | **Prompt Engine** | §10 | Compose prompts from 8 modules | Scene, product, season, global rules | Output A/B, Cover, Group prompts |
| 4 | **Print-Area Engine** | §11 | Enforce highest-priority print-area constraints | Scene composition, pose, props | Print-area constraint set / rejection |
| 5 | **Cover Engine** | §5 | Assemble Main Cover, auto-read metadata, pick layout by mockup count | Sale Images (A) + metadata | Cover prompt/layout spec |
| 6 | **Dedup Engine** | §8 | Guarantee no duplicate scene/pose/angle/composition | Selection candidates + ledger | Unique selections |
| 7 | **Palette Engine** | §8 | Resolve color selection and color-lock rules | Selected colors, palette library | Locked color set |
| 8 | **Validation Engine** | §14 | Run pre-generation validators as blocking gate | Full session state | Pass / structured failure |

Supporting (non-engine) orchestration units: **Workflow Orchestrator** (§3), **Export Coordinator** (§12), **Persistence/Version Manager** (§13).

**Engine execution order** within the pipeline:
Rule Engine → Palette Engine → Scene Engine (invokes Print-Area Engine + Dedup Engine per scene) → Validation Engine (gate) → Prompt Engine → Cover Engine.

---

## 4. Data Models

Entities are derived directly from PRD nouns. Relationships reflect the §3 workflow hierarchy.

### 4.1 Entity relationship overview

```
Project (1)
 └─ PhotoshootSession (1..n)
     ├─ Product (1..n)              [from §6 catalog]
     ├─ Season (1)                  [owns Scene Library, §7]
     ├─ ColorSelection (1)          [locked by Palette rules, §8]
     ├─ Scene (1..n)                [assembled, §9; unique, §8]
     │   ├─ OutputA  (BlankSaleImage prompt)   [§4]
     │   └─ OutputB  (PreviewImage prompt, refs OutputA + Artwork) [§4]
     ├─ MainCover (0..1)            [§5, derived from all OutputA]
     └─ Artwork (0..n)              [uploaded PNG, §4]
Project ─ VersionHistory (1..n)     [§13]
```

### 4.2 Core entities

**Project**
- `id`, `name`, `createdAt`, `updatedAt`
- `sessions[]`, `currentVersionId`
- `versionHistory[]` (§13), `isDigitalProduct` flag

**PhotoshootSession**
- `id`, `season` (ref), `audience`, `requestedSceneCount` (§8)
- `products[]`, `colorSelection`, `scenes[]`, `cover`
- `status` (draft | validated | generated | exported)

**Product** (declarative manifest, §6)
- `id`, `name`, `type`, `allowedViews[]`, `printAreaProfile`
- `audienceConstraints` (e.g. Kids → no adult models, §8)
- `defaultColors[]`, `expandable: true`

**Season** (§7)
- `id`, `name`, `sceneLibraryRef` (independent per season)
- `decorConstraints`, `heroSceneConstraints` (e.g. Father's Day exclusions, §8)

**Scene** (assembled, §9)
- `id`, `product` (ref), `location`, `lighting`, `decor`, `props`
- `camera`, `composition`, `pose`, `displayMethod`, `palette`, `season`
- `printAreaRules` (ref), `dedupSignature` (scene+pose+angle+composition, §8)
- `outputA`, `outputB`

**OutputA — BlankSaleImage** (§4)
- `garment`, `color`, `view` — invariants: no artwork, logo, watermark, typography

**OutputB — PreviewImage** (§4)
- `sourceOutputAId` (required ref), `artworkId` (required ref)
- Invariant: identical to Output A except artwork

**MainCover** (§5)
- `sourceSaleImageIds[]` (Output A only), `layout` (auto by mockup count)
- `readMetadata`: { product, colors, mockupCount, views, season, digitalProductStatus }
- Invariant: must never reference any OutputB

**Artwork**
- `id`, `pngAssetRef`, `uploadedAt`

**ColorSelection / Palette** (§8)
- `colors[]`, `locked: boolean` (e.g. White+Black → no other colors)

**ValidationResult** (§14)
- `passed: boolean`, `failures[]` = { field, code, message }

**VersionSnapshot** (§13)
- `versionId`, `timestamp`, `projectState`

---

## 5. Required JSON Schemas

The libraries and persisted state must be schema-validated to keep the "expandable without code restructuring" guarantee enforceable (§6, §15). Below are the schema definitions (structure, not code).

### 5.1 `product.schema.json`
Fields: `id`, `name`, `type`, `allowedViews[]`, `printAreaProfile{ position, minSizeRatio, centered }`, `audienceConstraints{ forbidAdultModels? , kidsOnly? }`, `defaultColors[]`, `metadata`.
Required: `id`, `name`, `printAreaProfile`, `allowedViews`.

### 5.2 `season.schema.json`
Fields: `id`, `name`, `sceneLibraryRef`, `decorConstraints[]`, `heroSceneConstraints[]`, `forbiddenSeasonDecor[]`.
Required: `id`, `name`, `sceneLibraryRef`.

### 5.3 `scene.schema.json` (dimensions from §9)
Fields: `id`, `product`, `location`, `lighting`, `decor`, `props`, `camera`, `composition`, `pose`, `displayMethod`, `palette`, `season`, `printAreaRulesRef`, `dedupSignature`.
Required: all 11 §9 dimensions + `dedupSignature`.

### 5.4 `rule.schema.json` (§8)
Fields: `id`, `priority` (int; print-area class = highest), `condition{ field, operator, value }`, `effect{ type: forbid|require|lock|limit, targets[] }`.
Required: `condition`, `effect`, `priority`.

### 5.5 `palette.schema.json`
Fields: `id`, `name`, `colors[]`, `lockRules[]`.

### 5.6 `prompt-module.schema.json` (§10)
Fields: `moduleType` (enum: global | product | season | scene | outputA | outputB | cover | group), `template`, `variables[]`, `constraintsRef`.

### 5.7 `output.schema.json` (§4)
Two variants under `oneOf`:
- Output A: `forbidden[]` = [artwork, logo, watermark, typography], `garment`, `color`, `view`.
- Output B: `sourceOutputAId` (required), `artworkId` (required), `onlyArtworkChanges: true`.

### 5.8 `cover.schema.json` (§5)
Fields: `sourceSaleImageIds[]`, `layout`, `readMetadata{ product, colors, mockupCount, views, season, digitalProductStatus }`.
Constraint: `sourceSaleImageIds` must reference Output A entities only.

### 5.9 `validation.schema.json` (§14)
Fields: `checks[]` = [season, audience, products, colors, sceneCount, duplicateScenes, printRules, coverData], `result{ passed, failures[] }`.

### 5.10 `project.schema.json` (§13)
Fields: `id`, `name`, `sessions[]`, `versionHistory[]`, `recentProjectsMeta`, `timestamps`.

### 5.11 `export-manifest.schema.json` (§12)
Fields: `scope` (enum: output | group | cover | session | all), `formats[]` (txt | json | zip), `payload`.

---

## 6. Application State Flow

The application is a **deterministic state machine**. The session `status` field drives allowable transitions; the validation gate is the only path from editing to generation.

```
        ┌─────────┐  create/load        ┌──────────────┐
        │  IDLE   │────────────────────▶│   EDITING    │◀──────────┐
        └─────────┘                     │ (draft)      │           │ edit any selection
                                        └──────┬───────┘           │
                                               │ request generate  │
                                               ▼                   │
                                        ┌──────────────┐           │
                                        │  VALIDATING  │           │
                                        │  (§14 gate)  │           │
                                        └──┬────────┬──┘           │
                                    fail   │        │  pass         │
                                           ▼        ▼               │
                                   ┌───────────┐  ┌──────────────┐  │
                                   │  BLOCKED  │──┘│  GENERATING  │  │
                                   │ (halt +   │   │  A then B    │  │
                                   │  reasons) │   └──────┬───────┘  │
                                   └───────────┘          │ all A done
                                        ▲                 ▼
                                        │          ┌──────────────┐
                                        │          │ COVER BUILD  │ (barrier, §5)
                                        │          └──────┬───────┘
                                        │                 ▼
                                        │          ┌──────────────┐
                                        └──────────│   READY      │──▶ EXPORT (§12)
                                          reopen    │ (generated)  │
                                                    └──────────────┘
```

State-flow rules enforced architecturally:

1. **No generation without a passing gate (§14).** `EDITING → GENERATING` is impossible directly; `VALIDATING` sits between them and can route to `BLOCKED`.
2. **Output ordering (§4).** Within `GENERATING`, Output A completes for a scene before its Output B begins.
3. **Cover barrier (§5).** `COVER BUILD` cannot begin until every scene reached Output-A completion.
4. **Immutable snapshots (§13).** Entering `READY` writes a `VersionSnapshot`. Reopening for edits returns to `EDITING` and forks a new working version.
5. **Reset** returns to `IDLE` and clears working state (§13) without deleting saved projects.

Application state store holds: `activeProject`, `activeSession`, `sessionStatus`, `validationResult`, `dedupLedger`, `generationProgress`, `recentProjects[]`, `versionHistory[]`.

---

## 7. UI Screen Hierarchy

Screens mirror the §3 workflow and the feature sections (§12, §13). No screen may bypass the validation gate.

```
Root Shell
├── Project Hub                         (§13)
│   ├── Recent Projects
│   ├── New / Load / Duplicate / Reset
│   └── Version History browser
│
├── Session Builder                     (§3 workflow spine)
│   ├── 1. Session Setup                 (season, audience)
│   ├── 2. Product Selection             (§6 catalog, multi-select)
│   ├── 3. Color / Palette Selection     (§8 color-lock feedback)
│   ├── 4. Scene Configuration           (§9 dimensions, scene count §8)
│   │      └── Per-scene inspector (location/lighting/decor/props/
│   │          camera/composition/pose/display/print-area preview)
│   ├── 5. Validation Review             (§14 — blocking gate UI)
│   │      └── Failure panel (halts generation, lists reasons)
│   ├── 6. Generation Monitor            (§4 Output A → Output B progress)
│   │      ├── Output A (Blank Sale Image) view
│   │      └── Output B (Preview) view — requires PNG upload
│   ├── 7. Main Cover Studio             (§5 auto-layout by mockup count)
│   └── 8. Export Center                 (§12)
│          └── Copy Output / Group / Cover / Session / All · TXT · JSON · ZIP
│
└── Library Manager (admin)             (§6, §7 expandability)
    ├── Product Library
    ├── Season → Scene Libraries
    ├── Palette Library
    └── Rule Sets
```

Navigation constraint: steps 6–8 are locked until step 5 passes. Cover Studio (7) is locked until all Output A exist.

---

## 8. Potential Conflicts

These are architectural conflict points the design must resolve explicitly.

1. **Rule precedence collisions (§8 vs §11).** Print Area Rules are "highest priority" (§11) but other rules (season decor, palette lock, audience) can demand elements that intrude on the print area (props, hands, hair — all forbidden in §11). **Resolution:** a fixed precedence ladder — Print Area (1) > Audience/Safety (2, e.g. Kids §8) > Season constraints (3) > Palette lock (4) > Scene aesthetics (5). Lower-priority effects are dropped, never allowed to override higher ones.

2. **Dedup vs constrained option space (§8).** "Never duplicate scene/pose/angle/composition" can be unsatisfiable when a small season library plus tight rules (e.g. White+Black lock + Kids + 3 scenes) leaves fewer unique combinations than the requested scene count. **Resolution:** the Validation Engine must pre-compute available unique combinations and fail the gate with a specific reason before generation, rather than the Scene Engine deadlocking.

3. **Color lock vs product default colors (§6 vs §8).** A product manifest may declare default colors (§6) that contradict a White+Black lock (§8). **Resolution:** palette lock (§8 user selection) overrides product defaults; product defaults are seed suggestions only.

4. **Output B dependency ordering (§4).** If Output A for a scene is edited/regenerated after Output B exists, Output B becomes stale (it must remain identical except artwork). **Resolution:** editing an Output A invalidates and forces regeneration of its dependent Output B; enforced as a dependency edge, not manual sync.

5. **Cover source purity (§5).** Cover "never uses Preview images" but both A and B are per-scene siblings; naive selection could pull B. **Resolution:** Cover Engine accepts only Output-A-typed references at the type level (schema constraint §5.8), making a Preview reference structurally impossible.

6. **Season decor cross-contamination (§8).** Father's Day forbids Mother's Day decor / mother-child hero scenes, but shared scene assets across libraries could leak. **Resolution:** each season owns an *independent* scene library (§7); shared assets, if any, must pass the season's `forbiddenSeasonDecor` filter.

7. **Determinism vs "variety" expectation (§2 vs §8).** Users may expect visual variety, but randomness is forbidden. **Resolution:** variety comes from deterministic traversal of the option space + dedup ledger, seeded only by project state — reproducible, not random.

---

## 9. Missing Requirements

Gaps in the PRD that engineering must resolve before build. These are noted, not invented — no feature is added; each is a decision the PRD leaves open.

1. **Audience taxonomy undefined.** §14 validates "Audience" and §8 references Kids vs adult models, but the PRD never enumerates the audience values or their rules. Needs an explicit audience vocabulary.
2. **Scene dimension vocabularies (§9).** The 11 scene dimensions (location, lighting, camera, composition, pose, display method, etc.) have no enumerated allowed values. Each needs a controlled vocabulary or library.
3. **Cover layout rules (§5).** "Layout changes automatically based on mockup count" — the count→layout mapping (thresholds, grid arrangements) is unspecified.
4. **Print-area quantification (§11).** "Large, centered, clean, visible" are qualitative. Needs numeric thresholds (min print-area ratio, centering tolerance, max shadow coverage) to be validatable.
5. **Duplicate definition granularity (§8).** "Never duplicate" — is a scene a duplicate if only the pose repeats, or must the full signature match? The dedup signature composition must be specified.
6. **Digital product status semantics (§5).** Cover reads "digital product status" but the PRD never defines what it changes in output or layout.
7. **Validation failure UX / partial recovery (§14).** Behavior on partial failure (fix-and-retry vs full restart) is unspecified.
8. **Artwork/PNG constraints (§4).** No spec for accepted resolution, aspect ratio, transparency, or how artwork maps onto each product's print area.
9. **Group vs Session semantics (§10, §12).** "Group Prompt" and "Copy Group" appear without a definition of what constitutes a group (per-product? per-color? per-view?).
10. **Version History depth/retention (§13).** No limit, pruning, or diff/restore semantics defined.
11. **Concurrency / multi-user.** The PRD is silent on whether projects are single-user local or shared; this affects persistence and locking.
12. **Non-functional targets (§15).** "Minimal editing" and "commercial suitability" are success criteria with no measurable acceptance thresholds.

---

## 10. Scalability Recommendations

Aligned with the PRD's explicit mandate for modularity and expandability (§6, §15).

1. **Data-driven libraries as the primary extension mechanism.** Adding a product (§6) or season (§7) must be a new JSON manifest validated against a schema — zero engine changes. This is the single most important scalability guarantee and is already a hard PRD constraint.

2. **Registry / plugin pattern for engines.** Each engine implements a stable contract and is registered, so new rule types, prompt modules (§10), or display methods (§9) can be added by registration rather than rewiring the pipeline.

3. **Independent season scene libraries scale horizontally (§7).** Because each season owns its library, libraries can grow (or be lazy-loaded) independently; a large Christmas library never bloats Halloween. Load scene libraries on demand by active season.

4. **Rule Engine as declarative rule-set, not hard-coded branches (§8).** Rules live in `rule-sets/` with priority metadata. New constraints (future products, new seasons) are data, keeping the precedence resolver stable.

5. **Deterministic combination indexing for dedup at scale (§8).** As libraries grow, precompute the size of the unique combination space per session so the Validation Engine can answer "can we make N unique scenes?" in constant time instead of runtime backtracking.

6. **Snapshot-based version history with structural sharing (§13).** Store version snapshots as diffs / structural-shared trees rather than full copies to keep history cheap as projects and scene counts grow.

7. **Streaming/staged export (§12).** For "Copy All" / ZIP across large sessions, generate export artifacts in a streamed, staged manner so memory stays bounded as mockup counts increase.

8. **Schema-versioned persistence.** Every persisted artifact (project, library manifest) carries a schema version, enabling forward migration as the model evolves without breaking saved projects — essential for a system explicitly designed to expand indefinitely (§15).

9. **Separation of prompt modules from prompt composition (§10).** Keep the 8 module templates as data so prompt tuning (a frequent, high-churn activity given the "minimal editing" goal, §15) never requires engine redeployment.

---

*End of architecture specification. This document analyzes `01_PRD.md` v1.0 only; all §-references point to that PRD. No implementation, HTML, or component code is included, per scope.*
