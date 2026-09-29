# D10 migration recovery

The D10 migration is additive over accepted D04-D09 data. Before any authoritative D10 data exists, rollback in a disposable environment may drop the D10-only tables/columns/triggers. Production recovery after D10 records exist must be forward-corrective.

Never recover by deleting Course lifecycle history, Request history/applications, activation snapshots, admission decisions, timetable history, schedule debt, Course Plan/Coverage history or academic audit lineage.

If a D10 deployment must be disabled, stop D10 mutation routes while preserving read access and records. Restore service behavior with a forward migration or code correction. The authenticated browser role must remain read-only for authoritative D10 state.
