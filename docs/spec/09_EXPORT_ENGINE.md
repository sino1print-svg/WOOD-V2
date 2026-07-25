# 09_EXPORT_ENGINE.md

# Mockup Photoshoot Director — Export Engine Specification

**Document type:** Engine Specification (specification only)
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`, `08_COVER_ENGINE.md`
**Status:** Authoritative baseline for engineering
**Scope note:** Specification only — no application code, no JavaScript/TypeScript implementation, no HTML/CSS/React. Entity/enum/branded-ID names are those of `03_DATA_MODELS_FINAL.md` (DM). UI is Arabic RTL (UI §18); exported prompt content is English and preserved **byte-for-byte**. Everything is deterministic.

**Mission (absolute):** The Export Engine is responsible for **every artifact that leaves the application** — prompts, plans, project data, backups, metadata, checksums, and ZIP packages — in a deterministic, recoverable, user-friendly structure. It **formats and packages authoritative data only**; it **never modifies** prompt content, scene data, numbering, colors, groups, or cover metadata.

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `DM` = `03_DATA_MODELS_FINAL.md`. `RE` = `04_RULE_ENGINE_REVISED.md`. `SE` = `05_SCENE_ENGINE.md`. `PE` = `06_PROMPT_ENGINE.md`. `UI` = `07_UI_ENGINE.md`. `CE` = `08_COVER_ENGINE.md`.

---

## 0. Export Doctrine (non-negotiable)

1. **Read-only.** The engine reads authoritative persisted state and emits copies. It never mutates any entity (ARCH §3 Export Coordinator; DM §20).
2. **Byte-for-byte prompts.** `OutputA/B.promptText`, `MainCover.promptText`, `Group.groupPromptText` are exported exactly as stored — no reflow, no trimming, no re-casing, no synonym substitution (PE §20).
3. **A/B linkage preserved.** Every exported Output B retains its `sourceOutputAId` reference and its matching number (§7).
4. **Numbering preserved.** `{n}A`/`{n}B` and group numbering are identical across every channel and round-trip (§7).
5. **One prompt = one image.** Every multi-prompt artifact restates: separate requests, all A first, then each B with its matching A + PNG (PE §3; §5/§16).
6. **Cover purity.** Cover exports reference Sale Images (Output A) only, never Output B (CE §3; PE §18).
7. **No runtime leakage.** `EvaluationContext` and `Resolved*` objects are **never** persisted or exported (DM §3.15/§3.16).
8. **No silent overwrite. No silent omission.** Every overwrite confirms (UI §14); every omission is listed (§18).
9. **Deterministic.** Identical state + versions → identical bytes, filenames, ordering, and checksums (ARCH §1.3).
10. **Arabic UI, English content.** Labels/toasts Arabic RTL; prompt payloads English LTR (UI §18).

---

## 1. Purpose, Responsibilities, Inputs, Outputs, Ownership

### 1.1 Purpose

The Export Engine is ARCH §3's Export Coordinator. It resolves an export **scope**, validates it, selects and orders the authoritative artifacts, formats them (Clipboard/TXT/Markdown/JSON/ZIP), computes SHA-256 checksums, packages them, delivers them (download/clipboard), and emits an audit event (§23). It realizes PRD §12 export/copy features.

### 1.2 Responsibilities (owns)

Ownership of: the `ExportManifest` (§13), export file naming (§12), export ordering (§6), checksum computation over exported artifacts (§14), packaging structure (§11), clipboard payload assembly (§5), backup/restore packaging (§15), Prompt Pack assembly (§16), and export audit events (§23).

### 1.3 Reads (never modifies)

`Project`, `PhotoshootSession`, `Scene`, `OutputA`, `OutputB`, `Group`, `MainCover`, `CoverMetadata`, `Artwork` (metadata only), `PromptMetadata`, `ValidationResult`, `VersionSnapshot`, `SessionFingerprint`, and library versions (`RuleSet.schemaVersion`, prompt-module `SemVer`). All read-only.

### 1.4 Must never modify

Prompt text, scene data, numbering (`sceneOrder`), colors (`ColorSelection`), groups (`Group`), cover metadata (`CoverMetadata`), hashes, or any persisted field. The engine copies; it does not edit (§0.1/§0.2).

### 1.5 Consumers of exported artifacts

- The **user** (clipboard paste into an external image tool; PE §17 manual execution).
- **External image tools** (Prompt Pack, §16).
- **Backup/restore** (this engine, §15).
- **Version diff / audit** (Persistence; DM §3.14).
- **Future integrations** (cloud/team, §27 — future-only).

---

## 2. Export Pipeline

Deterministic, gated stages. A blocking validation halts before any bytes are produced (§17).

```
[1] Export Intent        user/UI selects scope + format(s) (UI §3.10/§11)
   ↓
[2] Scope Resolution     resolve scope → concrete artifact set (§3)
   ↓
[3] Validation           block on unresolved/invalid artifacts (§17); warnings collected
   ↓
[4] Artifact Selection   gather authoritative entities (read-only)
   ↓
[5] Ordering             apply stable ordering (§6)
   ↓
[6] Formatting           render per format, prompt text byte-for-byte (§4/§8/§9/§10)
   ↓
[7] Checksum Generation  SHA-256 per artifact + manifest (§14)
   ↓
[8] Packaging            assemble clipboard string / TXT / MD / JSON / ZIP (§11)
   ↓
[9] Download / Clipboard deliver; confirm (§5/§20)
   ↓
[10] Audit Event         emit ExportStarted→Completed/Failed (§23)
```

Each stage is a pure function of inputs; identical inputs + versions → identical outputs and checksums (§0.9).

---

## 3. Export Scopes

The Export Engine's operational scope taxonomy refines DM `ExportScope` (`Output`, `Group`, `Cover`, `Session`, `All`). Refinements (Output A/B, Pair, Group A/B, Execution Plan, Complete Project, Backup, Version Snapshot, Prompt Pack) are **export-layer selectors** over authoritative entities; the persisted `export-manifest` records the base DM `ExportScope` plus a `scopeDetail` string (no domain-model change).

| Operational scope | DM base | Maps to entities | Contents |
|---|---|---|---|
| Output A | `Output` | one `OutputA` | one `{n}A` prompt |
| Output B | `Output` | one `OutputB` (+ `sourceOutputAId`) | one `{n}B` prompt (references `{n}A`) |
| Pair | `Output` | `OutputA` + `OutputB` of one scene | `{n}A` then `{n}B` as **two separate blocks** + separate-request banner |
| Group | `Group` | one `Group` + its scenes | group A+B blocks in scene order + group plan |
| Group A | `Group` | group's `OutputA[]` | all `{g}.{s}-A` |
| Group B | `Group` | group's `OutputB[]` | all `{g}.{s}-B` |
| Cover | `Cover` | `MainCover` (Output A refs only) | cover prompt + cover metadata |
| Session | `Session` | one `PhotoshootSession` | all scenes' A/B, groups, plan, cover |
| Execution Plan | `Session` | session two-phase plan (PE §17) | Phase 1 A list, Phase 2 B-using-A list |
| Complete Project | `All` | `Project` + all sessions | everything, structured (§11) |
| Backup | `All` | `Project` + `versionHistory` | full restorable backup (§15) |
| Version Snapshot | `All` | one `VersionSnapshot` | single snapshot export (§15) |
| Prompt Pack | `All`/`Session` | session prompts + plan + README | manual-execution package (§16) |
| All | `All` | project + cover + plan | session + cover, ordered (PE §15) |

Every scope resolution is deterministic; an empty or invalid scope is blocked (`EXPORT_SCOPE_001`, §19).

---

## 4. Export Formats

The engine supports five delivery formats. DM `ExportFormat` persists `Txt`/`Json`/`Zip`; **Clipboard** and **Markdown** are recognized export-layer formats (future-additive to the persisted enum if ever persisted — §27). For each format:

| Aspect | Clipboard | TXT | Markdown | JSON | ZIP |
|---|---|---|---|---|---|
| Content structure | ordered prompt blocks + banner | §8 sections | §9 sections | §10 schema | §11 tree |
| Encoding | UTF-8 (system clipboard) | UTF-8 (no BOM) | UTF-8 (no BOM) | UTF-8 (no BOM) | UTF-8 entries |
| Newline policy | `LF` within content | `LF` | `LF` | `LF` | `LF` in text entries |
| Directionality | Arabic labels RTL, English prompts LTR (bidi-isolated) | same | same | data is direction-neutral; UI renders | same |
| File naming | n/a | §12 | §12 | §12 | §11/§12 |
| Metadata | banner header only | Metadata + Checksums sections | YAML front matter | manifest + `PromptMetadata` | `manifest.json` |
| Checksums | none (transient) | Checksums section (§14) | Hashes section (§14) | `checksums` object (§14) | `checksums.sha256` file |
| Validation | §17 pre-check | §17 | §17 | §17 | §17 |
| Error recovery | retry/fallback (§5) | re-export | re-export | re-export | re-package (§19) |

Common rules: prompt text is emitted byte-for-byte (§0.2); timestamps are excluded from content checksums (§14); no locale-dependent transformation (§6).

---

## 5. Clipboard System

Clipboard actions place **English prompt text** on the system clipboard with an Arabic toast (UI §11). Mapping (mirrors PE §15 / UI §11):

| Action | Clipboard content |
|---|---|
| Copy A | one `{n}A` prompt |
| Copy B | one `{n}B` prompt (references `{n}A`) |
| Copy Pair | `{n}A` + `{n}B` as two separate blocks + banner |
| Copy Group | group A+B blocks + group plan + banner |
| Copy Group A | all group A prompts |
| Copy Group B | all group B prompts |
| Copy Cover | cover prompt (Sale Images A only) |
| Copy Execution Plan | full Phase 1 + Phase 2 plan (PE §17) |
| Copy Session | all groups in order + cover note |
| Copy All | session + cover, ordered |

### 5.1 Mandatory banner (every multi-prompt clipboard export)

```
NOTE: Each numbered prompt is a SEPARATE image request. Never combine prompts into one generation.
Generate ALL A images first. Then generate each B using its matching A and the uploaded PNG.
```

(The banner text is English within the payload; the UI toast is Arabic.)

### 5.2 Delivery behavior

- **Success confirmation:** Arabic toast «تم النسخ» + item label (UI §15); 2-second auto-dismiss.
- **Failure handling:** clipboard unavailable/denied → `EXPORT_CLIP_001`/`EXPORT_CLIP_002` (§19); show a blocking toast with **Retry** and a **fallback** offer.
- **Retry:** re-attempts the same deterministic payload.
- **Clipboard fallback:** if the system clipboard is denied, offer a TXT download of the identical payload (same bytes, same checksum) so no content is lost.
- **Arabic toasts:** all clipboard messages are Arabic (§20).

---

## 6. Stable Ordering

Ordering is deterministic and driven **only** by persisted order arrays and branded IDs — never by filesystem, locale, or randomness.

| Level | Order key |
|---|---|
| Projects | `createdAt` ascending, then `projectId` byte-lexicographic |
| Sessions | `Project.sessionOrder` (DM §3.1) |
| Groups | group `key` byte-lexicographic (SE §18) |
| Scenes | `PhotoshootSession.sceneOrder` (DM §3.2) |
| Outputs | Output A before Output B; within kind, by scene number |
| A prompts | `sceneOrder` ascending (Phase 1) |
| B prompts | `sceneOrder` ascending (Phase 2), each after its A |
| Cover | always last within a session |
| Metadata | fixed canonical section order (§8/§9/§10) |
| Files inside ZIP | entry path byte-lexicographic ascending (§11) |

Rules: **no filesystem-dependent ordering** (never rely on directory read order), **no locale-dependent sorting** (byte order, not collation), **no randomness**. Byte-lexicographic = ordinal comparison of UTF-8 bytes.

---

## 7. Numbering Preservation

### 7.1 Scheme (from PE §14)

```
Scene 1 → Prompt 1A, Prompt 1B
Scene 2 → Prompt 2A, Prompt 2B
Group numbering → {group}.{scene}-A / {group}.{scene}-B   e.g. 1.1-A, 1.1-B
```

`{n}` is the 1-based position in `sceneOrder`; group form adds the group index.

### 7.2 Cross-channel invariance

Numbering is **identical** across Clipboard, TXT, Markdown, JSON, ZIP, and across Save/Load/Restore/Regeneration. Because numbering derives purely from `sceneOrder` (persisted) and the stable branded IDs are carried in metadata, a re-export reproduces identical numbers. The **stable internal IDs** (`OutputAId`/`OutputBId`) are always retained in JSON/manifest so A/B linkage survives even if display numbers change.

### 7.3 Explicit user reordering

If the user explicitly reorders scenes (UI §5), `sceneOrder` changes and display numbering is **recomputed deterministically** from the new order. The A/B linkage is preserved via `sourceOutputAId` (unchanged branded IDs); only the positional `{n}` labels shift. Exports after a reorder reflect the new deterministic numbering; the manifest records both the number and the stable ID so consumers can reconcile.

---

## 8. TXT Export

Plain UTF-8 (no BOM), `LF` newlines. Sections in fixed order; each prompt is delimited so it remains **independently copyable**.

```
================ PROJECT HEADER ================
Project: {{project.name}}   (Arabic name preserved; LTR fields marked)
Export ID: {{exportId}}   |   App: {{applicationVersion}}   |   Generator: {{generatorVersion}}

================ SESSION SUMMARY ===============
Session: {{session.name}}   |   Season: {{season.name}}   |   Audience: {{audience}}
Products: {{product list}}   |   Colors: {{locked colors}}   |   Scene Count: {{requestedSceneCount}}

---- PRODUCTS ----     {{productIds → names}}
---- COLORS ----       {{ColorId → name #hex, primary first}}
---- SEASON ----       {{season}}
---- AUDIENCE ----     {{audience}}
---- SCENE COUNT ----  {{count}}

================ GROUP INDEX ===================
{{group number, groupBy, key, member scene numbers}}

================ PHASE 1 — A PROMPTS ===========
----- PROMPT 1A -----
{{OutputA.promptText verbatim}}
----- END 1A -----
----- PROMPT 2A -----
...
================ PHASE 2 — B PROMPTS ===========
----- PROMPT 1B (uses 1A + PNG) -----
{{OutputB.promptText verbatim}}
----- END 1B -----
...
================ GROUP PLANS ===================
{{Group.groupPromptText per group}}

================ COVER PROMPT ==================
{{MainCover.promptText verbatim — Sale Images A only}}

================ METADATA ======================
{{counts, primaries, versions, PromptMetadata}}

================ CHECKSUMS =====================
{{sha256 per prompt + manifest checksum}}

================ ERRORS / WARNINGS =============
{{blocking (if partial) + warnings list, §18}}
```

Separators (`----- PROMPT nA -----` … `----- END nA -----`) guarantee each prompt is independently selectable. Prompt bodies are byte-for-byte (§0.2). The banner (§5.1) precedes Phase 1.

---

## 9. Markdown Export

UTF-8, `LF`. English prompt text in fenced code blocks (```` ``` ````) so it copies cleanly and is never reflowed.

```
---
exportId: {{exportId}}
schemaVersion: {{exportSchemaVersion}}
projectId: {{projectId}}
applicationVersion: {{applicationVersion}}
generatorVersion: {{generatorVersion}}
ruleSetVersions: {{...}}
promptModuleVersions: {{...}}
sessionFingerprint: {{hash}}
exportedAt: {{iso}}   # excluded from checksums
---

# {{project.name}}

## Table of Contents
- Project Summary
- Session Summary
- Groups
- Phase 1 — A Prompts
- Phase 2 — B Prompts
- Cover
- Execution Plan
- Hashes & Versions
- Validation Summary
- Compatibility Notes

## Project Summary
{{...}}

## Session Summary
{{season / audience / products / colors / count}}

## Groups
{{group index tables}}

## Phase 1 — A Prompts
### Prompt 1A
```
{{OutputA.promptText verbatim}}
```
...

## Phase 2 — B Prompts
### Prompt 1B (uses 1A + PNG)
```
{{OutputB.promptText verbatim}}
```
...

## Cover
```
{{MainCover.promptText verbatim}}
```

## Execution Plan
{{Phase 1 list, then Phase 2 B-using-A list}}

## Hashes & Versions
{{promptHash / promptChecksum / coverHash / versions}}

## Validation Summary
{{passed/blocking/warnings, §17}}

## Compatibility Notes
{{document set consistency; §28}}
```

Fenced blocks preserve prompt bytes; the front matter is metadata (excluded from content checksums where noted, §14).

---

## 10. JSON Export

Canonical JSON: UTF-8, `LF`, **sorted keys** (byte-lexicographic), `2`-space indent for readability variant / minified for checksum variant (both defined). Numbers are integers/decimals as stored; branded IDs serialized as their **string value** (the brand is compile-time only).

### 10.1 Top-level shape (field contract)

| Field | Source | Notes |
|---|---|---|
| `schemaVersion` | export schema | export format version |
| `exportedAt` | now (ISO) | **excluded from checksums** |
| `generatorVersion` | app | SemVer |
| `project` | `Project` (persisted fields) | no runtime fields |
| `sessions` | `PhotoshootSession[]` | includes `SessionFingerprint` |
| `scenes` | `Scene[]` | dimensions + `sceneHash/Fingerprint/Version` + `dedupSignature` |
| `outputsA` | `OutputA[]` | `promptText`, hashes, `promptMeta` |
| `outputsB` | `OutputB[]` | `sourceOutputAId`, `artworkId`, hashes |
| `groups` | `Group[]` | `groupBy`, `key`, `sceneIds` |
| `cover` | `MainCover` | Output A refs only |
| `artworks` | `Artwork[]` **metadata only** | no bytes; no local paths |
| `promptMetadata` | `PromptMetadata` | versions + checksums |
| `validationResults` | `ValidationResult[]` | failures with codes |
| `versionHistory` | `VersionSnapshot[]` | `stateHash`; state serialized |
| `exportManifest` | `ExportManifest` (§13) | file list + checksums |
| `checksums` | per-payload SHA-256 (§14) | canonical |

### 10.2 Persisted vs runtime vs excluded

- **Exported (persisted):** every entity in DM §3.1–3.14, 3.17–3.18.
- **Never exported (runtime-only):** `EvaluationContext` (DM §3.15) and `Resolved*` (DM §3.16) — **must never** be serialized (§0.7; hard constraint).
- **Excluded (secrets/local):** absolute local file paths, `AssetRef` internal handles resolved to opaque tokens only, browser storage keys, temporary file references, hidden user identifiers, `ownerRef` when it encodes a local token (§21).

### 10.3 Serialization rules

- **Canonical key ordering:** byte-lexicographic across all objects (deterministic).
- **Null handling:** optional absent fields are **omitted** (not `null`) in the canonical checksum variant; the readable variant may show `null` — checksums are computed over the canonical variant only.
- **Branded ID serialization:** the string value only (e.g. `"scene_01"`); no brand wrapper.
- **Migration compatibility:** `schemaVersion` per DM §16 enables forward migration on import; a newer-than-app export is rejected on restore (§15).

---

## 11. ZIP Export

Deterministic archive. Folder tree:

```
{{project-slug}}/
  manifest.json
  README.md
  checksums.sha256
  project/
    project.json
    versions/
      {{versionId}}.json
  session-01/
    session-summary.md
    execution-plan.txt
    groups/
      group-01.txt
      ...
    prompts/
      A/
        001_{{slug}}_A.txt
        ...
      B/
        001_{{slug}}_B.txt
        ...
      pairs/
        001_pair_execution.md
        ...
    cover/
      cover-prompt.txt        # Output A references only
      cover-metadata.json
    metadata/
      prompt-metadata.json
      validation.json
  session-02/ ...
  assets/
    artwork-metadata/
      {{artworkId}}.json      # metadata only; NO image bytes
  backup/
    backup.json               # full restorable snapshot (§15)
```

Rendered image files are **never** included unless a future authorized source provides them (§27).

### 11.1 ZIP determinism rules

| Concern | Rule |
|---|---|
| Folder naming | ASCII-safe slug (§12); `session-NN` zero-padded |
| File naming | §12 policy |
| Duplicate names | append collision suffix `_2`, `_3` … deterministically by order |
| Unsafe characters | stripped/replaced per §12 |
| Unicode normalization | NFC; ASCII-safe slug for paths, original name kept in metadata |
| Maximum path length | ≤ 200 chars per full entry path (Windows-safe margin) |
| Empty folders | omitted (never emit empty directories) |
| Compression | fixed method + fixed level (deterministic); identical input → identical entry bytes |
| Timestamps | **fixed epoch** `1980-01-01T00:00:00Z` on every entry (or excluded from checksum) — no wall-clock time |
| Entry ordering | byte-lexicographic by path (§6) |

`checksums.sha256` lists SHA-256 of every entry (content, canonical). The archive's integrity is verified against `manifest.json` (§13).

---

## 12. File Naming Policy

### 12.1 Pattern

```
{{seq}}_{{slug}}_{{kind}}.{{ext}}
```

Examples:
```
001_bella-canvas-front_A.txt
001_bella-canvas-front_B.txt
001_pair_execution.md
cover-prompt.txt
group-01.txt
```

- `seq` = zero-padded scene number from `sceneOrder` (`001`, `002`, …).
- `slug` = deterministic ASCII slug of product + view/display (lowercase, hyphenated).
- `kind` = `A` | `B` | `pair` | `cover` | `group-NN` | `backup` | `version-{{id}}` | `prompt-pack`.
- `ext` = `txt` | `md` | `json` | `sha256`.

### 12.2 Safety rules

| Rule | Behavior |
|---|---|
| Stable | derived from persisted order + IDs; unchanged across exports |
| Human-readable | product/view slug included |
| Cross-platform | ASCII only in path segments |
| No reserved Windows names | `CON, PRN, AUX, NUL, COM1–9, LPT1–9` → prefixed (`file-con`) |
| No invalid path chars | `< > : " / \ | ? *` and control chars stripped/replaced with `-` |
| Length limits | segment ≤ 60 chars; full path ≤ 200 |
| Collision suffixes | `_2`, `_3` appended deterministically by export order |
| Arabic project names | folder/file use ASCII-safe transliteration/slug; **original Arabic name retained in `manifest.json` + README** (§20) |
| Internal stable IDs | `OutputAId`/`OutputBId`/`SceneId` retained in metadata for reconciliation |

Slug transliteration is a fixed deterministic mapping (no locale library dependence); unmappable characters become `-` and the exact original name is preserved in metadata so nothing is lost.

---

## 13. Export Manifest

`ExportManifest` is a data contract (fields below); it persists via `export-manifest.schema.json` (ARCH §5.11) extended for export bookkeeping. No implementation — contract only.

| Field | Type | Meaning |
|---|---|---|
| `exportId` | string (uuid-like, deterministic per export request content) | unique export identity |
| `schemaVersion` | number | export manifest schema version |
| `projectId` | `ProjectId` (string) | source project |
| `sessionIds` | `SessionId[]` | included sessions |
| `exportScope` | DM `ExportScope` + `scopeDetail` | base scope + refinement (§3) |
| `exportFormats` | (`ExportFormat` + `clipboard`/`markdown`) | delivered formats (§4) |
| `createdAt` | `IsoTimestamp` | **excluded from checksums** |
| `applicationVersion` | `SemVer` | app version |
| `generatorVersion` | `SemVer` | export generator version |
| `ruleSetVersions` | map `RuleSetId → SchemaVersion` | active rule-set versions |
| `promptModuleVersions` | map `PromptModuleType → SemVer` | module versions (PE §19) |
| `includedFiles` | list of `{ path, kind }` | every file in the package |
| `fileSizes` | map `path → bytes` | size per file |
| `checksums` | map `path → Sha256` | SHA-256 per file (§14) |
| `warnings` | list of `{ code, messageAr, messageEn }` | non-blocking notices (§18/§19) |
| `sourceFingerprints` | `{ sessionFingerprint, sceneFingerprints[], coverHash }` | provenance (DM §3.5/§3.9/§3.18) |

### 13.1 Manifest example (abridged)

```json
{
  "exportId": "exp_9f2c",
  "schemaVersion": 1,
  "projectId": "proj_01",
  "sessionIds": ["sess_01"],
  "exportScope": "all",
  "scopeDetail": "complete_project",
  "exportFormats": ["zip", "json"],
  "createdAt": "2026-07-16T10:00:00.000Z",
  "applicationVersion": "1.0.0",
  "generatorVersion": "1.0.0",
  "ruleSetVersions": { "ruleset_fathers_day": 3 },
  "promptModuleVersions": { "global": "1.0.0", "output_a": "1.0.0", "output_b": "1.0.0", "cover": "1.0.0" },
  "includedFiles": [ { "path": "session-01/prompts/A/001_bella-canvas-front_A.txt", "kind": "A" } ],
  "fileSizes": { "session-01/prompts/A/001_bella-canvas-front_A.txt": 742 },
  "checksums": { "session-01/prompts/A/001_bella-canvas-front_A.txt": "aa11...ff" },
  "warnings": [],
  "sourceFingerprints": { "sessionFingerprint": "9f2c...a1", "coverHash": "cc33...dd" }
}
```

---

## 14. Checksum Policy

**Algorithm:** SHA-256 over a canonical serialization.

**Canonical serialization:** UTF-8 (no BOM); `LF` newlines; prompt text hashed **byte-for-byte as stored** (no normalization of English content); JSON in canonical form (sorted keys, absent-optional omitted, §10.3); trailing-whitespace preserved (content is authoritative).

**Checksummed artifacts:** individual files; each prompt text; each JSON payload; the project archive; the ZIP `manifest.json`; the backup; each version snapshot.

**Exclusions:** `createdAt`/`exportedAt`/`generatedAt` and any wall-clock timestamp are **excluded** from content checksums; ZIP entry timestamps are fixed (§11.1) so they never affect the archive digest.

**Change semantics:**

| Change | Checksum effect |
|---|---|
| Prompt text changes (scene/module/template) | that prompt's `promptHash` + file checksum **change** (PE §19) |
| Cover sources/layout/metadata change | `coverHash` + cover file checksum **change** (CE §17) |
| Export time changes only | all content checksums **unchanged** (timestamps excluded) |
| Reorder scenes (renumber only) | file **names** change; prompt-content checksums **unchanged** (bytes identical); manifest checksum changes (file list changed) |

---

## 15. Backup and Restore

### 15.1 Backup types

| Type | Contents |
|---|---|
| Full Project Backup | `Project` + all sessions + `versionHistory` + manifest |
| Session-only Backup | one `PhotoshootSession` + its scenes/outputs/groups/cover |
| Version Snapshot Export | one `VersionSnapshot` (with `stateHash`) |

### 15.2 Restore workflow (safe)

```
Select backup → Restore Preview (read-only diff vs current) → Restore Validation
  → choose Merge or Replace → confirm (UI §14) → apply → verify → audit event
```

Rules:

- **Restore Preview:** shows what would change; nothing applied yet.
- **Restore Validation:** schema-version check (DM §16), checksum verification, structural integrity.
- **Migration:** older schema → migrate forward (DM §11/§16); **newer schema → rejected** (`EXPORT_RESTORE_002` / version mismatch, UI §14).
- **Merge vs Replace:** Merge folds a backup into the current project (new IDs where needed); Replace swaps the project — **both confirm**; **never a silent overwrite** (§0.8; hard constraint).
- **Rollback on failure:** if any step fails, the current project is left **unchanged** (transactional restore); partial application is never committed.
- **Corruption detection:** checksum/structure mismatch → `EXPORT_CHECKSUM_001`/`EXPORT_RESTORE_001`; offer **partial recovery** of intact sessions.
- **Missing libraries:** if a referenced season/product/rule-set library is absent, restore the data but flag dependent scenes as blocked (UI §20) — no silent drop.

---

## 16. Prompt Pack Export

A dedicated package for **manual execution in external image tools**. Contents:

| Item | Source |
|---|---|
| README | Arabic usage guide + English execution notes |
| Complete Execution Plan | PE §17 (Phase 1 all A, Phase 2 each B using A) |
| All A prompts | `OutputA.promptText` files (A/) |
| All B prompts | `OutputB.promptText` files (B/) |
| Group plans | `Group.groupPromptText` |
| Cover prompt | `MainCover.promptText` (Output A only) |
| Source requirements | which `{n}A` image each `{n}B` needs |
| PNG artwork requirement | uploaded PNG required for every B (PE §5) |
| A-before-B ordering | explicit phase note |
| One-prompt-one-image warning | banner (§5.1) |
| Missing-source behavior | PE §6 states (planned/blocked/ready/stale) |
| Numbering map | `{n}` ↔ `OutputAId`/`OutputBId` table |

The Prompt Pack contains **no image bytes**; it is instructions + prompt text so the user runs each single-image request themselves (UI §0.2/§23).

---

## 17. Validation Before Export

Export is **blocked** (nothing emitted) when any of these hold:

| Blocking condition | Code |
|---|---|
| Unresolved prompt variable | `EXPORT_PROMPTVAR_001` (PE `PROMPT_VAR_001`) |
| Invalid numbering (order/keys mismatch) | `EXPORT_NUM_001` |
| Missing required Output A prompt | `EXPORT_MISSINGA_001` |
| Broken A/B linkage | `EXPORT_LINK_001` |
| Output B without source A | `EXPORT_SRC_001` (PE `PROMPT_SRC_001`) |
| Output B without artwork metadata | `EXPORT_PNG_001` (PE `PROMPT_PNG_001`) |
| Stale Output B claimed current | `EXPORT_STALE_001` (PE `PROMPT_STALE_001`) |
| Cover references Output B | `EXPORT_COVER_001` (RE `RULE_COV_001`) |
| Wrong cover count | `EXPORT_COVERCOUNT_001` (CE `COVER_COUNT_001`) |
| Invalid group membership | `EXPORT_GROUP_001` |
| Checksum mismatch | `EXPORT_CHECKSUM_001` |
| Corrupted project data | `EXPORT_CORRUPT_001` |
| Unsupported schema version | `EXPORT_SCHEMA_001` |

**Blocking vs warning:** conditions that would produce an incorrect or misleading artifact are **blocking** (halt that artifact). Conditions that merely limit completeness (e.g. B prompts not yet runnable because PNG not uploaded) are **warnings** that permit **partial export** (§18) with an explicit omissions list. Warnings never mutate data (RE §13).

---

## 18. Partial Export

Partial export is allowed when the requested scope contains some valid and some blocked artifacts, and the valid subset is independently correct. Examples:

- Export **all A prompts** before any PNG is uploaded (B prompts omitted — listed).
- Export **one valid group** while another group is blocked.
- Export a **project backup** despite prompt-generation failures (data backup is valid even if prompts are incomplete).
- Export **metadata** without a cover (cover barrier not yet met).
- Export **cover only after** the barrier passes (`allOutputAReady`, RE §8).

Rules: every partial export **explicitly lists omissions and warnings** in the manifest `warnings`, the TXT "Errors/Warnings" section, and the Markdown "Validation Summary" — **no silent omission** (§0.8; hard constraint). The delivered subset is deterministic and independently valid.

---

## 19. Error Handling (Arabic + English)

Codes `EXPORT_<AREA>_<NNN>`; `originEngine = EngineId.Export` (DM §3.13); conform to `ValidationFailure` shape.

| Code | Condition | Severity | messageAr | messageEn |
|---|---|---|---|---|
| `EXPORT_CLIP_001` | clipboard unavailable | blocking | تعذّر الوصول إلى الحافظة. | Clipboard unavailable. |
| `EXPORT_CLIP_002` | clipboard permission denied | blocking | تم رفض إذن الحافظة؛ استخدم تنزيل TXT كبديل. | Clipboard denied; use TXT fallback. |
| `EXPORT_FILE_001` | file creation failed | blocking | تعذّر إنشاء الملف. | File creation failed. |
| `EXPORT_ZIP_001` | ZIP creation failed | blocking | تعذّر إنشاء حزمة ZIP. | ZIP creation failed. |
| `EXPORT_SCOPE_001` | invalid scope | blocking | نطاق التصدير غير صالح. | Invalid export scope. |
| `EXPORT_SCOPE_002` | empty scope | blocking | لا يوجد محتوى ضمن النطاق المحدد. | Empty export scope. |
| `EXPORT_MISSINGA_001` | missing required Output A | blocking | برومبت صورة البيع (A) مفقود. | Missing Output A prompt. |
| `EXPORT_LINK_001` | broken A/B linkage | blocking | ارتباط A/B مكسور. | Broken A/B linkage. |
| `EXPORT_PNG_001` | missing artwork metadata | warning/blocking | بيانات التصميم PNG مفقودة. | Missing artwork metadata. |
| `EXPORT_STALE_001` | stale Output B | warning/blocking | صورة المعاينة قديمة. | Stale preview. |
| `EXPORT_COVER_001` | cover uses Output B | blocking | الغلاف يستخدم صور البيع (A) فقط. | Cover must use Output A only. |
| `EXPORT_COVERCOUNT_001` | wrong cover count | blocking | عدد صور الغلاف غير صحيح. | Wrong cover count. |
| `EXPORT_FILENAME_001` | invalid filename | blocking | اسم ملف غير صالح. | Invalid filename. |
| `EXPORT_PATH_001` | path too long | blocking | مسار الملف طويل جدًا. | Path too long. |
| `EXPORT_CHECKSUM_001` | checksum failure | blocking | فشل التحقق من المجموع (SHA-256). | Checksum failure. |
| `EXPORT_CORRUPT_001` | corrupted backup/project | blocking | نسخة احتياطية/مشروع تالف. | Corrupted backup/project. |
| `EXPORT_SCHEMA_001` | unsupported schema | blocking | إصدار المخطط غير مدعوم. | Unsupported schema version. |
| `EXPORT_RESTORE_001` | restore conflict | blocking | تعارض في الاستعادة؛ يلزم التأكيد. | Restore conflict; confirmation required. |
| `EXPORT_RESTORE_002` | newer schema on restore | blocking | نسخة أحدث من التطبيق؛ لا يمكن الاستعادة. | Backup newer than app; cannot restore. |
| `EXPORT_STORAGE_001` | insufficient storage | blocking | مساحة التخزين غير كافية. | Insufficient storage. |
| `EXPORT_CANCELLED_001` | export cancelled | info | تم إلغاء التصدير. | Export cancelled. |

---

## 20. Arabic UI Behavior

- **Arabic labels/toasts/progress/success/blocking messages** for every export action (UI §15/§18).
- **Exported English prompts remain LTR**; the payload is not reordered by bidi. Files/JSON are direction-neutral data.
- **Mixed RTL/LTR:** UI wraps English tokens (IDs, checksums, filenames) in bidi isolation to prevent reordering artifacts.
- **Unicode normalization:** NFC for all names; ASCII-safe slugs for paths (§12).
- **Arabic project names in file names:** paths use the ASCII slug; the **original Arabic name is preserved** in `manifest.json`, README, and JSON metadata, so the human name is never lost.
- Progress messages: «جارٍ التصدير… %{{n}}»; success: «تم التصدير بنجاح»; blocking: «تعذّر التصدير» + code.

---

## 21. Security and Privacy

- **No secrets in exports** — no API keys, tokens, or credentials.
- **No absolute local paths** — `AssetRef` exported as opaque tokens only; no filesystem paths.
- **No browser storage keys / temporary file references / hidden user identifiers.**
- **Artwork metadata vs bytes:** only artwork **metadata** (`format`, dimensions, `aspectRatio`, `contentHash`) is exported — **never image bytes** (unless a future authorized source, §27).
- **Safe JSON parsing** on import: reject oversized/deeply-nested payloads (bomb protection); no code evaluation.
- **ZIP path-traversal protection** on import: reject entries containing `..`, absolute paths, or symlinks.
- **File-size limits** and **decompression-bomb protection**: cap uncompressed size and compression ratio; abort with `EXPORT_STORAGE_001`/`EXPORT_CORRUPT_001`.
- **Backup validation:** verify checksums + schema before applying (§15).
- `ownerRef` and any local-only token are excluded from exports (§10.2).

---

## 22. Performance

- **50 scenes / 100 prompts:** export is O(n) over ordered artifacts; prompt bodies are copied, not recomputed.
- **Multiple groups / large version history:** groups and snapshots stream into their folders in stable order (§6).
- **Large JSON backup:** canonical serialization is single-pass; snapshots use structural sharing references (DM §3.14) rather than duplicating state.
- **ZIP memory use:** entries are added in sorted order and can be **streamed** to the archive rather than held fully in memory; spec permits streaming or in-memory, both deterministic.
- **Progress reporting:** per-artifact progress events (§23) drive the Arabic progress toast (§20).
- **Cancellation:** an export may be cancelled between stages; a cancelled export produces **no partial file** and emits `ExportFailed`/`EXPORT_CANCELLED_001` (§23).
- **Retry:** re-running an identical export reproduces identical bytes/checksums (idempotent).

---

## 23. Events and Audit

Data contracts (fields), extending DM §3.19 event model. No implementation.

| Event | Key fields |
|---|---|
| `ExportStarted` | `exportId`, `scope`, `formats`, `projectId`, `sessionIds`, `emittedBy=Export` |
| `ExportCompleted` | `exportId`, `fileCount`, `totalBytes`, `manifestChecksum` |
| `ExportFailed` | `exportId`, `code`, `stage` |
| `BackupCreated` | `exportId`, `backupType`, `stateHash` |
| `RestoreStarted` | `backupId`, `mode` (merge/replace) |
| `RestoreCompleted` | `backupId`, `appliedChanges` |
| `RestoreFailed` | `backupId`, `code`, `rolledBack: true` |
| `ClipboardCopyCompleted` | `scope`, `payloadChecksum` |
| `ClipboardCopyFailed` | `scope`, `code` |

Audit requirements: every export/restore emits a start and a terminal (completed/failed) event; events are append-only, timestamped (timestamps excluded from content checksums), and reference entities by ID. Events never contain prompt bytes or secrets — only identifiers, counts, and checksums.

---

## 24. Acceptance Criteria (54)

- **AC-1** Export never mutates any persisted entity.
- **AC-2** Prompt text is exported byte-for-byte.
- **AC-3** Output A appears before Output B everywhere.
- **AC-4** Execution plan is two-phase: all A, then each B using its A.
- **AC-5** `{n}A`/`{n}B` numbering identical across clipboard/TXT/MD/JSON/ZIP.
- **AC-6** Numbering identical across save/load/restore/regeneration.
- **AC-7** A/B linkage (`sourceOutputAId`) preserved in every format.
- **AC-8** One-prompt-one-image banner present in every multi-prompt export.
- **AC-9** Cover exports reference Output A only.
- **AC-10** Cover with Output B reference is blocked (`EXPORT_COVER_001`).
- **AC-11** `EvaluationContext`/`Resolved*` never appear in any export.
- **AC-12** No secrets, absolute paths, storage keys, or user identifiers exported.
- **AC-13** Artwork metadata only; no image bytes.
- **AC-14** SHA-256 checksums produced for files/prompts/JSON/archive/backup.
- **AC-15** Timestamps excluded from content checksums.
- **AC-16** Export-time change does not alter content checksums.
- **AC-17** Prompt change alters that prompt's checksum.
- **AC-18** Deterministic ordering from persisted arrays + branded IDs.
- **AC-19** No locale-dependent sorting; byte-lexicographic only.
- **AC-20** No filesystem-dependent ordering.
- **AC-21** ZIP entries sorted by path; fixed epoch timestamps.
- **AC-22** Identical inputs → identical ZIP bytes and manifest checksum.
- **AC-23** File names ASCII-safe, cross-platform, ≤ limits.
- **AC-24** Reserved Windows names avoided.
- **AC-25** Invalid path characters stripped/replaced.
- **AC-26** Collision suffixes deterministic.
- **AC-27** Arabic project name preserved in metadata; ASCII slug in paths.
- **AC-28** Empty folders omitted.
- **AC-29** JSON keys canonically sorted; absent optionals omitted in checksum variant.
- **AC-30** Branded IDs serialized as plain strings.
- **AC-31** JSON `schemaVersion` present; migration-compatible.
- **AC-32** Manifest lists every file with size + checksum.
- **AC-33** Manifest records rule-set + prompt-module versions.
- **AC-34** Manifest records source fingerprints.
- **AC-35** Partial export lists all omissions and warnings.
- **AC-36** No silent omission.
- **AC-37** No silent overwrite; restore Merge/Replace confirm.
- **AC-38** Restore is transactional; rollback on failure leaves project unchanged.
- **AC-39** Newer-schema backup rejected on restore.
- **AC-40** Older-schema backup migrated forward.
- **AC-41** Corrupted backup detected via checksum; partial recovery offered.
- **AC-42** Missing libraries flagged, not silently dropped.
- **AC-43** Clipboard success shows Arabic toast.
- **AC-44** Clipboard denial offers identical-bytes TXT fallback.
- **AC-45** Prompt Pack includes README, plan, A, B, group plans, cover, numbering map.
- **AC-46** Prompt Pack states A-before-B + PNG requirement + missing-source behavior.
- **AC-47** Blocking validation halts the affected artifact.
- **AC-48** Arabic UI messages; English prompt content.
- **AC-49** Mixed RTL/LTR bidi-isolated; no reordering of English payload.
- **AC-50** ZIP import rejects path traversal and decompression bombs.
- **AC-51** Cancellation leaves no partial file; emits `ExportFailed`.
- **AC-52** 50-scene / 100-prompt export completes deterministically.
- **AC-53** Every export emits start + terminal audit events.
- **AC-54** Re-export is idempotent (identical bytes/checksums).

## 25. QA Test Plan (84)

```
Clipboard
[ ] T01 Copy A copies one prompt + toast.
[ ] T02 Copy B copies one prompt referencing {n}A.
[ ] T03 Copy Pair emits two separate blocks + banner.
[ ] T04 Copy Group / Group A / Group B ordered by scene number.
[ ] T05 Copy Execution Plan = Phase 1 then Phase 2.
[ ] T06 Copy Cover uses Output A only.
[ ] T07 Copy All = session + cover ordered.
[ ] T08 Clipboard unavailable ⇒ EXPORT_CLIP_001 + retry.
[ ] T09 Clipboard denied ⇒ EXPORT_CLIP_002 + TXT fallback.
[ ] T10 Banner present on every multi-prompt copy.

TXT
[ ] T11 All required sections present in order.
[ ] T12 Prompt bodies byte-for-byte.
[ ] T13 Separators make each prompt independently copyable.
[ ] T14 Phase 1 before Phase 2.
[ ] T15 Cover section uses Output A only.
[ ] T16 Checksums section present.
[ ] T17 Errors/Warnings section lists omissions.

Markdown
[ ] T18 Front matter metadata present.
[ ] T19 TOC present.
[ ] T20 Prompts in fenced code blocks (no reflow).
[ ] T21 Hashes & versions section present.
[ ] T22 Validation summary present.
[ ] T23 Execution plan two-phase.

JSON
[ ] T24 Canonical sorted keys.
[ ] T25 Branded IDs as plain strings.
[ ] T26 Absent optionals omitted in checksum variant.
[ ] T27 Runtime objects (EvaluationContext/Resolved*) absent.
[ ] T28 No local paths/secrets.
[ ] T29 Artwork metadata only; no bytes.
[ ] T30 schemaVersion present.
[ ] T31 outputsB carry sourceOutputAId.
[ ] T32 validationResults included with codes.

ZIP
[ ] T33 Folder tree matches spec.
[ ] T34 Entries sorted by path.
[ ] T35 Fixed epoch timestamps.
[ ] T36 Identical inputs ⇒ identical archive checksum.
[ ] T37 Empty folders omitted.
[ ] T38 checksums.sha256 lists all entries.
[ ] T39 No image bytes included.
[ ] T40 manifest.json validates against §13.
[ ] T41 README includes Arabic guide.

Naming
[ ] T42 Pattern seq_slug_kind.ext.
[ ] T43 Reserved Windows name prefixed.
[ ] T44 Invalid chars stripped.
[ ] T45 Path ≤ 200; segment ≤ 60.
[ ] T46 Collision suffix deterministic.
[ ] T47 Arabic name preserved in metadata; ASCII slug path.

Checksums
[ ] T48 SHA-256 per file.
[ ] T49 Timestamp change ⇒ content checksum unchanged.
[ ] T50 Prompt change ⇒ prompt checksum changes.
[ ] T51 Reorder ⇒ names change, prompt-content checksums unchanged.
[ ] T52 Manifest checksum reflects file list.

Backup
[ ] T53 Full backup restorable.
[ ] T54 Session-only backup restorable.
[ ] T55 Version snapshot export includes stateHash.
[ ] T56 Backup excludes runtime/secret fields.

Restore
[ ] T57 Restore Preview applies nothing.
[ ] T58 Restore Validation checks schema + checksums.
[ ] T59 Merge vs Replace both confirm (no silent overwrite).
[ ] T60 Failure ⇒ rollback; project unchanged.
[ ] T61 Newer schema ⇒ EXPORT_RESTORE_002.
[ ] T62 Older schema ⇒ migrate forward.
[ ] T63 Corrupted backup ⇒ EXPORT_CHECKSUM_001 + partial recovery.
[ ] T64 Missing libraries flagged, not dropped.

Partial export
[ ] T65 All A before PNG ⇒ B omitted + listed.
[ ] T66 One valid group exported while another blocked.
[ ] T67 Backup despite prompt failures.
[ ] T68 Metadata without cover.
[ ] T69 Cover only after barrier.
[ ] T70 Omissions listed in manifest + TXT + MD.

Failure
[ ] T71 Invalid scope ⇒ EXPORT_SCOPE_001.
[ ] T72 Empty scope ⇒ EXPORT_SCOPE_002.
[ ] T73 Broken A/B linkage ⇒ EXPORT_LINK_001.
[ ] T74 Output B without A ⇒ EXPORT_SRC_001.
[ ] T75 Cover uses B ⇒ EXPORT_COVER_001.
[ ] T76 Cancellation ⇒ no partial file + ExportFailed.

Windows compatibility
[ ] T77 CON/PRN/NUL prefixed; opens on Windows.
[ ] T78 No `:*?"<>|` in any path.

Arabic filenames
[ ] T79 Arabic project name → ASCII slug + preserved metadata.
[ ] T80 NFC normalization applied.

Stress
[ ] T81 50 scenes / 100 prompts export deterministic.
[ ] T82 Large version history export streams in order.
[ ] T83 ZIP of 50-scene project reproducible byte-for-byte.

Regression
[ ] T84 Re-export after no change ⇒ identical bytes/checksums.
```

## 26. Edge Cases (32)

1. One scene → `1A`/`1B` only; plan still two-phase.
2. No artwork uploaded yet → export all A; B omitted + listed.
3. One blocked B (missing PNG) → other B's export; blocked one listed.
4. Duplicate project names → export folder gets collision suffix; internal IDs distinguish.
5. Mixed Arabic + English project name → NFC; ASCII slug path; original preserved.
6. Very long project name → truncated slug + hash suffix; full name in metadata.
7. Invalid Windows filename input → sanitized deterministically.
8. Empty group → omitted from ZIP (no empty folder); noted in manifest.
9. Scene removed after prompt generation → renumber; stale references pruned; export consistent.
10. Renumbered scene → new `{n}` labels; stable IDs retained; content checksums unchanged.
11. Stale B (source A changed) → `EXPORT_STALE_001`; export blocked or warned per §17.
12. Missing cover (barrier not met) → export without cover; omission listed.
13. 50 scenes → mosaic-scale package; deterministic.
14. Multiple sessions → `session-01/`, `session-02/` … stable order.
15. Corrupted version history → detected; partial recovery of intact snapshots.
16. Newer-schema backup → restore rejected (`EXPORT_RESTORE_002`).
17. Older-schema backup → migrated forward on restore.
18. Clipboard denied → TXT fallback with identical bytes.
19. Insufficient storage during ZIP → `EXPORT_STORAGE_001`; no partial file.
20. Decompression bomb on import → aborted (`EXPORT_CORRUPT_001`).
21. ZIP with `..` entry on import → rejected (path traversal).
22. Two colors Sand+Navy → color metadata reflects locked set (not White/Black).
23. Digital product false → digital badges/lines absent in exported cover metadata.
24. All-back-view session → exports preserve views; hero references intact.
25. Prompt with unresolved variable → export blocked (`EXPORT_PROMPTVAR_001`).
26. Group membership violation (mixed groupBy) → `EXPORT_GROUP_001`.
27. Wrong cover count vs images → `EXPORT_COVERCOUNT_001`.
28. Checksum mismatch on re-verify → `EXPORT_CHECKSUM_001`.
29. Export cancelled mid-ZIP → no artifact; `ExportFailed`.
30. Two products, primary tie → deterministic smallest-ID primary in metadata.
31. Session fingerprint identical across two exports → identical content checksums.
32. Restore Merge creating ID collisions → new IDs assigned deterministically; no overwrite.

---

## 27. Future Compatibility (future-only extension points)

Marked future-only; not current user-facing features:

| Extension | Mechanism |
|---|---|
| New export formats | add a format renderer + enum value (additive to `ExportFormat`; DM §16 migration) |
| Cloud backup | a new delivery channel behind the same manifest/checksum contract |
| Direct external-tool integration | an authorized consumer of Prompt Pack (§16) |
| Rendered-image packaging | only when an **authorized image source** provides bytes; folder slots reserved (`prompts/`, `cover/`) but empty until then |
| New prompt artifact types | new scope entries mapping to new entities; manifest is generic |
| New checksum algorithms | `Sha256` brand isolates the choice; a future `HashRef { algo, digest }` can replace it (DM §17 note) |
| Team/multi-user exports | `PersistenceMode` beyond `LocalSingleUser`; manifest gains owner/authorization fields (additive) |
| Signed manifests | add a signature field over the manifest checksum; verification optional |

All extension points are additive and preserve determinism; none changes existing export bytes for existing scopes.

---

## 28. Compatibility Appendix

### 28.1 PRD (`01_PRD.md`)
- [x] Export supports Copy Output/Group/Cover/Session/All + TXT/JSON/ZIP (§12; §3/§4/§5 here).
- [x] Save/Load/Duplicate/Version History surfaced via backup/restore (§13; §15 here).

### 28.2 Architecture (`02_ARCHITECTURE.md`)
- [x] Export Coordinator role; streamed/staged export for large sessions (ARCH §3/§10.7; §22 here).
- [x] Schema-versioned artifacts + migration (ARCH §10.8; §10/§15 here). Deterministic (ARCH §1.3).

### 28.3 Data Model (`03_DATA_MODELS_FINAL.md`)
- [x] Reads persisted entities; `ExportManifest`/`ExportScope`/`ExportFormat` used (DM §3/§2.1); `PromptMetadata`/hashes exported (DM §3.17).
- [x] Runtime `EvaluationContext`/`Resolved*` never exported (DM §3.15/§3.16; §0.7/§10.2 here).
- [x] Canonical hashing consistent with DM §18; branded IDs serialized as strings (§10.3).

### 28.4 Rule Engine (`04_RULE_ENGINE_REVISED.md`)
- [x] Blocking vs warning semantics; Arabic messages; cross-referenced `RULE_*` codes (RE §13/§14; §17/§19 here).
- [x] Cover purity (`RULE_COV_001`) enforced on export (§17).

### 28.5 Scene Engine (`05_SCENE_ENGINE.md`)
- [x] Ordering from `sceneOrder`; group numbering from SE §18 (§6/§7 here). Fingerprints exported (SE §5).

### 28.6 Prompt Engine (`06_PROMPT_ENGINE.md`)
- [x] One-prompt-one-image + A-before-B banners; A/B separate; B needs A+PNG (PE §3/§6/§15/§17; §5/§16 here).
- [x] Prompt text byte-for-byte; checksums per PE §19 (§14 here).

### 28.7 UI Engine (`07_UI_ENGINE.md`)
- [x] Copy actions, toasts, no-silent-overwrite dialogs (UI §11/§14/§15; §5/§15/§20 here). Arabic UI, English prompts (UI §18).

### 28.8 Cover Engine (`08_COVER_ENGINE.md`)
- [x] Cover exports use Output A only; barrier respected; cover metadata/hash exported (CE §3/§18; §3/§10/§17 here).

---

*End of Export Engine specification. Sourced only from `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`, `07_UI_ENGINE.md`, and `08_COVER_ENGINE.md`. Specification only — no application code, JavaScript/TypeScript implementation, HTML, CSS, or React. Read-only and deterministic; prompt text preserved byte-for-byte; A/B linkage and numbering preserved; one prompt = one image; A and B are separate execution requests; cover exports use Output A only; runtime `EvaluationContext`/`Resolved*` are never exported; no silent overwrite; no silent omission; Arabic UI, English prompt content.*
