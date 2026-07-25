# Test Fixtures (deterministic)

Fixtures are **fixed, data-only inputs** used by tests. They contain no generated
content and no business logic. They must be deterministic: identical fixtures
produce identical test outcomes (11_TEST_PLAN §2; 12_IMPLEMENTATION_GUIDE §11).

Rules:

- Data only (JSON / typed constants). No engine output, no randomness, no timestamps
  that affect assertions.
- Fixtures are versioned and reviewed like source.
- Phase 0 ships only trivial sample data (e.g. `sample-colors.json`). Session, scene,
  prompt, cover, and export fixtures are added alongside their engines in later phases.

See `../golden-masters/README.md` for the golden-master (byte-oracle) policy.
