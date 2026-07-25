# Phase 6 — UI Engine

## Scope

Phase 6 implements the Arabic RTL user-facing orchestration and presentation layer defined by `docs/spec/07_UI_ENGINE.md`. It does not implement image generation, the Cover Engine, Export Engine, or any later phase.

## Architecture

The implementation is split into:

- `src/ui-engine/types.ts`: typed UI state, draft, failures, catalogs, and engine ports.
- `src/ui-engine/state.ts`: explicit deterministic state transitions and stale-output detection.
- `src/ui-engine/validation.ts`: UI-boundary validation and dependent-control checks.
- `src/ui-engine/controller.ts`: ordered invocation through approved public engine ports.
- `src/ui-engine/copy.ts`: exact prompt copy and canonical grouped copy.
- `src/ui-engine/persistence.ts`: canonical UI-owned state serialization and corrupt-state rejection.
- `src/ui/app-shell/AppShell.tsx`: Arabic RTL workflow interface.

The UI Engine imports domain contracts and public port types only. It does not import engine implementation internals.

## State model

The explicit phase union is:

`idle | editing | validating | invalid | ready | generating-scenes | scenes-ready | generating-prompts | prompts-ready | save-pending | saved | failure`

Draft, validated fingerprint, generated fingerprint, scenes, prompts, failures, dirty state, persisted state, selected output, workflow step, and active request sequence are distinct fields.

## Behavior

- No generation occurs from selector changes.
- Generation-affecting edits mark existing outputs stale.
- Local validation runs before engine invocation.
- Engine order is Validation → Rule → Palette → Print Area → Scene → Prompt.
- Repeated generation is guarded while a request is active.
- Prompt text is copied byte-for-byte; grouped copies preserve separate output boundaries.
- Arabic strings render RTL; prompt content remains LTR.
- Untrusted strings are rendered by React text nodes; unsafe HTML APIs are prohibited.
