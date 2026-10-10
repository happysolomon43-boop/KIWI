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

- Unit suite: 1,729 passing before the final publication run.
- Isolated embedded PostgreSQL engine: all 43 migrations applied, four closure/continuity database tests passing, no skips. This is local SQL evidence, not native multi-client concurrency or live provider qualification.
- Web build and foundation verification pass after regenerating the source inventory.
- Native PostgreSQL and connected browser CI must be inspected at the published head. No current-head pass is claimed before those checks run.

## Remaining work and gates

Delivery 7 still needs the before-end `close_class`/Presenter workflow, consumption of reviewed planning proposals in D16/D17, complete history availability/summaries UI, cross-Class owner workflow and connected-browser acceptance. The current candidate capability mapping does not yet authorize a `close_class` invocation; this adapter does not bypass that boundary. Those contracts must preserve D13/D16/D17–20/D27 authority and keep TPF-20 notes private until authorized publication.

The inherited Delivery 1–6 acceptance gates remain open: adopted numerical configuration, live provider and independent reviewer qualification, and the validated source-correction chapter/guide/plan/remap bundle. The 44-scenario qualification ledger remains NOT_QUALIFIED. Fixtures and local database results do not replace those gates.

Delivery 8 requires accepted Deliveries 1–7, coordinated migrations, compatible frontend/backend cutover, production observation and tested rollback. No shared Supabase or production migration, production activation, prompt retirement or deployment is performed by this change. Rollback must preserve admitted work and history/reconciliation readers.
