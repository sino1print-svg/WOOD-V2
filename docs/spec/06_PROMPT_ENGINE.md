# 06_PROMPT_ENGINE.md

# Mockup Photoshoot Director — Prompt Engine Specification

**Document type:** Engine Specification (specification only)
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`
**Status:** Authoritative baseline for engineering
**Scope note:** Specification only — no application code, no JavaScript/TypeScript implementation, no algorithms-as-code, no HTML/CSS/React. Entity, enum, and branded-ID names are those of `03_DATA_MODELS_FINAL.md` (DM). Prompt *templates* below are natural-language execution instructions (data/content), not code. Everything is deterministic: identical `SessionFingerprint` + `Scene.sceneFingerprint` + rule-set versions + prompt-module versions produce identical prompt text and identical checksum (§20).

**Prime directive:** **One prompt = one image.** A single image-generation request must always correspond to exactly one image output. Output A and Output B are **always separate execution requests**. Output B is **image-edit/reference mode only** and requires **both** the matching Output A image **and** the uploaded PNG artwork.

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `DM` = `03_DATA_MODELS_FINAL.md`. `RE` = `04_RULE_ENGINE_REVISED.md`. `SE` = `05_SCENE_ENGINE.md`.

---

## 1. Purpose and Responsibilities

### 1.1 Purpose

The Prompt Engine composes **execution-ready prompts** for a professional Etsy mockup photoshoot from already-assembled scenes (SE §17) and resolved constraints (RE §3). It is the modular prompt composer named in ARCH §3 (engine #3) and §10. It produces one prompt per image, never a multi-image request.

### 1.2 Inputs

| Input | Type (DM) | Source |
|---|---|---|
| Assembled scenes | `Scene[]` (+ `sceneFingerprint`, `dedupSignature`) | Scene Engine (SE §5) |
| Output pair placeholders | `OutputA`, `OutputB` (`Pending`) | Scene Engine (SE §17) |
| Resolved constraints | `ResolvedRule[]` / ResolvedConstraintSet | Rule Engine (RE §3) |
| Product manifests | `Product`, `PrintAreaProfile` | Data library |
| Season profile | `Season` + season library | Data library (SE §13) |
| Session selections | `PhotoshootSession` (audience, colors, season, products) | Orchestrator |
| Prompt modules | `PromptModule` (`PromptModuleType`, `template`, `variables`) | Data library (§2) |
| Cover metadata | `CoverMetadata` (primaries) | Cover Engine handoff (SE §19) |
| Artwork | `Artwork` (uploaded PNG) | Asset store |

### 1.3 Outputs

| Output | Type (DM) | Consumer |
|---|---|---|
| Output A prompt | `OutputA.promptText` + `promptHash` + `promptMeta` | image-generation request (one image) |
| Output B prompt | `OutputB.promptText` + `promptHash` + `promptMeta` | image-edit request (one image) |
| Cover prompt | `MainCover.promptText` + `promptHash` + `promptMeta` | image-generation request (one image) |
| Group prompt (plan) | `Group.groupPromptText` + `groupPromptMeta` | execution plan (text, not an image request) |
| Prompt metadata | `PromptMetadata` (checksums, versions) | reproducibility, Export |

### 1.4 Boundaries (what the Prompt Engine does NOT do)

- Does not assemble scenes (Scene Engine), evaluate rules (Rule Engine), measure the print area (Print-Area Engine), or build the cover layout (Cover Engine).
- Does not render images or call an image model — it emits prompt text only.
- Does not persist state (Persistence) or invent content (no artwork invention, no readable scene text).

### 1.5 Engine ownership

Per DM §20, the Prompt Engine is the **Owner** of: `OutputA/B.promptText`, `*.promptHash`, all `PromptMetadata`, `Group.groupPromptText`/`groupPromptMeta`, and `MainCover.promptText`. It is a **Reader** of scenes, products, seasons, cover metadata, and resolved constraints. `renderHash` is owned by the Render step, not here.

---

## 2. Prompt Architecture

### 2.1 Module types (exact, DM `PromptModuleType`)

| Module | `PromptModuleType` | Responsibility |
|---|---|---|
| **Global** | `global` | universal commercial-realism + safety constraints (one image, no collage, no readable text, print-area supremacy) |
| **Product** | `product` | garment identity, silhouette, print zone (§10) |
| **Season** | `season` | mood, lighting, palette, decor placement away from print area (§12) |
| **Scene** | `scene` | location, camera, composition, pose, display method, view (§13) |
| **Output A** | `output_a` | single blank Sale Image directive (§4) |
| **Output B** | `output_b` | image-edit directive: source A + PNG only (§5) |
| **Cover** | `cover` | cover composition from Sale Images A only (§18) |
| **Group** | `group` | multi-prompt execution plan, not one image (§16) |

### 2.2 Module composition order

For a **Sale Image (Output A)** prompt, modules are concatenated in this fixed order:

```
Global  →  Product  →  Season  →  Scene  →  Output A
```

For a **Preview (Output B)** prompt:

```
Global  →  Product  →  Season  →  Scene  →  Output B
```

Cover and Group are **separate artifact types** (not per-scene image prompts): Cover = `Global → Cover`; Group = `Global → Group` (a plan). Composition order is fixed and deterministic; no reordering, no random insertion.

### 2.3 Constraint precedence within a prompt

When module wordings could conflict, precedence follows the Rule Engine ladder (RE §2), **Print Area highest**:

```
Print-Area/Global constraints (1)  >  Audience/Safety (2)  >  Season (3)  >  Palette (4)  >  Scene aesthetics (5)
```

A lower-precedence module may never soften a higher one: e.g. a Season module may not request decor over the print area (Print-Area, priority 1 wins). The Prompt Engine emits the higher-precedence clause verbatim and drops any conflicting lower clause (mirrors RE §3 drop-not-override).

### 2.4 Variable resolution (deterministic)

Template variables (e.g. `{{product.name}}`, `{{scene.view}}`, `{{garment.color}}`) resolve from the assembled `Scene`, `Product` manifest, `Season` profile, and `PhotoshootSession` — all fixed by `Scene.sceneFingerprint`. Resolution is a pure substitution; **no synonyms, no variable wording, no randomness** (§20). An unresolved variable is a blocking error `PROMPT_VAR_001` (§21).

---

## 3. Core Execution Rule — One Prompt = One Image

### 3.1 The rule

Every image-generation request produces **exactly one image**. For every `Scene` (SE §17):

- **Prompt `{n}A`** creates **one Blank Sale Image only** (Output A).
- **Prompt `{n}B`** edits **the matching `{n}A` image only** (Output B).

### 3.2 Absolute prohibitions

- **Never** ask a single request to create A and B together.
- **Never** ask a single request to generate several numbered outputs.
- **Never** request a collage, grid, split, contact sheet, or multi-panel layout in any A/B prompt.
- A "pair" or "group" is an **execution plan of separate requests**, never one multi-image request (§15, §16).

### 3.3 Enforcement

Every Output A and Output B template ends with the invariant clause: *"Output exactly one image. Do not create a collage, grid, split, contact sheet, or multi-panel layout."* Any composition that would emit more than one image is a blocking `PROMPT_COLLAGE_001` (§21).

---

## 4. Output A Prompt Specification (Blank Sale Image)

### 4.1 Output A must

Create exactly **one** single blank sale mockup image that contains **no** artwork, typography, logo, watermark, readable scene text, and **no** collage/grid/split/contact-sheet/multi-panel layout; **preserve** the selected product, garment color, scene, audience, camera, composition, view, and display method; and **prioritize the printable area** (large, centered, clean, visible — §11; RE §7/§9).

This realizes `OutputA.forbidden = ['artwork','logo','watermark','typography']` (DM §3.6) as prompt language.

### 4.2 Prompt A template structure

```
[Global]
Create ONE single photorealistic commercial product-mockup image for an Etsy listing.
Output exactly one image. Do NOT create a collage, grid, split, contact sheet, or multi-panel layout.
No readable text anywhere in the scene. Commercial realism; no surreal elements.

[Product]  {{product.promptModule}}
A blank {{product.name}} in {{garment.color}} ({{product.silhouetteClause}}).
The garment is completely blank: no artwork, no logo, no text, no watermark, no graphics of any kind.

[Season]  {{season.promptModule}}
{{season.moodClause}}; {{season.lightingClause}}; {{season.paletteClause}}.
Keep any seasonal decor entirely away from the printable area; decor is background only.

[Scene]  {{scene.promptModule}}
{{scene.displayMethodClause}}, {{scene.viewClause}}, {{scene.cameraClause}},
{{scene.compositionClause}}, {{scene.locationClause}}, {{scene.poseClause (audience-safe)}}.

[Output A]
PRINT AREA (highest priority): keep the {{printArea.zoneClause}} large, centered, clean, and fully visible.
Nothing may cover the print area — no hands, hair, props, deep folds, or shadows over it.
Final directive: produce ONE blank sale mockup image only. No artwork. No text. No collage.
```

`{{...}}` are deterministic substitutions (§2.4). The print-area clause is always emitted last and is non-negotiable (priority 1).

---

## 5. Output B Prompt Specification (Matching Preview)

### 5.1 Output B is an image-edit / reference prompt

Output B is **not** a text-to-image generation; it is an **edit of the matching Output A image**. It must require:

- the matching **Output A image** as the source mockup (`OutputB.sourceOutputAId`, DM §3.7), and
- the uploaded **PNG artwork** as the **only** print artwork (`OutputB.artworkId`, DM §3.7).

### 5.2 Output B must preserve exactly

source model, face, pose, crop, camera, background, lighting, product, garment color, fabric folds, shadows, props, composition. **Only the artwork may change** (`onlyArtworkChanges = true`, DM §3.7).

### 5.3 Prompt B template structure

```
[Global]
Image EDIT of one existing image. Output exactly one image. No collage, grid, split, or multi-panel.
No readable text anywhere in the scene.

[Product]  {{product.promptModule}}   (identity restated for lock only, not re-created)
[Season]   {{season.promptModule}}    (restated for lock only)
[Scene]    {{scene.promptModule}}      (restated for lock only)

[Output B]
SOURCE: use the attached Output A image ({{numbering.A}}) as the source mockup — do not regenerate it.
ARTWORK: use the attached PNG artwork as the ONLY print artwork.
Print the PNG onto the {{printArea.zoneClause}} only.
PRESERVE EXACTLY (do not alter): source model, face, pose, crop, camera, background, lighting,
product, garment color, fabric folds, shadows, props, composition.
CHANGE ONLY: the artwork on the print area.
ARTWORK LOCK: the PNG is the only artwork source — do NOT redraw, recolor, replace, enhance,
reinterpret, translate, invent, or destructively crop it; add no seasonal graphics, placeholder text,
symbols, or decorations.
FABRIC INTEGRATION: follow wrinkles, garment drape, fabric microtexture, and natural perspective;
apply realistic print opacity and soft edge integration with shadows; NO sticker effect, NO flat
pasted image, NO white box, NO checkerboard.
Final directive: produce ONE edited preview image only.
```

### 5.4 Multi-garment scenes (e.g. Father + Son)

When a scene shows more than one garment (hero templates like `hero:father_son`, SE §11), Output B prints the **matching uploaded PNG onto each garment's print area** in the same single edited image, still preserving everything else and still producing exactly **one** image. Each garment's print area is treated with the same lock and fabric-integration rules.

---

## 6. Missing-Source Behavior (Output B planning)

### 6.1 Hard gates

- If the matching **Output A image is not attached**, Output B **must not execute** (`PROMPT_SRC_001`).
- If the **uploaded PNG artwork is missing**, Output B **must not execute** (`PROMPT_PNG_001`; aligns with `RULE_PRV_001`, RE §14).
- **Do not** regenerate Output B from text (no text-to-image fallback).
- **Do not** create random or invented artwork.
- **Do not** return a blank replacement B.

### 6.2 Execution states (derived, non-persisted — no model change)

The four required states are a **runtime execution view** derived from existing fields (`OutputStatus`, `outputB.artworkId`, source `OutputA.status`, `outputB.isStale`, DM §3.7/§3.15). This introduces **no** change to the authoritative domain model.

| Execution state | Derived condition | Meaning |
|---|---|---|
| **Planned** | Output B is `Pending`, prompt composed, but source A not `Generated` OR artwork null | prompt exists; not eligible to run |
| **Blocked** | required source A missing OR artwork missing at execution time | must not execute; emits `PROMPT_SRC_001`/`PROMPT_PNG_001` |
| **Ready** | source A `Generated` AND `artworkId` present AND not stale | eligible to run as one edit request |
| **Stale** | `outputB.isStale === true` (source A `contentHash` changed) | must regenerate against the new A; `PROMPT_STALE_001` / `RULE_PRV_003` |

A "Blocked" Output B holds its composed prompt but is never dispatched; it transitions to "Ready" only when both requirements are satisfied (§17 ordering: all A first, then B).

---

## 7. Artwork Lock

The uploaded PNG (`Artwork`, DM §3.8) is the **only** artwork source. Every Output B and multi-garment B prompt carries the artwork-lock clause. **Forbidden operations** (each explicitly stated in prompt text):

redraw · recolor · replace · enhance creatively · reinterpret · translate · invent · destructively crop · add seasonal graphics · add placeholder text · add symbols or decorations.

Violation intent (a prompt that would ask for any of these) is a blocking `PROMPT_ART_001` (§21). The PNG is placed onto the print area at its own aspect ratio (DM `Artwork.aspectRatio`); scaling to fit the print zone is allowed, content alteration is not.

---

## 8. Fabric Integration

Every Output B prompt enforces realistic printing with the fabric-integration clause (§5.3). Strict rules:

| Require | Forbid |
|---|---|
| follow wrinkles | sticker effect |
| fabric microtexture | flat pasted image |
| natural perspective | white box behind print |
| shadows honored across the print | checkerboard/transparency artifacts |
| garment drape followed | rigid undistorted overlay |
| realistic print opacity | opaque decal look |
| soft edge integration | hard cut-out edges |

The print must read as **ink on fabric**, conforming to the source A's folds, drape, and shadows (commercial realism, §2). These rules apply to Output B only; Output A is blank (§4).

---

## 9. Print-Area Protection (prompt language)

The Scene/Print-Area data (SE §16; DM `PrintAreaProfile`) is translated into prompt clauses. Print-area rules are **always highest priority** (§11; RE §2) and appear last-and-firmest in every A and B prompt.

| Context | Print-area prompt clause |
|---|---|
| **Front print area** | "keep the center-front chest print area large, centered, clean, and fully visible" |
| **Back print area** | "keep the center-back print area large, centered, and unobstructed" |
| **Left chest** | "keep the left-chest print zone clean, correctly sized, and unobstructed" |
| **Folded** | "present the folded garment so the front print area remains flat, visible, and uncreased" |
| **Flat lay** | "top-down flat lay; the print area is fully flat, centered, and shadow-free" |
| **Hanger** | "garment on hanger; print area centered and clean, no folds across it" |
| **Model** | "pose keeps hands, hair, and props off the print area; no shadow across it" |
| **Multiple garments** | "each garment's print area is individually large, centered, clean, and visible" |

Universal print-area guard (in every A/B prompt): *"Nothing may cover the print area — no hands, hair, props, deep folds, or shadows over it"* (`PrintAreaObstruction`, DM §3.3).

---

## 10. Product Modules

One `product` module per catalog product (§6; DM `ProductKind`). Modules state garment identity, silhouette, and print zone only — **no invented brand claims** (no fabric weights, thread counts, or marketing superlatives).

| Product | Silhouette clause | Print zone |
|---|---|---|
| **Bella Canvas 3001** | "unisex retail-fit t-shirt, standard crew neck, set-in sleeves" | center chest |
| **Classic T-Shirt** | "classic straight-cut t-shirt, crew neck" | center chest |
| **Comfort Colors** | "relaxed heavyweight-look t-shirt, crew neck" | center chest |
| **Oversized** | "oversized drop-shoulder t-shirt" | center chest / full front |
| **Hoodie** | "pullover hoodie with front pocket and hood" | center chest above pocket |
| **Crewneck** | "crewneck sweatshirt, ribbed collar and cuffs" | center chest |
| **Kids T-Shirt** | "children's t-shirt, crew neck, child proportions" | center chest (child scale) |
| **Tank** | "sleeveless tank top" | center chest |
| **Polo** | "collared polo shirt with placket" | left chest |
| **Raglan** | "raglan-sleeve baseball tee, contrast sleeves" | center chest |
| **Zip Hoodie** | "full-zip hoodie; front split by zipper" | one side of front / left chest |

Each module's print zone is bound to the product's `PrintAreaProfile.position` (DM §3.3). "Kids T-Shirt" uses child proportions and is subject to the Kids audience lock (§11).

---

## 11. Audience Modules

Audience wording (DM `Audience`; SE §11). Model archetypes are pose/hero tags with `audienceCompatibility`; the Rule Engine audience matrix (RE §17.1) is final authority.

| Archetype | Prompt wording | Constraint |
|---|---|---|
| Adult male | "an adult male model" | audience ≠ Kids |
| Adult female | "an adult female model" | audience ≠ Kids |
| Child boy | "a young boy model (child)" | Kids/all only |
| Child girl | "a young girl model (child)" | Kids/all only |
| Teen | "a teenage model" | teen/adult/unisex |
| Couple | "an adult couple" | adult/unisex |
| Family | "a family group" | all/adult |
| Father and son | "a father and his son" | Father's Day / all (RE §16) |
| Father and daughter | "a father and his daughter" | Father's Day / all |
| Mother and daughter | "a mother and her daughter" | Mother's Day / all |
| Mother and son | "a mother and her son" | Mother's Day / all |
| Brother and sister | "a brother and sister (children)" | kids/all |
| Teacher | "an adult teacher" | Teacher/Back-to-School |
| Student | "a student" | Back-to-School/Teacher |
| No model | "no model; garment shown by {{displayMethod}}" | always legal |

### 11.1 Kids-product protection

**Adults must never wear Kids products.** If the product is Kids T-Shirt (or `kidsOnly`), the audience must be `Kids` and only child/no-model wording is emitted; any adult-model wording is suppressed and the case is blocked (`RULE_AUD_002` / `PROMPT_AUD_001`, §21). Conversely child models are not emitted for adult audiences (`RULE_AUD_004`).

---

## 12. Season Modules

One `season` module per season (§7; SE §13). Each supplies mood, lighting, and palette wording and **keeps seasonal decor away from the printable area**; **no readable text anywhere in the scene**.

| Season | Mood clause | Lighting | Palette | Decor placement |
|---|---|---|---|---|
| Halloween | "playful, lightly spooky autumn mood" | warm low, moody | black/orange/purple | background only, off the print area |
| Christmas | "festive, warm holiday mood" | warm string-light glow | red/green/white/gold | background only |
| Valentine's Day | "soft romantic mood" | soft pink key | red/pink/white | background only |
| Mother's Day | "warm, loving, floral mood" | soft daylight | pastels/blush/sage | background only |
| Father's Day | "warm, rugged, understated mood" | warm directional | navy/charcoal/tan | background only |
| Back to School | "fresh, bright academic mood" | bright even daylight | primary brights/navy | background only |
| Summer | "bright, airy summer mood" | high-key sunlight | brights/aqua/coral/white | background only |
| Fall | "cozy, earthy autumn mood" | warm muted | rust/mustard/brown/olive | background only |
| Winter | "crisp, cozy winter mood" | cool soft + warm accents | white/ice-blue/navy/silver | background only |
| Teacher | "friendly, academic classroom mood" | bright even | primary brights/red/navy | background only |
| Minimal Studio | "clean, neutral studio mood; no seasonal decor" | soft even studio key | neutral grey/white/black | none |

Every season module ends with: *"Keep all seasonal decor entirely away from the print area; no readable text anywhere in the scene."* Foreign-season decor is excluded upstream (RE §16); the module never references it.

---

## 13. Display and View Modules

Display/view wording (DM `DisplayMethod`, `GarmentView`, `CameraAngle`; SE §12). Front/Back are **views**; Close/Lifestyle/Studio are modifiers.

| Term | Prompt wording | DM mapping |
|---|---|---|
| Model front | "on-model, front view" | OnModel + Front |
| Model back | "on-model, back view" | OnModel + Back |
| Hanger front | "on a hanger, front view" | Hanger + Front |
| Hanger back | "on a hanger, back view" | Hanger + Back |
| Flat lay | "top-down flat lay, no model" | FlatLay + FlatDetail |
| Folded | "neatly folded, styled" | Folded |
| Ghost mannequin | "invisible/ghost mannequin 3D form" | GhostMannequin |
| Hanging | "hung against the backdrop" | Hanging |
| Close-up | "tight close-up crop on the print area" | camera distance close |
| Lifestyle | "styled lifestyle setting" | location: lifestyle |
| Studio | "clean seamless studio backdrop" | location: studio |
| Front | "front view" | Front |
| Back | "back view" | Back |
| Side | "side/profile view" | Side |
| Detail | "detail crop of the garment/print" | FlatDetail |

Each module respects `product.allowedViews` (RE §17.2 P-3); an illegal view is `PROMPT_VIEW_001` (§21).

---

## 14. Numbering System

### 14.1 Scheme

Numbering is stable and derives only from `sceneOrder` (DM §3.2) and the output kind:

```
Scene 1 → Prompt 1A (Output A)   Prompt 1B (Output B, uses 1A)
Scene 2 → Prompt 2A              Prompt 2B (uses 2A)
...
Scene N → Prompt NA              Prompt NB (uses NA)
```

### 14.2 Stability guarantee

`{n}` is the 1-based position of the scene in `sceneOrder`. Because `sceneOrder` is deterministic (SE §7.4) and persisted, numbering is **identical across save, load, copy, export, and regeneration**. Within groups, the numbering additionally carries the group index (§18). A scene's number never changes unless `sceneOrder` itself changes (an explicit user reorder), and even then the mapping is deterministic.

---

## 15. Copy System

Exact behavior of each copy action (§12 PRD; DM `ExportScope`). **No copy action may imply that A and B can be executed as one image request** (§3).

| Action | Emits | Note |
|---|---|---|
| **Copy A** | one Output A prompt (`{n}A`) | one image |
| **Copy B** | one Output B prompt (`{n}B`) | one edit; references `{n}A` |
| **Copy Pair Instructions** | `{n}A` then `{n}B` as **two clearly separate requests** + a header: "Execute 1A first, then 1B using the 1A image. These are two separate image requests." | never one combined request |
| **Copy Group A** | all `A` prompts of one group, in scene-number order | one image each |
| **Copy Group B** | all `B` prompts of one group, each referencing its `A` | one edit each |
| **Copy Group Plan** | the group execution plan (§16) | plan text, not an image request |
| **Copy All A** | every `A` prompt in the session (Phase 1, §17) | one image each |
| **Copy All B** | every `B` prompt (Phase 2, §17) | one edit each |
| **Copy Complete Execution Plan** | full Phase 1 + Phase 2 plan (§17) + cover handoff note | plan text |
| **Copy Cover** | the Cover Prompt (§18) | one image; sources = Sale Images A only |

Every "pair"/"group"/"all" copy includes the explicit banner: *"Each numbered prompt is a separate image request. Never combine into one generation."*

---

## 16. Group Prompt Specification

A **Group Prompt** is an **execution plan**, never one multi-image generation prompt. `Group.groupPromptText` (DM §3.10) must clearly state:

```
GROUP {{group.number}} EXECUTION PLAN  (groupBy = {{group.groupBy}}, key = {{group.key}})
1. Execute every numbered prompt SEPARATELY — one image per request.
2. Generate ALL Output A images first (Phase 1): {{list of nA in this group}}.
3. Then generate EACH Output B using its matching A (Phase 2): {{nB using nA ...}}.
4. Never create a collage, grid, or combined image.
5. Never combine outputs into a single request.
```

The group prompt contains no image directive of its own; it orchestrates the separate A/B requests. Attempting to render a group prompt as one image is `PROMPT_COLLAGE_001` (§21).

---

## 17. Complete Execution Plan

For a session of **N** scenes, the plan is strictly two-phase (A-before-B, §4 PRD; RE §8):

```
PHASE 1 — Sale Images (Output A), each a separate one-image request:
  Prompt 1A
  Prompt 2A
  ...
  Prompt NA

PHASE 2 — Previews (Output B), each a separate one-image EDIT using its matching A + the PNG:
  Prompt 1B  using 1A
  Prompt 2B  using 2A
  ...
  Prompt NB  using NA

(Cover is prepared only after ALL Phase-1 A images exist — allOutputAReady === true, §18/§19.)
```

Rationale: Output B depends on its Output A image (DM §3.7); generating all A first guarantees each B has its source. The plan is deterministic — order = `sceneOrder`.

---

## 18. Cover Prompt Handoff

The Prompt Engine may compose the **Cover Prompt** **only** from Cover Engine metadata (`CoverMetadata`, DM §3.9; SE §19). The cover prompt must:

- reference **blank Sale Images A only** — **never** Output B (§5 PRD; DM §3.9 type guarantee);
- **never** add designs to garments (the cover shows blank sale images);
- maintain **source-image lock** (do not alter the referenced Sale Images);
- use **large images and smaller supporting text**;
- **dynamically adapt** to 2, 4, 8, 10, 20, 40, and 50 mockups.

### 18.1 Cover prompt template (composition responsibility only)

```
[Global] Create ONE cover image for an Etsy listing. Output exactly one image. No garment redesign.
[Cover]
SOURCES: use the attached blank Sale Images (Output A) ONLY: {{cover.sourceSaleImageIds}}.
Never use any Preview (Output B) image. Do not add any artwork, logo, or design to the garments.
SOURCE LOCK: do not alter the referenced Sale Images; arrange them only.
EMPHASIS: feature the primary product {{cover.primaryProduct}}, primary color {{cover.primaryColor}},
primary view {{cover.primaryView}}, audience {{cover.primaryAudience}}.
SCALE: use large product images with smaller supporting text; keep text minimal and non-competing.
COUNT ADAPTATION: compose for {{cover.mockupCount}} mockups (supports 2, 4, 8, 10, 20, 40, 50).
```

### 18.2 Boundary

The Prompt Engine composes **only the prompt text**. It does **not** define layout logic (grid math, cell placement) — that is the Cover Engine's `CoverLayout` responsibility ([R3]; SE §19). The prompt references `{{cover.layout}}`/`{{cover.mockupCount}}` as resolved values, never recomputing them. Cover use of Output B is a blocking `PROMPT_COV_001` / `RULE_COV_001`.

---

## 19. Prompt Metadata and Hashes

Uses `PromptMetadata` (DM §3.17) and the output `promptHash` (DM §3.6/§3.7/§3.9).

| Field | Meaning | Changes when… |
|---|---|---|
| `templateVersion` (`SemVer`) | version of the prompt template skeleton | the template structure (§4/§5) is revised |
| `moduleVersions` (`Record<PromptModuleType, SemVer>`) | version of each composed module | any composed module (Global/Product/Season/Scene/A/B/Cover/Group) wording is revised |
| `generatorVersion` (`SemVer`) | Prompt Engine version | the composition rules change |
| `generatedAt` (`IsoTimestamp`) | emission time | every run — **excluded from checksum** |
| `promptChecksum` (`Sha256`) | deterministic checksum of the composed prompt | any resolved variable, module version, or template version changes |
| `promptHash` (`Sha256`, on Output A/B/Cover) | hash of that output's composed prompt text | that specific prompt's text changes |

### 19.1 Hash change matrix

| Change | `promptHash` | `promptChecksum` | `moduleVersions` | scene `sceneFingerprint` |
|---|---|---|---|---|
| Scene dimension edit (generation-affecting) | ✓ | ✓ | — | ✓ (SE) |
| Module wording revised | ✓ | ✓ | ✓ | — |
| Template skeleton revised | ✓ | ✓ | — (unless module too) | — |
| Artwork replaced (affects B) | ✓ (B) | ✓ (B) | — | — |
| Timestamp only | ✗ | ✗ | ✗ | ✗ |

`generatedAt` never enters any checksum (§20).

---

## 20. Deterministic Composition

Identical `SessionFingerprint` (DM §3.18) + `Scene.sceneFingerprint` (DM §3.5) + rule-set versions + prompt-module versions **must** produce identical prompt text and identical `promptChecksum`. Guarantees:

- **No timestamps in checksums** — `generatedAt` excluded.
- **No random synonyms** — every clause is a fixed authored string; variable substitution is pure.
- **No variable wording** — module templates are constants; the only variability is resolved values, themselves fixed by the fingerprints.
- **Stable ordering** — module composition order (§2.2), numbering (§14), and plan phases (§17) are fixed.

Re-running an unchanged session reproduces byte-identical prompts and checksums (idempotence; ARCH §1.3; RE §1.3).

---

## 21. Error Handling (structured, blocking, Arabic messages)

Codes follow `PROMPT_<AREA>_<NNN>`; each maps to `ValidationSeverity.Blocking`, `originEngine = EngineId.Prompt` (DM §3.13), and cross-references a `RULE_*` where the Rule Engine already governs it. Objects conform to `ValidationFailure` (DM §3.13).

| Code | Condition | Cross-ref | messageAr | messageEn |
|---|---|---|---|---|
| `PROMPT_SRC_001` | Output B: matching Output A image not attached | — | لا يمكن تنفيذ صورة المعاينة: صورة البيع (A) المصدر غير مرفقة. | Output B blocked: source Sale Image (A) not attached. |
| `PROMPT_PNG_001` | Output B: uploaded PNG missing | `RULE_PRV_001` | لا يمكن تنفيذ صورة المعاينة: ملف التصميم PNG غير مرفوع. | Output B blocked: PNG artwork missing. |
| `PROMPT_STALE_001` | Output B stale (source A changed) | `RULE_PRV_003` | صورة المعاينة قديمة؛ يجب إعادة توليدها من صورة البيع المحدثة. | Output B stale; regenerate from updated A. |
| `PROMPT_PRD_001` | invalid/unknown product | — | المنتج غير صالح أو غير معروف. | Invalid product. |
| `PROMPT_VIEW_001` | view not in product allowedViews | `RULE_PRD_003` | زاوية العرض غير مدعومة لهذا المنتج. | View not supported by product. |
| `PROMPT_COLOR_001` | garment color outside locked selection | `RULE_PAL_002` | لون القطعة خارج الألوان المختارة. | Garment color outside selection. |
| `PROMPT_COLLAGE_001` | prompt would produce collage/multi-image | `RULE_CLG_001` | طلب يولّد كولاج/عدة صور؛ غير مسموح — صورة واحدة لكل طلب. | Collage/multi-image request; one image per prompt only. |
| `PROMPT_ART_001` | prompt would invent/redraw/replace artwork | — | محاولة اختراع/إعادة رسم التصميم؛ يُسمح فقط باستخدام ملف PNG المرفوع. | Artwork invention/redraw attempt; only the uploaded PNG is allowed. |
| `PROMPT_COV_001` | cover prompt references Output B | `RULE_COV_001` | الغلاف يستخدم صور البيع (A) فقط ولا يستخدم صور المعاينة (B). | Cover must use Sale Images (A) only. |
| `PROMPT_VAR_001` | unresolved prompt variable | — | متغيّر غير محلول في القالب. | Unresolved prompt variable. |
| `PROMPT_MOD_001` | invalid/incompatible module version | — | إصدار وحدة برومبت غير صالح أو غير متوافق. | Invalid module version. |
| `PROMPT_AUD_001` | adult model requested for Kids product/audience | `RULE_AUD_002` | لا يُسمح للبالغين بارتداء منتجات الأطفال. | Adults may not wear Kids products. |
| `PROMPT_TXT_001` | readable scene text requested | `RULE_TXT_001` | لا يُسمح بنص مقروء داخل المشهد. | Readable scene text not allowed. |

All are blocking: a failing prompt is not dispatched; generation halts for that item (§14 PRD).

---

## 22. Validation and QA

### 22.1 Acceptance criteria (32)

- **AC-1** One Output A prompt yields exactly one blank image.
- **AC-2** One Output B prompt yields exactly one edited image.
- **AC-3** No A/B prompt ever requests more than one image.
- **AC-4** A and B are always separate execution requests.
- **AC-5** Output B is image-edit mode referencing the matching A image.
- **AC-6** Output B requires both source A image and uploaded PNG.
- **AC-7** Output A contains no artwork/logo/watermark/typography.
- **AC-8** No A/B/Cover prompt contains readable scene text.
- **AC-9** No A/B/Cover prompt requests a collage/grid/split/contact sheet/multi-panel.
- **AC-10** Print-area clause is present and last-and-firmest in every A/B prompt.
- **AC-11** Print-area rules are never softened by lower-precedence modules.
- **AC-12** Output B preserves model/face/pose/crop/camera/background/lighting/product/color/folds/shadows/props/composition.
- **AC-13** Only the artwork changes between A and B.
- **AC-14** Artwork-lock clause forbids redraw/recolor/replace/enhance/reinterpret/translate/invent/destructive-crop/seasonal graphics/placeholder text/symbols.
- **AC-15** Fabric-integration clause forbids sticker/flat/white-box/checkerboard and requires wrinkle/drape/opacity/edge realism.
- **AC-16** Missing source A ⇒ Output B blocked (`PROMPT_SRC_001`), not text-regenerated.
- **AC-17** Missing PNG ⇒ Output B blocked (`PROMPT_PNG_001`), no random artwork, no blank B.
- **AC-18** Stale B ⇒ `PROMPT_STALE_001`; regenerates from updated A.
- **AC-19** Kids product ⇒ no adult-model wording (`PROMPT_AUD_001`).
- **AC-20** View outside `allowedViews` ⇒ `PROMPT_VIEW_001`.
- **AC-21** Color outside locked selection ⇒ `PROMPT_COLOR_001`.
- **AC-22** Cover prompt references Sale Images A only; B reference ⇒ `PROMPT_COV_001`.
- **AC-23** Cover prompt adds no garment design and locks source images.
- **AC-24** Cover prompt adapts to 2/4/8/10/20/40/50 mockups via resolved metadata.
- **AC-25** Numbering `{n}A/{n}B` is stable across save/load/copy/export/regeneration.
- **AC-26** Group Prompt is a plan (separate requests), never one image.
- **AC-27** Execution plan is two-phase: all A first, then each B using its A.
- **AC-28** Identical fingerprints+versions ⇒ identical prompt text.
- **AC-29** Identical fingerprints+versions ⇒ identical `promptChecksum`.
- **AC-30** `generatedAt`/timestamps never enter any checksum.
- **AC-31** Unresolved variable ⇒ `PROMPT_VAR_001`; nothing dispatched.
- **AC-32** No synonym/variant wording; module templates are constants.

### 22.2 QA test cases (44)

```
Prompt structure & one-image rule
[ ] T01 Output A prompt requests exactly one image.
[ ] T02 Output B prompt requests exactly one image.
[ ] T03 A prompt has no "and also generate B" clause.
[ ] T04 No prompt lists several numbered outputs to make at once.
[ ] T05 Every A prompt ends with the one-image / no-collage directive.
[ ] T06 Every B prompt ends with the one-image / no-collage directive.

Output A content bans
[ ] T07 A prompt forbids artwork.
[ ] T08 A prompt forbids logo.
[ ] T09 A prompt forbids watermark.
[ ] T10 A prompt forbids typography/readable text.
[ ] T11 A prompt forbids collage/grid/split/contact-sheet/multi-panel.
[ ] T12 A prompt preserves product/color/scene/audience/camera/composition/view/display.

Output B edit & preservation
[ ] T13 B prompt is image-edit mode using the {n}A source.
[ ] T14 B prompt requires the uploaded PNG as the only artwork.
[ ] T15 B prompt preserves model/face/pose/crop/camera/background/lighting.
[ ] T16 B prompt preserves product/color/folds/shadows/props/composition.
[ ] T17 B prompt changes only the artwork.
[ ] T18 Multi-garment B prints matching PNG on each garment, still one image.

Artwork lock
[ ] T19 B forbids redraw/recolor/replace/enhance.
[ ] T20 B forbids reinterpret/translate/invent.
[ ] T21 B forbids destructive crop.
[ ] T22 B forbids adding seasonal graphics/placeholder text/symbols.

Fabric integration
[ ] T23 B requires wrinkle/drape/microtexture/perspective.
[ ] T24 B requires realistic opacity + soft edges + shadows.
[ ] T25 B forbids sticker/flat/white-box/checkerboard.

Missing-source behavior
[ ] T26 No source A ⇒ B blocked (PROMPT_SRC_001), no text fallback.
[ ] T27 No PNG ⇒ B blocked (PROMPT_PNG_001), no random artwork.
[ ] T28 No PNG ⇒ B never returns a blank replacement.
[ ] T29 Source A changed ⇒ B stale (PROMPT_STALE_001), regenerated from new A.

Print-area protection
[ ] T30 Front/back/left-chest/folded/flat-lay/hanger/model clauses emitted per context.
[ ] T31 Print-area guard forbids hands/hair/props/deep-folds/shadows over print area.
[ ] T32 Season decor kept off the print area; no readable scene text.

Audience/product/view/color
[ ] T33 Kids product + adult audience ⇒ PROMPT_AUD_001 (no adult-on-kids).
[ ] T34 Illegal view ⇒ PROMPT_VIEW_001.
[ ] T35 Illegal color ⇒ PROMPT_COLOR_001.

Numbering & copy buttons
[ ] T36 1A/1B..NA/NB numbering stable across save/load/export.
[ ] T37 Copy A / Copy B copy exactly one prompt.
[ ] T38 Copy Pair emits two SEPARATE requests + "execute separately" banner.
[ ] T39 Copy Group A/B, Copy All A/B ordered by scene number, one image each.
[ ] T40 Copy Complete Execution Plan = Phase 1 then Phase 2 + cover note.

Cover & checksum
[ ] T41 Copy Cover references Sale Images A only; never B (else PROMPT_COV_001).
[ ] T42 Cover prompt adds no garment design; locks sources; adapts to count.
[ ] T43 Identical fingerprints+versions ⇒ identical prompt text AND checksum.
[ ] T44 Timestamp change alone ⇒ checksum unchanged.
```

### 22.3 Edge cases

1. Single-scene session → `1A`/`1B` only; plan still two-phase.
2. Multi-garment hero (father+son) → one B image, PNG on each garment (§5.4).
3. Zip Hoodie split front → print zone on one side only; print-area clause adapts (§10).
4. Minimal Studio → no season decor clause; clean studio wording (§12).
5. Locked single color → every A uses that color; no other color wording.
6. Artwork replaced after B generated → B stale (T29).
7. Product with only front allowed → no back/side prompts emitted (§13/§15).
8. 50-scene session → 50 A then 50 B; numbering `1..50`; cover after all A ready.
9. Unresolved `{{...}}` → `PROMPT_VAR_001`; item not dispatched.
10. Stale module version in library → `PROMPT_MOD_001` at compose time.

---

## 23. Prompt Examples (complete)

Placeholders are shown resolved. All examples obey one-prompt-one-image.

### 23.1 Bella Canvas 3001 — adult female, front — Prompt 1A
```
Create ONE single photorealistic commercial product-mockup image for an Etsy listing.
Output exactly one image. Do NOT create a collage, grid, split, contact sheet, or multi-panel layout.
No readable text anywhere in the scene.
An adult female model wears a blank Bella Canvas 3001 unisex retail-fit t-shirt (standard crew neck,
set-in sleeves) in Black. On-model, front view, eye-level camera, centered hero composition,
clean seamless studio backdrop, soft key lighting. Minimal Studio mood; neutral palette.
The t-shirt is completely blank: no artwork, no logo, no text, no watermark.
PRINT AREA (highest priority): keep the center-front chest print area large, centered, clean, and fully
visible. Nothing may cover the print area — no hands, hair, props, deep folds, or shadows over it.
Final directive: produce ONE blank sale mockup image only. No artwork. No text. No collage.
```

### 23.2 Matching Prompt 1B (uses 1A + PNG)
```
Image EDIT of one existing image. Output exactly one image. No collage, grid, split, or multi-panel.
No readable text anywhere in the scene.
SOURCE: use the attached Output A image (1A) as the source mockup — do not regenerate it.
ARTWORK: use the attached PNG artwork as the ONLY print artwork.
Print the PNG onto the center-front chest print area only.
PRESERVE EXACTLY: model, face, pose, crop, camera, background, lighting, product (Bella Canvas 3001),
garment color (Black), fabric folds, shadows, props, composition. CHANGE ONLY the artwork.
ARTWORK LOCK: do NOT redraw, recolor, replace, enhance, reinterpret, translate, invent, or destructively
crop the PNG; add no seasonal graphics, placeholder text, symbols, or decorations.
FABRIC INTEGRATION: follow wrinkles, drape, microtexture, and perspective; realistic print opacity and
soft edge integration with shadows; NO sticker effect, NO flat pasted image, NO white box, NO checkerboard.
Final directive: produce ONE edited preview image only.
```

### 23.3 Kids T-Shirt — child boy, front — Prompt 2A
```
Create ONE single photorealistic commercial product-mockup image. Output exactly one image.
No collage/grid/split/multi-panel. No readable text anywhere in the scene.
A young boy model (child) wears a blank children's t-shirt (crew neck, child proportions) in Royal Blue.
On-model, front view, eye-level camera, centered composition, bright even daylight, clean backdrop.
The t-shirt is completely blank: no artwork, no logo, no text, no watermark.
PRINT AREA (highest priority): keep the center-front chest print area (child scale) large, centered,
clean, and fully visible. No hands, hair, props, deep folds, or shadows over the print area.
Final directive: ONE blank kids sale mockup image only. (Adult models are not permitted for this product.)
```

### 23.4 Matching Prompt 2B
```
Image EDIT of one existing image. Output exactly one image. No collage. No readable scene text.
SOURCE: attached Output A image (2A). ARTWORK: attached PNG as the ONLY artwork.
Print the PNG onto the child-scale center-front chest print area only.
PRESERVE EXACTLY: child model, face, pose, crop, camera, background, lighting, product (Kids T-Shirt),
color (Royal Blue), folds, shadows, props, composition. CHANGE ONLY the artwork.
ARTWORK LOCK + FABRIC INTEGRATION: (same clauses as 1B). Produce ONE edited preview image only.
```

### 23.5 Father and son — Prompt 3A
```
Create ONE single photorealistic commercial product-mockup image. Output exactly one image.
No collage/grid/multi-panel. No readable text anywhere in the scene.
A father and his son each wear a blank crew-neck t-shirt (adult fit for the father, child fit for the son)
in Charcoal. On-model, front view, warm directional lighting, Father's Day mood; navy/charcoal/tan palette;
all seasonal decor kept in the background, away from the print areas. Both t-shirts are completely blank.
PRINT AREA (highest priority): each garment's center-front chest print area is individually large, centered,
clean, and fully visible. No hands, hair, props, deep folds, or shadows over either print area.
Final directive: ONE blank sale mockup image only.
```

### 23.6 Matching Prompt 3B (PNG on both garments, one image)
```
Image EDIT of one existing image. Output exactly one image. No collage. No readable scene text.
SOURCE: attached Output A image (3A). ARTWORK: attached PNG as the ONLY artwork.
Print the matching PNG onto BOTH garments' center-front chest print areas — in this single edited image.
PRESERVE EXACTLY: both models, faces, poses, crop, camera, background, lighting, products, colors,
folds, shadows, props, composition. CHANGE ONLY the artwork on each print area.
ARTWORK LOCK + FABRIC INTEGRATION: (same clauses as 1B), applied to each garment.
Final directive: produce ONE edited preview image only (both garments printed).
```

### 23.7 Hanger back — Prompt 4A
```
Create ONE single photorealistic commercial product-mockup image. Output exactly one image.
No collage. No readable scene text.
A blank Classic T-Shirt in White on a hanger, back view, eye-level camera, centered composition,
clean studio backdrop, soft even lighting. The t-shirt is completely blank.
PRINT AREA (highest priority): keep the center-back print area large, centered, and unobstructed;
no folds across it. Final directive: ONE blank sale mockup image only.
```

### 23.8 Hanger back — Prompt 4B
```
Image EDIT of one existing image. Output exactly one image. No collage. No readable scene text.
SOURCE: attached Output A image (4A). ARTWORK: attached PNG as the ONLY artwork.
Print the PNG onto the center-back print area only.
PRESERVE EXACTLY: hanger, garment (Classic T-Shirt), color (White), crop, camera, background, lighting,
folds, shadows, composition. CHANGE ONLY the artwork.
ARTWORK LOCK + FABRIC INTEGRATION: (same clauses as 1B). Produce ONE edited preview image only.
```

### 23.9 Folded — Prompt 5A
```
Create ONE single photorealistic commercial product-mockup image. Output exactly one image.
No collage. No readable scene text.
A blank Comfort Colors t-shirt in Sand, neatly folded and styled, top-down-ish angle, clean surface,
soft even lighting. The t-shirt is completely blank.
PRINT AREA (highest priority): present the folded garment so the front print area remains flat, visible,
and uncreased. Final directive: ONE blank sale mockup image only.
```

### 23.10 Folded — Prompt 5B
```
Image EDIT of one existing image. Output exactly one image. No collage. No readable scene text.
SOURCE: attached Output A image (5A). ARTWORK: attached PNG as the ONLY artwork.
Print the PNG onto the flat, visible front print area only.
PRESERVE EXACTLY: fold structure, garment (Comfort Colors), color (Sand), crop, camera, background,
lighting, shadows, composition. CHANGE ONLY the artwork.
ARTWORK LOCK + FABRIC INTEGRATION: (same clauses as 1B). Produce ONE edited preview image only.
```

### 23.11 Group execution plan (Group 1, groupBy = product)
```
GROUP 1 EXECUTION PLAN  (groupBy = product, key = Bella Canvas 3001)
1. Execute every numbered prompt SEPARATELY — one image per request.
2. Generate ALL Output A images first (Phase 1): 1A, 2A, 3A.
3. Then generate EACH Output B using its matching A (Phase 2): 1B using 1A, 2B using 2A, 3B using 3A.
4. Never create a collage, grid, or combined image.
5. Never combine outputs into a single request.
```

### 23.12 Complete session execution plan (N = 3)
```
COMPLETE EXECUTION PLAN — 3 scenes. Each numbered prompt is a SEPARATE one-image request.

PHASE 1 — Sale Images (Output A):
  Prompt 1A
  Prompt 2A
  Prompt 3A

PHASE 2 — Previews (Output B), each an EDIT using its matching A + the uploaded PNG:
  Prompt 1B using 1A
  Prompt 2B using 2A
  Prompt 3B using 3A

COVER: prepare only after ALL Phase-1 A images exist (allOutputAReady = true).
       Cover references Sale Images A only; never B.
Banner: never combine any prompts into one generation; one prompt = one image.
```

---

## 24. Compatibility Appendix

### 24.1 PRD (`01_PRD.md`)
- [x] Two outputs per scene: Output A blank, Output B preview from A + PNG (§4; §4/§5 here).
- [x] Prompt modules: Global/Product/Season/Scene/Output A/Output B/Cover/Group (§10; §2 here).
- [x] Print-area highest priority; no typography; no readable text (§11/§4; §3/§9/§12 here).
- [x] Cover from Sale Images A only (§5; §18 here). Export/copy behaviors (§12; §15 here).
- [x] Not a prompt generator of randomness — deterministic (§1/§2; §20 here).

### 24.2 Architecture (`02_ARCHITECTURE.md`)
- [x] Prompt Engine composes from 8 modules; runs after Validation gate, before Cover (ARCH §3/§10).
- [x] Data-driven modules; expandable without engine change (ARCH §10.1/§10.9).
- [x] Deterministic; idempotent regeneration (ARCH §1.2/§1.3).

### 24.3 Data Model (`03_DATA_MODELS_FINAL.md`)
- [x] Writes `OutputA/B.promptText`, `promptHash`, `promptMeta`; `MainCover.promptText`; `Group.groupPromptText/Meta` (DM §3.6–3.10).
- [x] `PromptMetadata` (templateVersion/moduleVersions/generatorVersion/promptChecksum) used exactly (DM §3.17; §19 here).
- [x] `PromptModuleType`, `DisplayMethod`, `GarmentView`, `Audience`, `ProductKind`, `CoverMetadata` primaries used exactly.
- [x] Execution states derived from `OutputStatus` + context (no model change) (DM §3.7/§3.15; §6 here).

### 24.4 Rule Engine (`04_RULE_ENGINE_REVISED.md`)
- [x] Print-area supremacy and precedence ladder honored in module precedence (RE §2; §2.3 here).
- [x] Errors cross-reference `RULE_PRV_001/003`, `RULE_COV_001`, `RULE_AUD_002`, `RULE_PAL_002`, `RULE_PRD_003`, `RULE_CLG_001`, `RULE_TXT_001` (RE §14; §21 here).
- [x] No unseeded randomness; blocking halts; warnings never mutate (RE §1.3/§13).

### 24.5 Scene Engine (`05_SCENE_ENGINE.md`)
- [x] Consumes assembled scenes + output pair placeholders + cover metadata (SE §5/§17/§19).
- [x] A-before-B two-phase plan matches SE output ordering and RE §8 barrier (§17 here).
- [x] Numbering from `sceneOrder`; groups from SE §18; one Scene → A + B forever (§14/§16/§17 here).

---

*End of Prompt Engine specification. Sourced only from `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, and `05_SCENE_ENGINE.md`. Specification and prompt-template content only — no application code, JavaScript/TypeScript implementation, HTML, CSS, or React. One prompt = one image; A and B are always separate requests; Output B is edit-mode requiring both the matching Output A image and the uploaded PNG; never invent artwork; never create collage; never place readable text in the scene; print-area rules always highest priority; fully deterministic.*
