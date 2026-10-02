# KIWI Teaching D18 — Assessment Shell, Response Renderers & Attempt UX

## Delivery boundary

D18 implements exactly the shared Assessment Shell and first-release Response Layer over the accepted D17 Assessment domain. D17 remains authoritative for locked Package scope, Attempt lifecycle, append-only accepted ResponseRecords, server time/expiry, one-authoritative-device state, challenge/invalidation facts and finalization. D18 adds no new academic database owner, no migration, no prompt edit and no model/provider route.

Canonical permanent scope is `TCH-0357`–`TCH-0375` from Delivery Task Map v1.7 / Master Backlog v9.7. The accepted D17→D18 handoff also supplies stricter resilience/acceptance requirements. Where its task-by-task prose used different labels for some permanent IDs, D18 preserves the permanent backlog meanings and treats the handoff prose as additional implementation guidance rather than renaming IDs.

## Architecture

The browser receives only a D18-safe projection of a D17 locked Package and, after start, the current D17 Attempt plus latest accepted response version per Package item. Protected marking payloads, candidate IDs, answer keys, rubrics, validator traces, device session hashes and response idempotency keys are not serialized into the D18 projection.

The shared renderer contract lives in `public/assessment-shell-core.js`. It is non-authoritative UI/transport logic: it maps the locked response family/public Response Contract into a renderer descriptor, canonical renderer JSON payload, restore behavior and completion posture. It cannot change marks, Package architecture or correctness.

D18 read projections are implemented in `teaching/d18/service.js` and `teaching/d18/routes.js`, mounted beside D17 routes so they share the D17 readiness/privilege boundary. All mutations continue through existing D17 endpoints.

## Canonical task accounting

- `TCH-0357` — the existing choice concept becomes a renderer registry / universal Response Layer.
- `TCH-0358` — MCQ single/multi selection using D17 deterministic stable option IDs; no correctness inference.
- `TCH-0359` — short constructed response preserving text exactly.
- `TCH-0360` — extended response with large editor, autosave and recovery.
- `TCH-0361` — multi-part question renderer with per-part state and unified question context.
- `TCH-0362` — mathematical working plus separate final-answer field; no fake OCR/handwriting capability.
- `TCH-0363` — numeric + unit structured renderer.
- `TCH-0364` — essay renderer with focused long-form editor and package-controlled writing assistance.
- `TCH-0365` — source-based responsive layout with source/stimulus kept visible while responding.
- `TCH-0366` — code renderer preserving code text; it does not invent an execution runtime.
- `TCH-0367` — explicit future visual-response extension point without pretending unsupported capability exists.
- `TCH-0368` — Unseen, Viewed, Answered, Partially Answered and Flagged navigation states; no correctness state.
- `TCH-0369` — free navigation by default, with sequential locking only when the locked Package explicitly requires it.
- `TCH-0370` — allowed-tools/resources area projected from locked resource policy.
- `TCH-0371` — save-state indicator distinguishes dirty/saving/server-saved/offline/conflict and only says Saved after D17 acknowledgement.
- `TCH-0372` — terminal Attempt uses the same shell in read-only Review Mode, preserving the submitted response view without pulling D20 marks/feedback forward.
- `TCH-0373` — QA covers `mcq_only`, `constructed_only`, and `mixed` architecture compatibility and immutable renderer/package rules.
- `TCH-0374` — QA/UI behavior for ambiguous/faulty items uses existing challenge and authoritative invalid/retired item state; D18 never reveals answers or self-invalidates.
- `TCH-0375` — QA covers network loss/autosave uncertainty, reconnect replay, server timer expiry posture, second-device conflict/explicit transfer, and package/protected-field failure modes.

## Autosave and recovery

Every supported renderer canonicalizes to typed JSON and posts to the existing D17 append-only response endpoint with Package item ID, device ID and idempotency key. The browser may persist a recovery draft and queued request metadata locally, but local state is never called Saved and never becomes final academic truth.

On reconnect the shell re-fetches authoritative Attempt/device state and latest accepted response versions before replay. A queued payload whose base version no longer matches current server state is held as a conflict instead of being forced through. D17 remains the mutation owner and rejects stale/non-authoritative devices.

## Timing and finalization

The UI countdown uses `serverNow` from the D18 projection to calculate a browser offset and display time remaining against D17 `expires_at`. The countdown is projection only. At projected zero the UI becomes read-only and waits for D17's durable expiry/finalization path; it does not call a client-side expiry mutation.

Final manual submission requires the existing D17 explicit `confirm:true` action and idempotency key. Before submit, the shell summarizes answered, partial, unanswered, flagged and save-uncertainty postures without showing inferred correctness. Manual submit and expiry still converge on D17's one authoritative finalization transition.

## Device authority

The D18 Attempt projection returns only `MATCH`, `MISMATCH` or `UNDECLARED` device posture; it does not expose the authoritative device ID or device-session hash. A mismatch opens a controlled transfer surface. Explicit transfer uses the existing D17 device-transfer endpoint. Stale writers continue to fail server-side.

## Shared KIWI Exam integration

`teaching/integrations/kiwi-exam-interface.js` advances to interface `1.2` / Assessment Shell contract `d18.v1`. Legacy KIWI Exam ownership/data are preserved. The Teaching handoff targets `/assessment-shell.html` with Assessment/Package/Attempt references rather than creating a second academic owner.

## Persistence and security

D18 introduces no tables, columns, grants or migrations. Production and Integration D17 RLS/grant posture remains unchanged. D18's browser-safe guard rejects protected keys recursively and its server projection selects only public Package fields plus latest accepted renderer payloads.

## Later-delivery boundary

D18 does not implement D19 assessment-type measurement semantics, D20 marking/moderation/Gradebook, D27 Study/FSRS integration, D30 route qualification or D31 release behavior. Review Mode in D18 shows submitted responses only; marks, rubric feedback, released answers and appeals remain later authoritative work.
