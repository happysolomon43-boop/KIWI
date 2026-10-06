# Teaching runtime interaction and Admin diagnostics fix

This focused repair addresses five production issues observed after PR #231:

- TPF-10 instructional-load estimation was incorrectly described as state-bearing at the D03/D05 boundary, causing valid T2 advisory estimates to be rejected with `T2_NO_EVIDENCE_MUTATION`.
- malformed schedule-change Requests could transition to `REVIEWING` before deterministic D09 validation failed, leaving stranded Requests.
- legacy duplicate Teaching Course rows could render as multiple cards and new duplicates were not prevented across non-terminal lifecycle states.
- Teaching actions lacked consistent pressed/busy/completion feedback and refresh restoration could race section registration.
- the main Admin panel had no bounded background diagnostic for the Teaching AI prompt/capability stack.

The repair preserves canonical authority boundaries. TPF-10 remains T2 and non-authoritative; Scheduler remains the durable scheduling owner. Request rejection is persisted through the existing D10 request-decision transaction/event path. Course rows are not destructively deleted; D07 selects one canonical live row per subject and prevents new non-terminal duplicates. Admin live diagnostics are read/evaluation-only and execute through the existing Teaching AI boundary.
