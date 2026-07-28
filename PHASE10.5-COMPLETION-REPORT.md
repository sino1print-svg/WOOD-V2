# Phase 10.5 — Runnable Application Integration & Smoke-Test Release — Completion Report

## Decision

```text
PASS — PHASE 10.5 RUNNABLE APPLICATION INTEGRATION COMPLETE
READY FOR INDEPENDENT AUDIT
```

## Source and Git provenance

| Item | Value |
|---|---|
| Authoritative base ZIP | `mockup-photoshoot-director-phase10-batch10.4-final-residual-corrective.zip` |
| Base ZIP SHA-256 (verified on receipt) | `1b934cc55b7b14b0a7a7efa6f445a5287fd6f53a3472c201c40622490551e898` |
| Base declared commit | `bab7e3a69d0203671674f4d268efc606e4968a5d` |
| Local base import commit | `eb39391ea9715736c4568d1a95bee78b981cba0f` |
| Implementation commit | `cf4999867c0776caf6d1a950f8c432a55f860869` — wire runnable Prompt Center over the real engines |
| Browser-smoke fix commit | `a632985b2eeac03cb70a2bedb35c832f57328d99` — grid overflow + favicon |
| Final checkpoint commit (ZIP identity) | `a49d5a81982a7c6bac61c5f798978286bb5e2b8f` |

The base ZIP's SHA-256 was verified before extraction, its content was imported byte-for-byte as the only implementation base, and no older source and no other implementation tree were merged.

## Final deliverable identity

| Item | Value |
|---|---|
| Final source ZIP | `mockup-photoshoot-director-phase10.5-runnable-application-integration.zip` |
| Final ZIP SHA-256 | `31dc8885103ec9501cfbcae35009c73c5d3f394be0c041c17872e6cf0042eda2` |
| ZIP archive comment | `a49d5a81982a7c6bac61c5f798978286bb5e2b8f` (final commit) |
| Source-tree combined hash | `2a317b4a65698c4bff0d58d45255e58ebf9707b519388e25278965e5915e5c63` (`423 files`, identical across two runs and identical between the dev tree and the fresh extraction) |
| Per-file checksums | `sha256sum -c CHECKSUMS.txt` → all OK from the fresh extraction |

## What was implemented (integration only — no engine rewrites)

1. **Application catalog** (`src/app/catalog`): deterministic production data — domain products, seasons, colors, palette library, the season scene library (bounded cross-product; dedup tuple space 81 ≥ the 50-scene maximum), and the closed-vocabulary resolved-text builders the Prompt Engine's grammar requires. All timestamps derive from one canonical constant; no wall clock or randomness anywhere in the generation path.
2. **Orchestrator** (`src/app/orchestrator`): real `UiEnginePorts` for the approved `UiController` — domain-mapping validation, rule port (canonically empty resolved-constraint set: no rule sets ship in the catalog), Palette Engine stage resolution, print-area profile resolution, Scene Engine planning (`planScenes`) plus Prompt Engine composition (`composeOutputA`/`composeOutputB`) producing fully generated scenes, and the Output A / Output B view-model projection. The UI path is `UI → Controller → Orchestrator ports → Engines → typed Result DTO → UI`.
3. **Commands** (`src/app/commands`): PNG artwork registration through the real Asset Store (full PNG structural validation, resource limits, SHA-256 content hashing) and export document construction through the official Export Engine plan (`createExportPlan`, session scope) and the official formatters (`formatTxt`, `formatMarkdown`, `formatReadableJson`, `formatCanonicalJson`). The UI never re-implements a formatter and never stringifies domain objects.
4. **Browser adapters** (`src/app/adapters`): Clipboard port over the native async Clipboard API; Blob download port with exact formatter bytes, correct MIME, deterministic names (`prompt-pack.txt` / `.md` / `.json` / `.canonical.json`), and `URL.revokeObjectURL` cleanup; `localStorage` persistence port honoring the approved `PersistencePort` contract.
5. **AppShell** (`src/ui/app-shell`) + pure components (`src/ui/components`) + view-state (`src/ui/view-state`): working Generate handler with loading state and double-submit guard, per-scene results with **Output A and Output B as strictly separate blocks**, independent `نسخ A` / `نسخ B` actions with literal (unmodified) clipboard text and visible success/failure states, export bar disabled until a valid result exists, artwork upload with typed failures, save/restore wired to the approved UI-engine persistence functions (save enabled exactly when the state machine allows it), empty/failure/partial states, and no button without a handler or a contract-based disabled reason.
6. **Proven integration fixes** (only): Scene Engine planned `outputA.garment` from `product.name` while the Prompt Engine contract validates `garment === product.type` (fixed at the source; no test weakened); a CSS grid blowout made product-row controls unclickable in a real RTL browser; a missing favicon produced a console 404.

## Test counts

| Item | Before (base) | After (final) |
|---|---|---|
| Test files | 130 | 137 |
| Tests | 2576 | 2626 |
| Skipped / todo / only | 0 / 0 / 0 | 0 / 0 / 0 |
| Deleted tests | — | 0 |

New suites: `test/app` (orchestrator integration, export command, adapters, artwork registration) and `test/ui-app` (pure components, jsdom AppShell integration, runtime smoke). One devDependency was added out of necessity for the mandated DOM-level UI integration tests: `jsdom@30.0.0` (audit-clean).

## Gate results (final clean tree AND fresh extraction — every command exit 0)

| Gate | Exit | Key result |
|---|---:|---|
| `npm ci` | 0 | 216 packages, 0 vulnerabilities |
| `npm audit` | 0 | found 0 vulnerabilities |
| `npm audit --omit=dev` | 0 | found 0 vulnerabilities |
| `npm run typecheck` | 0 | TypeScript clean |
| `npm run lint` | 0 | ESLint, zero warnings |
| `npm run format:check` | 0 | Prettier clean |
| `npm run test` | 0 | 137 files, 2626 tests passed |
| `npm run verify:determinism` | 0 | identical double-build hashes |
| `npm run build` | 0 | production build succeeds |
| `npm run verify` | 0 | full standard chain |
| `npm run verify:full` | 0 | audits + checks + tests + determinism + build |
| `npm run verify:zip:external` | 0 | 13/13 external cases (regression) |

Full command transcripts are in `PHASE10.5-COMMAND-RESULTS.md`.

## Fresh extraction verification

A brand-new directory was populated only by extracting the final ZIP. Before `npm ci`: no `.git`, no `node_modules`, no `dist`, no `coverage`, no symlinks, no `.env`/credentials/keys. Then: `npm ci`, `sha256sum -c CHECKSUMS.txt` (all OK), `node scripts/source-tree-hash.mjs` twice (identical `2a317b4a…`, 423 files), and the complete gate chain — all exit 0. `docs/spec/` in the fresh extraction is byte-identical to the working tree (recursive diff empty).

## Smoke tests (real Chromium)

The full §11 scenario passed **four times**: dev server and production preview from the development tree, and dev server and production preview from the fresh extraction — each with zero console errors and zero page errors. The TXT/Markdown/JSON exports downloaded in all four runs are **byte-identical across environments** (one unique SHA-256 per format). Details and evidence in `PHASE10.5-SMOKE-TEST-REPORT.md`.

## Declarations

- Phase 11 was **not** started; no Phase 11 scope (AI image generation, marketplace integrations, auth, cloud sync, analytics, routers, redesign) was touched.
- `docs/spec/` was **not** modified (byte-identical to the authoritative base).
- No test was deleted or weakened; no `skip`/`todo`/`only`; no `any`-masking or `as never`; no `Date.now`/`Math.random` in the generation or export paths; no mock, stub, or fake success in the production runtime path.
- Engines that passed their suites were modified only for the one proven cross-engine integration defect listed above.
