# Phase 10.5 — Open Issues

```text
No known open issues within Phase 10.5 scope.
```

## Documented scope notes (not defects, outside Phase 10.5)

- Binary artwork assets live in application memory for the session; the uploaded PNG must be re-selected after a browser reload or session restore before regenerating Output B (the UI states this requirement as a typed validation failure). Persisting binary assets is outside the Phase 10.5 scope.
- Group prompt plans and cover composition are not part of the Prompt Center A/B flow (no group-prompt composer engine exists; the Cover Engine's hashing is Node-only). The session-scope export therefore contains sessions, scenes, and Output A/B — with the approved ordering — and no group/cover artifacts. Deferred with the rest of the later scope.
- `src/app/state`, `src/app/validation-gate`, and `src/ui/screens` remain intentional empty namespaces with honest Phase 10.5 status documentation; none is part of the primary workflow.
