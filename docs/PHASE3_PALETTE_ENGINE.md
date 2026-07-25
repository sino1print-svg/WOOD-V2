# Phase 3 — Palette Engine

## Scope

Phase 3 implements only `src/engines/palette-engine/` as a deterministic leaf engine. It resolves the selected garment-color domain, applies already-resolved palette/garment-color constraints, enforces lock closure, and optionally judges one requested garment color.

## Public contract

`resolvePalette(input, limits?)` accepts:

- `ColorSelection`;
- a read-only `PaletteLibrary` (`Color[]`, `Palette[]`);
- `ResolvedConstraint[]` from the Rule Engine contract as data;
- optional `requestedGarmentColorId`.

It returns either a `PaletteResolution` or structured `ValidationFailure[]`. Expected business failures are values, not thrown exceptions.

## Algorithm

1. Reject cyclic, malformed, oversized, or unsafe runtime input.
2. Validate exact color IDs against the library.
3. Deduplicate and bytewise-sort selected IDs.
4. Ignore constraints outside `Palette` and `GarmentColor`.
5. Deterministically sort relevant constraints.
6. Intersect every resolved Lock with the current set.
7. Exclude every resolved Forbid target.
8. Verify every Require is already present; never add it.
9. Block if the resulting set is empty.
10. Check the optional requested scene garment color by exact ID.

## Lock semantics

When `locked` is true, selected IDs form a closed upper bound. Rule constraints may narrow it but cannot expand it. A requested known color outside the final set returns `RULE_PAL_001`.

When `locked` is false, Phase 3 still does not auto-expand to every library or product-default color. The authoritative Scene Engine text says colors are drawn only from `ColorSelection.colorIds` and no extra colors are introduced. A known requested but unselected color therefore produces `garmentColorAllowed: false`, without substitution.

## Domain isolation

- `RuleDomain.Palette`: selection-level set policy.
- `RuleDomain.GarmentColor`: per-scene garment-color policy.
- Unrelated domains do not affect the result.
- The engine does not parse Rules or descriptions and does not invoke Rule Engine.
- Diagnostics preserve whether a constraint came from `palette` or `garment_color`.

## Deterministic ordering

Final IDs are sorted with direct lexicographic comparison, matching SE §14.2. Constraint ordering uses stable domain, target, bucket, and winning-rule keys. No locale sorting, insertion-order dependence, time, or randomness is used.

## Errors

Authoritative business codes:

- `RULE_PAL_001`: requested garment color is outside a locked/final selection or a required color is unsatisfied.
- `RULE_PAL_002`: selected-set exclusion diagnostic.
- `RULE_PAL_003`: no selected colors or constraints produce an empty final set.

Locally namespaced infrastructure codes are used for malformed input/library/constraints, safety limits, and cycles because the authoritative global registry defines no official Palette Engine codes for those cases. See `PHASE3_PALETTE_ENGINE_SPEC_AUDIT.md`.

## Safety and immutability

Configured limits live in `APP_CONFIG.limits.paletteEngine` for color count, palette count, constraint count, and ID length. Dangerous keys and control characters are rejected. Inputs are never mutated; deep-frozen input tests pass.

## Architecture

Palette Engine imports only config, shared domain models/errors, and its own modules. It imports no UI, Persistence implementation, Asset Store, Orchestrator, or another engine. It performs no filesystem, network, clock, random, eval, or dynamic-code work.

## Tests

Phase 3 tests cover contract validation, lock/unlocked semantics, domain isolation, constraint application, set operations, empty-set blocking, membership, unknown IDs, permutation invariance, manifest-order invariance, cloning, deep-freeze immutability, cycles, limits, bilingual registry entries, source safety scans, public exports, and architecture boundaries.

## Non-goals

Phase 4 and later are not implemented. In particular, this phase contains no Print-Area, Dedup, Scene, Validation, Prompt, Cover, Export, Orchestrator, UI, prompt-generation, or image-generation logic.

## Preserved blockers

All Phase 1 and Phase 2 blockers remain documented. Phase 3 additionally documents `PALETTE_LOCAL_FAILURE_CODE_GAP`, `PALETTE_BILINGUAL_FAILURE_SHAPE_GAP`, and `PALETTE_EXPANSION_SOURCE_NOT_DEFINED`.

## Corrective domain separation

The Palette Engine uses two strictly ordered, independent stages:

1. `resolvePaletteStage` consumes only `RuleDomain.Palette` constraints and produces a `ResolvedPalette`.
2. `validateGarmentColorStage` consumes that read-only `ResolvedPalette`, the requested garment color, and only `RuleDomain.GarmentColor` constraints.

`RuleDomain.GarmentColor` never participates in selection-level set reduction. It cannot add, remove, lock, require, or otherwise rewrite `ResolvedPalette.colorIds`. Its effects apply only to the boolean garment-color membership decision. The public `resolvePalette` adapter executes stage 1 first and passes its result to stage 2 through `Readonly<ResolvedPalette>`.

The previous combined filter over Palette and GarmentColor constraints was removed because it allowed per-scene garment rules to author the selection-level palette. Regression tests cover white-only garment constraints, palette-only restrictions, multiple garment constraints, permutation invariance, deep-frozen inputs, stage ordering, and the absence of any write path from garment validation to the resolved palette.
