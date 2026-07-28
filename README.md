# Mockup Photoshoot Director

A deterministic, modular Mockup Photoshoot Director for Etsy and print-on-demand workflows.
The twelve documents in `docs/spec/` are the authoritative specifications.

> **Status: Phase 7 Corrective — Ready for independent audit.**
> Phases 0–6 remain approved. Findings P7-AUD-001, P7-AUD-002, and P7-AUD-003 are addressed by
> implementation evidence only; this is not an approval state. Phase 8 has not started.

## Phase 7 capabilities

- Pure terminal Cover Engine at `src/engines/cover-engine/`; it imports no other engine and performs
  no I/O, rendering, persistence, upload, or image mutation.
- Runtime-validated Output-A-only source boundary with the `allOutputAReady` barrier, generated-state
  verification, duplicate detection, and fail-closed handling of hostile runtime objects.
- Deterministic count-to-layout mapping for Single, Duo, Triptych, Grid 2×2, Grid 2×3, Grid 3×3,
  and unbounded Mosaic layouts.
- Deterministic product, color, and view modes; exact-primary hero selection; stable priority,
  scene-order, and Output-A-ID tie-breaks.
- Manifest-driven product and season names, a locked-color-only strip, digital-aware badges, and
  canonical English cover-prompt sections.
- `Project.isDigitalProduct` is the authoritative digital flag; conflicting or malformed derived
  metadata fails closed and physical products publish no digital-product messaging.
- A closed-world Cover PromptModule owns the sole canonical section template and final prompt
  assembly. Prompt-bound runtime text rejects reserved structure and control intent without
  sanitization or coercion.
- Non-negotiable source lock, warm-neutral canvas, one-image directive, restrained typography,
  whitespace, and visual-hierarchy doctrine.
- SHA-256 `coverHash`, `promptHash`, and timestamp-independent `promptChecksum`, with validated
  composition-cache reuse.
- Immutable owned results and no caller-input mutation.
- Typed bilingual Cover failures from the shared authoritative error registry.

## Preserved approved capabilities

- Phase 0 domain model, schemas, contracts, architecture boundaries, i18n, and CI foundations.
- Phase 1 persistence, assets, recovery, autosave, migrations, and version history.
- Phase 2 Rule Engine.
- Phase 3 Palette Engine.
- Phase 4 Print-Area Engine.
- Phase 5 Prompt Engine.
- Phase 6 UI Engine and all ownership-boundary corrective protections.

## Deliberately out of scope

- Rendering or editing any source or cover image.
- Export Engine implementation, ZIP/export behavior, marketplace publishing, or upload behavior.
- Any Phase 8 code, tests, architecture, or deliverables.

## Key folders

```text
src/engines/cover-engine/       Phase 7 Cover Engine
src/shared/contracts/           public engine contracts
src/shared/domain-model/        authoritative domain types
src/shared/errors/              authoritative bilingual error registry
test/cover-engine/              Phase 7 permanent regression tests
docs/PHASE7_COVER_ENGINE.md      implementation boundary and traceability
docs/spec/                      immutable authoritative specifications
```

## Requirements

- Node.js **22.22.3** — the single approved baseline, pinned in `.nvmrc` and `.node-version`; CI installs it via `node-version-file: .nvmrc`.
- npm **10.9.8** (bundled with Node 22.22.3; also declared in `package.json` `packageManager`).
- `package.json` `engines.node` is `^22.22.3 || ^24.15.0 || >=26.0.0` — the exact range the installed dependency
  tree supports (`jsdom` requires `^22.22.2 || ^24.15.0 || >=26.0.0`, `undici` requires `>=22.19.0`). Node 20 is **not** supported.

## Verification

```bash
npm ci
npm audit
npm audit --omit=dev
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run verify:determinism
npm run build
npm run verify
npm run verify:full
```

See `docs/PHASE7_COVER_ENGINE.md` for the implemented contract, deterministic policies, validation
boundary, and test coverage. Historical implementation notes for earlier approved phases remain in
`docs/`.
