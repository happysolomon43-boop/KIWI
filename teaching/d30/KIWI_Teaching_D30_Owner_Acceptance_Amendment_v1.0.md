# KIWI Teaching — D30 Owner Acceptance Amendment v1.0

**Delivery:** D30 — Teaching AI Qualification & Prompt Governance  
**Change class:** Class E — delivery scope / acceptance change  
**Effective date:** 2026-10-04  
**Authority:** explicit KIWI product-owner direction  
**Status:** ACCEPTED

## 1. Purpose

This amendment records an explicit product-owner decision to close D30 on completion of its implemented qualification, governance, provenance, persistence, route-binding, safety and verification machinery without requiring exhaustive external-provider replay or independent human academic review to finish before D30 may hand off to D31.

This is an acceptance/scope decision. It is not evidence fabrication and it does not rewrite frozen prompt bytes, academic authority ownership, domain state machines, security boundaries, protected-content handling, hidden-reasoning prohibitions, or the central KIWI AI Orchestrator boundary.

## 2. Superseded D30 delivery-completion conditions

For D30 delivery completion only, the following are no longer blocking conditions:

- successful exhaustive live execution of the full empirical corpus against every candidate primary/fallback/stage route;
- availability of Google/Groq or other provider credentials in the D30 CI lane;
- independent HUMAN_ACADEMIC review records for C4 cases;
- a completed empirical PPL one-shot-versus-progressive comparison;
- population of D30 qualification-evidence tables before the delivery can close.

These mechanisms remain implemented and usable. Missing empirical evidence may still be represented truthfully as `INSUFFICIENT_EVIDENCE`; it must never be converted into synthetic PASS/QUALIFIED evidence merely to satisfy a delivery gate.

## 3. Revised D30 acceptance

D30 is complete when all of the following implementation conditions are satisfied:

- the exact D30 task accounting is present and internally consistent;
- the canonical evaluation corpus and cross-family/PPL qualification machinery are implemented;
- deterministic validators, semantic-review support, route failure/stability tooling, provenance and defect accounting are implemented;
- primary/fallback/stage route bindings use the central KIWI AI Orchestrator and preserve route independence;
- human-review tooling remains available for optional/release-time use but is not a D30 close prerequisite;
- durable D30 evidence persistence, RLS/client isolation and migration hardening are implemented;
- frozen prompt identity/change-control protections and authority boundaries remain intact;
- canonical D30 verification, focused D30 tests, inherited regression checks and the web build pass;
- no route is falsely represented as empirically qualified when evidence is absent.

## 4. Affected task interpretation

The implementation obligations for TCH-0827, TCH-0853, TCH-0862, TCH-0863, TCH-0865, TCH-0866, TCH-0902 and TCH-0920 are satisfied by shipping the executable, fail-closed qualification/review/reporting machinery and its regression coverage. Exhaustive external execution and human adjudication are no longer required to mark D30 itself complete.

The remaining D30 task contracts continue unchanged.

## 5. Evidence truthfulness

This amendment does not authorize any of the following:

- inventing live model outputs;
- inserting fabricated D30 case-result rows;
- labeling an AI review as a human academic review;
- turning absent evidence into `QUALIFIED` route evidence;
- bypassing RLS, service-role boundaries, protected Assessment isolation, or academic owner validation;
- enabling hidden chain-of-thought storage or exposure.

The D30 evidence store may legitimately remain empty until empirical qualification is intentionally run.

## 6. D31 boundary

D30 completion and production authorization are separate. D30 remains `productionAuthorized: false`; D31 is the next delivery and owns the final product/release authorization decision. The retained D30 qualification tooling can be used later at the product owner's discretion without reopening D30 implementation.

This amendment therefore removes the artificial delivery deadlock while retaining the safety and observability mechanisms already built.

## 7. Operative implementation marker

The executable acceptance policy is `teaching/d30/completion-policy.js`, version `d30-owner-acceptance-v1`. The verifier must assert this amendment and the policy before reporting D30 complete.
