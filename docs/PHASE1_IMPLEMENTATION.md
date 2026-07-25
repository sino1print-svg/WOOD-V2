# Phase 1 Implementation — Corrective Release

## Scope and authority

This is the corrected implementation of **Phase 1 — Persistence Foundation + Asset Store
Foundation** only. The twelve files under `docs/spec/` are the sole authoritative
specifications and were not edited. No Rule, Palette, Print-Area, Dedup, Scene, Validation,
Prompt, Cover, Export, Orchestrator, UI, session-generation, prompt-generation, or
image-generation behavior was added.

## Source-to-implementation matrix

| Area / behavior                  | Specification classification                                 | Corrective status                          | Implementation / decision                                                                                             |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Canonical Project JSON           | Explicit Phase 1 requirement                                 | Correct                                    | `shared/canonical-json.ts`; deterministic code-unit key order, safe parsing, UTF-8, timestamp-excluded content hashes |
| Complete Project validation      | Explicit Phase 1 requirement                                 | Corrected                                  | AJV 2020 validates `schemas/domain.schema.json`; post-schema referential/security checks only                         |
| Project save/load/exists         | Explicit Phase 1 requirement                                 | Corrected                                  | `project-store`; mandatory snapshot and atomic project+journal write                                                  |
| Explicit overwrite               | Explicit Phase 1 requirement                                 | Correct                                    | Public save requires `overwrite:true`; stale history is rejected                                                      |
| Version snapshots / restore fork | Explicit Phase 1 requirement                                 | Corrected                                  | Immutable journal, deterministic ID/hash, parent lineage, explicit recovery and safe fork restore                     |
| KeepAll                          | Explicit and fully defined                                   | Operational                                | Preserves complete append-only lineage                                                                                |
| KeepLastN / KeepDays             | Required but contradicted/undefined                          | Specification blocker                      | Fail closed with `RETENTION_POLICY_UNSUPPORTED`; no false pruning claim                                               |
| Recent projects                  | Explicit Phase 1 requirement                                 | Correct                                    | Metadata only, deduplicated, deterministic code-unit order                                                            |
| Project v1 backfills             | Explicit migration                                           | Corrected                                  | Only DM §16.2 backfills, schema validation after migration                                                            |
| Rule v2→v3 payload               | Explicit transformation, incomplete aggregate metadata       | Partially operational / blocker documented | Separate Rule transform; no fabricated MigrationRecord because Rule has no schemaVersion/record aggregate             |
| RuleSet v2→v3                    | Explicit migration                                           | Corrected                                  | Migrates only `id/name/ruleIds/schemaVersion`; produces MigrationRecord                                               |
| RuleDomain reclassification      | Required but mapping undefined                               | Specification blocker                      | Unknown legacy domains fail closed; no guessed mapping                                                                |
| Asset registration/retrieval     | Explicit Phase 1 requirement                                 | Corrected                                  | Opaque AssetRef, authoritative metadata ownership, bytes outside Project JSON, SHA-256/PNG verification               |
| AssetRef ownership               | Explicit ownership; string format undefined                  | Corrected                                  | Ownership comes only from Asset Store metadata/index, never prefix parsing                                            |
| Atomic storage adapter           | Explicit Phase 1 requirement                                 | Correct                                    | Copy-on-write deterministic adapter with preconditions and fault injection                                            |
| Persistence errors               | Required infrastructure; global code registry undefined      | Corrected locally                          | Bilingual, severity/retry/recovery guidance, safe structured details, local namespaced catalog                        |
| Autosave slot                    | Explicit Persistence foundation                              | Implemented                                | Separate non-destructive slot with fingerprint/hash churn prevention                                                  |
| Crash marker                     | Explicit Persistence foundation                              | Implemented                                | Separate deterministic marker API; UI recover offer remains later                                                     |
| Corrupt-project recovery         | Explicit Persistence foundation + UI coordination            | Foundation implemented                     | Independent snapshot journal and explicit recovery API; silent auto-apply is not performed                            |
| Duplicate Project                | Persistence-owned but transformation incomplete              | Specification blocker                      | “new IDs” is required, but complete nested-ID/remap and asset association semantics are not defined                   |
| Rename Project                   | Persistence-owned and fully defined                          | Implemented                                | Name-only mutation through mandatory-save path; session fingerprint unchanged                                         |
| Delete Project                   | Persistence/UI-owned but asset cleanup semantics undefined   | Deferred/blocker                           | No unsafe deletion while shared/deduplicated asset ownership is unspecified                                           |
| Undo/Redo                        | Orchestrator + Persistence + Scene status effects            | Later-phase integration                    | No Orchestrator or Scene behavior added                                                                               |
| Restore Merge/Replace            | Export + UI + Persistence                                    | Later phase                                | Export backup restore owns mode/conflict semantics                                                                    |
| Missing-library affected scenes  | Startup/Export + Scene/Validation                            | Later phase                                | Requires library loading and scene blocking, prohibited in Phase 1                                                    |
| Physical structural sharing      | Persistence optimization requested, representation undefined | Specification blocker                      | No invented diff/checkpoint/re-parenting format                                                                       |

## Complete Project validation

Persistence uses the approved JSON Schema bundle through AJV before save, after
parse/deserialization, and after migration. AJV recursively validates Project, sessions,
scenes, outputs, groups, validation results, artworks, snapshots, retention, fingerprints,
and covers. `additionalProperties:false` catches unexpected nested fields. Diagnostics carry
exact JSON Pointer paths.

A separate referential-integrity pass covers facts JSON Schema cannot prove:

- parent/child `projectId`, `sessionId`, and `sceneId` equality;
- complete, unique `sessionOrder`, `sceneOrder`, and `versionOrder` maps;
- group scene membership within the same session;
- Output B → parent Output A linkage;
- cover source IDs limited to real Output A records in that session;
- validation and current-version targets;
- snapshot key/id/project/parent ordering;
- artwork parent ownership;
- Asset Store existence and authoritative metadata association during storage-aware checks;
- exclusion of raw bytes, absolute paths, EvaluationContext, and `Resolved*` runtime objects.

No parallel handwritten structural schema is maintained.

## Public save and version history

`ProjectStore.save(project, { overwrite, timestamp, reason? })` has no `createSnapshot`
option. Every successful manual save:

1. validates the complete project and every referenced asset;
2. creates an immutable VersionSnapshot;
3. updates `currentVersionId` and appends the ID once to `versionOrder`;
4. points `parentVersionId` to the prior current snapshot or `null`;
5. validates again;
6. commits canonical project bytes, snapshot item, and snapshot index in one atomic batch.

Any snapshot, retention, validation, asset, or storage failure aborts the save. Fault tests
inspect stored bytes and prove no project-only write or orphan snapshot remains.

Snapshot state excludes version-history containers to avoid recursive copies. IDs and state
hashes are deterministic. Restore verifies integrity and forks a new immutable version.

### Retention specification conflict

The specifications simultaneously require immutable append-only snapshots, a
`parentVersionId` lineage, safe pruning, and no dangling referenced parents, while
Architecture §9.10 explicitly says depth/pruning/diff/restore semantics are undefined and
Architecture §10.6 only recommends structural sharing/diffs without defining a format.
There is no authorized re-parenting, checkpoint, compaction, or diff algorithm.

- `keep_all`: operational.
- `keep_last_n`: blocked with typed failure.
- `keep_days`: blocked with typed failure.

`SPECIFICATION_BLOCKER: RETENTION_LINEAGE_COMPACTION_UNDEFINED` preserves all data rather
than pretending pruning occurred.

## Asset Store integration and ownership

`AssetRef` is persisted and consumed as an opaque branded string. Its generated text is an
implementation detail and is never parsed to infer a project. The authoritative
`StoredAssetMetadata.artwork.projectId` and exact Artwork metadata association establish
ownership.

The valid workflow now passes end to end:

`register PNG → receive Artwork/AssetRef → attach Artwork → save → load → retrieve → verify`

Project JSON contains Artwork metadata and the opaque reference only. PNG bytes remain under
separate safely hashed storage keys. Existing legacy-key assets are read where their legacy
reference is recognized, without treating the reference prefix as ownership evidence.

Cross-project claims, unknown/missing refs, metadata mismatch, corrupt bytes, hash mismatch,
PNG mismatch, and partial writes are rejected.

## PNG safety limits

Configured in `APP_CONFIG.limits.pngAsset`:

| Limit                           |                 Value |
| ------------------------------- | --------------------: |
| Maximum file bytes              | 134,217,728 (128 MiB) |
| Maximum width                   |             20,000 px |
| Maximum height                  |             20,000 px |
| Maximum total pixels            |           100,000,000 |
| Maximum chunks                  |                10,000 |
| Maximum individual chunk length |   67,108,864 (64 MiB) |
| Maximum metadata chunk          |     1,048,576 (1 MiB) |
| Maximum CRC work                |     134,217,728 bytes |

The parser rejects unsafe sizes before expensive work where possible, uses safe arithmetic
for pixel count, validates bounds/CRC/IHDR/IEND/trailing data, and reads pHYs metadata. It
does not decompress IDAT or render/edit images.

## Unicode IDs and storage keys

Domain IDs accept any non-empty NFC-normalized string permitted by the domain model,
including Arabic and mixed-language IDs. Control characters are rejected. TypeScript brands
remain mutually non-assignable. Persisted IDs are never silently normalized.

Filesystem-like/internal keys are separate SHA-256 tokens over namespace + normalized ID.
No domain ID or AssetRef is directly used as a path. Tests cover traversal input,
normalization-equivalent derivation, deterministic collision separation, and Unicode
roundtrips.

## Migrations

- Project schema remains version 1; only the explicitly listed same-version backfills are
  applied lazily on read.
- Rule and RuleSet are separate aggregates. RuleSet contains `ruleIds`, not embedded Rules.
- Rule target strings become literal/symbolic/dimension targets as explicitly categorized.
- context refs and numeric limits become the specified discriminated NumericExpression.
- RuleSet 2→3 changes only RuleSet-owned fields and records one MigrationRecord.
- Current aggregates are idempotent; future versions are rejected.
- Every migrated aggregate is AJV-validated.
- Canonical cloning plus atomic write-back preserves original objects/bytes on failure.
- RuleDomain values with no authoritative mapping return
  `MIGRATION_SPECIFICATION_BLOCKED`.

`SPECIFICATION_BLOCKER: RULE_DOMAIN_RECLASSIFICATION_MAPPING_UNDEFINED` and
`SPECIFICATION_BLOCKER: RULE_AGGREGATE_VERSION_RECORD_UNDEFINED` remain explicit.

## Autosave and recovery foundation

`RecoveryStore` provides a separate autosave slot and crash marker. Autosave never overwrites
a manual project; identical canonical content does not churn the slot. The independent
snapshot journal enables recovery when the primary Project JSON is corrupt. The public API
performs explicit recovery; startup/UI remain responsible for offering and confirming
recovery as required by Workflow §3 and UI §20.

## Persistence failure contract

Every public Phase 1 operation returns `PersistenceResult<T>`. Expected failures do not throw
strings. Each failure includes:

- local code and phase;
- severity;
- meaningful Arabic and English messages;
- retryability;
- recovery guidance;
- cause category;
- sanitized structured details.

Binary data, project payloads, secrets, absolute paths, stack traces, and raw Error messages
are not leaked. Internal Error causes are reduced to safe type/name diagnostics. The Phase 0
engine error registry remains untouched because no authoritative persistence-global registry
is defined.

## Tests and corrected expectations

The corrective suite includes public-API integration, regression, schema, referential,
security, Unicode, migration, PNG-limit, fault-injection, recovery, and architecture tests.
Two old expectations were intentionally replaced:

1. **Old:** KeepLastN=1 succeeded while retaining every version. **Conflict:** Workflow
   requires actual safe retention, while Architecture §9.10 leaves compaction undefined.
   **New:** unsupported pruning fails closed and leaves bytes/history unchanged.
2. **Old:** tests fixed AssetRef to `asset:<fragment>:<hash>` and raw ID-based storage keys.
   **Conflict:** AssetRef is a branded opaque string (DM §1.2) and ownership belongs to Asset
   metadata, not string parsing. **New:** tests assert opacity, authoritative ownership, and
   safe hashed internal keys.

## Architecture boundaries

Persistence and Asset Store import no content engine, UI, or Orchestrator. Production
persistence uses browser-compatible Web Crypto. Node-only utilities remain in test/build
scripts. Runtime evaluation objects are rejected from serialized state. All existing and
extended dependency-boundary tests remain required release gates.
