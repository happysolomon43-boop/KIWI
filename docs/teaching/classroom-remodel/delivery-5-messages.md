# Delivery 5 — durable student messages and question handling

This is an implemented, inactive qualification candidate on `feat/classroom-remodel-delivery-5`, stacked on Delivery 4 through draft PR #333. It is not a production rollout. Delivery 1–4 external acceptance holds still apply. All 44 blueprint qualification scenarios remain NOT_QUALIFIED; fixture evidence is supporting evidence only.

## Admission and public experience

The existing authenticated Class router exposes `POST /classes/:id/classroom/messages` and `GET /classes/:id/classroom/questions`. The request uses `classroom-messages.v1`, the owned session, operation key, content, client intent, versioned source reference and optional requested-clarification parent. Browser-supplied authority, quota overrides and Teacher task-response lanes are rejected. The backend independently admits a lane under the owned current session, adopted size/rate/allowance policy and actual clarification request.

One existing authority transaction stores the immutable message, unique allowance charge when applicable, queue record, stable conversation event and durable acceptance/routing outbox events. The receipt returns after commit. Retrying the identical body and operation key returns the same identity without a second charge; changing the body conflicts. Concurrent independent connections serialize against existing Class/session authority. Closure or exhaustion does not erase previously committed acceptance.

The actual mounted composer shows Sending, Accepted, pending disposition, requested clarification, answered and unresolved-at-closure state with the server balance. Unsent drafts and uncertain sends retain the exact original body/key in session-scoped storage for the adopted retention period. An uncertain send becomes a deliberate acceptance check after reload. A known rejection preserves the draft without claiming admission. New discretionary messages stop at zero balance; a confirmed Teacher-requested clarification remains available without a charge. The existing D14 technical-issue control remains available independently of conversational allowance. Teacher task participation stays disabled until Delivery 6.

## Coordinator and Presenter

`handle_message` is added to the candidate canonical coordinator registration through the existing governance proposal. Its existing capability owner remains PedagogyEngine, with the TPF-21 candidate representing the approved working alias TPF-5/8. The actual D03/D05 boundary validates the candidate prompt output and stores its provisional proposal without invoking an active academic-owner write. Engine acceptance is separately audited. Routing includes the accepted receipt, bounded owned peer-concern context, current published Teacher turn and actual confirmation status. Database timestamps are explicitly serialized at the plain-JSON model boundary.

Each admitted instructional message receives one validated disposition. Unknown or unsupported effects, substantive-work verdicts and task/replan actions hold for the appropriate owner path; no new task or correctness verdict is invented. Private criteria and protected packages do not enter the public projection. Source-linked student text remains untrusted input data.

A durable obligation records a suitable reasoning boundary, chapter unit, closure or non-promissory follow-up proposal before its acknowledgement is published. The approved timing enum stays unchanged; later-unit handling uses the compatible scheduling artifact. FIFO acceptance age orders eligible obligations. Worker status, attempts, leases, recovery events and retry budgets remain separate from instructional states.

Ordinary handling waits for a confirmed suitable reasoning pause or the committed unit. A material correction report holds affected upcoming release for an owner decision; Delivery 6 must provide the correction/replan path. Support reports never enter the free tutoring route. Held or failed work stays saved and visible after retry exhaustion.

A trusted Directive reader supplies the complete approved teaching permissions, evidence intent and unfinished anchor; Presenter generation reuses the durable presentation engine. Compatible grouped questions freeze every original concern under one shared fenced reply lease. The trusted reader must explicitly cover all included IDs before generation. Missing coverage keeps the originals pending. Incompatible obligations stay separate. A single confirmed reply can link every covered original concern; this confirms communication only, never difficulty resolution or mastery.

Prepared lesson portions survive a question interruption. Reply portions are inserted into the same Teacher conversation and carry stable message/source links. Publication progress uses committed conversation sequence rather than preparation ordinal, preventing regressions when older prepared lesson portions resume after a reply. Render confirmation updates the queue only after all portions of that reply sequence are confirmed. Clarification admission opens only after the actual clarification request is confirmed. The remaining lesson resumes from its preserved source/reasoning anchor.

At the hard end, all unanswered accepted concerns become `unresolved at closure`; their IDs, text, disposition history and links remain durable. The public notice promises no appointment or automatic next-Class answer. Delivery 7 owns subsequent academic carry-forward.

## Recovery and compatibility

Routing and answer-generation leases schedule durable recovery before provider execution. Expired leases, stale authorities, wrong epochs, exhausted attempt budgets and incompatible group ownership reject or hold safely. Generation happens outside authority transactions. Model timing is never release authority.

A pre-command snapshot cannot revoke a newly committed browser lease: the client rejects reads below the command's committed delivery version, reconciles a fresh snapshot and preserves takeover fencing. The public question projection retains every accepted concern independently of conversation page limits. Notebook and support-control writes acquire the Class parent before its session, matching presentation/admission lock order. The question list has keyboard-focusable bounded internal scrolling and wraps long content so it does not consume the whole classroom surface or create mobile overflow.

The migration is additive and service-only: `20261010140000_classroom_message_queue.sql` adds messages, charge ledger, question queue and proposal history with constraints, RLS and browser-role revocations. It is included in the existing disposable CI database bootstrap. No connected Supabase migration or deployment has been performed.

Existing active prompt manifest 1.4 and registry 1.3 remain unchanged. All 22 old capability bindings and non-classroom callers remain; historical Help records retain provenance. Remodeled sessions reject the old Help route with `CLASSROOM_USE_PERSISTENT_COMPOSER` to prevent a parallel question queue. Legacy sessions retain their established behavior. CLASSROOM_V1 and its message runtime remain inactive by default and require explicit qualified composition, adopted policy, coordinator, Presenter and trusted Directive reader.

## Qualification and limits

Native PostgreSQL tests exercise atomic rollback, idempotency, exhausted quota, free linked clarification, bounded reports, correction hold, stale workers, separate connections, boundary/unit commitments, grouped coverage and missing-coverage hold, native D03/D05 execution, protected redaction, interleaved confirmed replies, legacy Help isolation and unresolved closure. They use synthetic student/academic/provider fixtures on disposable PostgreSQL, not production data.

The connected Chromium test uses the actual composer, router, repository, Board reader/renderer and render receipt. Its injected post-commit 503 models lost acceptance acknowledgement; reload retries exactly once against the saved operation. It checks exhaustion, draft preservation, actual Teacher-requested free clarification, mobile reflow, automated WCAG checks and unresolved closure. Synthetic identity/provider fixtures are explicitly distinguished from live-provider/deployed-account evidence. Manual screen reader and real mobile software-keyboard checks remain outstanding.

Production acceptance requires owner-adopted message/generation/privacy/reliability policy, prerequisites from Deliveries 1–4, actual-provider/reviewer/C4 evidence and connected deployment qualification. No numerical production policy is supplied by prompts or fixture values. Correction decisions, teacher task windows, interpretation, extensions and replanning belong Delivery 6. Carry-forward and TPF-20 reconciliation belong Delivery 7. Deployment, rollback of active sessions and obsolete-binding retirement belong Delivery 8.

Rollback currently means keeping the optional candidate disabled while retaining additive history. There is no claim of exercised production rollback or a safe downgrade of an already-active remodeled session into the legacy engine.
