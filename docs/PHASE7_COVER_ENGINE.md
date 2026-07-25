# Phase 7 Corrective Cover Engine

This non-authoritative implementation note describes the Phase 7 Cover Engine implemented from
`docs/spec/08_COVER_ENGINE.md`. The specification directory is unchanged. Phase 7 remains subject to
independent audit. The corrective implementation addresses P7-AUD-001, P7-AUD-002, and
P7-AUD-003; Phase 8 is not implemented.

## Public boundary

`composeCover(input)` accepts an owned Cover identity, generated Sale Images (Output A) with their
product/display/scene-order context, the `CoverMetadata` seed, authoritative
`Project.isDigitalProduct`, read-only product/season/color manifests, the authoritative Cover
`PromptModule`, output barrier, prompt versions, and a caller-supplied timestamp. It returns either:

- an immutable `MainCover` plus an immutable composition plan; or
- one typed blocking `ValidationFailure` owned by `EngineId.Cover`.

The engine is a terminal reader. It calls no engine and accesses no UI, application, persistence,
filesystem, network, clock, randomness, environment, or rendering API.

## Deterministic pipeline

1. Inspect the complete runtime graph without invoking accessors or accepting proxies, cycles,
   exotic prototypes, sparse/custom arrays, symbol keys, unknown keys, or over-limit collections.
2. Enforce `allOutputAReady === true` and independently require every Output A status to be
   `generated`.
3. Validate Output-A-only exact shapes, uniqueness, metadata relationships, prompt-bound text,
   the closed-world Cover PromptModule, manifests, locked colors, layout assertions, versions, and
   optional cache data.
4. Recompute metadata modes from the authoritative sources. `Project.isDigitalProduct` is the
   digital source of truth and must agree with the metadata seed. Ties use bytewise lexicographic
   order.
5. Select the layout from source count and order images by primary match, image class, scene order,
   and Output A ID.
6. Resolve prompt data and publish it only through the authoritative Cover PromptModule, which owns
   the fixed English sections, canonical ordering, source lock, typography, color strip, and badge
   wording. Reserved structural/control syntax is rejected rather than sanitized.
7. Compute SHA-256 identities, clone the owned result, and freeze every returned object and array.

No input object is mutated. The engine never creates, edits, loads, or persists image bytes.

## Layout and composition rules

| Source count | Layout   | Grid                                | Hero          |
| -----------: | -------- | ----------------------------------- | ------------- |
|            1 | Single   | 1×1                                 | full bleed    |
|            2 | Duo      | 2×1                                 | equal pair    |
|            3 | Triptych | 3×1                                 | priority lead |
|            4 | Grid 2×2 | 2×2                                 | lead cell     |
|          5–6 | Grid 2×3 | 2×3                                 | lead cell     |
|            7 | Grid 3×3 | 3×3                                 | lead cell     |
|          8–9 | Grid 3×3 | 3×3                                 | 2×2           |
|          10+ | Mosaic   | `ceil(sqrt(n)) × ceil(n / columns)` | 2×2           |

Trailing cells are balanced and never filled by inventing or duplicating sources. The prompt keeps
mockups dominant, typography restrained, gutters legible, and the canvas warm-neutral.

## Hash and cache policy

- `coverHash` covers ordered source IDs, layout/grid, and canonical `CoverMetadata`.
- `promptHash` covers the exact prompt text.
- `promptChecksum` covers prompt text, cover identity, prompt/generator/module versions, and the
  authoritative Cover PromptModule identity/schema.
- Caller timestamps are excluded from all three content identities.
- A supplied cache is reused only after full runtime validation and exact composition-identity
  comparison. A stale or malformed cache is never reused.

## Permanent regression coverage

`test/cover-engine/` covers the authoritative layout table and large-count formula, source purity,
barrier behavior, source lock, premium doctrine, metadata modes and tie-breaks, image priority,
manifest naming, Minimal Studio behavior, locked colors, digital/physical conflicts, reserved
prompt-structure injection, closed-world PromptModule validation, badges, typed failures,
unresolved variables, cache identity, determinism, immutability, hostile runtime objects, and
architecture isolation. Previously approved tests continue to run in the same suite without being
disabled or weakened.

## Scope boundary

Phase 7 produces prompt text and a composition specification only. Export, packaging, image
generation/editing, publication, and all Phase 8 behavior remain unimplemented.
