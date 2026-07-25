# Golden Masters (determinism oracle)

Golden masters are **byte-exact expected outputs** for deterministic engine results
(scenes, prompts, cover prompts, export bytes). They are the regression backbone
(11_TEST_PLAN §26; 12_IMPLEMENTATION_GUIDE §26/§35).

Policy:

- A golden master is produced from a fixed fixture + fixed module/rule-set versions.
- The determinism CI stage compares two independent runs byte-for-byte and against
  the stored golden master (IMPL §36 EVP-25..28).
- Any change to a golden master requires an intentional PR with justification
  (IMPL §31/§32; AC-125). Unjustified drift is a determinism defect.
- Timestamps are excluded from all golden-master content (IMPL §14; AC-15).

Phase 0 ships **no** golden masters because no engine produces output yet. This folder
and its policy exist so later phases have a stable home for byte oracles.
