# Phase 10.5 — Changed Files Manifest

Diff basis: authoritative base import `eb39391ea9715736c4568d1a95bee78b981cba0f` → final checkpoint `a49d5a81982a7c6bac61c5f798978286bb5e2b8f`. Exactly the files below changed; nothing under `docs/spec/` changed.

## Source (production runtime)

| # | Path | State | Reason | Serves | Linked tests |
|---|---|---|---|---|---|
| 1 | `src/app/catalog/index.ts` | Added | Deterministic production catalog: domain products/seasons/colors, palette library, scene library, closed-vocabulary resolved-text builders, canonical app time | Generate + export data source | `test/app/orchestrator.test.ts`, `test/app/export-command.test.ts` |
| 2 | `src/app/orchestrator/index.ts` | Modified (placeholder → implementation) | Real engine ports for the approved `UiController`: validation, rule, palette, print-area, scene planning + prompt composition, A/B view-model projection | Generate (§5.1–§5.3) | `test/app/orchestrator.test.ts`, `test/ui-app/runtime-smoke.test.tsx` |
| 3 | `src/app/commands/export.ts` | Added | Official export input assembly + `createExportPlan` + TXT/Markdown/readable/canonical JSON formatters; deterministic file names | Export (§5.5–§5.6) | `test/app/export-command.test.ts`, `test/ui-app/app-shell-integration.test.tsx` |
| 4 | `src/app/commands/artwork.ts` | Added | PNG artwork registration through the real Asset Store | Output B artwork (§5.2) | `test/app/artwork-command.test.ts` |
| 5 | `src/app/commands/index.ts` | Modified (placeholder → re-exports) | Official command surface for the UI | Application layer | same as #3/#4 |
| 6 | `src/app/adapters/index.ts` | Added | Clipboard port, Blob download port with Object-URL cleanup, `localStorage` persistence port | Copy/download/save (§5.4, §5.6, §5.10) | `test/app/adapters.test.ts`, `test/ui-app/app-shell-integration.test.tsx` |
| 7 | `src/app/state/index.ts` | Modified (comment only) | Honest Phase 10.5 status documentation for the intentional empty namespace (out of run path) | Placeholder policy (§5.9) | — |
| 8 | `src/app/validation-gate/index.ts` | Modified (comment only) | Same as #7 | Placeholder policy (§5.9) | — |
| 9 | `src/ui/app-shell/AppShell.tsx` | Modified | Real Generate/copy/export/save/restore/artwork-upload flow; loading/failure/empty states; double-submit guard; edit-clears-outputs per the state machine; no handler-less buttons | Primary workflow (§5.2–§5.10, §8) | `test/ui-app/app-shell-integration.test.tsx`, `test/ui-app/runtime-smoke.test.tsx`, `test/ui-engine/security-and-boundaries.test.tsx` |
| 10 | `src/ui/components/index.tsx` | Added (replaces placeholder `index.ts`, deleted) | Pure presentational components: ResultsPanel (A/B strictly separate + copy), ExportBar, FailuresPanel | Results/export UI (§5.3–§5.5, §5.7) | `test/ui-app/components.test.tsx` |
| 11 | `src/ui/components/index.ts` | Deleted | Replaced by #10 | — | — |
| 12 | `src/ui/view-state/index.ts` | Modified (placeholder → implementation) | Pure UiState projections: per-scene A/B rows, results phase, failure partitions, export enablement | Results view-model | `test/ui-app/components.test.tsx` |
| 13 | `src/ui/screens/index.ts` | Modified (comment only) | Honest single-screen status documentation | Placeholder policy (§5.9) | — |
| 14 | `src/engines/scene-engine/engine.ts` | Modified (1 call site) | Proven integration defect: planned `outputA.garment` must equal `product.type` per the Prompt Engine contract | Generate | `test/app/orchestrator.test.ts` + full scene/prompt suites unchanged and green |
| 15 | `src/styles/base.css` | Modified | Results/export/failures/artwork styles; fix number-control grid blowout that made RTL product-row controls unclickable in a real browser | UI usability | dev/prod smoke runs |
| 16 | `index.html` | Modified | Inline SVG favicon (removes the only console 404) | Smoke cleanliness (§11.22) | smoke runs |

## Tests

| # | Path | State | Reason |
|---|---|---|---|
| 17 | `test/app/fixtures.ts` | Added | Deterministic app-layer fixtures: valid draft, artwork record, programmatic valid 1×1 PNG |
| 18 | `test/app/orchestrator.test.ts` | Added | Real-generation integration: separate A/B, determinism, A-only, artwork-required fail-closed, invalid form, kids product, generated outputs |
| 19 | `test/app/export-command.test.ts` | Added | Formatter-official bytes, deterministic names, JSON parse + A-before-B ordering, byte determinism, fail-closed without result |
| 20 | `test/app/adapters.test.ts` | Added | Exact bytes through download port, typed download failure, clipboard literal copy + failure, persistence save/load + typed failures |
| 21 | `test/app/artwork-command.test.ts` | Added | Real PNG accept, determinism, invalid bytes/file-name rejection |
| 22 | `test/ui-app/element-tree.ts` | Added | Hook-free React element-tree walker (test helper) |
| 23 | `test/ui-app/components.test.tsx` | Added | A/B separation, copy per prompt id, empty/loading, copy status visibility, export bar disable/kinds/error, handler audit |
| 24 | `test/ui-app/app-shell-integration.test.tsx` | Added | Full DOM workflow (jsdom): fill → generate → A/B → copy A only/B only → clipboard failure → change input clears → regenerate → export bytes/names/URL revocation → cross-generation byte identity |
| 25 | `test/ui-app/runtime-smoke.test.tsx` | Added | Mount without exception, no unhandled rejection, no handler-less buttons, headless workflow completion, in-flight double-submit prevention |

## Configuration / bookkeeping

| # | Path | State | Reason |
|---|---|---|---|
| 26 | `package.json` | Modified | Added devDependency `jsdom@30.0.0` (required by the mandated DOM-level UI integration tests) |
| 27 | `package-lock.json` | Modified | Lock update for #26 (audit stays at 0 vulnerabilities) |
| 28 | `CHECKPOINT-MANIFEST.json` | Modified | Phase 10.5 checkpoint identity, provenance, and verification summary |
| 29 | `CHECKSUMS.txt` | Modified | Regenerated per-file SHA-256 listing for the final tree (424 files) |
