# KIWI Teaching — Feature Availability Amendment v1.0

**Status:** ACCEPTED_PRODUCT_DIRECTION  
**Date:** 2026-09-25  
**Change class:** Class E — task/delivery scope change  
**Affected permanent task IDs:** TCH-0029, TCH-0675  
**Affected accepted delivery:** D01

## Decision

KIWI Teaching does not use runtime feature-availability toggles for present or future Teaching capabilities.

The Teaching app itself is available normally to authenticated KIWI users. A capability that has been implemented, accepted, and is valid to expose is available normally. A capability that has not yet been implemented or accepted is simply absent from the product/runtime until its owning delivery introduces it.

Do not use account allowlists, hidden enable/disable switches, or environment booleans to decide whether a normal Teaching feature exists for one user but not another.

## Superseded D01 semantics

The original TCH-0029 wording required a development/test-user feature flag for Teaching. That behavior is superseded.

The original TCH-0675 wording required feature flags for high-stakes marking, impromptu tests, resits, and external integrations. That behavior is superseded.

The permanent TCH IDs remain valid for traceability and are materially rewritten in the paired Backlog/Task-Map amendments committed with this decision.

## What this does NOT remove

This amendment does not weaken safety, academic authority, or qualification gates.

The following remain mandatory and are not "feature toggles":

- authentication and authorization;
- Reckoning/platform lockouts and other authoritative platform rules;
- server-side privileged-operation boundaries;
- Assessment Eligibility and Package Lock;
- Gradebook/SKM/Progression/Scheduler ownership;
- prompt/runtime qualification requirements;
- D30 empirical Teaching-AI qualification;
- D31 final production-readiness gate;
- any deterministic prerequisite/validation rule defined by the canonical architecture.

A feature may be unavailable because it has not been implemented, accepted, qualified, or authorized by its governing academic/runtime contract. It must not be kept dormant through a generic product on/off flag once those requirements are satisfied.

## Implementation consequence

Remove and do not reintroduce:

- `TEACHING_ENABLED`
- `TEACHING_DEV_USER_IDS`
- `TEACHING_HIGH_STAKES_MARKING_ENABLED`
- `TEACHING_IMPROMPTU_TESTS_ENABLED`
- `TEACHING_RESITS_ENABLED`
- `TEACHING_EXTERNAL_INTEGRATIONS_ENABLED`
- equivalent future Teaching feature-availability toggles

Environment/configuration boundaries remain valid for operational parameters such as AI route settings, timeouts, token budgets, secrets, infrastructure endpoints, and other non-product-availability configuration.
