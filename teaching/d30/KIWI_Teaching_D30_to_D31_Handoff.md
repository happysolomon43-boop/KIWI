# KIWI Teaching — D30 → D31 Implementation Handoff

**Completed delivery:** D30 — Teaching AI Empirical Qualification & Prompt Governance  
**Next delivery:** D31 — Final Release Readiness & Production Gate  
**Repository:** `happysolomon43-boop/KIWI`  
**Branch:** `teaching/d30-empirical-qualification`  
**PR:** #209

## Delivery result

D30 implementation is complete for progression. All 46 assigned task IDs are explicitly represented: `TCH-0819–0832`, `TCH-0834–0855`, `TCH-0857`, `TCH-0860–0866`, `TCH-0902`, `TCH-0920`.

The implementation preserves the frozen prompt/authority architecture and adds the executable qualification framework rather than reducing D30 to documentation. Exhaustive provider replay and independent human academic review are not falsely asserted; the system records and gates those evidence classes where required.

## Implemented qualification system

D30 now contains a versioned 2,000-case qualification corpus: 1,832 isolated-family cases, 72 cross-family cases and 96 TPF-20 cases. Coverage includes golden/negative/counterfactual/adversarial patterns, uncertainty, scope expansion, authority attacks, protected-content/injection behavior, cross-subject behavior, cross-family workflows, TPF-20 pre-Class preparation, post-Class reconciliation and end-to-end behavior.

`teaching/d30/qualification-system.js` adds the executable harness around the central KIWI AI Orchestrator, deterministic validation, run-record construction, route failure simulation, stability analysis, route qualification reporting, prompt-governance validation, cross-family compatibility verification and PPL one-shot/progressive qualification comparison.

The canonical cross-family chains are explicitly represented: TPF-04→05→06→07→08→09; TPF-12→13→14→authoritative package lock; TPF-15→deterministic aggregation→TPF-16→Gradebook owner; TPF-11→assessment-integrity handoff; and TPF-18→TPF-08.

## AI route decision requested by product owner

D30 records the product-owner route posture without bypassing the central AI Orchestrator:

- ordinary Teaching AI responsibilities use the website's default AI route;
- Course Plan uses the same route class as flash generation;
- route qualification remains independent and cannot raise academic authority;
- fallbacks do not inherit qualification from the primary route.

The verification script asserts this route policy so later changes cannot silently drift it.

## Prompt governance

The implementation preserves the frozen Phase-15 prompt baseline and Phase-14 revision process. Explicit lifecycle states are retained from `NOT_STARTED` through `FROZEN_VERSION`/`DEPRECATED`; Behavior Brief approval is enforced before candidate prompt authoring; failure-root-cause categories are explicit; silent mutation of frozen prompts is rejected; shared Constitution/runtime rules are not duplicated merely to improve benchmark performance.

## Qualification and failure controls

The D30 framework supports deterministic/schema/domain checks, semantic-review attachment, adversarial/metamorphic cases, primary/fallback separation, provider/quota/auth failure simulation, retry/circuit-break/credential-rotation posture, generation-affinity checks, repeated stochastic stability, immutable regression intent, P0/P1 fail-closed qualification, consequential/C4 human-review evidence, latency/token/cost/retry/timeout provenance and route-by-route reporting.

PPL qualification compares matched one-shot and progressive preparation and indicates when Preparation Profiles should be reduced because extra passes do not establish sufficient value.

## Persistence

Migration `teaching_d30_ai_qualification` has been applied to the KIWI Teaching integration Supabase project. Durable records exist for qualification runs, independent reviews and route decisions, including exact case/route/model/settings/prompt/schema/suite identity, validation, defects, latency, tokens, estimated cost, retries, timeout/fallback posture and D31 authorization boundary.

RLS is enabled/forced and ordinary client roles do not receive direct table access. `production_authorized` is structurally constrained to false at D30; D31 owns final production authorization.

## Verification

`npm run verify:teaching:d30` verifies the exact 46-task census, corpus floors, route policy, fail-closed authority validation, Behavior Brief governance gate, provider failure controls and all required cross-family compatibility chains.

The D30 implementation deliberately does not manufacture claims that every live provider/model replay or independent human C4 review was performed by this implementation session. Those are evidence inputs to the final route/release decision, not permission to omit the engineering machinery.

## Known limitations / deferred evidence

Full live replay of every corpus item across every permitted provider/fallback/stage route and independent human academic adjudication of all consequential C4 cases were not exhaustively executed in this implementation session. The framework supports and records them. D31 must not authorize any route for which its required evidence remains insufficient.

Existing project-wide Supabase advisor findings concerning RLS-enabled tables without policies are not silently attributed to or repaired by D30; D31's final privacy/security gate must review the current complete database posture.

## Architecture exceptions

None. The requested route policy is implemented as route selection inside the existing central KIWI AI Orchestrator boundary; it does not create a second provider path or modify authority ownership.

## D31 prerequisites now satisfied

D31 can consume a concrete D30 corpus, executable qualification harness, route policy, prompt-governance controls, qualification persistence, stability/failure/PPL reporting and explicit release-evidence boundary. D31 remains responsible for final privacy/security, visual/accessibility, complete traceability, limitations review and production authorization.

## Handoff status

**D30 IMPLEMENTATION: COMPLETE FOR HANDOFF**  
**EXHAUSTIVE EXTERNAL/HUMAN EVIDENCE: NOT FABRICATED**  
**FINAL PRODUCTION AUTHORIZATION: D31 ONLY**

Start D31 from the actual merged repository state. Do not reimplement D30 unless a concrete regression or canonical omission is discovered.