# Teaching D08 migration recovery

D08 persistence is additive. Recovery must preserve accepted Course Plan/Coverage history.

If a non-production migration must be rolled back before any D08 plan is accepted, remove D08 child tables in reverse dependency order, remove the D08 Course Plan update guard, remove D08-added indexes/foreign key/columns, and then restore the previous schema. If any D08 Course Plan or Coverage Audit has been accepted, do not destructively roll back; ship a forward corrective migration that preserves lineage.

Never recover by granting `authenticated` browser roles INSERT/UPDATE/DELETE privileges on Teaching academic truth. Never delete historical Learning Units or VPK decisions to make a new plan fit. Never rewrite Coverage Audit snapshots.

Scope-change recovery is review-state aware. An `OPEN` scope review has not changed source truth and may be dismissed by a forward corrective operation. `ACCEPTED_PENDING_REPLAN` means the source snapshot has advanced and the prior plan is intentionally review-required; recovery must not reactivate superseded source rows by deleting history. `APPLIED` means a successor plan has consumed the accepted snapshot and its application row is immutable.
