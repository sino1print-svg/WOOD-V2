# Phase 10.5 — Command Results

Every command below was actually executed; exit codes are recorded from the live runs. Section A ran in the final clean development tree; Section B ran in a brand-new directory populated only by extracting the final ZIP (`31dc8885103ec9501cfbcae35009c73c5d3f394be0c041c17872e6cf0042eda2`). Output blocks show the decisive lines from the captured logs (full logs retained in the session workspace).

## A. Final clean development tree

### `$ npm ci`

Exit code: **0**

```text
added 241 packages, and audited 242 packages in 3s
found 0 vulnerabilities
```

### `$ npm audit`

Exit code: **0**

```text
found 0 vulnerabilities
```

### `$ npm audit --omit=dev`

Exit code: **0**

```text
found 0 vulnerabilities
```

### `$ npm run typecheck`

Exit code: **0**

```text
> mockup-photoshoot-director@0.1.0 typecheck
> tsc --noEmit
```

### `$ npm run lint`

Exit code: **0**

```text
> eslint . --max-warnings 0
```

### `$ npm run format:check`

Exit code: **0**

```text
All matched files use Prettier code style!
```

### `$ npm run test`

Exit code: **0**

```text
   ✓ Phase 10.5 export command > returns bytes identical to the official formatters (no re-implementation)  383ms
   ✓ Phase 10.5 export command > is byte-for-byte deterministic across two identical generations  567ms
   ✓ Phase 10.5 orchestrator — real generation > is deterministic: the same draft yields byte-identical prompts  429ms
 ✓ test/rule-engine/trace-and-errors.test.ts (7 tests) 9ms
   ✓ Scene Engine — determinism (§21) > identical inputs reproduce an identical plan, scene-for-scene  425ms
 ✓ test/errors/authoritative-codes.test.ts (5 tests) 3ms
 ✓ test/palette-engine/security-and-errors.test.ts (7 tests) 1ms
 ✓ test/errors/registry.test.ts (6 tests) 4ms
stderr | test/ui-app/app-shell-integration.test.tsx > Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations
   ✓ Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations  447ms
 Test Files  137 passed (137)
      Tests  2626 passed (2626)
```

### `$ npm run verify:determinism`

Exit code: **0**

```text
Build output is deterministic (identical file list + SHA-256 hashes).
```

### `$ npm run build`

Exit code: **0**

```text
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.93s
```

### `$ npm run verify`

Exit code: **0**

```text
> eslint . --max-warnings 0
All matched files use Prettier code style!
   ✓ Scene Engine — determinism (§21) > identical inputs reproduce an identical plan, scene-for-scene  462ms
   ✓ Phase 10.5 export command > returns bytes identical to the official formatters (no re-implementation)  390ms
   ✓ Phase 10.5 export command > is byte-for-byte deterministic across two identical generations  645ms
   ✓ Phase 10.5 orchestrator — real generation > is deterministic: the same draft yields byte-identical prompts  469ms
 ✓ test/rule-engine/trace-and-errors.test.ts (7 tests) 10ms
    …
stderr | test/ui-app/app-shell-integration.test.tsx > Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations
   ✓ Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations  449ms
 Test Files  137 passed (137)
      Tests  2626 passed (2626)
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 2.08s
```

### `$ npm run verify:full`

Exit code: **0**

```text
found 0 vulnerabilities
> eslint . --max-warnings 0
All matched files use Prettier code style!
   ✓ Scene Engine — determinism (§21) > identical inputs reproduce an identical plan, scene-for-scene  445ms
   ✓ Phase 10.5 export command > returns bytes identical to the official formatters (no re-implementation)  394ms
   ✓ Phase 10.5 export command > is byte-for-byte deterministic across two identical generations  567ms
   ✓ Phase 10.5 orchestrator — real generation > is deterministic: the same draft yields byte-identical prompts  434ms
    …
   ✓ Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations  454ms
 Test Files  137 passed (137)
      Tests  2626 passed (2626)
Build output is deterministic (identical file list + SHA-256 hashes).
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.95s
```

### `$ npm run verify:zip:external`

Exit code: **0**

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
PASS  single-output-a  (6 entries)
PASS  a-b-pair  (9 entries)
PASS  multi-scene-session  (18 entries)
PASS  arabic-project-name  (15 entries)
PASS  collision-heavy-names  (20 entries)
    …
PASS  markdown-long-backtick-runs  (14 entries)
PASS  prompt-cr-crlf-nfc-nfd-emoji-trailing  (14 entries)
PASS  tampered-checksums-repaired-ledger  (repaired outer ledger accepted; extracted semantic tamper rejected)
PASS  tampered-manifest-repaired-ledger  (repaired outer ledger accepted; extracted semantic tamper rejected)
PASS  reordered-hostile-external-compatibility  (external unzip/list/extract/semantic checks: accepted; internal verifyPackageZip: structural/local_order_mismatch)
PASS  external-case-count  (13/13 passed)
```

## B. Fresh extraction of the final ZIP

Exit codes in this section were captured live by the runner (`"$@"; echo "$* -> exit $?"`), which printed `exit 0` for every command; the transcript below shows each command's decisive output lines.

### `$ npm ci`

Exit code: **0**

```text
added 241 packages, and audited 242 packages in 3s
found 0 vulnerabilities
```

### `$ sha256sum -c CHECKSUMS.txt --quiet`

Exit code: **0**

```text
```

### `$ node scripts/source-tree-hash.mjs`

Exit code: **0**

```text
2a317b4a65698c4bff0d58d45255e58ebf9707b519388e25278965e5915e5c63  423 files
```

### `$ node scripts/source-tree-hash.mjs`

Exit code: **0**

```text
2a317b4a65698c4bff0d58d45255e58ebf9707b519388e25278965e5915e5c63  423 files
```

### `$ npm audit`

Exit code: **0**

```text
found 0 vulnerabilities
```

### `$ npm audit --omit=dev`

Exit code: **0**

```text
found 0 vulnerabilities
```

### `$ npm run typecheck`

Exit code: **0**

```text
> mockup-photoshoot-director@0.1.0 typecheck
> tsc --noEmit
```

### `$ npm run lint`

Exit code: **0**

```text
> eslint . --max-warnings 0
```

### `$ npm run format:check`

Exit code: **0**

```text
All matched files use Prettier code style!
```

### `$ npm run test`

Exit code: **0**

```text
   ✓ Phase 10.5 export command > returns bytes identical to the official formatters (no re-implementation)  395ms
   ✓ Phase 10.5 export command > is byte-for-byte deterministic across two identical generations  641ms
   ✓ Phase 10.5 orchestrator — real generation > is deterministic: the same draft yields byte-identical prompts  464ms
 ✓ test/rule-engine/trace-and-errors.test.ts (7 tests) 9ms
   ✓ Scene Engine — determinism (§21) > identical inputs reproduce an identical plan, scene-for-scene  419ms
 ✓ test/errors/authoritative-codes.test.ts (5 tests) 3ms
 ✓ test/palette-engine/security-and-errors.test.ts (7 tests) 2ms
 ✓ test/errors/registry.test.ts (6 tests) 5ms
stderr | test/ui-app/app-shell-integration.test.tsx > Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations
   ✓ Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations  446ms
 Test Files  137 passed (137)
      Tests  2626 passed (2626)
```

### `$ npm run verify:determinism`

Exit code: **0**

```text
Build output is deterministic (identical file list + SHA-256 hashes).
```

### `$ npm run build`

Exit code: **0**

```text
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.95s
```

### `$ npm run verify`

Exit code: **0**

```text
> eslint . --max-warnings 0
All matched files use Prettier code style!
   ✓ Scene Engine — determinism (§21) > identical inputs reproduce an identical plan, scene-for-scene  440ms
   ✓ Phase 10.5 export command > returns bytes identical to the official formatters (no re-implementation)  386ms
   ✓ Phase 10.5 export command > is byte-for-byte deterministic across two identical generations  683ms
   ✓ Phase 10.5 orchestrator — real generation > is deterministic: the same draft yields byte-identical prompts  451ms
 ✓ test/rule-engine/trace-and-errors.test.ts (7 tests) 10ms
    …
stderr | test/ui-app/app-shell-integration.test.tsx > Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations
   ✓ Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations  583ms
 Test Files  137 passed (137)
      Tests  2626 passed (2626)
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.92s
```

### `$ npm run verify:full`

Exit code: **0**

```text
found 0 vulnerabilities
> eslint . --max-warnings 0
All matched files use Prettier code style!
   ✓ Phase 10.5 export command > returns bytes identical to the official formatters (no re-implementation)  448ms
   ✓ Phase 10.5 export command > is byte-for-byte deterministic across two identical generations  637ms
   ✓ Scene Engine — determinism (§21) > identical inputs reproduce an identical plan, scene-for-scene  427ms
   ✓ Phase 10.5 orchestrator — real generation > is deterministic: the same draft yields byte-identical prompts  437ms
    …
   ✓ Phase 10.5 AppShell — export downloads > downloads identical bytes for the same inputs across two generations  486ms
 Test Files  137 passed (137)
      Tests  2626 passed (2626)
Build output is deterministic (identical file list + SHA-256 hashes).
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 2.04s
```

### `$ npm run verify:zip:external`

Exit code: **0**

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
PASS  single-output-a  (6 entries)
PASS  a-b-pair  (9 entries)
PASS  multi-scene-session  (18 entries)
PASS  arabic-project-name  (15 entries)
PASS  collision-heavy-names  (20 entries)
    …
PASS  markdown-long-backtick-runs  (14 entries)
PASS  prompt-cr-crlf-nfc-nfd-emoji-trailing  (14 entries)
PASS  tampered-checksums-repaired-ledger  (repaired outer ledger accepted; extracted semantic tamper rejected)
PASS  tampered-manifest-repaired-ledger  (repaired outer ledger accepted; extracted semantic tamper rejected)
PASS  reordered-hostile-external-compatibility  (external unzip/list/extract/semantic checks: accepted; internal verifyPackageZip: structural/local_order_mismatch)
PASS  external-case-count  (13/13 passed)
```
