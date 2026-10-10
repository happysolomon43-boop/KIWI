# Delivery 4 — inactive connected classroom candidate

Delivery 3 checkpoint: `delivery-3-checkpoint.v1.json`. Delivery 4 draft: https://github.com/happysolomon43-boop/KIWI/pull/332. This document records implementation and evidence limits; it does not pass the missing provider/reviewer/C4 or policy adoption gates.

## Implemented surface and ownership

The existing Course/Class/history entry shell stays registered in `public/teaching-classroom.js`. Its authenticated D14 snapshot supplies `classroomEngine`; only a server-pinned `CLASSROOM_V1` session loads the remodeled modules. Legacy sessions retain their surface. Classwork/Assessment transitions clear the remodeled reading surface and re-enter the existing D16/D18 authorized work shell. There is no new browser feature flag or academic authority.

`public/classroom/session-client.js` is the sole session store. It consumes versioned public snapshots/deltas, deduplicates committed events, retains an uncertain command's exact identity, uses shared authenticated transport, and fences a credential after takeover or expiry. Lease, pause/resume, pace and receipt commands reach the actual Delivery 3 APIs. The backend continues to own release, D11 timing, permissions, durable work and recovery. A display-only clock does not release content.

`renderers.js` renders inert public text, chapter elements and source links. `classroom-view.js` keeps the reading DOM mounted, appends events by sequence, preserves focus/scroll through updates, provides independent mobile Conversation/Chapter views, text sizing, an accessible chapter-width range, current-span highlighting, history loading and Return to current. Reading preferences use session storage; chapter/task/criteria payloads are not browser-persisted. Ordinary updates preserve the existing Notebook sheet and its editor.

Actual allowlisted D14 Board renderers and authenticated blob assets remain in use. Board objects attach to their committed conversation identity, have an expanded native dialog, retain alternative descriptions, and participate in active-client readiness. Required asset identities are public only after release. A missing required representation cannot produce an application-render receipt. Receipts explicitly carry application-render semantics and do not infer attention, attendance or mastery.

The composer shell is persistent but disabled. No message is submitted or displayed as Accepted; Delivery 5 owns admission. Teacher task participation awaits Delivery 6. Existing bounded technical and Leave controls retain their D14/D15 owners.

## Notebook persistence

`20261010082135_classroom_notebook_references.sql` adds nullable `source_ref` to the existing service-only D14 Notebook table. Old personal/Board readers remain compatible through `to_jsonb` access. No browser DML grant is added.

D14 validates chapter identity/version/anchor against the pinned owned chapter and message/portion references against released owned records. Current protected state is checked under the session lock. A transaction-scoped operation lock serializes duplicate saves; changed content or reference under the same operation conflicts. References are persisted atomically with existing Notebook rows. Chapter/message buttons provide a non-selection capture path; selection capture preserves the public source reference. Notebook links return to their exact version/anchor and report unavailable history truthfully.

D14's existing Teacher-turn/Board limits are shared by sequence acceptance and publication. They are retained owner rules, not invented classroom numeric policy. Unsafe or unpublishable prepared turns are rejected before becoming releasable. Correction-dependent sequences remain held until Delivery 6 implements correction authority.

## Validation scope and limits

The local full suite, web build and foundation verifier are rerun for relevant changes. Native PostgreSQL CI includes the additive Notebook migration and exercises the actual D14 service/repository, invalid and private references, retries and protected rejection. The Chromium workflow uses actual authenticated route/service/database behavior, synthetic owned academic fixtures and a fixture identity. It checks committed publication/render receipts, controls, source focus, Notebook retry, scroll/focus, disabled composer, axe WCAG, responsive/reflow, historical non-mutation and protected clearing. It does not call AI providers or qualify a deployment/account/proxy. Its Board adapter is a fixture text representation; the complete existing Board/visual/sheet/course-shell matrix needs further connected review.

Local Chromium installation failed because the supplied archive was truncated. Browser success must be supported by observed CI logs, not this document or screenshots alone. Screen-reader behavior, real mobile keyboard, complete asset cancellation/recovery, offline/lost-ack/reload/two-tab browser paths and all 44 blueprint scenarios remain qualification obligations. A disabled composer cannot qualify mobile message composition before Delivery 5.

## Compatibility and rollback

Candidate composition and production session admission remain inactive. No connected migration, deployment, service creation, policy adoption or legacy-binding retirement has occurred. Backend and frontend DTO support must be coordinated before admission. A mismatched/missing candidate API holds the view; it does not silently use an uncoordinated chatbot. Additive Notebook metadata preserves old readers. Code rollback retains existing Notebook text and references; destructive production schema rollback has not been exercised.

## Next action

Inspect the current commit's CI and browser diagnostics, resolve failures, preserve a precise Delivery 4 checkpoint, and complete the remaining connected Board/history/recovery/accessibility matrix. Production activation remains held by the earlier delivery qualification and owner-adopted runtime policy gates.
