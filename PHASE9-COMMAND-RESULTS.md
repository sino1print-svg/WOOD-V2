# PHASE 9 — Command Results (captured live this session)

All results below are from commands actually executed on this working tree.

| Command                      | Exit | Result                                                   |
| ---------------------------- | ---- | -------------------------------------------------------- |
| `npm ci`                     | 0    | clean install                                            |
| `npm run typecheck`          | 0    | no errors                                                |
| `npm run lint`               | 0    | 0 warnings                                               |
| `npm run format:check`       | 0    | clean                                                    |
| `npm run test`               | 0    | **1869 passed (100 files)**, incl. 57 Scene Engine tests |
| `npm run verify:determinism` | 0    | identical file list + SHA-256                            |
| `npm run build`              | 0    | dist/ produced                                           |
| `npm run verify`             | 0    | full pass                                                |
| `npm run verify:full`        | 1    | **fails only at `audit:full`** (dev-only ESLint chain)   |
| `npm audit --omit=dev`       | 0    | **0 vulnerabilities**                                    |

## verify:full blocker evidence

```
===== npm audit (all) — tail =====
          node_modules/file-entry-cache

14 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

===== npm audit --omit=dev =====
found 0 vulnerabilities

===== npm explain eslint — head =====
eslint@8.57.1 dev
node_modules/eslint
  dev eslint@"8.57.1" from the root project
  peer eslint@"^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0" from eslint-plugin-react-hooks@4.6.2
  node_modules/eslint-plugin-react-hooks
    dev eslint-plugin-react-hooks@"4.6.2" from the root project
  peer eslint@"^6.0.0 || ^7.0.0 || >=8.0.0" from @eslint-community/eslint-utils@4.9.1
  node_modules/@eslint-community/eslint-utils

===== which verify:full step failed =====
> npm run audit:full && npm run audit:prod && npm run typecheck && npm run lint && npm run format:check && npm run test && npm run verify:determinism && npm run build
> mockup-photoshoot-director@0.1.0 audit:full
14 high severity vulnerabilities
```

docs/spec/ confirmed byte-identical to the original baseline (untouched). No `--force`, no ESLint breaking upgrade, no tests deleted.
