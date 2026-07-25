# 05_SCENE_ENGINE.md

# Mockup Photoshoot Director — Scene Engine Specification

**Document type:** Engine Specification (specification only)
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`
**Status:** Authoritative baseline for engineering
**Scope note:** Specification only — no application code, no JavaScript/TypeScript implementation, no algorithms-as-code, no HTML/CSS/React. All entity, enum, and branded-ID names are used exactly as defined in `03_DATA_MODELS_FINAL.md` (DM). Library-item structures are declarative data contracts that extend DM §2.2 `VocabularyTerm`; they describe *data*, not logic. Everything is deterministic: identical `PhotoshootSession` selections + identical libraries + identical rule-set versions always produce an identical photoshoot (§2; RE §1.3).

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `DM` = `03_DATA_MODELS_FINAL.md`. `RE` = `04_RULE_ENGINE_REVISED.md`.

---

## 1. Purpose, Responsibilities, Inputs, Outputs

### 1.1 Purpose

The Scene Engine plans an **entire commercial photoshoot** the way a professional Etsy/print-on-demand photographer would: a coherent set of mockups that are individually conversion-optimized and collectively varied yet unmistakably one session. It is **not** a random scene generator (§1, §2). It optimizes for print-area visibility, Etsy conversion, commercial realism, consistency, and expandability, and **never** for randomness (§2).

### 1.2 Responsibilities

The Scene Engine owns:

- Assembling each `Scene` from the season-owned scene libraries and product manifests under the Rule Engine's resolved constraints (ARCH §3, engine #2; §9).
- Generating the deterministic candidate space and rejecting impossible combinations (§6).
- Scoring and ordering candidates by a fixed formula with deterministic tie-breaks (§7).
- Enforcing uniqueness (`DedupSignature`, §8) and diversity across the session (§8–§9).
- Deterministic garment-color assignment (§14) and view assignment (§15) within Rule Engine limits.
- Preserving the print area by construction and delegating measurement to the Print-Area Engine (§16).
- Creating the mandatory `OutputA` + `OutputB` pair for every scene (§17).
- Planning `Group`s and their numbering (§18).
- Preparing `CoverMetadata` for the Cover Engine — **without** generating the cover (§19).
- Emitting domain events (`SceneCreated`, `SceneUpdated`, `OutputGenerated` planning markers) per DM §3.19.

The Scene Engine does **not**: evaluate rules (Rule Engine), measure pixels (Print-Area Engine), compose prompt text (Prompt Engine), render images, build the cover (Cover Engine), or persist state (Persistence).

### 1.3 Position in the pipeline (ARCH §3 execution order)

```
Rule Engine → Palette Engine → [ SCENE ENGINE (invokes Print-Area + Dedup per scene) ]
            → Validation Engine (gate) → Prompt Engine → Cover Engine
```

The Scene Engine runs after the Rule Engine has produced a `ResolvedConstraintSet` (RE §3) and the Palette Engine has resolved the locked garment-color set, and before the Validation gate (§14) and Prompt Engine.

### 1.4 Inputs

| Input | Type (DM) | Source |
|---|---|---|
| Session selections | `PhotoshootSession` (`season`, `audience`, `productIds`, `colorSelection`, `requestedSceneCount`) | Orchestrator (§3) |
| Resolved constraints | `ResolvedRule[]` / ResolvedConstraintSet | Rule Engine (RE §3) |
| Locked garment colors | `ColorSelection` + derived `garmentColorAllowed` | Palette Engine |
| Season scene library | `ControlledVocabularies` + `SceneLibraryItem`s (§4) scoped by `season.sceneLibraryRef` | Data library (§7) |
| Product manifests | `Product`, `PrintAreaProfile` | Data library (§6) |
| Print-area measurements | `EvaluationContext.printArea.*` | Print-Area Engine (§16) |
| Dedup ledger | `DedupLedger` | Dedup Engine (§8) |
| Artwork references | `Artwork` (for Output B linking) | Asset store (§17) |

### 1.5 Outputs

| Output | Type (DM) | Consumer |
|---|---|---|
| Assembled scenes | `Scene[]` with `dedupSignature`, `sceneHash`, `sceneFingerprint`, `sceneVersion` | Validation, Prompt |
| Output pairs | `OutputA` + `OutputB` per scene (planned, `Pending`) | Prompt, Cover |
| Groups | `Group[]` (§18) | Prompt, Export |
| Cover metadata | `CoverMetadata` (primaries computed) (§19) | Cover Engine |
| Progress | `GenerationProgress` (`totalScenes` set) | Orchestrator, Cover barrier |
| Events | `SceneCreated`, `SceneUpdated` (DM §3.19) | Persistence, observability |

---

## 2. Complete Scene Generation Pipeline

Each stage is a pure, deterministic transformation. A blocking Rule Engine/Validation failure halts the pipeline before Output assignment (§14; RE §13).

```
[0] User selections           PhotoshootSession (season, audience, products, colors, count)
        ↓
[1] Rule filtering            apply ResolvedConstraintSet: Forbid / Lock / Limit / Require (RE §3, §11)
        ↓
[2] Scene candidate generation  build the deterministic candidate space (§6)
        ↓
[3] Candidate scoring          fixed formula, weights, deterministic tie-break (§7)
        ↓
[4] Duplicate elimination      enforce DedupSignature uniqueness + diversity caps (§8)
        ↓
[5] Scene ordering             stable, deterministic session order (§7.4, §9)
        ↓
[6] Output A assignment        create blank Sale Image per scene (§17)
        ↓
[7] Output B assignment        create linked Preview per scene (source A + artwork) (§17)
        ↓
[8] Group generation           form groups + numbering (§18)
        ↓
[9] Cover preparation          compute CoverMetadata + primaries; DO NOT build cover (§19)
```

Stage contracts:

- **[1] Rule filtering** consumes the `ResolvedConstraintSet`; every candidate dimension value must survive all `Forbid`/`Lock`/`Limit` at their winning priority and satisfy `Require` (RE §3). Print Area (priority 1) is absolute.
- **[2]–[4]** operate over the surviving space; **feasibility** is checked first: if the unique combination space `< requestedSceneCount`, halt with `RULE_CNT_001` before any assignment (RE §10.3).
- **[5]** produces `sceneOrder`; **[6]/[7]** create the mandatory output pair; **[8]/[9]** are planning-only.

---

## 3. Scene Library Architecture

Domain knowledge lives in **data**, not logic (§6, §15; ARCH §10.1). Twelve dimension libraries feed the Scene Builder. Each season owns an **independent** scene library (§7; ARCH §7); cross-cutting dimensions (camera, composition, pose) are shared vocabularies filtered per season/audience/product.

| # | Dimension | Backing store (DM) | Scope | Notes |
|---|---|---|---|---|
| 1 | **Locations** | `ControlledVocabularies.locations` (`LocationId`) | season-scoped | studio vs lifestyle backdrops |
| 2 | **Lighting** | `ControlledVocabularies.lightings` (`LightingId`) | season-scoped | soft key, hard, seasonal warmth |
| 3 | **Decor** | `ControlledVocabularies.decors` (`DecorId`) | season-owned | seasonal only; foreign decor excluded (RE §16) |
| 4 | **Props** | `ControlledVocabularies.props` (`PropId`) | season-scoped | must respect print area (§16) |
| 5 | **Camera** | `ControlledVocabularies.cameras` (`CameraTerm` → `CameraAngle`) | shared | angle drives dedup (§8) |
| 6 | **Composition** | `ControlledVocabularies.compositions` (`CompositionId`) | shared | hero/support framing |
| 7 | **Pose** | `ControlledVocabularies.poses` (`PoseId`) | shared, audience-filtered | encodes model archetype (§11) |
| 8 | **Display Method** | `DisplayMethod` enum (DM §2.1) | shared | on_model / flat_lay / hanger / folded / ghost_mannequin / hanging |
| 9 | **Garment View** | `GarmentView` enum (DM §2.1) | product-constrained | front / back / side / flat_detail |
| 10 | **Background** | location + backdrop tags | season-scoped | legibility governed by Print-Area (RE §7) |
| 11 | **Palette** | `Palette` / `ColorSelection` (`ColorId`) | session selection | garment-color domain (RE §6) |
| 12 | **Print Area Profile** | `Product.printAreaProfile` (`PrintAreaProfile`) | product-owned | highest-priority constraint (§11) |

Scene base templates are `SceneTemplateId`-keyed entries in the season library that pre-bundle a coherent starting combination; the Scene Builder resolves the remaining free dimensions around a chosen template (§5).

---

## 4. Library Item Contract

Every library item is a declarative data record extending DM §2.2 `VocabularyTerm`. This contract is a **data-library manifest shape** (not code); it does not alter the persisted `Scene` shape. All fields are required unless marked optional.

**`SceneLibraryItem` (extends `VocabularyTerm`)**

| Field | Type | Meaning |
|---|---|---|
| `id` | `VocabularyId` | inherited; branded identity |
| `kind` | `VocabularyKind` | inherited; dimension class |
| `label` | `string` | inherited; human label |
| `tags` | `readonly string[]` | inherited; mood/feel/style descriptors used for diversity (§8) and scoring (§7) |
| `printAreaSafe` | `boolean` | inherited; may this item appear near the print area (§16) |
| `seasonCompatibility` | `readonly SeasonId[] \| 'all'` | seasons in which the item is allowed (RE §16) |
| `audienceCompatibility` | `readonly Audience[] \| 'all'` | audiences allowed (§8 Kids rules; RE §17.1) |
| `productCompatibility` | `readonly (ProductId \| ProductKind)[] \| 'all'` | products allowed (RE §17.2) |
| `weight` | `number` (0..1) | selection propensity within scoring (§7); higher = more commercially favored |
| `priority` | `number` (int) | hero ranking / tie tier; higher = stronger hero candidate |
| `exclusions` | `readonly VocabularyId[]` | items that must NOT co-occur in the same scene |
| `requiredCompanions` | `readonly VocabularyId[]` | items that MUST co-occur if this item is chosen |

Semantics:

- **`weight`** feeds the scoring formula (§7.2) as a normalized factor; it never introduces randomness — it is a fixed authored constant.
- **`priority`** is used for hero/support classification (§10) and as a deterministic tie tier before the final lexicographic tie-break (§7.4).
- **`exclusions`** are symmetric: if A excludes B, B excludes A. A candidate containing both is **impossible** and rejected (§6).
- **`requiredCompanions`** are directional: choosing A forces B into the scene; if B is forbidden by a rule, the candidate is impossible and rejected (§6).
- Compatibility fields are pre-filters applied before the Rule Engine; the Rule Engine remains the final authority (a compatible item can still be forbidden by a higher-priority rule).

---

## 5. Scene Builder — Assembling One `Scene`

Deterministic assembly of a single `Scene` (DM §3.5). Every step is a pure selection from an already-filtered, lexicographically ordered pool; no randomness.

```
Step S1  Choose base template
   From the active season library, take the SceneTemplateId pool allowed for
   (audience, product) after Rule filtering; order by (priority DESC, weight DESC, id ASC);
   the Candidate Generator (§6) fixes which template this scene uses.

Step S2  Resolve fixed context
   productId (from session productIds slot, §10 distribution),
   seasonId = session.season, paletteColorId (deterministic color, §14), view (§15).

Step S3  Resolve free dimensions
   For each of location, lighting, decor, props, camera, composition, pose, displayMethod:
     pool ← library items whose seasonCompatibility/audienceCompatibility/productCompatibility
            admit this scene AND survive Rule filtering (Forbid/Lock/Limit) AND are printAreaSafe
            where they touch the print area (§16);
     honor exclusions (drop conflicting) and requiredCompanions (pull mandatory);
     the Candidate Generator selects the specific value per §6/§7.

Step S4  Bind print-area profile
   printAreaRulesRef = product.printAreaProfile.id (§16).

Step S5  Compute identity
   cameraAngle ← resolved CameraTerm.angle;
   dedupSignature = (templateId, poseId, cameraAngle, compositionId) + hash (DM §3.5);
   sceneFingerprint = hash of generation-affecting dimensions (DM §3.5);
   sceneHash = hash of all persisted scene fields; sceneVersion = 1.

Step S6  Attach output placeholders
   outputA = blank Sale Image (Pending); outputB = linked Preview placeholder (Pending) (§17).

Step S7  Emit SceneCreated (DM §3.19) with sceneFingerprint.
```

The Scene Builder assembles from exactly the 11 §9 dimensions plus `view`, matching DM §3.5. It never writes prompt text (Prompt Engine) or measures the print area (Print-Area Engine).

---

## 6. Candidate Generator

### 6.1 Candidate space

A **candidate** is a fully specified potential `Scene`: a base template plus one resolved value for each free dimension, a product slot, a color, and a view. The candidate space is the constrained Cartesian product:

```
Space = { (template, location, lighting, decor*, props*, camera, composition, pose, displayMethod, product, color, view) }
   restricted by:
     • Rule Engine Forbid / Lock / Limit / Require   (RE §3, §11)  — highest authority
     • library compatibility (season / audience / product)          (§4)
     • exclusions (no mutually exclusive pair)                       (§4)
     • requiredCompanions (all mandatory companions present)         (§4)
     • printAreaSafe where an item intersects the print area         (§16)
     • product.allowedViews (view legality)                          (§15)
     • garmentColorAllowed (color ∈ locked selection)                (§14; RE §6)
```

`decor*`/`props*` denote possibly-empty sets (Minimal Studio may have none, RE §16).

### 6.2 Deterministic enumeration

Enumeration order is fixed: dimensions are iterated in the order listed in §6.1, and within each dimension the pool is sorted **lexicographically ascending by branded ID**. This yields a stable candidate ordering with zero randomness (RE §10.2). The generator does not shuffle, sample, or time-seed.

### 6.3 Rejecting impossible combinations

A candidate is **impossible** (dropped, with a trace reason) when any of the following holds:

1. Any dimension value was removed by a higher-priority `Forbid`/`Lock` (RE §3) — e.g. adult-model pose in a Kids session (RE §17.1).
2. A `requiredCompanion` is absent or itself forbidden.
3. Any `exclusions` pair co-occurs.
4. An item that intersects the print area is not `printAreaSafe`, or would violate `PrintAreaProfile` (§16).
5. `view ∉ product.allowedViews`, or `color ∉` locked selection.
6. The candidate's `dedupSignature.hash` is already in `DedupLedger.seen` (duplicate, §8).

### 6.4 Feasibility pre-check (blocking)

Before scoring, the generator computes the size of the **unique** combination space over `(sceneTemplateId, poseId, cameraAngle, compositionId)` surviving all constraints. If it is `< requestedSceneCount`, generation halts with blocking `RULE_CNT_001` (RE §10.3) — never a deadlock, never a random fallback.

---

## 7. Candidate Scoring

### 7.1 Principle

Scoring ranks *legal* candidates by commercial quality so the photoshoot reads like a professional plan. Scoring never overrides a rule (all inputs are already legal) and never uses randomness (§2).

### 7.2 Scoring formula

For a candidate `c`, all factors are normalized to `[0,1]`:

```
Score(c) =  0.30 · PrintAreaVisibility(c)
          + 0.25 · ConversionValue(c)
          + 0.20 · CommercialRealism(c)
          + 0.15 · SessionConsistency(c)
          + 0.10 · DiversityContribution(c)
          −  Penalty(c)
```

Factor definitions (all deterministic functions of authored data + measured facts):

| Factor | Definition | Data source |
|---|---|---|
| `PrintAreaVisibility` | normalized print-area size × centering × cleanliness (larger, centered, unobstructed → higher) | Print-Area measurements + `PrintAreaProfile` (§16) |
| `ConversionValue` | mean of the item `weight`s of the candidate's dimensions (commercially favored items score higher) | `SceneLibraryItem.weight` (§4) |
| `CommercialRealism` | tag-coherence: fraction of the candidate's items sharing the season's mood tags (§13) | `tags` (§4, §13) |
| `SessionConsistency` | closeness to the session mood anchor (palette + product + season mood) | session selections + mood anchor (§9) |
| `DiversityContribution` | how much new coverage the candidate adds across under-used dimensions (§9) | diversity coverage state (§9) |
| `Penalty` | additive penalty for soft-repeated dimensions already used (pose family, camera, background, decor, mood) beyond their soft cap (§8) | diversity ledger (§8) |

The five positive weights sum to 1.0. Weights are fixed constants of the Scene Engine specification and are identical across every run (determinism).

### 7.3 Weighting rationale

Print-area visibility carries the largest weight because it is the PRD's highest-priority quality goal (§11) even though the *hard* print-area constraint is enforced upstream by priority-1 rules; scoring optimizes *degree* of visibility among already-legal candidates. Conversion and realism follow (§2 Etsy conversion, commercial realism). Consistency and diversity balance "one photoshoot" against "visually different" (§9).

### 7.4 Tie-breaking and deterministic ordering

Candidates are ordered by:

```
1. Score(c) DESC
2. max item priority in c DESC              (hero tier, §4)
3. dedupSignature.hash ASC (lexicographic)  (final, always unique)
```

Because `dedupSignature.hash` is unique per candidate, the ordering is **total and deterministic** — there is never a random tie-break. Selection takes candidates from the top of this order, subject to duplicate/diversity elimination (§8).

---

## 8. Duplicate Prevention

### 8.1 Hard uniqueness (PRD §8)

No two scenes may repeat the tuple `(sceneTemplateId, poseId, cameraAngle, compositionId)` — the `DedupSignature` (DM §3.5). The Dedup Engine hashes it; the Scene Engine reads the derived boolean `scene.isDuplicate` and rejects any candidate whose hash is in `DedupLedger.seen` (RE §18). This is a **blocking** uniqueness guarantee (`RULE_DUP_001`).

### 8.2 Soft diversity signature

Beyond the hard tuple, the PRD requires never repeating pose, camera, composition, background, decor, product, scene mood, and overall feel (§8, task §8). These are tracked as a **DiversitySignature** (a Scene Engine planning construct, not persisted):

| Diversity axis | Derived from |
|---|---|
| pose family | `PoseId` tag group |
| camera | `CameraAngle` (+ distance) |
| composition | `CompositionId` |
| background | location + backdrop tags |
| decor | `DecorId` set |
| product | `ProductId` |
| scene mood | dominant mood tag of the scene's items |
| overall feel | ordered tuple of (lighting mood, palette tone, composition style) |

### 8.3 Soft caps and penalties

Each diversity axis has a **soft cap** proportional to `requestedSceneCount` (e.g. no single pose family may exceed `ceil(count / distinctPoseFamilies)` uses). Exceeding a soft cap adds `Penalty(c)` (§7.2), pushing repeats down the deterministic order rather than forbidding them outright — so a large session still fills even when a dimension pool is small, while visibly minimizing repetition. Caps are computed with `NumericExpression`-style deterministic arithmetic on `requestedSceneCount` (DM §3.12); no randomness.

### 8.4 Guarantee

Hard uniqueness is absolute (§8.1). Soft diversity is maximized deterministically: for a given session and libraries, the exact set and order of scenes — and therefore the exact repetition profile — is reproducible.

---

## 9. Scene Diversity (staying "one photoshoot")

### 9.1 The tension

A session of 20+ scenes must look **varied** (different poses, angles, backgrounds) yet **cohesive** (same brand, season, palette, product family). Diversity comes from deterministic traversal of the option space, not randomness (§2; RE §7 conflict #22).

### 9.2 Mood anchor (cohesion)

At session start the Scene Engine fixes a **mood anchor**: the season's main mood (§13), the locked palette (§14), the product set, and the dominant lighting family. Every scene's `SessionConsistency` factor (§7.2) measures closeness to this anchor. The anchor is constant for the whole session, guaranteeing cohesion.

### 9.3 Coverage rotation (variety)

Variety is produced by a **coverage matrix** over the diversity axes (§8.2). The Scene Engine walks the lexicographically ordered pools in a deterministic round-robin, preferring under-used axis values (higher `DiversityContribution`, §7.2). This spreads scenes across locations, lighting, camera angles, poses, and display methods while the mood anchor holds the palette/product/season constant.

### 9.4 Result

Twenty scenes differ on the rotated axes (pose, camera, background, composition, display) yet share the anchored axes (palette, product, season mood) — the signature of a single professional photoshoot. The whole matrix is reproducible: same inputs → same coverage → same scenes.

---

## 10. Photoshoot Sessions (sizes and consistency)

### 10.1 Hero / support composition

A session is composed of **hero** scenes (high-`priority` templates, front-view, maximal print-area emphasis — primary Etsy listing images) and **support** scenes (secondary angles, alternate colors/views, lifestyle/detail). The ratio is fixed per size for reproducibility.

| Session size | Hero scenes | Support scenes | Distinct views used | Distinct display methods | Notes |
|---|---|---|---|---|---|
| 4 | 2 | 2 | front (+1 back/detail) | 2 | minimal listing set |
| 8 | 3 | 5 | front, back, detail | 3 | standard listing |
| 12 | 4 | 8 | front, back, side, detail | 3–4 | rich listing |
| 20 | 6 | 14 | all product-allowed | 4+ | full photoshoot |
| 40 | 10 | 30 | all + color variants | 5 | multi-color catalog |
| 50 | 12 | 38 | all + color + display variants | 5–6 | large catalog |

Hero/support counts scale deterministically with `requestedSceneCount` (documented ratios ≈ hero = round(count × 0.3)). These are planning ratios, not new user features — they realize §8's "generate exactly N" with professional structure.

### 10.2 Preserving consistency at scale

Regardless of size, consistency is preserved by: (1) a single season library (§7), (2) the constant mood anchor (§9.2), (3) the locked palette (§14), (4) the fixed product set, and (5) the same `PrintAreaProfile` per product (§16). Larger sessions add *coverage*, not *drift*: new scenes rotate the diversity axes but never leave the anchor. Feasibility (§6.4) guarantees the requested size is achievable before assignment.

---

## 11. Model Selection

### 11.1 Model archetypes as data

Model archetypes are **pose/scene-template tags with `audienceCompatibility`** (§4), not new enums — this keeps the catalog expandable (§20). Display-only methods map to the `DisplayMethod` enum (DM §2.1). The Rule Engine's audience matrix (RE §17.1) is the final authority (Kids ⇒ no adult models, §8).

### 11.2 Rules per model type

| Model archetype | Represented as | Allowed audiences | Forbidden when | Rule authority |
|---|---|---|---|---|
| Adult | pose tag `model:adult` | adult, unisex, teen(≥teen) | audience = Kids (RE §17.1) | `RULE_AUD_001` |
| Child | pose tag `model:child` | kids, all | adult/teen/unisex audiences (§2 coherence) | `RULE_AUD_004` |
| Teen | pose tag `model:teen` | teen, adult, unisex | audience = Kids | `RULE_AUD_001` |
| Male | pose tag `model:male` | per audience | — | audience/product compat |
| Female | pose tag `model:female` | per audience | — | audience/product compat |
| Couple | hero template `hero:couple` | adult, unisex | Kids | season hero rules (§13) |
| Family | hero template `hero:family` | all, adult | conflicts with single-hero seasons | season hero rules |
| Father + Son | hero template `hero:father_son` | Father's Day, all | Mother's Day / Mother-Child seasons (RE §16) | `RULE_SEA_002` symmetric |
| Mother + Daughter | hero template `hero:mother_daughter` | Mother's Day, all | Father's Day (RE §16) | `RULE_SEA_001/002` |
| Brother + Sister | hero template `hero:siblings` | kids, all | audience mismatch | audience compat |
| Teacher | hero template `hero:teacher` | Teacher/Back-to-School seasons | other seasons | season compat (§13) |
| Student | hero template `hero:student` | Back-to-School/Teacher | other seasons | season compat |
| No model | `DisplayMethod.FlatLay`/`Folded` | all | — | always legal |
| Hanger | `DisplayMethod.Hanger` | all | — | always legal |
| Flat lay | `DisplayMethod.FlatLay` | all | — | always legal |
| Folded | `DisplayMethod.Folded` | all | — | always legal |
| Ghost mannequin | `DisplayMethod.GhostMannequin` | all | — | always legal |

No-model display methods are universally legal and are the safe fallback that always fills a session even when model archetypes are constrained (e.g. tightly restricted Kids sessions).

---

## 12. Display Method Engine

### 12.1 Mapping to the model

The task's display terms map onto DM enums without inventing new values:

| Display term | DM representation |
|---|---|
| On model | `DisplayMethod.OnModel` |
| Front | `GarmentView.Front` (a view, not a display method) |
| Back | `GarmentView.Back` |
| Folded | `DisplayMethod.Folded` |
| Flat Lay | `DisplayMethod.FlatLay` |
| Hanger | `DisplayMethod.Hanger` |
| Ghost mannequin | `DisplayMethod.GhostMannequin` |
| Hanging | `DisplayMethod.Hanging` |
| Close up | camera distance `close` + tight `CompositionId` |
| Lifestyle | location category `lifestyle` |
| Studio | location category `studio` |

### 12.2 Definitions and usage

| Method / modifier | Definition | Typical use | Print-area behavior |
|---|---|---|---|
| On model | garment worn by a model | hero scenes, lifestyle | pose must keep hands/hair off print area (§16) |
| Flat lay | garment laid flat, top-down | no-model hero/support, detail | top-down camera; maximal, unobstructed print area |
| Folded | garment folded, styled stack | support, catalog | print area partial; used for variety, not hero |
| Hanger | garment on a hanger | support, quick catalog | print area centered, clean |
| Ghost mannequin | invisible-mannequin 3D form | premium support | full-front print area, no obstruction |
| Hanging | garment hung against backdrop | lifestyle support | print area centered |
| Close up | tight crop on print area | detail/hero support | print area dominant (largest visibility) |
| Lifestyle (location) | contextual, styled environment | conversion/mood | props must not intrude (§16) |
| Studio (location) | clean seamless backdrop | hero, Minimal Studio | cleanest print-area conditions |

Front/Back are **views** (§15), orthogonal to display method: e.g. an on-model front hero and a flat-lay back support are distinct scenes.

---

## 13. Season Scene Libraries

Each season owns an independent library (§7). The following per-season profiles are consistent with the Season Compatibility Matrix (RE §16). Props/decor here are library `tags`/`DecorId`s; "forbidden" items are excluded by season scoping and enforced by season-priority rules (`RULE_SEA_*`).

| Season | Main mood | Allowed props | Forbidden props | Typical lighting | Typical colors | Hero scenes | Support scenes |
|---|---|---|---|---|---|---|---|
| **Halloween** | playful-spooky | pumpkins, cobwebs, candles, autumn leaves | Christmas/Valentine/Mother's/Father's decor | warm-low, moody | black, orange, purple | spooky flat-lay hero, on-model costume-adjacent | hanger, folded, detail |
| **Christmas** | festive-warm | tree, lights, ornaments, gift wrap, pine | Halloween/Valentine decor | warm string-light glow | red, green, white, gold | family on-model, festive flat-lay | hanger, ghost mannequin, detail |
| **Valentine's Day** | romantic-soft | hearts, roses, ribbons, candles | Halloween/Christmas decor | soft pink key | red, pink, white | couple/romantic hero, heart flat-lay | folded, detail |
| **Mother's Day** | warm-loving | flowers, pastel florals, cards | Father's Day decor, mother-forbidden foreign | soft daylight | pastels, blush, sage | mother/daughter hero (RE §16) | flat-lay, hanger |
| **Father's Day** | rugged-warm | ties, tools, wood textures, cards | Mother's Day decor, mother/child hero (RE §16) | warm directional | navy, charcoal, tan | father/son hero (RE §16) | flat-lay, ghost mannequin |
| **Back to School** | fresh-bright | books, pencils, backpacks, chalkboard | seasonal-holiday decor | bright even daylight | primary brights, navy | student/teacher hero, desk flat-lay | hanger, folded |
| **Summer** | bright-airy | sunglasses, towels, greenery, sand | winter/holiday decor | high-key sunlight | brights, aqua, coral, white | lifestyle on-model, beach flat-lay | hanger, detail |
| **Fall** | cozy-earthy | leaves, mugs, knit textures, wood | summer/holiday decor | warm muted (muted Halloween allowed, RE §16) | rust, mustard, brown, olive | cozy on-model, autumn flat-lay | folded, hanger |
| **Winter** | crisp-cozy | snow, pine, knit blankets, lights | summer decor | cool soft + warm accents | white, ice blue, navy, silver | cozy on-model, winter flat-lay | ghost mannequin, detail |
| **Teacher** | friendly-academic | apples, chalkboard, books, supplies | seasonal-holiday decor | bright even | primary brights, red, navy | teacher hero, classroom flat-lay | hanger, folded |
| **Minimal Studio** | clean-neutral | none (no seasonal decor, RE §16) | ALL seasonal decor (`RULE_SEA_004`) | soft even studio key | neutral greys, white, black | centered studio flat-lay, ghost mannequin | hanger, close-up detail |

Hero vs support classification uses `SceneLibraryItem.priority` (§4). Minimal Studio is the deterministic fallback aesthetic and always yields clean print-area conditions.

---

## 14. Color Assignment

### 14.1 Deterministic allocation

Garment colors are drawn only from `session.colorSelection.colorIds`. When `colorSelection.locked` is true, the Palette Engine has closed the garment-color domain to exactly those IDs (RE §6); the Scene Engine may use no other color (`RULE_PAL_001/002`). No extra colors are ever introduced (§8).

### 14.2 Allocation rule

Colors are assigned across scenes by **deterministic round-robin over the selected `ColorId`s sorted lexicographically ascending**, walking scenes in `sceneOrder`:

```
scene[i].paletteColorId = sortedSelectedColors[ i mod |selectedColors| ]
```

This distributes colors evenly and reproducibly, with no randomness. Hero scenes receive the deterministic `primaryColor` (the mode, §19) first, so the most important listing images carry the flagship color. `garmentColorAllowed` (DM §3.15) must be true for every assignment; otherwise the candidate is rejected (§6).

### 14.3 Single-color and locked cases

A single-color selection assigns that color to all scenes. A White+Black lock alternates White/Black deterministically. Sand+Navy locks to exactly Sand/Navy (RE §6, corrected). Decor/background palettes are a **different domain** (RE §6) and never count as garment colors — a red seasonal prop does not violate a White+Black garment lock.

---

## 15. View Assignment

### 15.1 Legal views

A scene's `view` must be within `product.allowedViews` (`GarmentView`; RE §17.2 P-3). The mapping of the task's view terms: Front/Back/Side = `GarmentView.Front/Back/Side`; Close = camera distance modifier (§12), not a `GarmentView`; Flat/Folded = `DisplayMethod.FlatLay/Folded` combined with `GarmentView.FlatDetail`.

### 15.2 Assignment rules (deterministic)

| Rule | Statement |
|---|---|
| V-1 | Hero scenes default to `Front` (maximal print-area visibility, §11). |
| V-2 | `Back` is assigned only when the product allows it and the session needs view variety (support scenes), never displacing a front hero. |
| V-3 | `Side` is used only for products whose `allowedViews` include it (e.g. Raglan) and only as support. |
| V-4 | `FlatDetail` (close/flat) is used for detail/no-model support scenes. |
| V-5 | View distribution follows the size table (§10.1): front dominates; back/side/detail fill support slots in deterministic order. |
| V-6 | A view is never assigned outside `allowedViews`; violation → `RULE_PRD_003`. |

View assignment is computed after ordering (§7.4) by walking `sceneOrder` and filling the size table's view quota in lexicographic dimension order — reproducible, no randomness.

---

## 16. Print Area Preservation

### 16.1 Scene Engine responsibilities

The print area is the highest-priority quality target (§11). By construction the Scene Engine:

1. Excludes any item that intersects the print area unless `printAreaSafe` (§4).
2. Never selects poses/props/compositions that place hands, hair, props, deep folds, or shadows over the print area (`PrintAreaObstruction`, DM §3.3; §11).
3. Prefers compositions/camera distances that make the print area **large, centered, clean, visible** (§11) via the `PrintAreaVisibility` scoring factor (§7.2).
4. Binds each scene to its product's `PrintAreaProfile` (§5 Step S4).

### 16.2 Interaction with the Print-Area Engine

Separation of concerns (RE §7 three-layer split):

```
Scene Engine       proposes a candidate scene (dimensions chosen to protect the print area)
      ↓
Print-Area Engine  MEASURES the rendered/planned composition → printArea.overlaps,
                   sizeRatio, centeringOffset, shadowCoverage (EvaluationContext, DM §3.15)
      ↓
Validation Engine  JUDGES measurements against PrintAreaProfile via predicates
                   PA-PRED-1 (size), PA-PRED-2 (centering), PA-PRED-3 (shadow)  (RE §7)
      ↓
Rule Engine        categorical obstruction rules (overlaps includes hands …) at priority 1
```

If a candidate fails a print-area predicate or a priority-1 obstruction rule, it is **rejected** and the Scene Engine advances to the next candidate in deterministic order (never a random substitution). The Scene Engine never measures pixels itself and never overrides a priority-1 print-area verdict.

---

## 17. Output Pair Planning

### 17.1 Mandatory pair

Every assembled `Scene` **always** creates two outputs (§4; DM §3.5) — this is invariant:

- **`OutputA` — Blank Sale Image:** blank garment, no artwork/logo/watermark/typography (`forbidden`, DM §3.6). Created `Pending`.
- **`OutputB` — Matching Preview:** derived from `OutputA` (`sourceOutputAId`, required) plus the uploaded PNG `artworkId` (required); differs from A only by artwork (`onlyArtworkChanges`, DM §3.7). Created `Pending`.

One Scene → one Output A → one linked Output B, **forever**. The Scene Engine plans this pairing; the Prompt Engine later composes the prompts and generation follows the A-before-B ordering (§4; RE §8).

### 17.2 Linkage and lifecycle

- `OutputB.sourceOutputAId` pins its Output A permanently; `OutputB.sourceHash` pins the source content hash (DM §3.7). If Output A changes (`sceneFingerprint` change, §3.5), Output B becomes `Stale` and must regenerate (RE §18).
- Output B stays `Pending` until both its Output A is `Generated` and an artwork is uploaded (§4 ordering). Missing artwork → `RULE_PRV_001`; missing source → `RULE_PRV_002`.
- IDs (`OutputAId`, `OutputBId`) are assigned deterministically in `sceneOrder`.

### 17.3 Determinism

Because the pair is created for every scene in a fixed order, the number and identity of outputs is a pure function of the session — `GenerationProgress.totalScenes` equals the scene count, and `allOutputAReady` gates the cover (RE §8).

---

## 18. Group Planning

### 18.1 Group formation

Groups (`Group`, DM §3.10) partition the session's scenes by exactly one `GroupBy` dimension — `product`, `color`, or `view` (RE §9; [R9]). All members of a group share the same value on that dimension. Group formation is deterministic: groups are created in lexicographic order of the group `key`, and members are listed in `sceneOrder`.

### 18.2 Numbering scheme

| Element | Scheme | Example |
|---|---|---|
| Group number | 1-based index over groups ordered by `key` | Group 1, Group 2 … |
| Scene number | 1-based index within a group, following `sceneOrder` | 1.1, 1.2 … |
| Output numbering | scene number + output kind suffix | `1.2-A`, `1.2-B` |
| A/B numbering | `-A` = Sale Image, `-B` = Preview; always paired | every scene has both |

Numbering is stable: it depends only on `groupBy`, `key` order, and `sceneOrder`, so re-running yields identical labels.

### 18.3 Copy behavior (§12 export mapping)

| Action | Scope (DM `ExportScope`) | Behavior |
|---|---|---|
| Copy Output | `Output` | copies one scene's A and B prompts |
| Copy Group | `Group` | copies all A/B prompts of one group, in scene-number order, plus the Group Prompt (§10 PRD) |
| Copy Cover | `Cover` | copies the cover prompt (Cover Engine output) |
| Copy Session | `Session` | copies every group in group order |
| Copy All | `All` | copies session + cover, deterministically ordered |

The Scene Engine plans the group structure and Group Prompt slots (`groupPromptText`, `groupPromptMeta`, DM §3.10); the Prompt Engine fills the text and the Export Coordinator performs the copy (§12). Export scope/format governance is the `Export` rule domain (DM §2.1).

---

## 19. Main Cover Planning

### 19.1 Prepare, never generate

The Scene Engine **prepares** the metadata the Cover Engine needs and **never builds the cover** (§5; ARCH §3). It populates `CoverMetadata` (DM §3.9):

| Field | Source |
|---|---|
| `productIds` | session `productIds` present in Sale Images |
| `colors` | distinct garment colors used |
| `mockupCount` | number of Sale Images (Output A) |
| `views` | distinct views used |
| `seasonId` | session season |
| `digitalProductStatus` | `Project.isDigitalProduct` ([R6]) |
| `primaryProduct` | deterministic mode of products (tie → smallest `ProductId`) |
| `primaryColor` | deterministic mode of garment colors (tie → smallest `ColorId`) |
| `primaryView` | deterministic mode of views (tie → smallest enum value) |
| `primaryAudience` | session `audience` |

### 19.2 Barrier and purity

The cover uses Sale Images (Output A) **only**, never Previews (Output B) (§5; DM §3.9 type-level guarantee). The cover may be built only after **all** Output A exist — `generationProgress.allOutputAReady === true` (RE §8). The Scene Engine sets `totalScenes` so the barrier can be evaluated; it does not itself gate — the Cover Engine and Validation enforce the barrier (`RULE_COV_002`). Cover layout is chosen by the Cover Engine from `mockupCount` per the [R3] mapping; the Scene Engine only supplies the metadata.

---

## 20. Future Extension

The Scene Engine is **data-driven**; its code never changes to add content (§6, §15; ARCH §10.1).

| To add… | Mechanism | Scene Engine change |
|---|---|---|
| **New season** | add a season folder with `Season` manifest + independent scene library (`SceneLibraryItem`s) validated against the schema (§4; ARCH §2) | none — season is loaded by ID |
| **New product** | add a `Product` manifest with `allowedViews` + `PrintAreaProfile`; tag library items with its `ProductId`/`ProductKind` in `productCompatibility` | none — product resolved by ID |
| **New pose / model archetype** | add a `PoseId` `VocabularyTerm` with `tags`, `audienceCompatibility`, `exclusions`, `requiredCompanions` | none — entered into the shared pose pool |
| **New library (any dimension)** | add vocabulary terms conforming to `SceneLibraryItem` (§4) | none — read via `ControlledVocabularies` |
| **New display method** | extend `DisplayMethod` (DM enum) — the only case needing a data-model amendment, handled via schema migration (DM §16) | additive enum only |

The registry/plugin pattern (ARCH §10.2) means new rule domains, prompt modules, and display methods register as data. The Scene Engine reads libraries by ID, filters by the §4 compatibility contract, and applies Rule Engine constraints — so the entire content universe expands without touching engine logic, satisfying the PRD's expandability mandate (§6, §15).

---

## 21. Determinism and Consistency Guarantees

- **Determinism.** Every stage (§2) is a pure function of session selections + libraries + rule-set versions. Ordering is lexicographic on branded IDs; scoring weights are fixed constants; tie-breaks end on the unique `dedupSignature.hash`. No `Math.random`, no sampling, no time seeding (§2; RE §1.3). Re-running an unchanged `SessionFingerprint` (DM §3.18) reproduces the identical photoshoot, scene-for-scene.
- **One photoshoot.** The mood anchor (§9.2) and locked palette (§14) hold cohesion; coverage rotation (§9.3) provides variety.
- **Print Area supremacy.** Priority-1 print-area rules and predicates are never overridden by the Scene Engine (§16; RE §2).
- **Mandatory pairing.** One Scene always yields Output A and Output B, linked forever (§17).
- **Blocking halts.** A blocking rule/validation failure stops the pipeline before Output assignment (§14; RE §13); warnings never mutate selections.

## 22. Compatibility Appendix

### 22.1 PRD compatibility (`01_PRD.md`)
- [x] Builds a complete photoshoot from selections (§3 workflow); not a random generator (§1, §2).
- [x] Every scene produces Output A (blank) + Output B (preview from A + artwork) (§4; §17).
- [x] Season-owned libraries (§7); rule constraints honored (§8); print-area highest priority (§11; §16).
- [x] Cover metadata prepared from Sale Images only; cover not generated here (§5; §19).
- [x] Exactly N scenes; no duplicates of scene/pose/camera/composition (§8; §6.4, §8).

### 22.2 Architecture compatibility (`02_ARCHITECTURE.md`)
- [x] Runs at the Scene stage; invokes Print-Area + Dedup; precedes Validation gate, Prompt, Cover (ARCH §3).
- [x] Data-driven libraries; expandable without code change (ARCH §10.1–10.2; §20).
- [x] Deterministic pipeline; runtime constructs (candidate space, diversity signature) non-persisted (ARCH §1.2).

### 22.3 Data-model compatibility (`03_DATA_MODELS_FINAL.md`)
- [x] Uses `Scene` with all 11 §9 dimensions + `view`, `dedupSignature`, `sceneHash/Fingerprint/Version` (DM §3.5).
- [x] `OutputA`/`OutputB` pairing + hashes; `CoverMetadata` primaries; `Group` + numbering; `GenerationProgress.allOutputAReady` (DM §3.6–3.10).
- [x] Library items extend `VocabularyTerm`; `DisplayMethod`, `GarmentView`, `CameraAngle`, `Audience`, `SceneDimension` used exactly (DM §2.1–2.2).
- [x] `SceneCreated`/`SceneUpdated` events emitted (DM §3.19).

### 22.4 Rule-Engine compatibility (`04_RULE_ENGINE_REVISED.md`)
- [x] Consumes `ResolvedConstraintSet`; respects Forbid/Lock/Limit/Require and the fixed precedence ladder (RE §2–§3, §11).
- [x] Audience matrix (RE §17.1), season matrix (RE §16), palette lock domain (RE §6), dedup via `scene.isDuplicate` (RE §18).
- [x] Print-area three-layer split honored: propose (Scene) → measure (Print-Area) → judge (Validation predicates) (RE §7; §16).
- [x] Feasibility pre-check blocks with `RULE_CNT_001`; blocking failures halt (RE §10.3, §13).

---

*End of Scene Engine specification. Sourced only from `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, and `04_RULE_ENGINE_REVISED.md`. Specification, matrices, and declarative data contracts only — no application code, algorithms-as-code, TypeScript/JavaScript implementation, HTML, CSS, or React. Fully deterministic; one Scene always creates Output A and Output B.*
