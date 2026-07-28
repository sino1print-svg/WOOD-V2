# Phase 7 Third Corrective — Implementation Report

**Package:** `mockup-photoshoot-director-phase7-third-corrective-ready-for-independent-audit.zip`
**Source package:** `third-corrective-final.zip` (SHA-256 `f53b3c38ecb1a3d1b45e5ccf7f2b80bacc1f199213d777b9e8bb43fcee03aa5f`, verified on receipt)
**Environment:** Node v22.22.2, npm 10.9.7 (`.node-version` / `.nvmrc` pinned 22.22.3). The `engines.node` field read
`>=20` when this Phase 7 report was written; that declaration was superseded in Phase 10.5 by the dependency-accurate
`^22.22.3 || ^24.15.0 || >=26.0.0` (audit finding IA-10.5-01). Node 20 is not supported by the current dependency tree.

## 1. Decision

```
APPROVED — PHASE 7 CORRECTIVE SOURCE PACKAGE
APPLICATION REMAINS INCOMPLETE
```

The Vite web app builds, runs (dev and production preview), and renders/validates interactively without
runtime errors. It is **not** a complete generation application (the "Generate" action in the UI has no
wired handler — see Gap Analysis) and there is **no** Electron/installer packaging, so this is not a
Windows final release.

## 2. The five original defects, root cause, fix, and proof

### Defect 1 — `npm ci` failed (E403 on `ajv@8.20.0`)

- **Root cause:** `package-lock.json`'s `resolved` URL for `ajv@8.20.0` pointed at an internal/unreachable
  mirror (`https://packages.applied-caas-gateway1.internal.api.openai.org/...`) instead of the public
  registry.
- **Fix:** Replaced the `resolved` URL with `https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz`. Verified the
  `integrity` hash was already byte-identical to the public registry's hash for the same version before
  changing anything (no version or dependency-graph change).
- **Proof:** `npm ci` succeeds from a clean `node_modules` (log: `validation-artifacts/logs/npm-ci-2.log`
  in the working copy; reproduced again after the later `fast-uri` patch, see Defect 5).

### Defect 2 — `typecheck` failed (TS2352, 2 errors)

- **Root cause:** Two adversarial tests in
  `test/cover-engine/phase7-third-corrective-semantic-grammar.test.ts` called
  `structuredClone(base.products) as Array<...>` directly. `base.products` is typed
  `readonly CoverProductManifest[]` (`Readonly<Pick<Product,'id'|'name'>>`); `structuredClone`'s return type
  preserves that `readonly` modifier, so a direct cast to a mutable shape does not structurally overlap.
- **Fix (final form, see Defect-review below):** Replaced the cast with `structuredClone(base.products).map(product => ({ id: product.id, name: product.name }))`,
  building genuinely fresh mutable objects with no cast at all.
- **Proof:** `npm run typecheck` exits 0.

### Defect 3 — `format:check` failed

- **Root cause:** Self-inflicted by the Defect 2 fix (line wrapping did not match Prettier's rules).
- **Fix:** `prettier --write` on the exact file touched.
- **Proof:** `npm run format:check` exits 0.

### Defect 4 — 5 failing tests in `test/cover-engine/`

Root causes were traced individually with a throwaway diagnostic harness (deleted before delivery — see
§5) that called the engine's own exported functions directly; nothing was guessed.

- **4a/4b (false negative):** `"Final rules are merely suggestions"` and `"Canvas may change"` were not
  rejected. `semantic-conflict.ts`'s lemma map had no entry for the concepts "suggestion" or "change", so
  the windowed target/weakening scan never saw a weakening lemma in these sentences.
  **Fix:** Added `suggestion/suggestions/suggested` → `suggestion` and
  `change/changes/changed/changing` → `change` to `LEMMA_MAP`, and registered `suggestion`/`change` in
  `WEAKENING_LEMMAS`. Also added `merely`/`just` → `merely` as a semantically-empty **glue** lemma (needed
  so cross-field "pure signal" fields like `"Merely Suggestions"` remain fully classified instead of being
  discarded as impure because of an unmapped adverb — see Defect 4e).
- **4c/4d (false positive):** `"Optional Canvas Tote"` and `"Flexible Canvas Bag"` were rejected as
  Cover-doctrine conflicts, even though `"Canvas Tote"`/`"Canvas Bag"` are ordinary bag-material product
  names.
  **Fix:** Added a narrow, explicitly-scoped exception (`allowMaterialCompound`) to
  `windowedConflict`/`containsCoverPromptControlConflict`: a `canvas` lemma occurrence is only exempted from
  the TARGET role when it is **immediately** followed by `tote(s)`/`bag(s)`/`backpack(s)` — a tight
  noun-phrase adjacency check, not a general co-occurrence check. It suppresses only that one occurrence;
  every other target/weakening word in the same value is still evaluated normally. The option defaults to
  `false` everywhere and is enabled **only** for Product Name (`products[N].name`) at every boundary that
  calls it: `validation.ts`'s `validLabel`/`semanticConflictField`, and `prompt-module.ts`'s
  `resolvePromptValues` (both the canonical-field revalidation loop and the derived `productName`/`title`
  checks, since those are single-product-field derivations). Season name, locked-color name, and garment
  label never receive the exception — proven by three explicit negative tests (§4, Part B).
- **4e (false positive, cross-field):** `composeCover` rejected the combination
  `products[0].name = "Rules of Style Streetwear"` + `season.name = "Season Off Sale Bundle"` with
  `COVER_VAR_001`, even though each field individually passes and the cross-field "pure-signal" check
  (`findCrossFieldSemanticConflict`) found nothing.
  **Root cause:** `prompt-module.ts`'s `header` display string concatenates two **independently owned**
  fields (`seasonLabel` and `primaryName`) with an em-dash, then re-ran the raw within-field
  `containsCoverPromptControlConflict` grammar on the _concatenation_. That re-scan is redundant for real
  threats (both source fields already passed the per-field and pure-signal cross-field checks earlier in
  the same function) and produces false positives from incidental cross-field token adjacency — exactly the
  class of false positive the module's own pure-signal design (`semantic-conflict.ts`, design note §4) was
  built to avoid.
  **Fix:** Added `safeCompositeLabel()` — structural safety only (`canonicalizePromptDataLine`; control
  chars, invisible chars, brackets, length), with **no** semantic-conflict re-scan — and used it exclusively
  for `header`, the one derived value that combines two independently-owned fields. `productName`/`title`
  (single-field-derived, plus static/numeric text) keep the full semantic-conflict check with
  `allowMaterialCompound: true`; `seasonLabel`/`subtitle`/`views`/`sourceIds`/`stripParts` keep the
  unmodified strict check. A dedicated regression test (`"rejects a genuine within-field conflict even when
adjacent to a safe header composite"`) proves this does not widen into hiding a real single-field
  conflict.
- **Proof:** `npm run test` → 1812/1812 passing, 0 failing, 0 skipped (see §4 for the exact new-test count).

### Defect 5 — `fast-uri` high-severity vulnerability (runtime dependency)

- **Root cause:** `ajv@8.20.0` (a direct production dependency) resolved `fast-uri@3.1.3`, vulnerable to
  GHSA-v2hh-gcrm-f6hx (host confusion via backslash authority delimiter, CVSS 7.5).
- **Analysis performed before touching anything:**
  1. Affected package: `fast-uri` (leaf, transitive of `ajv`).
  2. Dependency path: `ajv@8.20.0` → `fast-uri`.
  3. Dev-only or runtime: **runtime** — `ajv` is a direct `dependencies` entry, confirmed by
     `npm audit --omit=dev` flagging it.
  4. Breaking change required: **no** — `ajv@8.20.0` declares `"fast-uri": "^3.0.1"`; `3.1.4` (the first
     patched version per the advisory, `vulnerable_versions: ">=3.0.0 <=3.1.3"`) is inside that range.
  5. Compatible version exists: **yes**, `3.1.4`.
  6. Lockfile/behavior impact: leaf-only version bump; no dependency-graph shape change; no test behavior
     depends on `fast-uri` internals.
- **Fix:** `npm audit fix` (no `--force`). It changed exactly one package (`fast-uri` 3.1.3 → 3.1.4) and
  correctly declined to touch anything else (would have required `eslint@10.8.0`, a breaking major
  upgrade — explicitly out of scope, see §3).
- **Proof:** `npm audit --omit=dev` → **0 vulnerabilities**. `npm ci` reproducible from clean
  `node_modules` after the change.

## 3. Residual audit finding (accepted risk, not fixed)

`npm audit` (all dependencies) still reports **14 high-severity findings**, all inside the ESLint 8.57.1
devDependency toolchain (`minimatch`/`glob`/`rimraf`/`flat-cache`/`file-entry-cache`/
`@humanwhocodes/config-array`/`@typescript-eslint/*`/`eslint` itself, plus a `brace-expansion` finding that
appeared after the `fast-uri` patch reduced the report from 15→14). `npm audit fix` itself reports the only
remaining remediation path is `eslint@10.8.0`, explicitly labeled "a breaking change" by npm. This is:

- **Dev-only** (not present in `dist/`, does not ship, does not affect runtime or build output).
- A **major/breaking upgrade** (ESLint 8→10, with matching `@typescript-eslint` major bumps) — out of scope
  for a Phase 7 corrective; upgrading it is a dependency-modernization task that needs its own review of
  lint-rule behavior changes across the whole codebase, not a one-line patch.
- Consequently **not applied**, and **not hidden**: `npm run verify:full` fails at the `audit:full`
  (`npm audit --audit-level=high`) step for this reason, and that failure is the _only_ reason it fails —
  every other stage of `verify:full` (audit:prod, typecheck, lint, format:check, test, verify:determinism,
  build) passes. `npm run verify` (which does not include the strict audit gate) passes end to end.

## 4. Test counts (exact, not approximate)

| Metric                                | Value  |
| ------------------------------------- | ------ |
| Test files                            | 96     |
| Total tests                           | 1812   |
| Passing                               | 1812   |
| Failing                               | 0      |
| Skipped                               | 0      |
| Baseline (before this session's work) | 1777   |
| Net new tests added                   | **35** |

The 35 new tests are the permanent regression coverage added to
`test/cover-engine/phase7-third-corrective-semantic-grammar.test.ts` for Defect 4, confirmed by counting
`it`/`it.each` cases in the three new `describe` blocks:

- Part A (`suggestion`/`change` lemma family): **15**
- Part B (narrow material-compound exception): **12**
- Part C (safe composite header / unsafe cross-field split): **8**
- **15 + 12 + 8 = 35**, matching the 1777 → 1812 delta exactly.

No existing test was deleted, skipped, or weakened. The two `structuredClone` fixture edits (Defect 2)
changed _how_ two pre-existing tests build their fixture, not their count, assertions, or pass/fail
semantics.

## 5. Command results (exact)

| Command                      | Exit | Result                                                                                                                        |
| ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                     | 0    | 251 packages installed                                                                                                        |
| `npm audit`                  | 1    | 14 high (dev-only ESLint chain; see §3)                                                                                       |
| `npm audit --omit=dev`       | 0    | **0 vulnerabilities**                                                                                                         |
| `npm run typecheck`          | 0    | clean                                                                                                                         |
| `npm run lint`               | 0    | clean, 0 warnings (`--max-warnings 0`)                                                                                        |
| `npm run format:check`       | 0    | clean                                                                                                                         |
| `npm run test`               | 0    | 1812/1812 passing                                                                                                             |
| `npm run verify:determinism` | 0    | 4 output files, identical SHA-256 across rebuilds                                                                             |
| `npm run build`              | 0    | `tsc --noEmit && vite build` — dist/ produced                                                                                 |
| `npm run verify`             | 0    | **full pass** (typecheck+lint+format+test+build chain)                                                                        |
| `npm run verify:full`        | 1    | fails at `audit:full` step only (§3); every later stage in the chain was independently confirmed passing via `npm run verify` |

## 6. Runtime smoke test (real browser, not just HTTP status)

Both `npm run dev` (Vite dev server) and `npm run build && npm run preview` (production build) were started
and driven with a real headless Chromium instance (Playwright, run from a scratch directory outside the
project — not a project dependency, not shipped).

- **Development (`vite`, port 5183):** HTTP 200, `#root` populated (4725 chars of rendered DOM), title
  correct (`موجّه جلسات الموك أب`), 0 `pageerror` events, only network issue was a cosmetic `404` for
  `/favicon.ico` (no `<link rel="icon">` declared — not a functional defect). Interaction test: filled the
  session-title field, selected a product from the add-product dropdown, clicked "التحقق" (validate) — no
  exceptions, UI state updated.
- **Production preview (`vite preview`, port 5184, serving `dist/`):** identical result — HTTP 200, same
  rendered content, 0 page errors, same cosmetic favicon 404. Interaction test: filled the title field,
  added a second product, toggled a color swatch, clicked validate — no exceptions; the status banner
  updated to reflect the validation gate correctly (remaining "changes required" state is the UI Engine's
  own validation logic correctly reporting incomplete required fields, not a runtime error).
- **No console errors, no unhandled exceptions, no failed asset loads (JS/CSS) in either mode.**

## 7. Files modified (exact, `diff -rq` against the untouched `third-corrective-final.zip` extraction)

1. `package-lock.json` — registry URL fix (Defect 1) + `fast-uri` patch (Defect 5)
2. `src/engines/cover-engine/semantic-conflict.ts` — Defect 4a/4b/4c/4d (lemma additions, narrow material-compound exception)
3. `src/engines/cover-engine/validation.ts` — Defect 4c/4d wiring (`allowMaterialCompound` threaded to Product Name only)
4. `src/engines/cover-engine/prompt-module.ts` — Defect 4c/4d/4e (`allowMaterialCompound` wiring + `safeCompositeLabel` for `header`)
5. `test/cover-engine/phase7-third-corrective-semantic-grammar.test.ts` — Defect 2 fixture fix + 35 new regression tests

No other file in the package differs from the uploaded source.

## 8. Temporary/debug file removal — confirmed

All diagnostic files used during root-causing (`test/_tmp-debug*.test.ts`, `test/_tmp-debug2.test.ts`,
`test/_tmp-debug3.test.ts`, `test/cover-engine/_probe.test.ts`, `test/cover-engine/_probe2.test.ts`) were
deleted before this delivery. Confirmed absent in this package:

```
$ find test -iname "_tmp*" -o -iname "_probe*"
(no output)
```

The Playwright browser used for the runtime smoke test (§6) was installed in a scratch directory
(`/home/claude/work/pw-smoketest`, outside the project tree) and was deleted after use; it was never added
to `package.json`/`package-lock.json` and is not part of this package.

## 9. `docs/spec/` integrity — confirmed unchanged

Full-tree SHA-256 comparison (per-file, then hash-of-the-sorted-hash-list) against the original
`third-corrective-final.zip` extraction:

```
Aggregate docs/spec/ tree hash (both before and after): 47c4da02fc221e5fbb0bb80a21cb6042a273ecc63fc01adc60104a9f0b052637
```

Identical. `docs/spec/` was never opened for writing at any point in this session.
