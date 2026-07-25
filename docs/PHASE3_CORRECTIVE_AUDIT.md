# Phase 3 Palette Engine Corrective Audit

## Root cause

The rejected implementation filtered both `RuleDomain.Palette` and `RuleDomain.GarmentColor` constraints into one accumulator. As a result, a per-scene GarmentColor lock or forbid could shrink `PaletteResolution.colorIds`. This violated domain ownership: Palette owns `ColorSelection` and selection-level set algebra, while GarmentColor only validates a requested scene garment color against an already resolved palette.

## Corrective design

### Stage 1 — Resolve Palette

`resolvePaletteStage(input)`:

- reads the selected `ColorSelection.colorIds`;
- consumes only `RuleDomain.Palette` constraints;
- applies palette locks, forbids, and requires;
- blocks an empty palette;
- returns `ResolvedPalette`.

### Stage 2 — Validate garment color

`validateGarmentColorStage(palette, requested, constraints, selectionLocked)`:

- receives `Readonly<ResolvedPalette>`;
- consumes only `RuleDomain.GarmentColor` constraints;
- computes only `allowed: boolean | null` and garment diagnostics;
- has no mutation path to `ResolvedPalette`.

The public `resolvePalette` adapter executes the two stages in this order and combines diagnostics without allowing stage 2 to alter stage 1 output.

## Incorrect test replaced

The old test expected a white-only GarmentColor constraint to reduce `[white, black]` to `[white]`. The corrected test expects the palette to remain `[black, white]`; the requested garment color is evaluated independently.

## Regression coverage

The corrective suite covers:

- white allowed under a white-only GarmentColor constraint while the palette remains unchanged;
- black rejected by garment membership while the palette remains unchanged;
- Palette-domain white-only reduction;
- membership against a Palette-domain reduced set;
- no GarmentColor constraints;
- GarmentColor forbids that never rewrite palette IDs;
- multiple GarmentColor constraints affecting membership only;
- constraint permutation invariance;
- deep-freeze immutability;
- explicit stage-order and source-level no-write architecture checks.

## Architecture status

Palette Engine remains a pure leaf engine. It imports no Rule Engine implementation, Scene Engine, UI, Persistence implementation, Asset Store, Orchestrator, filesystem, network, clock, or random source.

## Scope confirmation

Phase 4 and all later engines and UI remain unimplemented. No file under `docs/spec/` was modified.
