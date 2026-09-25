# D00 Canonical Source Resolution

## Start record

- GitHub repository: `happysolomon43-boop/KIWI`.
- GitHub main at D00 start: `3641391d4c9077ad0740cf6e5693b2644d31a0df`.
- Working branch: `teaching-d00-canonical-governance`.
- Supabase production project: `nqdwifqskxkblgdgeutn` (Kiwi), ACTIVE_HEALTHY, PostgreSQL 17, eu-central-2.
- Supabase migration head at start: `20260924000506_reckoning_resumable_preparation_delivery_d`.
- No `teaching_*` tables or Teaching migrations existed at start.
- Vercel project: `kiwi`, Express, Node 24.x. Production deployment for the start commit was READY.
- Render: one workspace is visible to the connector, but connector policy requires explicit user confirmation before selecting it. D00 does not select or mutate a Render workspace.
- Teaching feature-flag baseline: no canonical Teaching enablement flag exists yet; TCH-0029 belongs to D01.

## Resolved canonical artifacts

The canonical hashes are pinned in `canonical-baseline.json`. Available artifacts that were hash-verified against the freeze include Blueprint v11.5, Backlog v9.5, Capability Registry v1.1, Orchestrator/Event Runtime v1.1, PPL Standard v1.0, Prompt Manifest v1.2 JSON, frozen 19-family prompt pack v1.2, Delivery Roadmap v1.4, Delivery Task Map v1.5, Capability Traceability Matrix v1.1, Critical Invariant Trace Map v1.1, Context Pack v1.7, Final Freeze v1.3 and D00 Launch Packet v1.3.

## Integrity exception: stale local authority-spec copy

The locally retained file named as the Phase 4–6 Authority Spec hashes to `ff42c14c3ce131355c16abd9daa5182372d8e6e88176b1d1146abeace95c91f3`, not the frozen v1.1 hash `32ed4f149edc9531e6d5a3e0c81478f7025c9c16b32857b87707f4e609c40b87`.

It is therefore rejected as current implementation authority. Current identity/count/authority rules are taken from the hash-valid Capability Registry v1.1, Capability Traceability Matrix v1.1, Blueprint v11.5, PPL Standard v1.0, Final Freeze v1.3 and Phase-22 manifest.

This is a source-integrity issue, not permission to reinterpret the frozen design.

## Canonical artifacts referenced by freeze but not locally retrievable in full

The current Phase-16 Evaluation v1.4, PPL Empirical Qualification v1.0 and Original-18-T0 PPL Review v1.0 bodies were not locally retrievable in this implementation session. Their hashes and D00-relevant release holds are pinned by the Final Freeze, Roadmap and manifest. D00 does not implement or close their empirical procedures; D30 remains the qualification owner.

If a later delivery requires a detailed rule found only in one of these bodies, that delivery must retrieve the exact canonical artifact before implementing that rule.

## Pre-existing implementation observations

The start commit already contains `public/teaching-frontend.js` and `teaching-backend.js`. They are a prototype created before canonical D00 and are not evidence that D01 or any Teaching feature delivery is complete.

The prototype currently renders a Teaching surface inside the monolithic KIWI frontend and is not protected by the future Teaching feature flag. The current product direction is a separate Teaching application surface. D01 owns the module/repository/configuration realization; any separate app must still use the same canonical domain owners and must not create a second academic-truth universe.

The server source also contains a hard-coded fallback database credential. D00 does not touch unrelated runtime code; D01 TCH-0031 must remove/rotate this exposure as part of the required secret audit.

Supabase additionally reports RLS disabled on existing public tables `background_jobs`, `biome_zones`, `biome_zone_descriptions`, `onboarding_state`, and `notifications`. This is pre-existing security debt outside D00 and must be handled deliberately with correct policies rather than blindly enabling RLS.
