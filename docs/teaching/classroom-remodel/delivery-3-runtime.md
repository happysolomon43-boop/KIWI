# Delivery 3 runtime candidate

This is an inactive implementation candidate stacked on Deliveries 1 and 2. Their acceptance gates remain held. No candidate migration has been applied to a connected Supabase project, and no Render deployment or active prompt binding has changed.

## Ownership and composition

`classroomPresentationOptions` is an optional trusted server dependency in Teaching composition. Its absence registers no new presentation service. Existing D11 session admission still selects the legacy engine. An isolated remodeled session must already have an immutable accepted chapter and preparation-binding pin.

The runtime reuses D02 due-event claims, D05 outbox and central model orchestration, D11 academic state/time, and D14 Teacher/Board publication. The classroom instruction event can prepare an admitted session when the adopted initial pace, policy reader and coordinator opening-directive reader are supplied. Missing adoption yields a scoped hold. There is no new worker service, database, identity system or browser-owned release timer.

Live generation uses D14's controller request, the retained TPF-08 candidate binding, and current private chapter/guide/directive inputs. It does not reopen a handed-off pre-class PPL workspace. The D05 provisional-result sink commits an immutable prepared sequence before marking execution complete. Retry first reconciles that private sequence. Missing output from a prior execution remains an unknown-outcome hold; it is never silently called complete or submitted again under a fresh operation identity.

## State and release

The migration adds six service-only RLS tables: delivery state, immutable sequences, immutable portions, ordered public conversation, receipts and commands. Delivery pins cannot change; cursor, epochs and confirmed/published positions cannot regress. Board identifiers become immutable at publication.

Acceptance rechecks the actual chapter dependencies, current plan/Blueprint/schedule/course/timetable, Controller state, authorized span and buffer budgets. Generation runs outside transactions. Response-dependent portions, task windows, unsupported Board operations and student questions remain disabled. D14 validates supported `add` blocks; an essential asset requires an owned ready D14 asset. A source-grounded text replacement is an explicit new sequence, with the old prepared sequence superseded.

A due release requires the current worker claim, unexpired claim, matching delivery epoch and exact portion identity. It also requires an active client lease, eligible dwell time, no pause/protected state, and confirmation of the prior published portion. Teacher communication, Board items, portion publication, conversation ordering and outbox are one database transaction. A failure rolls them all back. D11's authoritative end is checked again before publication commits.

A render receipt means application render readiness only. It never means attention, mastery, attendance or successful learning. `accessible_ready` permits accessible reading without requiring viewport intersection. Hidden clients and incomplete representations cannot confirm. Lost acknowledgements reuse the operation key. Explicit takeover increments the control epoch and rejects stale writers; readers remain permitted. Lease expiry holds release without closing the Class or resetting dwell.

At protected takeover, stale sources, revoked parents or authoritative end, prepared sequences are superseded and the epoch advances. Final released/confirmed position is retained. D11 alone closes the Class. Recovery accepts fresh semantically validated generation; it never relabels old output with new authority versions.

## Versioned policy and public contract

The core snapshot, delta, command and receipt contract is `classroom-domain.v1`; the concrete HTTP adapter is `classroom-presentation-wire.v1`. Its camel-case request fields map directly to the core safety fields. A single caller-generated `operationKey` supplies both the core operation identity and idempotency key. Successful or held command responses include a validated canonical `receipt`, alongside the adapter's compatibility fields.

The session snapshot adds a versioned wire marker, adopted pace names, authoritative clocks, client renewal interval, limited released portions with real D14 Board references, supported capabilities and transport backoff. It never includes sequence buffers, coordinator directives, criteria, lease-token hashes or generation inputs. In protected assessment/Classwork mode, chapter, conversation, portions and resume anchor are hidden.

Policy values have no production defaults. Pace profiles, buffer limits, client lease/renewal, transport pagination/backoff and generation timing/retries require versioned owner adoption. The earlier generic `generationBudget` integer did not specify a unit. Delivery 3 explicitly requires its adopted record to declare `unit: output_tokens_per_attempt` before live generation; it maps to the central provider token limit. The adopted retry ceiling limits provider attempts at the existing D05 before-attempt boundary, after the ordinary authority check. The server timeout aborts inference and preserves uncertainty about any remote outcome. No numerical limit is invented in model wording.

Retention fields remain pinned; this candidate never deletes historical conversation or provenance. Coordinated archival/retirement and mandatory policy-change rollout remain later qualification work.

Authenticated routes are mounted under the existing Teaching router:

- `GET /classes/:id/classroom/session`
- `GET /classes/:id/classroom/conversation?after=<cursor>`
- `GET /classes/:id/classroom/stream?after=<cursor>`
- `POST /classes/:id/classroom/client-lease`
- `POST /classes/:id/classroom/presentation-controls`
- `POST /classes/:id/classroom/delivery-receipts`

Fetch-based SSE uses Authorization headers and numeric cursors. It re-runs existing authentication, closes on auth expiry, protection, cancellation or backpressure, and shares visibility/ordering with polling. The shared client handles refresh, gaps, reset and cancellation. It sends no render receipts or teaching commands automatically. Delivery 4 must supply the visible classroom and accessible render adapter; no new UI control is activated here.

## Reproducible technical demonstration and evidence limits

Run `npm test` for contract/domain/protocol checks. Run `node scripts/setup-teaching-integration-db.js` and `npm run test:teaching:integration` with an explicitly non-production database and project reference. The CI workflow does this in disposable native PostgreSQL 17; it refuses the production project.

`classroom-presentation.test.js` creates actual prepared real-format chapter/plan/guide/opening artifacts, immutable binding and remodeled session. It exercises public release, receipts, recovery, takeover, exact due claims, independent concurrent transactions, rollback, protected state, hard end, asset hold, canonical Board identities, and connected HTTP/SSE against the persisted service. Its content, adoption and academic review records are clearly fixture-only. It is not live-provider evidence.

`classroom-presentation-transport.test.js` exercises HTTP authentication, SSE and shared fetch/polling in a JavaScript client harness. It is not a full browser, screen-reader, actual-account or deployed proxy qualification. All 44 blueprint scenarios remain unqualified in the ledger; Delivery 3 adds bounded fixture evidence for its assigned scenarios rather than changing that status.

## Rollback and next gate

Leave presentation options unset and new-session admission on the legacy engine. The additive migration retains every old table and binding. Do not drop the new tables after any candidate session has written history. No legacy binding is retired. Production rollback, active-session migration and retirement are Delivery 8 gates.

The next acceptance action is to supply adopted owner policy/requirements and configured central candidate/reviewer routes, obtain the required academic review evidence, qualify revised modes/callers with observed providers, and then run deployed authenticated SSE/poll/recovery/accessibility qualification. Fixture policies and CI success cannot satisfy those gates.
