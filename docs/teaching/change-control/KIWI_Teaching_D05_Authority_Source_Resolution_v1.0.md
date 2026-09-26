# KIWI Teaching — D05 Authority Source Resolution v1.0

**Status:** ACCEPTED_D05_SOURCE_RESOLUTION  
**Date:** 2026-09-26  
**Delivery:** D05 — Teaching Orchestrator & Durable Event Runtime Integration  
**Change-control classification:** Class B source-integrity/canonical-ambiguity resolution  
**Scope:** D05 implementation source selection only

## Decision

The frozen Phase-22 baseline names `KIWI_Teaching_Intelligence_Inventory_Authority_Spec_Phases_4-6_v1.1.md`, but the exact frozen-hash v1.1 body was not recoverable in Project Knowledge during D04/D05 source resolution. The retained implementation source is:

`KIWI_Teaching_Intelligence_Inventory_Authority_Spec_Phases_4-6_v1.2_PPL.md`

SHA-256:

`3d0bf8503df58c2126692119353d5c6eb29d157b8891de18ffaade1dd1f3e0ec`

On 2026-09-26 the project owner explicitly directed D05 implementation to use the v1.2 PPL Authority Spec and continue implementation. That explicit direction resolves the D05 source-integrity blocker. D05 therefore uses v1.2_PPL as its operative Phase 4–6 authority source.

## Why this does not silently redesign authority

The selected v1.2_PPL artifact states that it preserves INV-001–INV-165 in identity/classification/authority intent and adds only four deterministic T0 PPL responsibilities. It does not add a model-eligible capability, prompt family, model authority, or direct mutation authority.

D05 therefore continues to enforce:

- 169 capabilities = 147 model-eligible + 22 T0/no-direct-prompt;
- T0–T4 authority ceilings;
- one authoritative owner/boundary per academic fact;
- AI proposal/interpretation never directly becoming academic truth;
- four promptless deterministic PPL T0 capabilities;
- event/state authority remaining server/domain-owned;
- capability-scoped context minimization;
- fail-closed state/version revalidation and authoritative-owner handoff.

## Unchanged baselines

This resolution does **not**:

- rewrite the frozen Phase-22 manifest globally;
- change Capability Registry v1.1 identity;
- change the accepted D03 prompt baseline;
- rewrite any TPF prompt text;
- change prompt-family membership;
- qualify a Teaching AI route;
- authorize D30 qualification or D31 release;
- change a domain authority owner;
- change D05 task scope.

The accepted D03 runtime continues to use the user-authorized Prompt Manifest / frozen prompt pack v1.3 implementation baseline. All Teaching AI/PPL routes remain `UNQUALIFIED` pending D30.

## Carry-forward

Later deliveries must read this versioned record when reconstructing D05 implementation provenance. A future permanent replacement of the Phase-22 global baseline source identity requires its own explicit baseline/change-control amendment; this D05 record does not pretend that the original frozen v1.1 hash existed locally.
