# Final Project Gap Analysis — Phase 7 Third Corrective

## 1. What is actually implemented (Engines, fully tested)

All of the following exist as deterministic TypeScript modules under `src/engines/` and `src/ui-engine/`,
each with dedicated test suites (part of the 1812 passing tests):

- Rule Engine (`src/engines/rule-engine`)
- Palette Engine (`src/engines/palette-engine`)
- Print Area Engine (`src/engines/print-area-engine`)
- Prompt Engine (`src/engines/prompt-engine`)
- Scene Engine — referenced by domain model/tests; cover/prompt modules consume its output types
- Cover Engine (`src/engines/cover-engine`) — the engine touched by this corrective
- UI Engine (`src/ui-engine`) — state/draft/validation logic consumed by the shell
- Persistence layer (`src/persistence`)
- Export mapping (`src/export`)

Every engine has its own architecture/determinism/security/hostile-input test files (visible in the
`npm run test` file list: `test/rule-engine/`, `test/palette-engine/`, `test/print-area-engine/`,
`test/prompt-engine/`, `test/cover-engine/`, `test/ui-engine/`, `test/persistence/`, `test/export/`,
`test/i18n/`, `test/domain-model/`, `test/contracts/`, `test/schemas/`, `test/architecture/`,
`test/errors/`, `test/ci/`).

## 2. What is wired into the UI

`src/main.tsx` mounts `src/ui/app-shell/AppShell.tsx`, which:

- Renders a full Arabic RTL form (session title, season, audience, target count, custom scene description).
- Lets the user add/remove products from a small hard-coded `catalog` (2 products, 4 colors, 3 seasons —
  defined inline in `AppShell.tsx`, not loaded from any engine registry).
- Lets the user adjust per-product quantity, select colors (swatches), and toggle "include Output B".
- Calls `validateDraft()` (from `src/ui-engine`) live on every change and shows failures in a validation
  panel.
- Has a "التحقق" (Validate) button wired to update the UI phase (`ready`/`invalid`) based on
  `validateDraft()`.
- Has a "حفظ"/"استرجاع" (save/restore) button pair and a "توليد" (Generate) button that are **rendered but
  not functionally wired** — `<button className="primary full" disabled={failures.length > 0}>{AR.actions.generate}</button>`
  has no `onClick` handler at all; clicking it (once enabled) does nothing.
- The helper text under the Generate button ("يتم استدعاء المحركات المعتمدة فقط بعد الضغط الصريح" — "the
  approved engines are only invoked after an explicit click") describes the _intended_ design, not current
  behavior: no engine invocation is wired to any click handler in this codebase.

Confirmed live in a real browser (§6 of the implementation report): the form, validation panel, and product/
color selection all work end-to-end without runtime errors, in both dev and production-preview mode.

**Note on a stale source comment:** `src/main.tsx` carries a comment reading "Application entry — Phase 0.
Mounts the Arabic RTL shell only. No engines, routing, or session logic are wired." This comment is
out of date — `AppShell.tsx` already imports and calls `createInitialUiState`/`updateDraft`/`validateDraft`
from `src/ui-engine`, and the sidebar footer text in the same component reads "Phase 6 · UI Engine". The
comment was not corrected as part of this corrective (out of scope: Phase 7 Third Corrective is scoped to
the Cover Engine semantic-conflict defects, not documentation-comment cleanup), but it should not be relied
upon to describe current UI capability.

## 3. What is NOT implemented / not reachable from the UI

- **No generation pipeline wiring.** Nothing in `src/ui/` calls the Prompt Engine, Scene Engine, Cover
  Engine, Palette Engine, Print Area Engine, or Export layer to actually produce Output A / Output B /
  Cover / export bundles. The engines exist and are individually correct (per their own extensive test
  suites) but there is no orchestration code connecting UI state → engine calls → rendered
  images/prompts/exports.
- **No product/color/season registry loading.** `AppShell.tsx`'s `catalog` is a hard-coded literal, not
  read from `src/app/state`, `src/persistence`, or any canonical registry module.
- **Save/Restore buttons are not wired** to `src/persistence`.
- **No routing.** The sidebar nav shows 5 stages ("الإعداد", "المنتجات", "التحقق", "التخطيط",
  "البرومبتات") but only the first two are enabled (`disabled={index > 1}`); the rest show "قريبًا"
  ("coming soon") and are inert.
- **No packaging.** No Electron main process, no installer script, no `electron-builder`/`electron-forge`
  config, nothing under `package.json`'s `dependencies`/`devDependencies` related to desktop packaging.
  Confirmed by search: no `electron*` files anywhere in `src/`, no `electron` mention in `package.json`.

## 4. What is required before a Windows final release

1. **Wire the generation pipeline.** Connect the Generate button to actually invoke Scene → Palette →
   Print Area → Prompt/Cover → Export in sequence against the validated draft, and render/display the
   result (or persist it) instead of doing nothing.
2. **Replace the hard-coded `catalog`** with real product/color/season data sourced from the project's
   canonical registries/persistence layer.
3. **Wire Save/Restore** to `src/persistence`.
4. **Implement or explicitly defer** the remaining workflow stages (التخطيط/البرومبتات) currently marked
   "قريبًا", or scope them out with an explicit decision.
5. **Correct the stale `src/main.tsx` header comment** so it doesn't misdescribe the shell as Phase-0-only.
6. **Choose and implement a Windows packaging strategy** (Electron + installer, or a documented
   alternative) — none exists today; today's `dist/` is a static web bundle servable only via
   `vite preview` or any static file server, not a standalone Windows executable.
7. **Resolve the residual dev-only ESLint 8→10 vulnerability chain** (§3 of the implementation report) as
   its own reviewed upgrade task, separate from any further Cover Engine corrective work.

## 5. Packaging status

No Electron packaging, no installer, no `.exe`, no auto-updater config exists in this codebase. The only
"runtime" artifact is a static Vite build (`dist/`) that must be served (e.g. `vite preview` or any static
HTTP server) and opened in a browser — it is a **Vite web app**, not a Windows desktop application.
