# KIWI AI Orchestrator Resilience — Delivery B Handoff

**Date:** 2026-09-26  
**Delivery:** B — Feature Integration & Production Hardening  
**Change class:** Class A implementation correction  
**Accepted base:** `main@b9feaa9aa147cf9b812ff31dbbbd50e6f50ffde4`  
**Runtime merge:** `45abdd6516e12d54d6a48a869e4e484162de56a2`

## 1. Scope

Delivery B integrates the accepted Delivery A runtime with Reckoning V2, Daily Ritual persistence/delivery, and background AI workload policy.

It does not change Teaching academic authority, prompt-family content, curriculum rules, assessment constructs, or learner-facing Teaching contracts.

## 2. B1 — Reckoning runtime integration

Reckoning preparation now consumes Delivery A backpressure rather than using a fixed family fan-out.

Key invariants:

- family concurrency remains capped at four;
- provider congestion, critical queue pressure, route pacing and route occupancy can reduce new-family concurrency;
- the route-pressure denominator is the full set of currently eligible `RECKONING_CBT` routes, not merely routes already touched in-process;
- only models/project routes actually eligible for `RECKONING_CBT` influence this signal;
- unrelated Lite/background activity cannot unnecessarily serialize Flash-quality Reckoning;
- `RECKONING_CBT` remains VVIP with a Flash quality floor.

## 3. B2 — Durable Reckoning preparation ownership and recovery

Migration `20260926_ai_resilience_delivery_b_reckoning_claims.sql` adds:

- `preparation_claim_id`;
- `preparation_claim_expires_at`;
- `preparation_heartbeat_at`;
- a partial index for pending V2 preparations.

Production migration version:

`20260926070700 ai_resilience_delivery_b_reckoning_claims`

Preparation ownership is now an explicit lease rather than an `updated_at` inference.

A worker may persist a prepared item or activate the execution exam only while it owns the current non-expired claim. Prepared-item writes are fenced in SQL against the live claim. If a stale worker resumes after a takeover, it cannot persist another question, reset the new worker's state, or activate a second exam.

Existing durable preparation behavior remains authoritative:

- validated READY questions are persisted immediately;
- compatible preparation manifests are reused;
- retry resumes missing work rather than regenerating validated questions;
- activation occurs transactionally;
- temporary preparation artifacts are removed only after durable exam/question activation succeeds.

## 4. B3 — Daily Ritual cache contract repair

`daily_ritual_cache` now has one canonical adapter contract:

`id, user_id, type, date, data JSONB, updated_at`

Feature-specific ritual fields are never expanded into physical SQL columns.

The adapter explicitly serializes the full feature payload into `data JSONB`, allowing strings, arrays and objects without relying on PostgreSQL's implicit JSON conversion.

Consumers/producers were aligned to the same contract for Morning Brief, Weekly Anchor, Return Greeting and related Ritual data. Unrelated Knowledge Score cache semantics remain unchanged.

## 5. B4 — Morning Brief and Weekly Anchor delivery

The dashboard remains independent of Gemini latency.

Behavior:

1. render dashboard/cache immediately;
2. preserve an already-hydrated Morning Brief/Weekly Anchor during dashboard revalidation;
3. if missing, issue a non-blocking ritual request;
4. single-flight that request in the frontend;
5. update only the dashboard state/component after success;
6. apply a retry cooldown after failure;
7. never block dashboard usability on the ritual request.

The Morning Brief frontend adapter unwraps the backend `{ brief }` envelope to text. Weekly Anchor unwraps `anchor_text`.

The dashboard backend no longer simultaneously starts Morning Brief generation on a cache miss. This prevents the dashboard request and frontend lazy request from racing and spending duplicate provider calls.

Daily Invitations were preserved because their learner-visible flow was already working.

## 6. B5 — Background AI workload rationalization

Only the two confirmed scheduled generation jobs were changed to Lite-first background execution:

- `MORNING_BRIEF`;
- `STUDY_TASK_GENERATION`.

Both use the stable Flash-Lite policy and retain their declared Flash-Lite quality floor.

Assessment-quality tasks remain unchanged: Main CBT, Reckoning CBT and CBT Completion remain VVIP / Flash.

The nightly 03:00 synthesis pass now skips:

- guest accounts;
- accounts without a recorded login;
- accounts whose last login is more than 14 days old.

Morning Brief pre-generation is therefore only an optional latency optimization for demonstrably recent learners. On-demand frontend hydration remains the authoritative miss path.

## 7. B6 — Cross-feature verification

Delivery B added/extended tests covering:

- migration additivity and absence of destructive DDL;
- atomic prepared-item claim fencing;
- stale-worker rejection before persistence or activation;
- durable prepared-question reuse/resume;
- route-aware family concurrency;
- Reckoning-only route-pressure scoping;
- Daily Ritual JSONB persistence contract;
- Ritual producer/consumer normalization;
- non-blocking, single-flight dashboard hydration;
- no duplicate dashboard Morning Brief generation;
- Lite-first background policy with assessment-quality preservation;
- inactive/guest background-generation exclusion;
- legacy VIP routing regression expectations updated only for the two explicitly approved background exceptions.

Existing Reckoning Delivery D/E suites continue to verify resumable preparation, partial provider failure recovery, activation atomicity, and frontend execution contracts.

## 8. B7 — Full regression and production rollout

Pre-merge and merge-commit GitHub gates:

- `ai-tests`: **PASS**
- Teaching D01 verifier: **PASS**
- Teaching D02 verifier: **PASS**
- Teaching D04 verifier/full regression path: **PASS**
- Vercel PR preview integration: **PASS**

Production:

- Supabase migration: **APPLIED and schema-verified**
- Render deploy: `dep-darmujvf3r2c73a7on6g`
- Render commit: `45abdd6516e12d54d6a48a869e4e484162de56a2`
- Render status: **LIVE**
- Render startup: schema migration, AI orchestrator hydration, Teaching runtime, WebSocket and server bind all completed successfully
- Render self-health: **HTTP 200** at 2026-09-26T07:10:09Z
- Vercel production deploy: `dpl_Ko17Y2eMBLMCQzdrMLLHhFnvximQ`
- Vercel commit: `45abdd6516e12d54d6a48a869e4e484162de56a2`
- Vercel status: **READY**

Post-cutover log scan found no new error/critical application logs and none of the previously observed Ritual persistence signatures:

- missing `greeting` column;
- invalid JSON input for `daily_ritual_cache`;
- Morning Brief cache-write failure.

## 9. Production-traffic limitation

At the production verification point there had been zero natural AI provider attempts after the Delivery B backend became live, zero newly written Ritual cache rows after cutover, and no active V2 preparation claim.

No learner Reckoning or AI request was manufactured solely to create telemetry.

Therefore Delivery B's live gate proves:

- compatible production schema;
- clean backend boot;
- exact frontend/backend deploy commits;
- healthy self-health endpoint;
- absence of immediate runtime errors;
- passing full regression/fault contract suites.

The first natural post-deploy Reckoning/ritual provider request remains the first opportunity to observe the new production paths with real traffic.

## 10. Supabase advisor note

The project contains pre-existing Supabase security/performance advisor findings outside this delivery, including server-only RLS-without-browser-policy notices, public tables with RLS disabled, duplicate indexes and unindexed foreign keys.

Delivery B adds no new public table, view, function, browser grant, or privileged database role. Its schema change is limited to nullable operational columns and one partial index on the already-existing `reckoning_sessions` table.

## 11. Dependency audit note

Render's existing `npm install` output continues to report:

- 4 moderate vulnerabilities;
- 1 critical vulnerability.

This is pre-existing supply-chain work and was not modified as part of Delivery B.

## 12. Rollback

If application rollback is required:

1. revert the Delivery B runtime merge;
2. redeploy the prior Delivery A application commit;
3. leave the additive Delivery B claim columns/index in place.

Pre-Delivery-B application code ignores the new nullable claim columns and partial index, so emergency destructive database rollback is not required.

## 13. Closure

Delivery B completes the planned two-delivery AI resilience intervention.

Delivery A made the shared AI runtime resilient to quota, throttling, overload and retry amplification.

Delivery B made Reckoning, Ritual delivery and scheduled background generation obey that runtime safely.

No further Delivery C is implied by this intervention. Future AI/Teaching work should consume these runtime contracts rather than reintroducing feature-owned provider retry or uncoordinated background generation.
