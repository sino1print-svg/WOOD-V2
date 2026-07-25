# Phase 0 Audit & Remediation

Scope: infrastructure + shared declarations only. No engine, persistence, screen,
session, or generation logic (12_IMPLEMENTATION_GUIDE §9 build order — Phase 0).

## Remediations applied (external audit)

1. Toolchain reproducibility: pinned Node (`.nvmrc`, `.node-version` = 22.22.3),
   `packageManager` = npm@10.9.8, exact (non-floating) dependency versions,
   committed `package-lock.json`, CI uses `npm ci` + node-version-file + npm cache.
2. `verify` now runs typecheck → lint → format:check → test → build.
3. Clean outputs: `node_modules/`, `dist/`, `dist-verify/`, `coverage/`, Vitest temp
   files ignored in git + prettier; final ZIP built from `git archive` (excludes them).
4. Architecture tests upgraded: relative + alias + side-effect + dynamic + re-export +
   require resolution; full WF §2.3–§2.4 permission matrix; fixtures that FAIL closed.
5. Domain-model completeness: compile-time coverage of all 122 exported types + matrix.
6. Contracts audit: type-only, domain-model-only imports (no forbidden deps).
7. Error registry audit: authoritative code lists (89) compared to registry.
8. JSON schemas: ajv positive/negative behavior fixtures (not parse-only).
9. Deterministic build verification: two fresh temp builds, SHA-256 content compare.
10. RTL/bidi: index.html + shell RTL checks; Unicode isolate code points; non-reorder.
11. CI: npm ci, typecheck, lint, format:check, test, determinism, build — fail-closed.

## Known environment limitation (sandbox only)

The build sandbox mount marks previously-emitted `dist/`, `dist-verify/`, and Vite
`*.timestamp-*.mjs` temp files as non-deletable (EPERM on unlink). These are all
git-ignored and excluded from the delivered ZIP (produced via `git archive`), so the
source package is clean. On a normal filesystem / CI these artifacts are removed
normally and never accumulate.

## Second-audit remediations (this pass)

1. CI runs from repository ROOT (no internal folder; root `.nvmrc`/`package-lock.json`);
   added `npm audit --audit-level=high`; added `test/ci/ci-workflow.test.ts`.
2. Architecture scanner + tests enforce Persistence & Asset as leaves (no engine/UI/app),
   allowed-target checks, "no engine imports Orchestrator", and FAIL CLOSED on unresolved
   internal aliases; added synthetic fixtures for all listed forbidden edges.
3. JSON schemas rewritten as a structural bundle (`schemas/domain.schema.json`, 35 `$defs`,
   nested `$ref`, required/enums/`additionalProperties:false`/conditional retention/ID patterns);
   comprehensive AJV positive + negative fixtures.
4. Dependency updates: ajv 8.20.0, vite 6.4.3, @vitejs/plugin-react 5.0.4, vitest 3.2.6 (exact);
   `npm audit` = 0 vulnerabilities (all + `--omit=dev`).
5. Export operational refinement (`ExportDeliveryFormat`) moved to
   `src/shared/contracts/export-refinements.ts`; domain `ExportManifest` uses persisted `ExportFormat`.
6. Type coverage strengthened with compile-time assignability + `@ts-expect-error` negatives;
   coverage matrix distinguishes name / schema / assignability / runtime layers.
