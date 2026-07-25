# PHASE 9 — FINAL AUDIT BLOCKER REPORT

**Adopted status:**

```
PHASE 9 — IMPLEMENTATION VERIFIED — FINAL AUDIT BLOCKED BY DEV-ONLY ESLINT DEPENDENCY CHAIN
```

**Actions taken per instruction:** no `--force`, no breaking ESLint upgrade, no Phase 9 release package
produced, no completion declared. The Scene Engine implementation is verified against every gate except
the pre-existing dev-only `audit:full` chain documented below. Phase 10 not started.

---

## 1. Result

`verify:full` is BLOCKED at its `audit:full` step, and only that step. The blocker is a
**dev-tooling-only** dependency chain: 14 high-severity advisories, all the single root advisory
`GHSA-mh99-v99m-4gvg` (`brace-expansion`: DoS via unbounded expansion → OOM, CVSS 7.5), reaching the
project exclusively through `eslint@8.57.1` and `@typescript-eslint@7.18.0` (both devDependencies).

- **`npm audit --omit=dev` = 0 vulnerabilities** (the operative gate for shippable code).
- No safe fix exists: the only advisory-clean `brace-expansion` (`5.0.8`) breaks the lint toolchain
  (§4), and npm's only other remediation is a semver-major ESLint-stack replacement (§5) — an unsafe
  breaking change, explicitly disallowed here.
- Production impact: **none** (not in `dist/`, not in the runtime graph, not in the Scene Engine).

## 2. Actual command outputs (captured live, verbatim)

```
===== npm audit --omit=dev =====
found 0 vulnerabilities

===== npm audit (all) TAIL =====
          node_modules/file-entry-cache

14 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

===== npm explain eslint (head) =====
eslint@8.57.1 dev
node_modules/eslint
  dev eslint@"8.57.1" from the root project
  peer eslint@"^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0" from eslint-plugin-react-hooks@4.6.2
  node_modules/eslint-plugin-react-hooks
    dev eslint-plugin-react-hooks@"4.6.2" from the root project

===== brace-expansion resolution =====
brace-expansion@1.1.16
brace-expansion@2.1.2
```

Both installed `brace-expansion` lines (`1.1.16`, `2.1.2`) are still flagged because the high advisory
range is `<=5.0.7`, which spans every prior major line.

## 3. Dependency paths (root advisory → root project)

All 14 advisory instances trace to `brace-expansion` under dev-only tooling. Representative paths
(`npm explain`):

```
brace-expansion@1.1.16
└─ minimatch@3.1.5            (requires brace-expansion ^1.1.7)
   ├─ eslint@8.57.1  (dev)                                   ← root devDependency
   ├─ @eslint/eslintrc@2.1.4 → minimatch@3.1.5 → brace-expansion
   ├─ @humanwhocodes/config-array@0.13.0 → minimatch@3.1.5 → brace-expansion
   └─ file-entry-cache@6.0.1 → flat-cache@3.2.0 → rimraf@3.0.2 → glob@7.2.3 → minimatch@3.1.5 → brace-expansion

brace-expansion@2.1.2
└─ minimatch@9.0.9           (requires brace-expansion ^2.0.2)
   └─ @typescript-eslint/typescript-estree@7.18.0  (dev)     ← via parser + eslint-plugin
```

Five flagged install nodes (from `npm audit --json`), all dev-tooling:
`node_modules/@eslint/eslintrc/node_modules/brace-expansion`,
`node_modules/@humanwhocodes/config-array/node_modules/brace-expansion`,
`node_modules/brace-expansion`, `node_modules/eslint/node_modules/brace-expansion`,
`node_modules/glob/node_modules/brace-expansion`.

## 4. Minimal override attempted, tested, and reverted (not safe)

An `overrides` entry pinning `brace-expansion@5.0.8` (the only advisory-clean version) was **applied and
tested**, then **reverted**:

- With it: `npm ci` OK, `npm audit` → 0 vulnerabilities, `typecheck` + `test` pass.
- But `npm run lint` **crashes**: `TypeError: expand is not a function` at `Minimatch.braceExpand`
  (`node_modules/@eslint/eslintrc/node_modules/minimatch/minimatch.js`). ESLint 8's bundled
  `minimatch@3` hard-requires `brace-expansion@^1.1.7` and calls the legacy CJS `expand()`; `5.x`
  changed its export shape. `format:check` also regresses.
- No `brace-expansion`/`minimatch` override combination both satisfies the `<=5.0.7` advisory and
  preserves the `minimatch@3` API ESLint 8 needs; making it coherent requires `minimatch@10`, which
  cascades into the same full ESLint-stack replacement as §5.

Post-revert integrity (verified): `package.json` and `package-lock.json` are **byte-identical** to the
pre-attempt baseline, `overrides` is absent, and `lint`/`format:check`/`typecheck` are green.

## 5. Only npm-offered remediation — semver-major, unsafe, out of scope

`npm audit --json` gives an identical `fixAvailable` for all 14 advisories, each `isSemVerMajor: true`:
`eslint → 10.8.0` (from `8.57.1`), `@typescript-eslint/eslint-plugin → 8.65.0`,
`@typescript-eslint/parser → 8.65.0` (both from `7.18.0`). This also removes the `.eslintrc.cjs` format
(flat-config migration required) and forces replacing `eslint-plugin-react-hooks@4.6.2`
(peer-capped at `eslint@^8.0.0-0`). Out of Phase 9 scope; not applied.

## 6. Full gate results (clean, reverted tree)

| Gate                       | Command                      | Result                                                            |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| Clean install              | `npm ci`                     | PASS                                                              |
| `npm audit` (all)          | —                            | FAIL — 14 high (dev-only ESLint chain)                            |
| **`npm audit --omit=dev`** | —                            | **PASS — 0 vulnerabilities**                                      |
| Typecheck                  | `npm run typecheck`          | PASS                                                              |
| Lint                       | `npm run lint`               | PASS                                                              |
| Format                     | `npm run format:check`       | PASS                                                              |
| Test                       | `npm run test`               | **PASS — 1869/1869 (100 files, incl. 57 new Scene Engine tests)** |
| Determinism                | `npm run verify:determinism` | PASS (identical SHA-256s)                                         |
| Build                      | `npm run build`              | PASS                                                              |
| `npm run verify`           | —                            | **PASS**                                                          |
| `npm run verify:full`      | —                            | **FAIL — only at `audit:full`**                                   |

## 7. Correction plan (out of Phase 9 scope)

1. Treat ESLint 8→10 + `@typescript-eslint` 7→8 as a separate, reviewed tooling task on its own branch.
2. Migrate `.eslintrc.cjs` → flat `eslint.config.js`; upgrade/replace `eslint-plugin-react-hooks` to an
   ESLint-9/10-compatible release.
3. Re-run the full rule set across the codebase; resolve new findings before merge.
4. After it lands, `brace-expansion` resolves to a patched `5.x` via the upgraded `minimatch@10`, and
   `audit:full` (hence `verify:full`) passes with no override.
5. Until then, the `audit:full` failure is a **known, accepted, dev-only** finding — identical to the
   state carried and documented since Phase 7 and Phase 8. `audit:prod = 0` is the operative security
   gate for shippable code.

---

_No Phase 9 release ZIP or completion declaration was produced, because `verify:full` did not pass and
the only available fix is an unsafe breaking upgrade. The Scene Engine implementation itself is complete
and green on every gate except the pre-existing dev-only audit chain above. `docs/spec/` was not
modified._
