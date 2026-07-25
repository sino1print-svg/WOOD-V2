# Phase 6 UI Engine — Specification Audit

## Authority reviewed

- `01_PRD.md`
- `02_ARCHITECTURE.md`
- `03_DATA_MODELS_FINAL.md`
- `04_RULE_ENGINE_REVISED.md`
- `05_SCENE_ENGINE.md`
- `06_PROMPT_ENGINE.md`
- `07_UI_ENGINE.md`
- `10_APP_WORKFLOW.md`
- `11_TEST_PLAN.md`
- `12_IMPLEMENTATION_GUIDE.md`

## Key authority decisions

`07_UI_ENGINE.md` is explicit that the shipping interface is Arabic-only and RTL. Therefore localization is presentation-only and no language switch was added. Prompt text remains English/LTR.

The UI is an orchestration boundary. Domain behavior remains owned by approved engines and is accessed through typed public ports. UI validation covers input shape, count integrity, catalog membership, dependent-control compatibility, and control-character safety without replacing engine validation.

## Requirement mapping

- Explicit state union: `src/ui-engine/types.ts`.
- Deterministic transitions and stale state: `state.ts`.
- Count/dependent controls: `validation.ts`.
- Ordered engine orchestration: `controller.ts`.
- Persistence boundary: `persistence.ts`.
- Exact and grouped copy: `copy.ts`.
- Arabic RTL, accessibility, responsive layout: `AppShell.tsx` and `base.css`.
- Security and architecture scans: `test/ui-engine/security-and-boundaries.test.tsx`.

No authoritative specification file was modified.
