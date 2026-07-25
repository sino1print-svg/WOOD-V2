# Phase 1 Corrective Audit

## Baseline

The supplied Phase 1 ZIP was extracted into a fresh writable directory. Before edits,
`npm ci` and `npm run verify:full` both passed with 21 test files and 161 tests. Therefore the
corrective work treated the independent findings as integration/specification defects hidden
by incomplete tests, not as baseline build failures.

## Defect reproduction and resolution

| Independent-audit defect                           | Root cause                                                                                            | Corrective action                                                                                       | Regression coverage                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Asset Store Artwork rejected by Project Store      | Project validation parsed an undocumented AssetRef prefix while registration generated another format | Removed ownership parsing; storage-aware validation queries authoritative Asset Store metadata/index    | Integration flow B; cross-project, unknown, mismatch, corrupt and rollback tests |
| Malformed nested Project accepted                  | Shallow/manual root checks                                                                            | AJV 2020 full schema validation + referential pass                                                      | `project-validation.test.ts`                                                     |
| Public save could disable snapshots                | `createSnapshot:false` was public                                                                     | Removed option; snapshot+project+journal atomic batch                                                   | integration A/C/E, project operations, compile-time API test                     |
| KeepLastN/KeepDays claimed success without pruning | ancestor-closure workaround retained all history                                                      | Fail closed and document compaction conflict                                                            | version-history retention regression                                             |
| RuleSet migration assumed embedded Rules           | migration used legacy shape inconsistent with current `ruleIds`                                       | Separate Rule payload and RuleSet aggregate migrations                                                  | migration fixtures and determinism tests                                         |
| Missing RuleDomain mapping was guessed/incomplete  | spec mandates reclassification but defines no mapping                                                 | Typed specification blocker                                                                             | migration blocker test                                                           |
| Missing persistence operation audit                | prior report omitted ownership classification                                                         | Added operation matrix; implemented rename/autosave/crash/recovery foundations only where fully defined | project operations + recovery tests                                              |
| Error contract English-only/weak                   | local failure type lacked bilingual severity/recovery semantics                                       | Complete local bilingual catalog and safe cause/details sanitation                                      | failure-contract tests                                                           |
| PNG parser unbounded                               | structure/CRC checks had no resource budget                                                           | Configured deterministic file/dimension/pixel/chunk/metadata/CRC limits                                 | PNG resource-limit suite                                                         |
| ASCII/prefix ID restrictions                       | storage/path concerns were mixed with branded domain IDs                                              | NFC Unicode domain IDs + separately hashed internal keys                                                | identifier/storage safety + compile-time brands                                  |
| Storage ownership/path coupling                    | raw domain IDs and AssetRef details leaked into keys/ownership rules                                  | namespace-hashed keys; metadata ownership; traversal checks                                             | collision/traversal/cross-project tests                                          |

## Specification-conflict decisions

### Retention

No authoritative algorithm reconciles immutable append-only snapshots, non-dangling parent
lineage, and destructive pruning. `keep_all` is operational. `keep_last_n` and `keep_days`
return `RETENTION_POLICY_UNSUPPORTED` with blocker
`RETENTION_LINEAGE_COMPACTION_UNDEFINED` and leave data unchanged.

### Rule migration

The target/NumericExpression transformations are specified. RuleDomain reclassification has
no authoritative old→new mapping, so unmapped cases fail with
`RULE_DOMAIN_RECLASSIFICATION_MAPPING_UNDEFINED`. The current Rule type has no aggregate
schemaVersion and MigrationRecord has no Rule aggregate discriminator, so no fabricated
Rule MigrationRecord is produced.

### Project duplicate/delete/structural sharing

Duplicate requires new IDs but does not define complete nested ID remapping and asset
association semantics. Delete confirmation is UI-defined, while asset ownership/deletion for
shared or deduplicated data is undefined. Structural sharing is recommended without a
serialized diff/checkpoint contract. These remain documented blockers rather than unsafe
implementations.

## Missing-operation ownership matrix

| Feature                         | Owning phase/module                | Current status                | Reason                                                                               | Required later integration                                 |
| ------------------------------- | ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Duplicate Project with new IDs  | Persistence + UI coordination      | Blocked                       | Fresh nested IDs, references, history and asset associations lack complete algorithm | Authoritative remap/ownership policy, then confirmation UI |
| Rename Project                  | Persistence                        | Implemented                   | Fully defined as name-only; fingerprints exclude names                               | UI command/notification only                               |
| Delete Project                  | Persistence + UI                   | Blocked/deferred              | Confirmation is UI; shared/deduplicated asset cleanup undefined                      | Asset ownership/lifetime policy and UI confirmation        |
| Independent autosave slot       | Persistence                        | Implemented foundation        | Fully defined as non-destructive                                                     | Orchestrator debounce/settings timer                       |
| Crash marker/recovery           | Persistence + startup UI           | Implemented foundation        | Marker and explicit recovery are Persistence-owned                                   | Boot-time Recover offer/confirmation                       |
| Automatic latest-valid restore  | Persistence + UI                   | Explicit API, no silent apply | Workflow also requires recovery offer and no silent overwrite                        | Orchestrator/UI decision and dirty-state handling          |
| Undo/Redo                       | Orchestrator + Persistence + Scene | Deferred                      | Requires output Pending/Stale effects                                                | Orchestrator commands and Scene-owned status effects       |
| Restore Merge/Replace           | Export + UI + Persistence          | Deferred                      | Export §15 owns backup conflict/remap transaction                                    | Export engine and confirmation UI                          |
| Missing-library affected scenes | startup/Export + Scene/Validation  | Deferred                      | Requires library registry and scene blocking                                         | Later library, Scene and Validation integration            |
| Real structural sharing         | Persistence optimization           | Blocked                       | No diff/checkpoint/compaction representation                                         | New authoritative persistence contract                     |

## Architecture result

The corrective modules remain inside Persistence. No Phase 2 engine, Orchestrator, UI screen,
prompt, scene, cover, export, session generation, or image generation was implemented.
