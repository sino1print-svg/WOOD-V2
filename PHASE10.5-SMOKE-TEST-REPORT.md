# Phase 10.5 — Smoke Test Report

## Environment

| Item | Value |
|---|---|
| OS | Linux 6.18.5 x86_64 (containerized CI runner) |
| Node | v22.22.2 |
| npm | 10.9.7 |
| Browser | Real Chromium (Playwright build 1194), clipboard read/write permissions granted, downloads accepted |
| Dev URL (dev tree) | `http://localhost:5173/` (`npm run dev`) |
| Prod URL (dev tree) | `http://localhost:4173/` (`npm run build && npm run preview`) |
| Dev URL (fresh extraction) | `http://localhost:5175/` |
| Prod URL (fresh extraction) | `http://localhost:4175/` |

The identical §11 scenario was executed **four times** — dev and production preview from the development tree, then dev and production preview from a brand-new fresh extraction of the final ZIP. All four runs: **PASS** with **0 console errors and 0 page errors**.

## Scenario steps and observed results (identical in all four runs)

1. **Open the application** — page loads, title `موجّه جلسات الموك أب`, Prompt Center renders.
2. **Invalid form first** — with the empty form, `توليد البرومبتات` is disabled and validation failures are listed with codes and Arabic messages.
3. **Enter a valid data set** — title, season `الهالوين`, target count 2, product Bella Canvas 3001 ×2, one color.
4. **Upload PNG artwork** — a real 1×1 RGBA PNG passes the real Asset Store validation; file name and dimensions are displayed.
5. **Generate** — the real engines produce 2 scenes; 4 prompt blocks render (2×A, 2×B).
6. **Output A / Output B separate** — the A block contains only `[Output A]` content; the B block only `[Output B]`; never merged.
7. **Copy A** — clipboard equals the A prompt byte-for-byte; contains no B content; visible `تم النسخ ✓`.
8. **Copy B** — clipboard equals the B prompt byte-for-byte; contains no A content.
9. **Export TXT** — `prompt-pack.txt` downloads; contains both `[Output A]` and `[Output B]` sections (11,284 chars).
10. **Export Markdown** — `prompt-pack.md` downloads; starts with the official `# Mockup Photoshoot Director Export` header.
11. **Export JSON** — `prompt-pack.json` downloads; `JSON.parse` succeeds (23,880 chars).
12. **Export canonical JSON** — `prompt-pack.canonical.json` downloads; parses successfully.
13–14. **Repeat the identical request** — regeneration reproduces byte-identical prompts and a byte-identical TXT export.
15. **Change an input (season)** — previous results are immediately cleared (the approved state machine never displays stale outputs as current).
16. **Regenerate** — updated results for the new season (`minimal studio` content), different from the previous run.
17. **Invalid input again** — clearing the session name disables Generate and shows `UI_SESSION_NAME_REQUIRED — اسم الجلسة مطلوب.`
18. **Console check** — 0 console errors, 0 page errors in every run.

## Cross-environment determinism evidence

SHA-256 of the downloaded exports across all four runs (dev, prod, fresh-dev, fresh-prod):

- `prompt-pack.txt` → **one** unique hash across all four environments.
- `prompt-pack.md` → **one** unique hash.
- `prompt-pack.json` → **one** unique hash.

## Evidence files (session workspace `evidence/` directory)

Per run (`dev`, `prod`, `fresh-dev`, `fresh-prod`): full-page screenshots `…-01-open.png`, `…-02-filled.png`, `…-03-results.png`, `…-04-exported.png`, `…-05-updated.png`, `…-06-invalid.png`; downloaded `…-prompt-pack.{txt,md,json,canonical.json}`; step log `…-steps.log`; plus the uploaded `artwork-design.png`. Selected screenshots are attached with the delivery.

## Defects found by the smoke test and fixed before completion

1. RTL grid blowout: the number-control input forced its grid cell wider than the form column, pushing product-row buttons under the validation panel where real clicks were intercepted (`src/styles/base.css`).
2. Missing favicon caused a `404` console error on every load (`index.html` inline SVG icon).

Both fixes are in commit `a632985b2eeac03cb70a2bedb35c832f57328d99`; all four PASS runs above were executed after these fixes.
