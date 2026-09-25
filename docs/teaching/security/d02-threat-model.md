# KIWI Teaching D02 — Initial Threat Model

**Delivery:** D02 — Authoritative Runtime, Event & Validation Primitives  
**Status:** implementation threat model  
**Scope:** low-level Teaching runtime, event execution, AI-output validation and cross-cutting security boundaries only.

This threat model is intentionally established before KIWI Teaching ships privileged academic mutation or untrusted course-material ingestion. D02 does not implement Gradebook writes, Assessment Package locking, formal Request decisions, attendance decisions, Course scope mutation, or other later domain behavior.

## Security objectives

Teaching must preserve one authoritative owner per academic fact, keep browser state non-authoritative, keep model output non-authoritative until trusted validation and owner commit, keep untrusted content in data-only lanes, keep provider/model routing inside the central KIWI AI Orchestrator, and ensure KIWI-caused failures cannot directly become student academic penalties.

The runtime must remain reconstructable without storing hidden chain-of-thought.

## Trust boundaries

The browser is an untrusted presentation/input boundary. Client timestamps and countdowns are metadata/projections only.

The Teaching runtime is a server-side operational boundary. It may preserve and deliver due events, but it is not Scheduler, Gradebook, SKM, Assessment, Attendance, Request, Progression, Course scope, Teacher Identity, or Teaching Controller authority.

The central KIWI AI Orchestrator is the only model execution boundary. Teaching feature code cannot select or call provider SDKs directly.

Authoritative domain owners are the only components permitted to commit their facts. Model output reaches them only after schema, domain, deterministic-authority and state/precondition validation.

Subject text, uploaded material, student responses, source passages and retrieved academic content are untrusted data. Their contents never become platform/controller/security instructions.

## Threat: grade or academic-record tampering

Attack paths include browser calls that attempt privileged mutation, fabricated model results, bypass of validation, replay of an old accepted result, or misuse of an unrelated service as a Gradebook writer.

D02 controls:

- privileged academic mutations remain server-only;
- T2–T4 model output cannot use the authoritative commit gateway until it has a trusted validation brand;
- the commit gateway routes only to a registered authoritative owner;
- deterministic domain checks take precedence over conflicting model output;
- D02 creates no Gradebook or academic-record write endpoint;
- later owners must revalidate their own state/preconditions before commit.

Residual work belongs to the deliveries that implement the actual Gradebook and assessment state machines.

## Threat: assessment leakage

Attack paths include future question candidates, keys, rubrics or validation traces leaking through ordinary teaching context, event payloads, logs or unrelated AI calls.

D02 controls:

- event payloads are bounded routing metadata, not a content store;
- AI telemetry stores identifiers/outcomes, not prompts, student content, answers, rubrics or hidden reasoning;
- untrusted/content context is structurally separated from trusted constraints;
- provider/model calls remain centralized.

Protected future-assessment candidate storage and the full PPL protected-content isolation workflow are later-delivery responsibilities. D02 must not invent them early.

## Threat: RLS/Data API bypass

The new D02 operational tables live in the private `teaching_runtime` schema, not `public`. Browser roles receive no schema/table/sequence privileges. RLS is enabled as defense in depth.

Production inspection also found pre-existing public tables with RLS disabled, including `background_jobs`, `notifications`, `biome_zones`, `biome_zone_descriptions`, and `onboarding_state`. D02 does not silently enable RLS on those tables because correct policies and application compatibility must be established first.

Most importantly, D02 does not reuse `public.background_jobs` as authoritative Teaching event storage.

## Threat: privilege escalation

Attack paths include a browser presenting itself as a trusted worker, model output naming a privileged mutation, a lower-authority result being treated as a higher-authority result, or a component bypassing the owning service.

D02 controls:

- privileged operations explicitly reject browser trust;
- T0 responsibilities cannot be executed as model-backed authority;
- every AI execution declares an intelligence class and T0–T4 ceiling;
- prompt/model output cannot raise that ceiling;
- only the authoritative commit gateway may hand a validated result to a registered owner;
- the runtime worker invokes injected owner handlers and never mutates academic truth itself.

## Threat: prompt/content injection

Attack paths include Subject text, uploaded material, source passages or student responses containing instructions intended to override system rules, eligibility, grading policy, authority, or permissions.

D02 controls:

- `asUntrustedData()` wraps such material as a data lane;
- trusted authoritative state, permission constraints, provenance-linked academic content and untrusted content remain separate structures;
- formal marking context has an explicit prohibited-context check for attendance, Teacher Personality, reputation, prior GPA, unrelated marks and behavioral history unless an approved exception exists;
- Teaching feature/domain code contains no direct model-provider SDK path.

D03 will bind these lanes into the canonical structural prompt/capability contracts. D02 does not rewrite frozen prompt-family bodies.

## Threat: stale/duplicate/late event execution

Attack paths include worker restart, duplicate delivery, expired claims, delayed due events, device closure, or old events overwriting newer state.

D02 controls:

- events are persisted before execution;
- idempotency keys are unique and collision checked;
- due-event claims use database row locking and bounded leases;
- expired claims are recoverable;
- every registered academic handler must supply an authoritative-state reconciler;
- reconciliation distinguishes actionable, already satisfied, superseded and fairness-recovery-required states;
- duplicate/late work cannot skip reconciliation;
- exhausted KIWI-side retries enter fairness recovery rather than manufacturing a student penalty.

## Threat: AI outage or invalid output

D02 applies the authority-aware failure boundary:

- T0 deterministic state does not depend on AI;
- T1 may use a constrained communication fallback;
- invalid T2 cannot mutate evidence;
- invalid T3 remains draft/pending;
- invalid T4 remains unfinalized.

No failure path fabricates a mark, attendance fact, submission, eligibility decision, progression result, or student action.

## Logging and privacy boundary

D02 telemetry may record execution/event IDs, correlation/causation IDs, declared intelligence class, authority level, central task/model identifier, contract/schema version, validation outcome, rejection reason, safe failure code and eventual authoritative mutation reference.

It must not store hidden chain-of-thought, raw student responses, assessment answers, source passages, full prompt bodies, secrets, access tokens or irrelevant personal history.

## D02 security findings carried forward

The active source tree no longer contains the D01 hard-coded database credential fallback, but historical Git commits may still contain a previously exposed credential. Rotation remains an operational follow-up.

The five pre-existing public tables currently reported with RLS disabled require deliberate policy design; this delivery records the issue and avoids depending on those tables for authoritative Teaching runtime state.

No architecture exception is created by these findings because D02 does not need to weaken or repurpose those surfaces.
