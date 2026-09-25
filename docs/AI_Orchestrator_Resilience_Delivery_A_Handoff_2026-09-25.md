# KIWI AI Orchestrator Resilience — Delivery A Handoff

**Date:** 2026-09-25  
**Delivery:** A — AI Orchestrator Resilience  
**Change class:** Class A implementation correction  
**Base:** `main@1a6e893c69d5659e494a0750ee90cce4cd6dee9b`  
**Branch:** `fix/ai-orchestrator-resilience-delivery-a`

## 1. Scope

Delivery A corrects systemic AI-runtime failure handling without changing KIWI Teaching academic authority, prompt-family text, curriculum contracts, assessment constructs, or learner-facing Teaching design.

Delivery B has **not** begun. In particular, this delivery does not implement the Daily Ritual cache repair, Morning Brief frontend delivery, broad Reckoning lifecycle redesign, or background-work rationalization beyond explicit runtime execution-lane metadata.

## 2. Production problem addressed

Production telemetry showed that temporary provider failures could be amplified by KIWI itself:

- Reckoning logical requests could fan out into many provider attempts.
- short-window 429s could rotate rapidly across independent projects;
- 503 provider overloads could trigger repeated probing;
- feature-level Reckoning retries could repeat a provider-availability retry wave;
- `CAPACITY_EXHAUSTED` could occur without a Gemini request when KIWI believed no route remained.

Delivery A changes the recovery model from “search aggressively until something works” to bounded, evidence-based, coordinated recovery.

## 3. A1 — Runtime truth and diagnostics

Provider failure telemetry now records sanitized operational evidence only:

- provider HTTP/error status;
- quota dimension;
- quota metric and quota limit identity;
- observed quota value;
- provider retry delay;
- KIWI classification source;
- route state before/after;
- logical operation ID and operation attempt number.

No API key, prompt text, student content, or generated answer is added to these diagnostic fields.

## 4. A2 — Authoritative quota classification

Quota handling now separates:

- `RATE_LIMIT_RPD` — confirmed daily route exhaustion;
- `RATE_LIMIT_RPM` — temporary request-rate throttle;
- `RATE_LIMIT_TPM` — temporary token-rate throttle;
- `RATE_LIMIT_UNKNOWN` — temporary unclassified 429;
- `PROVIDER_OVERLOADED` / `TRANSIENT` — provider/model availability.

Structured provider evidence is preferred. An unknown 429 cannot create day-long RPD exhaustion. An observed numeric quota value is stored together with its observed dimension.

## 5. A3 — Single provider retry authority

The central AI orchestrator owns provider-availability recovery.

Reckoning's per-item generation retry remains available for content/validation failures after a successful provider response, but 429/503/network/availability errors bypass that feature-level retry loop. This removes the previous nested provider-retry multiplication path.

## 6. A4 — Project × model route scheduling

A new route scheduler coordinates the individual `project_slot × model_id` routes.

Key invariants:

- default maximum one in-flight call per exact route;
- leases are persisted in `ai_route_runtime` so duplicate use is coordinated beyond process-local state;
- route contention is reported as retryable `ORCHESTRATOR_BUSY`, not `CAPACITY_EXHAUSTED`;
- daily quota exhaustion remains isolated to the exact project/model route;
- unrelated models/projects remain eligible.

## 7. A5 — Pacing and provider circuits

Short-window RPM/TPM/unknown 429s are paced and bounded instead of sweeping the full project pool.

Current VVIP per-model short-window probe ceiling: **3**.

Provider/model overload retains independent-slot corroboration. After the first corroboration-worthy 503/transient failure, exactly one request may own the confirmation probe. Followers stop probing that model while confirmation is in flight. Two independent overload signals open the existing model circuit; recovery still uses the existing half-open single probe.

Already-in-flight requests are not cancelled.

## 8. A6 — Operation budgets and traffic priority

Large workflows can share one operation budget through their generation-group identity.

Default VVIP operation limits:

- provider attempts: **96**
- availability failures: **24**
- short-window rate failures: **12**
- provider-overload/transient failures: **12**

The 96-attempt ceiling intentionally preserves the complete Reckoning content-quality envelope: up to 30 generated questions × up to 3 successful-provider content-validation attempts = 90. Availability-storm counters remain much tighter and stop pathological recovery long before the total-attempt ceiling.

Execution priority is now separate from quality class:

- VVIP assessment work defaults to `CRITICAL`;
- ordinary non-VVIP work defaults to `INTERACTIVE`;
- only the confirmed scheduled jobs `MORNING_BRIEF` and `STUDY_TASK_GENERATION` are marked `BACKGROUND` in Delivery A.

Background concurrency is capped independently so it cannot occupy all global AI execution capacity. Reckoning remains Flash-quality; no VVIP quality-floor downgrade was introduced.

## 9. Persistence migration

Migration: `20260925_ai_orchestrator_resilience_delivery_a.sql`

Applied to Supabase production as migration:

`20260925222637 ai_orchestrator_resilience_delivery_a`

The migration is additive and backward-compatible. It adds sanitized diagnostic columns and two operational tables:

- `ai_route_runtime`
- `ai_operation_budget`

Both new tables:

- have RLS enabled;
- grant no DML access to `anon` or `authenticated`;
- grant backend `service_role` DML access.

The schema was verified after migration.

A live SQL primitive test verified:

1. first exact-route lease succeeds;
2. a duplicate lease at the one-in-flight limit is denied;
3. operation-budget claims succeed to the configured test limit;
4. the next claim is denied;
5. synthetic verification rows are deleted afterward.

The migration can safely remain present if application rollback is required because old application code does not depend on or write the new fields/tables.

## 10. Verification

GitHub Actions gates on the Delivery A branch:

- AI architecture/tests: **PASS**
- Teaching D04 verifier: **PASS**
- Vercel preview integration check: **PASS**

Delivery A adds or extends tests for:

- structured RPD/RPM/TPM evidence classification;
- generic/unknown 429 safety;
- route leases and distributed contention;
- short-rate pacing;
- shared operation budgets and TTL reset;
- 30-question × 3-attempt Reckoning quality envelope;
- critical traffic reservation against background work;
- Reckoning provider-error retry ownership;
- route contention vs true capacity exhaustion;
- sanitized telemetry evidence;
- concurrent single-flight 503 confirmation.

## 11. Supabase advisor note

The project already contains existing Supabase security/performance advisor findings outside Delivery A. The two new runtime tables are intentionally server-only: RLS is enabled, browser roles have no grants, and the backend service role is the only intended application principal.

No pre-existing unrelated advisor finding is altered as part of this delivery.

## 12. Rollback

Application rollback:

1. revert the Delivery A application merge;
2. redeploy the prior known-good backend;
3. leave the additive database migration in place unless a later controlled cleanup is desired.

The new database columns/tables are inert under pre-Delivery-A application code, so emergency destructive schema rollback is not required.

## 13. Delivery B boundary

Delivery B remains responsible for:

- full Reckoning scheduler/lifecycle integration and recovery hardening;
- Daily Ritual cache contract repair;
- Morning Brief frontend delivery;
- verification of Weekly Anchor;
- wider background AI workload rationalization;
- full-system production stress validation.

**Delivery A must be production-validated before Delivery B begins.**
