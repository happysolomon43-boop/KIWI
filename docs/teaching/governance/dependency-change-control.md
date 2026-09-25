# Dependency Metadata and Change Control

## Canonical task metadata convention

Every implementation task/delivery tracking record must preserve at least:

- `task_id` — permanent TCH identity.
- `delivery_id` — canonical D00–D31 placement.
- `hard_predecessors` — deliveries/tasks that must be accepted first.
- `blockers` — unresolved GATE, architecture exception, migration conflict, security hold or required external prerequisite.
- `release_milestone` — Foundation / Milestone A–F as defined by Roadmap.
- `owning_domain` — the authoritative domain/service whose truth or contract is affected.
- `governing_contracts` — canonical files/sections that define the task.
- `status` — NOT_STARTED, ACTIVE, CODE_COMPLETE, TESTED, HANDOFF_READY, MERGED or ACCEPTED.
- `migration_owner` where persistence changes.
- `state_machine_owner` where state transitions change.
- `unlocks` when a passed task/delivery enables a named dependent boundary.

TCH number or physical Backlog position is never sufficient evidence of execution order.

## Contradiction review

When a proposed implementation appears to merge concepts intentionally separated by the Blueprint, work on the affected portion stops before code mutation.

Review must identify:

1. exact conflicting implementation proposal;
2. governing canonical sources and versions;
3. authoritative owner/state axis/invariant at risk;
4. whether the issue is implementation defect, ambiguity, prompt/intelligence change, domain/schema change or task/delivery scope change;
5. smallest compliant resolution;
6. migration/compatibility/traceability effects;
7. whether dependent delivery work remains blocked.

## Change-control classes

**Class A — implementation defect/local realization.** Fix within the delivery and record it when academic meaning, authority, public academic behavior, prompt contract, task scope and dependency ordering do not change.

**Class B — canonical ambiguity.** Stop affected work, open an architecture exception, cite exact sources, resolve/version canonical material before continuing.

**Class C — prompt/intelligence-contract change.** Never patch frozen prompt text in feature code. Version the prompt/manifest/traceability and keep affected routes unqualified until required empirical evidence.

**Class D — academic domain/authority/state/schema change.** Block the affected surface, version Blueprint/Backlog/contracts/traceability/delivery mapping as required, and rerun applicable gates.

**Class E — task/delivery scope change.** Preserve TCH IDs, version Backlog/Task Map/Roadmap artifacts, and explicitly record the rebind.

## Non-negotiable constraints

- one authoritative owner per academic fact;
- AI cannot directly become authoritative state;
- KIWI-caused failure cannot create student penalty;
- frozen prompts are not silently edited;
- provider/model routing stays outside Teaching prompt/domain logic;
- D30 and D31 qualification/release holds remain in force.

Cross-chat conversation summaries are continuity aids, never architecture amendments.
