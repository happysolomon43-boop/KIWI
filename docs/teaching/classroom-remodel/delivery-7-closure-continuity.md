# Delivery 7: closure and continuity core

Status: inactive implementation in progress. This is not Delivery 7 acceptance or production qualification.

D11 now fences delivery, closes unanswered queue entries, closes open response windows and invalidates prepared teaching in the same transaction as its immutable closure fact. Accepted responses and evaluation jobs remain available under their original context. Failure rolls back the entire closure; retry returns the existing fact. Legacy sessions retain their existing closure path.

The closure record separates published portions, confirmed application rendering, accepted responses, completed evaluations, pending work and D11/D12 evidence classifications. Confirmed taught Learning Unit references come from confirmed portions and the pinned chapter's objective map. Render confirmation does not establish understanding or mastery.

Late accepted evaluations record their actual completion time and whether the controller was closed. Breaks and protected activities are not closure. A durable reconciliation event prepares a new immutable record and routes versioned summaries and private TPF-20 reconciliation through existing owners. Results bind the record hash; summary, teacher-note and study-note commits reject stale snapshots under the same authority locks. Original closure facts, accepted work and historical evidence remain unchanged. No late live feedback is published.

Owned history APIs retrieve up to three earlier closed Classes and bounded exact public conversation pages. The retrieval horizon is not retention or deletion policy. Earlier scheduled Classes without available records do not become fabricated first-Class history. Assessment/Classwork restrictions, including interrupted protected work, prohibit these history readers. Cross-Class question links require the same student and course, a prior closed session and an unresolved source question. Resolution requires independently reviewed coverage, current authority and a render-confirmed reply in the target Class; it does not reopen the old Class or establish difficulty resolution.

## Planning adapters and actual-teaching inputs

An optional `planning` adapter on the inactive presentation runtime routes six explicit modes through existing central orchestration and qualification-only prompt bindings: `prepare_continuity`, `guide_assessment`, `lesson_closure_analysis`, `homework_design_generate`, `homework_to_next_lesson_synthesis` and `rolling_planning_horizon`. It requires adopted configuration and an independent owner reviewer. Generation has a bounded output budget, retry budget and timeout. A timeout records unknown outcome and cannot become an accepted proposal.

Homework content generation requires the explicit homework mode, permitted resources and an owner-validated workload receipt. Other author modes cannot generate homework tasks. No-homework is a valid reviewed proposal. Rolling allocation requires already scheduled Classes. Accepted outputs remain provisional handoffs; they do not create assignments/deadlines, schedule follow-ups, expand eligibility or write marks. D16/D17 consumption of these handoffs still needs its own durable owner commit and current-state validation.

Requests carry owned actual records, up to three relevant prior records, versioned source references and conservative exposure/assistance context. Protected future-package context is rejected. Record, requirements and numerical-policy contents participate in the input fingerprint. The reviewer must bind both input and output hashes and the producing execution; fresh reads reject late record changes after review.

Closure records now retain the already public teacher explanation and project assistance stages and accepted-response exposure without private task criteria. Prepared assistance remains distinct from released/accessible assistance. History selects the latest immutable reconciliation version, links both the original closure and the later record, and retains the reconciliation timestamp. A later Class therefore sees completed late evaluations without rewriting what was pending at the original closure.

## Validation

- Unit suite: 1,732 passing before the final publication run.
- Isolated embedded PostgreSQL engine: all 43 migrations applied, four closure/continuity database tests passing, no skips. This is local SQL evidence, not native multi-client concurrency or live provider qualification.
- Web build and foundation verification pass after regenerating the source inventory.
- Native PostgreSQL and connected browser CI must be inspected at the published head. No current-head pass is claimed before those checks run.

## Remaining work and gates

Delivery 7 still needs the before-end `close_class`/Presenter workflow, consumption of reviewed planning proposals in D16/D17, source-linked summaries, older-summary conflict handling and notes publication-state UI, cross-Class owner workflow and connected-browser acceptance. The current candidate capability mapping does not yet authorize a `close_class` invocation; this adapter does not bypass that boundary. Those contracts must preserve D13/D16/D17–20/D27 authority and keep TPF-20 notes private until authorized publication.

The inherited Delivery 1–6 acceptance gates remain open: adopted numerical configuration, live provider and independent reviewer qualification, and the validated source-correction chapter/guide/plan/remap bundle. The 44-scenario qualification ledger remains NOT_QUALIFIED. Fixtures and local database results do not replace those gates.

Delivery 8 requires accepted Deliveries 1–7, coordinated migrations, compatible frontend/backend cutover, production observation and tested rollback. No shared Supabase or production migration, production activation, prompt retirement or deployment is performed by this change. Rollback must preserve admitted work and history/reconciliation readers.

## Recent-history classroom view

The classroom now exposes a read-only Recent Class records panel using owned history routes. It distinguishes first Class, short history and unavailable records; shows confirmed rendering separately from understanding, pending evaluation and unresolved/carry-forward questions; and links the original closure and latest reconciled record. Exact released conversations load in bounded pages in a separate feed with original source references, without navigating those old sources into the current Chapter. No historical read emits rendering receipts or changes progress, tasks or deadlines. Protected takeover, replacement sessions and view closure discard stale replies and clear the panel. Older records remain accessible through the course Past Classes view. Formal summaries and notes publication state remain separate unfinished UI work.

## Delivery 7 continuation — reviewed handoffs and readable historical artifact state

The same inactive branch was extended beyond the original closure core. The most recent code commit at this checkpoint is `b397151e88119037625cb75627c750a817fea1d8`. This is **not** a claim of accepted Delivery 7 or a production release.

Historical Class reads now join versioned D11 Class Summary metadata and D14 post-Class Study Notes metadata to the owned three-Class result. The student projection contains only artifact state, version, current source references and an explicit `published:false` for private notes. It does **not** serialize teacher notes, protected TPF-20 content or unapproved translation payloads. A summary whose stored reconciliation hash differs from the latest record is held as `STALE_RECONCILIATION`, rather than shown as a current verified summary. The Recent Class panel displays these distinctions and the original closure/reconciliation references.

The existing continuity repository already supports immutable cross-Class question links and confirmation-based resolution. The new internal `linkReviewedContinuity` workflow admits a link only after the independent planning reviewer selected an exact unresolved source message in a closed Class. It binds the reviewed input/receipt to the current prior-history snapshot. Every source message retains its identity. A link is **not** a scheduled appointment, answered communication or proven resolution. Connected browser and owner review acceptance remain required.

The candidate Delivery 7 planner now has an optional `consumeReviewedPlanning` handoff to the actual composed D16 Homework and D17 Assessment services. The handoff checks independent reviews bound to exact input/output hashes and latest closure records. D16 no-homework remains valid. Creation requires D16-approved effort/workload, actual confirmed taught Learning Units, an owner-supplied assignment/deadline spec and explicit immutable record/source/approval references. The D16 assignment repository now performs a final owner/course/closure/current-record-and-coverage check under a locked database transaction. The underlying D17 Blueprint route remains the only authority for assessment preparation. Existing D16/D17 controls remain untouched for ordinary legacy calls. Neither adapter bypasses D13, D17 eligibility/package locking, D20 marks or D27 study publication. The trusted independent `ownerApprovalReader` is intentionally absent from default runtime options, so these writes remain held until owner adoption and acceptance.

Validation added independent unit tests for read-only artifact projection, stale summary selection, reviewed cross-Class question selection and strict D16/D17 handoffs; native database tests cover D16 source locking and protected summary/notes handling. The prior implementation head `757cadc...` passed 32 GitHub workflows; **the new head must pass its own published-head CI before claiming completion**. No local live provider, production, cross-Class browser scenario or full 44-scenario evidence is claimed.

### Explicit open work

The pre-end coordinator `close_class` capability is not yet present in the 22 governed legacy-migration bindings; none of the existing unrelated capability IDs may be reused to counterfeit that authority. The compatible TPF-08 final closing Directive, scheduled pre-end handoff and confirmed public transition remain to be implemented after an expressly scoped candidate/adoption decision. The D11 hard-end transactional closure remains authoritative and operationally safe meanwhile.

The candidate D16/D17 owner readers need actual approved configuration, domain acceptance and live fixture/provider qualification. D17 must retain eligibility/source-freshness authority at its commit. Formal student summary content and D27-authenticated study publication remain separate from the metadata-only history display. Cross-Class linked replies must be demonstrated through the connected UI without turning historical reads into live writes. The inherited numerical-policy, independent provider-review and chapter/source correction bundle gates are not satisfied. The 44 qualification scenarios remain `NOT_QUALIFIED`.

Delivery 8 owns final connected route qualification, coordinated migrations, rollout, production observation and rollback. New paths stay inactive; neither Render/Vercel production nor either shared Supabase schema was changed during this continuation.
