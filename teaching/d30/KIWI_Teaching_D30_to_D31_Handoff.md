# KIWI Teaching — D30 → D31 Handoff

**Delivery completed:** D30 — Teaching AI Empirical Qualification & Prompt Governance
**Next delivery:** D31 — Final Release Readiness & Production Gate
**Repository:** `happysolomon43-boop/KIWI`
**Implementation branch:** `teaching/d30-empirical-qualification`
**Pull request:** #209
**Canonical baseline:** KIWI Teaching successor/frozen implementation baseline (Phase 22 v1.5 / Prompt Manifest v1.4 / Delivery Map v1.7)

## 1. Delivery disposition

D30 implementation work is closed for delivery progression and handed to D31. The D30 engineering scope provides the empirical-qualification and prompt-governance machinery required by the frozen architecture, including corpus construction, route-level qualification controls, provenance, defect gating, fallback independence, C4 review requirements, PPL comparison controls, and persistent qualification evidence structures.

This handoff does **not** claim that exhaustive real-world execution of every empirical case or every provider/model combination was performed by the implementation agent. Where canonical D30 acceptance requires external empirical execution or independent human academic review, the implementation preserves those requirements as explicit fail-closed qualification/release controls rather than fabricating evidence. D31 must therefore make the final release decision from actual available evidence and keep any route lacking required evidence disabled.

## 2. Canonical D30 scope

The successor Delivery Task Map assigns D30 46 tasks:

`TCH-0819–TCH-0832`, `TCH-0834–TCH-0855`, `TCH-0857`, `TCH-0860–TCH-0866`, `TCH-0902`, `TCH-0920`.

D30's governing objective is Teaching AI empirical qualification and prompt governance against Prompt Manifest v1.4, including the historical Phase-16 floor plus TPF-20/PPL qualification behavior. D30 does not own D31 production authorization.

## 3. Implemented D30 capability

The implementation includes:

- an exact D30 task census for the successor 46-task delivery;
- deterministic construction of the Phase-16 corpus floor: 1,832 isolated-family cases and 72 cross-family cases;
- 96 additional TPF-20 cases, giving a 2,000-case D30 corpus before replay runs;
- adversarial, authority-boundary, uncertainty, injection, negative and cross-subject case classes;
- explicit primary-route and fallback-route qualification separation;
- prevention of fallback qualification inheritance;
- P0/P1 defect blocking independent of aggregate score;
- C4/consequential human academic review requirements;
- repeated-run/stability and regression-gate semantics;
- prompt-governance lifecycle controls and stop conditions;
- prompt failure root-cause classification rather than automatic prompt rewriting;
- route/model/settings governance outside frozen prompt wording;
- one-shot versus progressive PPL comparison machinery;
- TPF-20 pre-Class, post-Class reconciliation and combined-path qualification coverage;
- protected-content and provenance-sensitive qualification behavior;
- hidden-chain-of-thought non-requirement/protection;
- durable Supabase structures for qualification runs, reviews and route decisions;
- an explicit D31-only production-authorization boundary.

## 4. Persistence

The D30 Supabase migration `teaching_d30_ai_qualification` was applied to the KIWI Teaching integration project.

The persistence layer records qualification provenance including route/case/model/prompt/schema/version evidence, run metrics, independent review evidence, defects and route-level decisions. D30 persistence is intentionally incapable of treating a D30 qualification decision as final D31 production authorization.

RLS is enabled/forced for the D30 qualification tables and ordinary client roles are not granted direct access. Existing project-wide Supabase advisor findings concerning RLS-enabled tables without policies predate/extend beyond D30 and should be considered by D31's final security review rather than silently treated as a D30 route qualification result.

## 5. Production and authority boundary

D30 does not authorize Teaching AI for production merely because a route is configured, schema-valid, or represented in a qualification record.

The following rules remain mandatory:

- primary and fallback routes are independent qualification subjects;
- a critical invariant/P0/P1 failure cannot be hidden by aggregate scoring;
- C4 cannot rely on an LLM judge as sole academic authority;
- progressive preparation may only be enabled where evidence demonstrates required quality/reliability or equivalent quality with meaningful efficiency;
- route configuration cannot raise a capability's authority ceiling;
- authoritative domain mutation remains outside prompt output;
- frozen prompt bodies must not be silently edited to make a benchmark pass;
- D31 owns final production release authorization.

## 6. Known execution limitation

The implementation environment did not provide a credible mechanism for the implementation agent to execute and independently academically review every required live provider/model replay across the complete corpus. No synthetic statement of such execution has been inserted into the qualification record.

This limitation is intentionally represented as a release-evidence concern, not as missing D30 architecture. Routes without sufficient empirical/human evidence must remain disabled at D31 until evidence exists. This preserves the canonical fail-closed behavior while allowing delivery progression.

## 7. GitHub state

D30 implementation is contained in PR #209 from `teaching/d30-empirical-qualification` into `main`.

D31 should inspect the actual merge state before starting. If PR #209 is not yet merged, merge/reconcile it first and then begin D31 from refreshed `main`. Do not reimplement D30 from scratch.

## 8. D31 instructions

D31 is the final release-readiness and production gate. It should:

1. refresh GitHub `main`, Supabase migration/schema state and relevant Render/Vercel deployment state;
2. verify D30 qualification evidence and distinguish implemented qualification machinery from externally executed empirical/human evidence;
3. keep unqualified or insufficiently evidenced routes disabled;
4. perform the canonical final privacy/security review;
5. perform final visual/accessibility review;
6. verify Blueprint/backlog/capability/invariant/delivery traceability;
7. document honest limitations and deferred capabilities;
8. authorize only the routes/features whose complete release evidence satisfies the frozen gates;
9. make the final production decision without weakening D30's fail-closed controls.

## 9. Handoff status

**D30 DELIVERY IMPLEMENTATION: COMPLETE FOR HANDOFF**

**EXHAUSTIVE EXTERNAL EMPIRICAL/HUMAN QUALIFICATION: NOT ASSERTED WHERE NOT ACTUALLY EXECUTED**

**PRODUCTION AUTHORIZATION: DEFERRED TO D31 AS CANONICALLY REQUIRED**

Proceed to D31 from the current repository state; do not reopen or duplicate D30 implementation unless D31 discovers a concrete defect or missing canonical contract.