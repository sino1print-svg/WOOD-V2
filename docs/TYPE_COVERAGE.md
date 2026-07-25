# Domain-Model Type Coverage Matrix

Maps `03_DATA_MODELS_FINAL.md` declarations to their source files and to the FOUR
verification layers that guard them.

## Verification layers

| Layer                         | What it proves                                                                                  | Where                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Name / export coverage     | every exported type exists & is not renamed                                                     | `test/domain-model/type-coverage.ts` (compile)                         |
| 2. Structural schema coverage | persisted JSON shape (nested refs, required, enums, `additionalProperties:false`, conditionals) | `schemas/domain.schema.json` + `test/schemas/*` (AJV)                  |
| 3. Compile-time assignability | brand purity, required/optional/nullable, runtime-only isolation                                | `test/domain-model/assignability.test.ts` (`tsc` + `@ts-expect-error`) |
| 4. Runtime enum coverage      | enum member values exactly match the spec                                                       | `test/domain-model/types.test.ts` (Vitest)                             |

## Entity → source file

| Spec section (DM)                                                    | Types                                                                                                                                                                                                                                                                                                                                                                                                          | Source file                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| §1.2 Shared primitives                                               | IsoTimestamp, SchemaVersion, Sha256, ById, HexColor, SemVer, ContextFieldPath                                                                                                                                                                                                                                                                                                                                  | `primitives.ts`                              |
| §1.2 Branded IDs                                                     | all `*Id` brands (Project…Vocabulary)                                                                                                                                                                                                                                                                                                                                                                          | `ids.ts`                                     |
| §2.1 Enumerations                                                    | 27 enums incl. ProductKind, SeasonKind, Audience, RuleOperator, RuleDomain, ExportFormat, …                                                                                                                                                                                                                                                                                                                    | `enums.ts`                                   |
| §2.2 Vocabularies                                                    | VocabularyTerm, CameraTerm, ControlledVocabularies                                                                                                                                                                                                                                                                                                                                                             | `vocabulary.ts`                              |
| §3.12 Rule cluster                                                   | ContextRef, RuleCondition, ConditionGroup, ConditionNode, RuleTarget, NumericExpression, RuleEffect, Rule, RuleSet                                                                                                                                                                                                                                                                                             | `rules.ts`                                   |
| §3.1–§3.14, §3.17–§3.18 Entities                                     | Project, PhotoshootSession, GenerationProgress, Product, AudienceConstraints, PrintAreaProfile, Season, Scene, DedupSignature, DedupLedger, OutputA, OutputB, Artwork, MainCover, CoverMetadata, Group, Color, Palette, ColorSelection, PromptModule, ValidationResult, ValidationCheckResult, ValidationFailure, VersionSnapshot, SerializedProjectState, RetentionPolicy, PromptMetadata, SessionFingerprint | `entities.ts`                                |
| §3.15 EvaluationContext, §3.16 Resolved\* (RUNTIME-ONLY)             | EvaluationContext, ResolvedCondition, ResolvedTarget, ResolvedEffect, ResolvedRule                                                                                                                                                                                                                                                                                                                             | `evaluation.ts`                              |
| §3.19 Events                                                         | DomainEvent + 7 event types + AnyDomainEvent                                                                                                                                                                                                                                                                                                                                                                   | `events.ts`                                  |
| EX §13 Export manifest (persisted)                                   | ExportManifestFileEntry, ExportManifestWarning, ExportManifest, MigrationRecord                                                                                                                                                                                                                                                                                                                                | `export-manifest.ts`                         |
| EX §4 Export operational refinement (CONTRACTS layer, NOT persisted) | ExportDeliveryChannel, ExportDeliveryFormat, PERSISTED_EXPORT_FORMAT                                                                                                                                                                                                                                                                                                                                           | `src/shared/contracts/export-refinements.ts` |

## Invariants verified (with layer)

- Branded IDs are nominal/non-interchangeable — layer 3 (`@ts-expect-error`) + layer 2 (ID `pattern`).
- `OutputA.forbidden` = `['artwork','logo','watermark','typography']` — layer 2 (4-item enum tuple).
- `OutputB` requires `sourceOutputAId` + `artworkId` — layers 2 (`required`) + 3 (`undefined extends … ? …`).
- `MainCover.sourceSaleImageIds` = OutputA only — layer 3 (OutputBId not assignable) + layer 2
  (persistence ID convention: sale-image IDs match `^outA_`, so an `outB_` ID is rejected).
- `EvaluationContext` / `Resolved*` never persisted or exported — layer 3 (not assignable to persisted fields)
  - layer 2 (`additionalProperties:false` rejects them inside Project/ExportManifest; no `$def` exists for them).
- Persisted `ExportFormat` NOT widened by operational refinements — layer 3 (`ExportDeliveryFormat` not
  assignable to `ExportFormat`) + layer 2 (`ExportManifest.exportFormats` enum = txt/json/zip only).
- `RetentionPolicy.kind` required; `keepN`/`keepDays` conditionally required — layer 2 (`if/then`).
- `additionalProperties:false` on closed persisted entities — layer 2.
- Absolute paths / secrets excluded from `ExportManifest` — layer 2 (path pattern + closed object).
- Domain entities contain no implementation logic — declarations only.

## Persistence ID convention (enabling machine-checkable cover purity)

Output A / Output B identifiers use the deterministic prefixes `outA_` / `outB_`. This lets the
persisted schema reject an Output-B id inside a cover's `sourceSaleImageIds` at the JSON layer,
complementing the compile-time branded-type guarantee (layer 3). This is an infrastructure ID
convention, not a user-facing feature.
