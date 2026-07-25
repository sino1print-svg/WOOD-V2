# 08_COVER_ENGINE.md

# Mockup Photoshoot Director — Cover Engine Specification

**Document type:** Engine Specification (specification only)
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`
**Status:** Authoritative baseline for engineering
**Scope note:** Specification only — no application code, no JavaScript/TypeScript implementation, no algorithms-as-code, no HTML/CSS/React. Entity/enum/branded-ID names are those of `03_DATA_MODELS_FINAL.md` (DM). The cover prompt text is English (PE §20); UI is Arabic (UI §18). Everything is deterministic.

**Mission (absolute):** The Cover Engine composes **only the Etsy main-listing Cover Prompt**. It **never** creates mockups, **never** edits images, **never** generates artwork, **never** regenerates or alters any source image. It arranges existing **Sale Images (Output A)** into one premium listing cover prompt.

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `DM` = `03_DATA_MODELS_FINAL.md`. `RE` = `04_RULE_ENGINE_REVISED.md`. `SE` = `05_SCENE_ENGINE.md`. `PE` = `06_PROMPT_ENGINE.md`. `UI` = `07_UI_ENGINE.md`.

---

## 0. Premium Cover Doctrine (non-negotiable output qualities)

Every cover prompt the engine composes **always**:

1. Uses **large mockup images** as the dominant visual element.
2. Uses **smaller, restrained typography**.
3. **Avoids clutter** — generous white space, few text blocks.
4. **Avoids dark side shadows** — soft, even light; no heavy vignette.
5. **Never uses a green background by default** — the default canvas is a **warm neutral** palette (soft beige / off-white / warm grey).
6. **Supports warm neutral palettes** as the standard aesthetic.
7. **Automatically adapts to the number of selected mockups** (§4).
8. **Automatically generates all listing information** from session metadata (§11).
9. **Never asks the AI to recreate source mockups** (§3/§13).
10. **Preserves every source image exactly** (source lock, §13).
11. **Uses only the uploaded/generated Sale Images (Output A)** — never Previews (Output B) (§3).

These qualities are emitted as explicit clauses in every cover prompt and are enforced by validation (§18) and acceptance criteria (§22).

---

## 1. Purpose, Responsibilities, Inputs, Outputs, Ownership

### 1.1 Purpose

The Cover Engine is ARCH §3 engine #5. It assembles the main Etsy listing cover: it selects the layout by mockup count, assembles metadata, plans typography/color-strip/badges, and **composes the single Cover Prompt** that instructs an image tool to arrange the existing Sale Images into a premium cover (§5 PRD; SE §19; PE §18).

### 1.2 Responsibilities

Owns: layout selection (`CoverLayout`, DM [R3]); cover composition spec (placements, hierarchy); metadata assembly + deterministic primaries (DM §3.9); typography plan (§6); color-strip plan (§7); badge plan (§8); product/season naming (§9/§10); **composition of `MainCover.promptText`** using the shared `cover` prompt module (PE §2.1/§18); `coverHash`/`promptHash`/`promptMeta` for the cover (DM §3.9).

Does **not**: generate or edit any image; create mockups or artwork; alter Sale Images; build scenes (Scene Engine); evaluate rules (Rule Engine); render the cover (external image tool). It emits **prompt text only**.

### 1.3 Inputs

| Input | Type (DM) | Source |
|---|---|---|
| Sale Images | `OutputA[]` (`Generated`) referenced by `OutputAId` | Prompt/Render outputs (PE §4) |
| Cover metadata seed | `CoverMetadata` | prepared by Scene Engine handoff (SE §19) |
| Session context | `PhotoshootSession` (season, audience, products, colors) | Orchestrator |
| Product manifests | `Product` (`name`, `kind`) | data library (§9) |
| Season profile | `Season` (`name`, `kind`) | data library (§10) |
| Locked colors | `ColorSelection` (garment-color domain) | Palette Engine (§7) |
| Digital status | `Project.isDigitalProduct` ([R6]) | Project |
| Cover prompt module | `PromptModule` (`PromptModuleType.Cover`) | data library (PE §2.1) |
| Barrier flag | `generationProgress.allOutputAReady` | Orchestrator (RE §8) |

### 1.4 Outputs

| Output | Type (DM) | Consumer |
|---|---|---|
| Cover composition spec | `MainCover` (layout, `readMetadata`, primaries) | UI Cover Manager (UI §3.9) |
| Cover prompt | `MainCover.promptText` (English) + `promptHash` + `promptMeta` | image tool (one image) |
| Cover hash | `MainCover.coverHash` | Persistence, version diff |

### 1.5 Ownership and boundary with the Prompt Engine

Per DM §20, the Cover Engine is **Owner/Creator/Updater** of all `MainCover.*` fields, primaries, `coverHash`, and the cover `promptText`. PE §18 holds the **template/module** for the `cover` module type; the Cover Engine **fills** that module with resolved metadata + composition and produces the final cover prompt. This reconciles PE §18 ("Prompt Engine may compose the Cover Prompt only from Cover Engine metadata; layout logic belongs to the Cover Engine") with this mission: **layout + composition + final cover-prompt assembly are the Cover Engine's; the `cover` module template is shared data.** No conflict.

---

## 2. Cover Generation Pipeline

Deterministic stages; the cover barrier (`allOutputAReady === true`, RE §8) gates entry.

```
[Barrier]  allOutputAReady === true            (else Blocked, RULE_COV_002)
   ↓
[1] Session                 read session metadata + context (§11)
   ↓
[2] Output A Collection     gather Generated Sale Images ONLY (§3); reject any Output B (§18)
   ↓
[3] Layout Selection        choose CoverLayout + grid by mockupCount (§4)
   ↓
[4] Metadata Assembly       counts + primaries (deterministic modes) (§11; DM §3.9)
   ↓
[5] Typography              header/title/subtitle/views/footer/digital/notice/software (§6)
   ↓
[6] Color Strip             ordered swatches from LOCKED colors only (§7)
   ↓
[7] Badges                  digital/commercial/quality badges by rules (§8)
   ↓
[8] Prompt Composition      fill the cover module → MainCover.promptText + coverHash (§12)
```

Every stage is a pure function of inputs; identical inputs → identical cover prompt + identical `coverHash`/`promptChecksum` (§17; DM §18).

---

## 3. Source Image Rules

The cover uses **only Sale Images (Output A)** (§5 PRD; DM §3.9 type-level guarantee: `sourceSaleImageIds: readonly OutputAId[]`). Explicitly, the cover prompt and engine:

- **Never** use Preview images (Output B) — impossible by type, validated anyway (`RULE_COV_001`, §18).
- **Never** recreate mockups. **Never** redraw. **Never** crop important areas (print area, faces, garments). **Never** stretch. **Never** recolor. **Never** regenerate garments. **Never** change lighting. **Never** change models.

These are emitted verbatim in the Source Image Lock clause of every cover prompt (§12/§13). The engine only **arranges** existing images.

---

## 4. Dynamic Layout Engine

### 4.1 Count → layout mapping

`CoverLayout` (DM §2.1) is selected deterministically from `mockupCount` per DM [R3], extended with mosaic sub-grids for large counts. Ties/empties fill in deterministic RTL reading order (right→left, top→bottom).

| Mockups | `CoverLayout` | Grid (cols × rows) | Hero treatment |
|---|---|---|---|
| 1 | `Single` | 1×1 | full-bleed hero |
| **2** | `Duo` | 2×1 | two equal large images |
| 3 | `Triptych` | 3×1 | center/first slightly larger |
| **4** | `Grid2x2` | 2×2 | top-lead cell = hero |
| **6** | `Grid2x3` | 2×3 | first cell = hero |
| **8** | `Grid3x3` | 3×3 (8 of 9 filled) | hero spans 2×2; empty cell balanced |
| **10** | `Mosaic` | 4×3 (10 of 12) | hero spans 2×2 |
| **12** | `Mosaic` | 4×3 | hero spans 2×2 |
| **20** | `Mosaic` | 5×4 | hero spans 2×2 |
| **30** | `Mosaic` | 6×5 | hero spans 2×2 |
| **40** | `Mosaic` | 7×6 (40 of 42) | hero spans 2×2 |
| **50** | `Mosaic` | 8×7 (50 of 56) | hero spans 2×2 |

### 4.2 Grid derivation (deterministic)

For counts in the mosaic family: `cols = ceil(sqrt(count))`, `rows = ceil(count / cols)`; the **hero** occupies a 2×2 span at the RTL lead position (top-right); remaining Sale Images fill the grid in RTL reading order by image priority (§5). Empty trailing cells are balanced by enlarging neighboring cells symmetrically — never by inventing images. No randomness; the mapping is a pure function of `count`.

### 4.3 Scaling behavior

As count grows, individual cell size shrinks but the **hero stays dominant** (2×2 span) so the cover always reads "large mockups" (§0.1). Beyond 50, the same formula continues (`cols=ceil(sqrt(n))`), keeping the layout general and future-proof (§21). Layout is a composition **instruction** in the prompt; the Cover Engine never computes pixels — it specifies grid structure and relative sizes.

---

## 5. Image Priority

### 5.1 Priority classes

Which Sale Images appear larger is deterministic, driven by Scene Engine hero/support classification (SE §10) and image type:

```
Priority order (highest first):
  1. Hero        (SE hero scenes, on-model front, primaryProduct + primaryColor + primaryView)
  2. Support     (secondary on-model / alternate color)
  3. Detail / Close-up
  4. Flat Lay
  5. Folded
  6. Hanger
  7. Back View
```

### 5.2 Selection rules

- The **hero cell** takes the highest-priority Sale Image: an image matching `primaryProduct`, `primaryColor`, and `primaryView` (DM §3.9); ties break by scene number (`sceneOrder`, lexicographic `OutputAId`).
- Remaining cells fill by descending priority, then by scene order — fully deterministic, no randomness.
- Front views and on-model heroes are favored for larger cells (conversion, §2 PRD); back views and hanger shots fill smaller support cells.
- Every referenced image is a distinct `OutputAId`; duplicates are rejected (§18).

---

## 6. Typography System

All text is **deterministically generated from metadata** (§11); no free authoring, no random wording. Typography is restrained (small relative to images, §0.2). Text elements:

| Element | Content source | Example (resolved) |
|---|---|---|
| Header | season label (§10) + product family (§9) | "Father's Day — Bella Canvas 3001" |
| Main Title | product name + "Mockup Bundle" + count | "Bella Canvas 3001 Mockup Bundle — 20 Mockups" |
| Subtitle | audience + season mood | "Father's Day • Adult" |
| Views | distinct views used (§11) | "Front • Back • Detail" |
| Footer | shop-neutral listing line (no invented brand claims) | "Digital Mockup Set" |
| Digital Product | present only if `isDigitalProduct` | "Digital Download — No Physical Item" |
| Example Design Notice | fixed disclaimer that printed designs are examples | "Designs shown are examples only" |
| Compatible Software | generic compatibility line (no invented brand claims) | "Compatible with common image editors" |

Typography rules: minimal blocks, high legibility, small footprint, warm-neutral text color harmonizing with the canvas; **no readable text is placed on the garments** (that is the mockups' print area; the cover shows blank Sale Images) — text lives only in cover chrome. All strings are deterministic functions of session metadata; identical metadata → identical text (§17).

---

## 7. Color Strip Engine

### 7.1 Composition

A horizontal color strip is generated automatically from the session's **locked garment colors only** (`ColorSelection`, garment-color domain, RE §6). Decor/background colors are excluded (RE §6).

Each strip entry contains:

| Field | Source |
|---|---|
| Color Name | `Color.name` (DM §3.11) |
| Color Swatch | `Color.hex` (DM §3.11) |
| Order position | deterministic order (§7.2) |

### 7.2 Ordering (deterministic)

Strip order: `primaryColor` first (the mode, DM §3.9), then remaining locked colors in **lexicographic `ColorId` order**. No randomness. The count equals `colorCount` (§11). If colors are locked to White+Black, the strip shows exactly White then Black (or primary-first). Sand+Navy → Sand/Navy (RE §6, corrected).

### 7.3 Rules

- **Locked colors only.** A color not in the locked selection may never appear (`COVER_COLOR_001`, §19; RE §6).
- Swatches are drawn from `hex`; no recoloring of source images (§3).
- The strip is a small chrome element (bottom band), subordinate to the mockups (§16).

---

## 8. Information Badges

### 8.1 Badge set and rules

Badges are generated deterministically from session/project flags — no free choice.

| Badge | Arabic UI label | Shown when |
|---|---|---|
| High Resolution | دقة عالية | always (mockups are high-res) |
| PNG Included | يشمل PNG | `isDigitalProduct` true |
| Digital Download | تحميل رقمي | `isDigitalProduct` true |
| No Physical Item | لا يوجد منتج مادي | `isDigitalProduct` true |
| Commercial Use | استخدام تجاري | always (listing default) |
| Editable | قابل للتعديل | `isDigitalProduct` true |
| Instant Download | تحميل فوري | `isDigitalProduct` true |
| Premium Mockups | موك أب مميز | always |

### 8.2 Rules

- Digital-only badges appear **only** when `Project.isDigitalProduct` is true ([R6]); otherwise suppressed.
- Badges are small, grouped, low in the hierarchy (§16); they never crowd the mockups (§0.3).
- Badge text on the cover is English in the prompt output (PE §20); the Arabic labels above are the UI surface (UI §18). No invented certifications or claims.
- Badge set is deterministic: identical flags → identical badges in identical order (quality → digital → commercial).

---

## 9. Product Naming

Product names are **read from the `Product` manifest** (`Product.name`, `ProductKind`, DM §3.3), never hardcoded titles. Supported catalog (§6 PRD): Bella Canvas 3001, Comfort Colors, Kids, Hoodie, Crewneck, Tank, Polo, Oversized, Classic (T-Shirt), Raglan, Zip Hoodie.

Naming rules:

- Single product → its manifest `name`.
- Multiple products → `primaryProduct`'s name + "& More" (deterministic; `primaryProduct` = mode, DM §3.9).
- New products added as manifests appear automatically (§21) — no title hardcoding, satisfying §6/§15 expandability.

---

## 10. Season Labels

Season labels are **read from the `Season` manifest** (`Season.name`, `SeasonKind`, DM §3.4), automatically adjusting the header/subtitle (§6). Supported seasons (§7 PRD): Halloween, Christmas, Valentine's Day, Mother's Day, Father's Day, Back to School, Summer, Fall, Winter, Teacher, Minimal Studio.

Rules:

- The season label prefixes the header and appears in the subtitle mood.
- **Minimal Studio** produces a neutral label ("Studio") and the cleanest warm-neutral canvas (no seasonal decor styling, RE §16).
- New seasons added as manifests appear automatically (§21).

---

## 11. Dynamic Metadata

All listing metadata is generated automatically from the session (DM `CoverMetadata`, §3.9) — nothing is manually typed.

| Metadata | Derivation |
|---|---|
| Mockup Count | number of referenced Sale Images (`sourceSaleImageIds.length`) |
| View Count | distinct `GarmentView` among Sale Images |
| Color Count | distinct locked `ColorId` used |
| Product Count | distinct `ProductId` used |
| Season | `session.season` → `Season.name` |
| Audience | `session.audience` (`primaryAudience`, DM §3.9) |
| primaryProduct / primaryColor / primaryView | deterministic mode; tie → smallest ID/enum (DM §3.9; SE §19) |

`readMetadata.mockupCount` must equal `sourceSaleImageIds.length` (invariant, DM §5). All counts feed typography (§6) and layout (§4).

---

## 12. Cover Prompt Structure

The cover prompt is composed by filling the shared `cover` module (PE §2.1/§18) with resolved composition. Fixed section order:

```
[Global Rules]
Create ONE single premium Etsy listing cover image. Output exactly one image.
No collage of NEW artwork; arrange only the provided Sale Images. No readable text on the garments.
Warm neutral background (soft beige / off-white / warm grey). Do NOT use a green background.
Soft, even lighting; avoid dark side shadows and heavy vignette. Clean, uncluttered, generous white space.

[Source Image Lock]
Use ONLY the attached blank Sale Images (Output A): {{sourceSaleImageIds}}.
Never use any Preview (Output B). Preserve every source image EXACTLY: do not regenerate, redraw, recolor,
recrop important areas, stretch, or alter garments, faces, poses, lighting, folds, backgrounds, colors, or props.
Arrange the images only.

[Canvas]
Square listing canvas, warm neutral background, premium minimal aesthetic.

[Layout]
{{layout}} — grid {{cols}}×{{rows}}; hero image occupies a 2×2 span at the lead (top) position;
remaining Sale Images fill the grid in reading order by priority. Large mockups dominate the canvas.

[Metadata]
Product: {{primaryProduct.name}} ({{productCount}} product(s)); Season: {{season.name}};
Audience: {{primaryAudience}}; {{mockupCount}} mockups; {{viewCount}} views; {{colorCount}} colors.

[Typography]
Header: "{{header}}"; Main Title: "{{mainTitle}}"; Subtitle: "{{subtitle}}"; Views: "{{views}}";
Footer: "{{footer}}"; {{digitalLine?}}; Notice: "Designs shown are examples only";
Software: "Compatible with common image editors". Keep typography SMALL relative to the images; minimal blocks.

[Image Placement]
Hero = {{heroImage}} (primary product/color/front). Support images by priority: {{orderedSupportImages}}.
Front/on-model images larger; back/hanger/detail images smaller.

[Color Strip]
Bottom band, ordered swatches (primary first, then lexicographic): {{colorStrip: name+hex ...}}.
Locked colors only. Small, subordinate to the mockups.

[Badges]
Small badge group (low hierarchy): {{badges}}. Digital badges only if digital product.

[Final Rules]
Produce ONE cover image only. Preserve all Sale Images exactly. No green background. No dark side shadows.
No clutter. Large mockups, small text. Do NOT recreate or edit any mockup.
```

`{{...}}` are deterministic substitutions (PE §2.4). The Source Image Lock and Final Rules are always emitted and non-negotiable.

---

## 13. Source Lock

Absolutely forbidden in every cover prompt (emitted verbatim, §12):

regenerating mockups · changing garments · changing faces · changing poses · changing lighting · changing folds · changing backgrounds · changing colors · changing props.

The cover is an **arrangement of existing images**. Any composition intent that would alter a source image is a blocking `COVER_LOCK_001` (§19). This mirrors the Output B source-preservation philosophy (PE §5) but applies to the whole cover: **nothing about a Sale Image may change**.

---

## 14. Scaling Rules

Expressed as deterministic composition directives (relative, not pixel-exact):

- **Typography scaling:** title size scales *inversely and mildly* with `mockupCount` — larger counts use proportionally smaller text so mockups always dominate (§0.2/§16). Header > Main Title > Subtitle > Views > Footer/Badges in relative size, always.
- **Image size scaling:** hero holds a fixed 2×2 span; support cells shrink as `cols×rows` grows (§4.2), keeping the hero dominant at every count.
- **Spacing:** uniform gutters between cells; gutter proportion decreases slightly as count grows to preserve image area, never below a legibility minimum (§15).
- **Margins:** fixed proportional outer margin (warm-neutral frame) at all counts (§15).

All scaling is a pure function of `mockupCount`; identical count → identical scaling directives.

---

## 15. White Space Rules

- **Minimum margins:** a proportional outer margin of warm-neutral space is always reserved; content never bleeds to the edge (except a full-bleed single hero at count 1).
- **Padding:** consistent inner padding around text blocks and the badge group.
- **Alignment:** RTL-aware alignment of chrome; images align to the grid; the color strip spans the bottom band.
- **Balance:** empty trailing grid cells are balanced by symmetric neighbor enlargement (§4.2), never by clutter or invented images.
- **Hierarchy:** white space enforces separation between mockups (dominant), title (secondary), and badges/strip (tertiary) — the anti-clutter guarantee (§0.3).

---

## 16. Visual Hierarchy

Fixed, deterministic hierarchy (highest to lowest):

```
1. Image dominance   — mockups fill most of the canvas; hero is largest (2×2)
2. Typography        — Header > Main Title > Subtitle > Views > Footer
3. Color hierarchy   — warm neutral canvas; primary color emphasized in strip; swatches subordinate
4. Badge hierarchy   — quality (High Res/Premium) > digital (Download/PNG) > commercial; small, grouped, lowest
```

No element outranks the mockups. Text and badges are always visually secondary (§0.2/§0.3).

---

## 17. Performance

- **Large bundles (50 mockups):** the cover references up to 50 `OutputAId`s; the engine composes prompt text only (no image processing), so composition cost is bounded and small.
- **Memory:** the engine holds references (IDs) and metadata, not image bytes; source images are attached by the user/image tool at execution, not loaded by the engine.
- **Caching:** `coverHash` (DM §3.9) caches the composition; if `sourceSaleImageIds` + `layout` + `readMetadata` are unchanged, the cached cover prompt is reused (idempotence, ARCH §1.3). `promptChecksum` (DM §3.17) detects any change.
- **Determinism at scale:** layout derivation (`ceil(sqrt(n))`, §4.2) and ordering are O(n) pure functions; a 50-mockup cover composes identically every run.

---

## 18. Validation

Before emitting a cover prompt, the engine validates and **rejects**:

| Rejected | Condition | Code | Severity |
|---|---|---|---|
| Preview images | any `sourceSaleImageIds` entry resolves to Output B | `COVER_SRC_001` / `RULE_COV_001` | blocking |
| Duplicate images | the same `OutputAId` appears twice | `COVER_DUP_001` | blocking |
| Wrong counts | `readMetadata.mockupCount !== sourceSaleImageIds.length` | `COVER_COUNT_001` | blocking |
| Wrong colors | a strip color not in the locked selection | `COVER_COLOR_001` / `RULE_PAL_002` | blocking |
| Missing metadata | required `CoverMetadata` field absent | `COVER_META_001` | blocking |
| Barrier not met | `allOutputAReady !== true` | `COVER_BARRIER_001` / `RULE_COV_002` | blocking |
| Layout mismatch | `layout` inconsistent with `mockupCount` mapping (§4) | `COVER_LAYOUT_001` / `RULE_COV_003` | blocking |

Any blocking rejection halts cover composition; the UI Cover Manager shows the reason (UI §3.9). Warnings (non-blocking) never mutate selections (RE §13).

---

## 19. Error Handling (Arabic messages)

Codes `COVER_<AREA>_<NNN>`; `originEngine = EngineId.Cover` (DM §3.13); cross-referenced to `RULE_*` where applicable. Objects conform to `ValidationFailure` (DM §3.13).

| Code | Cross-ref | messageAr | messageEn |
|---|---|---|---|
| `COVER_BARRIER_001` | `RULE_COV_002` | لا يمكن إنشاء الغلاف قبل اكتمال جميع صور البيع (A). | Cover blocked until all Sale Images (A) are ready. |
| `COVER_SRC_001` | `RULE_COV_001` | الغلاف يستخدم صور البيع (A) فقط ولا يستخدم صور المعاينة (B). | Cover must use Sale Images (A) only, never Previews (B). |
| `COVER_LOCK_001` | — | ممنوع تعديل أو إعادة توليد أي صورة مصدر في الغلاف. | Altering/regenerating any source image is forbidden. |
| `COVER_DUP_001` | — | توجد صورة بيع مكررة في الغلاف. | Duplicate Sale Image in the cover. |
| `COVER_COUNT_001` | — | عدد الموك أب لا يطابق عدد صور البيع. | Mockup count mismatches Sale Image count. |
| `COVER_COLOR_001` | `RULE_PAL_002` | يوجد لون في شريط الألوان خارج الألوان المقفلة. | Strip color outside the locked selection. |
| `COVER_META_001` | — | بيانات الغلاف ناقصة. | Missing cover metadata. |
| `COVER_LAYOUT_001` | `RULE_COV_003` | تخطيط الغلاف لا يطابق عدد الموك أب. | Cover layout does not match mockup count. |
| `COVER_GREENBG_001` | — | خلفية خضراء غير مسموحة افتراضيًا؛ استخدم خلفية محايدة دافئة. | Green background not allowed by default; use warm neutral. |
| `COVER_VAR_001` | — | متغيّر غير محلول في قالب الغلاف. | Unresolved variable in cover template. |

All are blocking except where a warning is explicitly appropriate (e.g. near-limit typography density → warning). A blocking cover error prevents the cover prompt from being emitted (§14 PRD; UI §3.9).

---

## 20. Prompt Examples

Placeholders shown resolved. Each produces exactly **one** cover image; all preserve Sale Images exactly.

### 20.1 Two mockups (Duo)
```
Create ONE premium Etsy listing cover image. Output exactly one image. Warm neutral background
(soft beige). Do NOT use a green background. Soft even lighting; no dark side shadows. Clean, uncluttered.
SOURCE LOCK: use ONLY the attached blank Sale Images (Output A): 1A, 2A. Never use Preview (B).
Preserve every image EXACTLY — do not regenerate, redraw, recolor, recrop, stretch, or alter garments,
faces, poses, lighting, folds, backgrounds, colors, or props. Arrange only.
LAYOUT: Duo, grid 2×1; two equal large mockups dominating the canvas.
METADATA: Bella Canvas 3001; Minimal Studio; Adult; 2 mockups; 1 view; 2 colors.
TYPOGRAPHY (small): Header "Bella Canvas 3001"; Title "Mockup Bundle — 2 Mockups"; Subtitle "Studio • Adult";
Views "Front"; Notice "Designs shown are examples only"; Software "Compatible with common image editors".
COLOR STRIP (bottom): White (#FFFFFF), Black (#000000). Locked colors only, small.
BADGES (small, low): High Resolution, Commercial Use, Premium Mockups.
FINAL: ONE cover image only. Large mockups, small text. Preserve all Sale Images exactly. No green background.
```

### 20.2 Four mockups (Grid 2×2, hero lead)
```
Create ONE premium Etsy listing cover image. Output exactly one image. Warm neutral background. No green.
Soft even light; no dark side shadows. Uncluttered.
SOURCE LOCK: use ONLY Sale Images (A): 1A, 2A, 3A, 4A. Never use B. Preserve every image EXACTLY (no
regenerate/redraw/recolor/recrop/stretch/alter). Arrange only.
LAYOUT: Grid 2×2; lead (top) cell = hero (primary product/color/front); other three fill by priority (RTL).
METADATA: Comfort Colors; Summer; Adult; 4 mockups; 2 views; 2 colors.
TYPOGRAPHY (small): Header "Summer — Comfort Colors"; Title "Comfort Colors Mockup Bundle — 4 Mockups";
Subtitle "Summer • Adult"; Views "Front • Back".
COLOR STRIP: Sand (#C2B280), Aqua (#7FDBDA). Locked only.
BADGES: High Resolution, Digital Download, PNG Included, No Physical Item, Commercial Use, Premium Mockups.
FINAL: ONE cover image only. Large mockups dominate; small text. Preserve all Sale Images exactly.
```

### 20.3 Eight mockups (Grid 3×3, hero spans 2×2)
```
Create ONE premium Etsy listing cover image. Output exactly one image. Warm neutral background. No green.
Soft even light; no dark shadows. Uncluttered, generous white space.
SOURCE LOCK: use ONLY Sale Images (A): 1A–8A. Never use B. Preserve every image EXACTLY. Arrange only.
LAYOUT: Grid 3×3 (8 of 9 cells); hero spans 2×2 at the lead; remaining 4 fill by priority; balance the empty cell.
METADATA: Hoodie; Fall; Adult; 8 mockups; 3 views; 3 colors.
TYPOGRAPHY (small): Header "Fall — Hoodie"; Title "Hoodie Mockup Bundle — 8 Mockups"; Subtitle "Fall • Adult";
Views "Front • Back • Detail".
COLOR STRIP: Rust (#B7410E), Olive (#708238), Charcoal (#36454F). Locked only.
BADGES: High Resolution, Digital Download, PNG Included, Commercial Use, Editable, Premium Mockups.
FINAL: ONE cover image only. Hero dominant; small text. Preserve all Sale Images exactly. No green background.
```

### 20.4 Twenty mockups (Mosaic 5×4)
```
Create ONE premium Etsy listing cover image. Output exactly one image. Warm neutral background. No green.
Soft even light; no dark side shadows. Clean, uncluttered.
SOURCE LOCK: use ONLY Sale Images (A): 1A–20A. Never use B. Preserve every image EXACTLY. Arrange only.
LAYOUT: Mosaic, grid 5×4; hero spans 2×2 at the lead; 16 support images fill by priority (front/on-model larger,
back/hanger/detail smaller), RTL reading order.
METADATA: Bella Canvas 3001 & More; Father's Day; Adult; 20 mockups; 3 views; 4 colors.
TYPOGRAPHY (small, reduced for count): Header "Father's Day — Bella Canvas 3001"; Title "Mockup Bundle — 20 Mockups";
Subtitle "Father's Day • Adult"; Views "Front • Back • Detail".
COLOR STRIP: Navy (#1F2A44), Charcoal (#36454F), Tan (#D2B48C), White (#FFFFFF). Locked only.
BADGES: High Resolution, Digital Download, PNG Included, No Physical Item, Commercial Use, Instant Download, Premium.
FINAL: ONE cover image only. Large mockups dominate; typography small. Preserve every Sale Image exactly.
```

### 20.5 Fifty mockups (Mosaic 8×7)
```
Create ONE premium Etsy listing cover image. Output exactly one image. Warm neutral background. No green.
Soft even light; no dark side shadows. Uncluttered despite volume; generous gutters.
SOURCE LOCK: use ONLY Sale Images (A): 1A–50A. Never use B. Preserve every image EXACTLY — no regenerate,
redraw, recolor, recrop, stretch, or alteration of garments/faces/poses/lighting/folds/backgrounds/colors/props.
LAYOUT: Mosaic, grid 8×7 (50 of 56 cells); hero spans 2×2 at the lead; 46 support images fill by priority, RTL;
balance trailing empty cells by symmetric neighbor enlargement. Hero remains dominant.
METADATA: Bella Canvas 3001 & More; Christmas; Adult; 50 mockups; 4 views; 6 colors.
TYPOGRAPHY (smallest tier for large count): Header "Christmas — Bella Canvas 3001"; Title "Mega Mockup Bundle —
50 Mockups"; Subtitle "Christmas • Adult"; Views "Front • Back • Side • Detail".
COLOR STRIP: Red (#B3261E), Green (#1E5631), White (#FFFFFF), Gold (#C9A227), Navy (#1F2A44), Charcoal (#36454F).
Locked only, primary first then lexicographic.
BADGES: High Resolution, Digital Download, PNG Included, No Physical Item, Commercial Use, Editable, Instant, Premium.
FINAL: ONE cover image only. Large mockups dominate; text minimal. Preserve all 50 Sale Images exactly. No green bg.
```

---

## 21. Future Compatibility

The Cover Engine is data-driven; content grows without engine changes:

| Add… | Mechanism | Cover Engine change |
|---|---|---|
| Future products | new `Product` manifests; names read from `Product.name` (§9) | none — resolved by ID |
| Future seasons | new `Season` manifests; labels read from `Season.name` (§10) | none |
| Future layouts | the `ceil(sqrt(n))` mosaic formula generalizes to any count; new `CoverLayout` values added as an additive enum + migration (DM §16) | additive only |
| Future typography | new typography plan fields via the shared `cover` module version (`templateVersion`/`moduleVersions`, PE §19) | version bump, deterministic |
| Future badges | new badge rules keyed to project/session flags | additive rule entry |

No product/season/layout/badge is hardcoded; every one is resolved from manifests or metadata (§6/§15 PRD expandability).

---

## 22. Acceptance Criteria (44)

- **AC-1** Cover prompt produces exactly one image.
- **AC-2** Cover uses Sale Images (Output A) only.
- **AC-3** Cover never references any Preview (Output B).
- **AC-4** Cover never recreates, redraws, or edits any mockup.
- **AC-5** Source Image Lock clause present in every cover prompt.
- **AC-6** Every source image preserved exactly (no recolor/stretch/crop/regenerate).
- **AC-7** Faces/poses/lighting/folds/backgrounds/colors/props unchanged (§13).
- **AC-8** Default background is warm neutral; never green.
- **AC-9** Soft even lighting; no dark side shadows.
- **AC-10** Layout auto-selected from mockup count (§4).
- **AC-11** Correct grid for 2/4/6/8/10/12/20/30/40/50.
- **AC-12** Hero image is the largest (2×2 span for counts ≥ 8).
- **AC-13** Large mockups dominate; typography is smaller.
- **AC-14** Clutter avoided; generous white space.
- **AC-15** Image priority order applied (hero>support>detail>flat>folded>hanger>back).
- **AC-16** Typography generated from metadata only; no free text.
- **AC-17** Header/Title/Subtitle/Views/Footer present per rules.
- **AC-18** Digital lines/badges only when `isDigitalProduct`.
- **AC-19** Example-design notice present.
- **AC-20** Compatible-software line present; no invented brand claims.
- **AC-21** Color strip from locked colors only.
- **AC-22** Strip order: primary first, then lexicographic.
- **AC-23** Strip color count equals `colorCount`.
- **AC-24** Badges deterministic per flags and order.
- **AC-25** Product names read from manifest, not hardcoded.
- **AC-26** Multi-product → primary + "& More".
- **AC-27** Season labels read from manifest.
- **AC-28** Minimal Studio → neutral label + cleanest canvas.
- **AC-29** Metadata counts auto-derived (mockup/view/color/product).
- **AC-30** `mockupCount === sourceSaleImageIds.length`.
- **AC-31** Primaries are deterministic modes with ID tie-break.
- **AC-32** Cover barrier enforced (`allOutputAReady`); blocked otherwise.
- **AC-33** Duplicate Sale Image rejected.
- **AC-34** Wrong color rejected.
- **AC-35** Missing metadata rejected.
- **AC-36** Layout/count mismatch rejected.
- **AC-37** Green-background request rejected/overridden.
- **AC-38** Identical inputs → identical cover prompt text.
- **AC-39** Identical inputs → identical `coverHash`/`promptChecksum`.
- **AC-40** No timestamps in cover checksum.
- **AC-41** No randomness in layout, ordering, or wording.
- **AC-42** 50-mockup cover composes deterministically and remains uncluttered.
- **AC-43** Cover prompt is English; UI labels Arabic (PE §20; UI §18).
- **AC-44** Cover Engine emits prompt text only — never an image.

## 23. QA Tests (62)

```
Source purity & lock
[ ] T01 Cover references only Output A ids.
[ ] T02 Any Output B id ⇒ COVER_SRC_001.
[ ] T03 Source Image Lock clause present.
[ ] T04 Prompt forbids regenerating mockups.
[ ] T05 Prompt forbids changing garments.
[ ] T06 Prompt forbids changing faces.
[ ] T07 Prompt forbids changing poses.
[ ] T08 Prompt forbids changing lighting.
[ ] T09 Prompt forbids changing folds.
[ ] T10 Prompt forbids changing backgrounds.
[ ] T11 Prompt forbids changing colors.
[ ] T12 Prompt forbids changing props.
[ ] T13 Prompt forbids stretch/recrop of important areas.

One image & premium doctrine
[ ] T14 Cover prompt asks for exactly one image.
[ ] T15 Warm neutral background specified.
[ ] T16 Green background never default; request ⇒ COVER_GREENBG_001.
[ ] T17 Soft even lighting; no dark side shadows.
[ ] T18 Clutter avoided; white-space clause present.
[ ] T19 Large mockups + small typography stated.

Layout
[ ] T20 count 2 ⇒ Duo 2×1.
[ ] T21 count 4 ⇒ Grid 2×2.
[ ] T22 count 6 ⇒ Grid 2×3.
[ ] T23 count 8 ⇒ Grid 3×3 (hero 2×2).
[ ] T24 count 10 ⇒ Mosaic 4×3.
[ ] T25 count 12 ⇒ Mosaic 4×3.
[ ] T26 count 20 ⇒ Mosaic 5×4.
[ ] T27 count 30 ⇒ Mosaic 6×5.
[ ] T28 count 40 ⇒ Mosaic 7×6.
[ ] T29 count 50 ⇒ Mosaic 8×7.
[ ] T30 Layout ≠ count mapping ⇒ COVER_LAYOUT_001.
[ ] T31 Hero spans 2×2 for counts ≥ 8.
[ ] T32 Empty trailing cells balanced, not filled with invented images.

Image priority
[ ] T33 Hero = primary product/color/front.
[ ] T34 Support ordered by priority then scene order.
[ ] T35 Front/on-model larger; back/hanger smaller.
[ ] T36 Duplicate Sale Image ⇒ COVER_DUP_001.

Typography & metadata
[ ] T37 Header from season+product.
[ ] T38 Title includes product + count.
[ ] T39 Subtitle includes audience+season.
[ ] T40 Views list matches distinct views.
[ ] T41 Digital line only if isDigitalProduct.
[ ] T42 Example-design notice present.
[ ] T43 Compatible-software line present; no invented claims.
[ ] T44 Missing metadata ⇒ COVER_META_001.
[ ] T45 mockupCount ≠ image count ⇒ COVER_COUNT_001.

Color strip
[ ] T46 Strip uses locked colors only.
[ ] T47 Non-locked color ⇒ COVER_COLOR_001.
[ ] T48 Strip order primary-first then lexicographic.
[ ] T49 Strip count = colorCount.
[ ] T50 Sand+Navy strip = Sand,Navy (not White/Black).

Badges & naming
[ ] T51 Digital badges only when digital.
[ ] T52 Commercial + Premium always present.
[ ] T53 Product name read from manifest.
[ ] T54 Multi-product ⇒ primary + "& More".
[ ] T55 Season label from manifest; Minimal Studio neutral.

Barrier, determinism, performance
[ ] T56 allOutputAReady false ⇒ COVER_BARRIER_001.
[ ] T57 Identical inputs ⇒ identical cover prompt.
[ ] T58 Identical inputs ⇒ identical coverHash/promptChecksum.
[ ] T59 Timestamp change ⇒ checksum unchanged.
[ ] T60 50-mockup cover composes without clutter.
[ ] T61 coverHash cache reused when sources+layout+metadata unchanged.
[ ] T62 Engine emits prompt text only; never an image or edit.
```

### 23.1 Edge cases
1. Single product single color → strip = one swatch; title uses that product.
2. Minimal Studio → neutral label, warm-neutral canvas, no seasonal styling.
3. Odd count (e.g. 7) → grid_3x3 with 2 empties balanced.
4. Very large count (>50) → `ceil(sqrt(n))` continues; hero stays 2×2.
5. All-back-view session → back views used; hero still the highest-priority available (SE §5).
6. Digital = false → digital badges/line suppressed; Commercial/Premium remain.

---

## 24. Compatibility Appendix

### 24.1 PRD (`01_PRD.md`)
- [x] Cover after all Sale Images; uses Sale Images (A) only; never Previews; auto-reads product/colors/count/views/season/digital; layout by count (§5; §2/§3/§4/§11 here).
- [x] Cover generated only after all Sale Images exist (barrier, §5; §2 here).

### 24.2 Architecture (`02_ARCHITECTURE.md`)
- [x] Cover Engine (ARCH §3 #5) owns layout/metadata/composition; runs last, after Prompt (ARCH §3).
- [x] Deterministic, cached via `coverHash`; data-driven expandability (ARCH §10; §17/§21 here).

### 24.3 Data Model (`03_DATA_MODELS_FINAL.md`)
- [x] Writes `MainCover.*`: `sourceSaleImageIds` (OutputA only), `layout` (`CoverLayout`), `readMetadata` + primaries, `coverHash`, `promptHash`, `promptMeta` (DM §3.9/§3.17).
- [x] Deterministic primaries + `[R3]` layout mapping used exactly; barrier via `allOutputAReady` (DM §3.2/§3.9; RE §8).

### 24.4 Rule Engine (`04_RULE_ENGINE_REVISED.md`)
- [x] Cover purity/barrier/layout enforced; errors cross-ref `RULE_COV_001/002/003`, `RULE_PAL_002` (RE §14; §18/§19 here).
- [x] Garment-color domain respected in color strip (RE §6). Blocking halts; warnings never mutate (RE §13).

### 24.5 Scene Engine (`05_SCENE_ENGINE.md`)
- [x] Consumes `CoverMetadata` + primaries prepared by SE §19; image priority from SE hero/support (SE §5/§10; §5/§11 here).

### 24.6 Prompt Engine (`06_PROMPT_ENGINE.md`)
- [x] Cover composed only from Cover metadata; Sale Images A only; no garment redesign; source lock; large images, small text; adapts to count; English prompt (PE §18/§20; §12 here).
- [x] Cover boundary reconciled: Cover Engine fills the shared `cover` module (PE §2.1) and owns layout/composition (§1.5 here).

### 24.7 UI Engine (`07_UI_ENGINE.md`)
- [x] Cover Manager gated by `allOutputAReady`; Copy Cover semantics; Arabic UI labels vs English prompt (UI §3.9/§11/§18; §8/§12 here).

---

*End of Cover Engine specification. Sourced only from `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, and `07_UI_ENGINE.md`. Specification and prompt-template content only — no application code, JavaScript/TypeScript implementation, HTML, CSS, or React. The Cover Engine composes only the Cover Prompt; it never creates mockups, edits images, or generates artwork. Sale Images (Output A) only; every source image preserved exactly; warm neutral background, never green by default; large mockups, small typography; fully deterministic.*
