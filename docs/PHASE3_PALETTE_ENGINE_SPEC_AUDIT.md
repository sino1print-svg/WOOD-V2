# Phase 3 Palette Engine — Specification Audit

## Sources reviewed

Only the following authoritative documents were used: `01_PRD.md`, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `10_APP_WORKFLOW.md`, `11_TEST_PLAN.md`, and `12_IMPLEMENTATION_GUIDE.md` under `docs/spec/`. No specification file was edited.

## Source-to-contract matrix

| Topic                   | Explicit source                                                                                               | Audit decision                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine role             | ARCH §3/§4; WF §2 and stage 2                                                                                 | Pure leaf engine. Resolves garment-color closure and derives membership. No engine calls, persistence, UI, I/O, time, or randomness.                                                                       |
| Primary selection       | DM §3.11 `ColorSelection`                                                                                     | `colorIds`, `locked`, optional `paletteId`. `ColorSelection` is owned as session selection by Orchestrator; Palette owns the derived resolved set and `garmentColorAllowed` (DM ownership table).          |
| Library input           | ARCH palette library; DM §3.11 `Color`/`Palette`                                                              | Read-only typed `Color[]` and `Palette[]`; identity is exact `ColorId`. Unknown IDs are invalid.                                                                                                           |
| Rule input              | RE resolved constraints; SE pipeline                                                                          | Consume `ResolvedConstraint[]` data only. Never import/invoke Rule Engine and never reinterpret raw `Rule` objects.                                                                                        |
| Output                  | ARCH engine table; WF stage 2; DM `garmentColorAllowed`                                                       | Canonically ordered final `ColorId[]`, lock state, optional palette identity, diagnostics, and optional requested-color membership.                                                                        |
| Locked semantics        | PRD §8; ARCH §4; DM §3.11; RE §6; SE §14                                                                      | Closed to the actual selected IDs. Constraints may only narrow. No unselected color may be added.                                                                                                          |
| Unlocked semantics      | SE §14.1: colors are drawn only from `session.colorSelection.colorIds`; “No extra colors are ever introduced” | Unlocked does not mean all library colors. The Palette Engine keeps the selected IDs as its candidate set. No specification authorizes expansion from product defaults, names, hex, or the entire library. |
| Palette vs GarmentColor | DM §2.1/§3.11; RE §6                                                                                          | `Palette` is selection-level policy; `GarmentColor` is per-scene garment application. Both are accepted as resolved data but remain distinguishable in diagnostics. Unrelated domains are ignored.         |
| Ordering                | SE §14.2                                                                                                      | `ColorId`s use lexicographic ascending order. Implementation uses direct bytewise string comparison, not locale ordering.                                                                                  |
| Empty selection/result  | Registry `RULE_PAL_003`; RE §9; test plan T034                                                                | Blocking failure. No fallback or color restoration.                                                                                                                                                        |
| Membership              | DM EvaluationContext; RE §6; SE §14                                                                           | Exact `ColorId` membership only. Locked out-of-set requested colors block. Unknown requested IDs are invalid library references.                                                                           |
| White/Black             | PRD §8 and SE §14.3 examples                                                                                  | Examples demonstrate actual selected IDs, not magic names or hex constants. The engine has no hard-coded White/Black IDs.                                                                                  |
| Authoritative codes     | Shared registry: `RULE_PAL_001`, `RULE_PAL_002`, `RULE_PAL_003`                                               | Used for locked membership, selected-set exclusion, and no-color/empty-result conditions. Registry ownership remains `EngineId.Rule` because the authoritative registry defines these as `RULE_` entries.  |

## Null, empty, missing, and duplicates

- Missing/null structural fields are invalid input.
- `colorIds: []` is the authoritative blocking `RULE_PAL_003` case.
- Unknown IDs are rejected; the engine never guesses by name or hex.
- Duplicate selected IDs are normalized to one exact ID because the specifications require a set and deterministic ordering but do not define duplicates as a separate official error.
- Duplicate library IDs are rejected as an ambiguous manifest.

## Constraint application

1. Validate bounded, acyclic inputs and the read-only color library.
2. Normalize selected IDs to a canonical candidate set.
3. Filter to `RuleDomain.Palette` and `RuleDomain.GarmentColor`; ignore unrelated domains.
4. Sort resolved constraints by explicit stable data.
5. Apply `lockedTo` by intersection.
6. Apply `forbidden` by exclusion.
7. Check `required` without introducing a missing color.
8. Block immediately if the set becomes empty.
9. Derive requested garment-color membership by exact ID.

The engine preserves Rule Engine precedence decisions and does not repeat raw-rule conflict resolution.

## Formal specification gaps

### `PALETTE_LOCAL_FAILURE_CODE_GAP`

The authoritative global registry contains only the three `RULE_PAL_*` business codes. It does not define official codes for malformed runtime inputs, unknown/malformed palette manifests, cyclic input, or configured safety-limit violations. Phase 3 therefore uses locally namespaced `PE_INTERNAL_*` infrastructure failures without adding them to the permanent global registry.

### `PALETTE_BILINGUAL_FAILURE_SHAPE_GAP`

`ValidationFailure` contains one `message` field, while the global registry contains Arabic and English messages. The engine preserves the approved `ValidationFailure` shape and supplies bilingual text in deterministic palette diagnostics/registry lookup; it does not redesign the shared persisted model.

### `PALETTE_EXPANSION_SOURCE_NOT_DEFINED`

No authoritative text defines a source from which an unlocked selection may expand. SE §14 explicitly says garment colors are drawn only from selected IDs and no extras are introduced. The engine therefore performs no expansion. A future expansion policy would require an additive authoritative contract.

## Explicit exclusions

No Print-Area, Dedup, Scene, Validation, Prompt, Cover, Export, Orchestrator, UI, session-generation, prompt-generation, or image-generation behavior is implemented.
