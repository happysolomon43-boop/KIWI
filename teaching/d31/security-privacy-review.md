# D31 Production Security & Privacy Review

**Task:** TCH-0680  
**Review date:** 2026-10-05  
**Scope:** KIWI Teaching production academic-record boundary and D31 AI owner-release exception

## Candidate disposition

**SECURITY / PRIVACY CANDIDATE PASS.** No P0/P1 security blocker was identified in the production-state review. Final D31 closure still requires the accepted D31 SHA to deploy cleanly and the post-deploy log/health check to remain clean.

## Production data authority reviewed

Production Supabase project: `nqdwifqskxkblgdgeutn` (`Kiwi`). Integration project: `kmymmwujhotqxtoamyur` (`KIWI Teaching Integration`).

The live privilege/RLS review established:

- Teaching tables and `teaching_runtime` relations inspected with academic data have RLS enabled.
- `anon` has no Teaching table grants.
- No `authenticated` Teaching mutation table grant was found; browser-readable Teaching records are SELECT-only and ownership-scoped.
- Browser-readable RLS predicates reviewed bind access to the authenticated student identity (`auth.uid()` / equivalent ownership predicate); no broad `USING (true)` Teaching read policy was found.
- High-stakes assessment, marking, gradebook, progression, recovery and runtime evidence surfaces remain service-role/server mutation paths.
- D28 privileged `SECURITY DEFINER` functions (`d28_inflight_acquire`, `d28_inflight_release`, `d28_rate_limit_check`) are not executable by `anon`, `authenticated`, or `public`.
- Supabase security advisors reported no critical/high Teaching security lint. `RLS Enabled No Policy` INFO entries correspond to fail-closed/server-only surfaces verified without client table privileges.
- Public EXECUTE inheritance observed on several non-`SECURITY DEFINER` trigger guard functions does not grant table mutation or privileged RPC authority; those functions return `trigger` and remain bound to the table/trigger execution context.

## D31 AI owner override security posture

The Product Owner release exception is implemented only in server composition. The browser cannot activate it. Exact activation requires:

`TEACHING_D31_AI_RELEASE_MODE=OWNER_OVERRIDE_V1`

Any other state fails closed. The override instantiates only existing production-mounted intelligence adapters against `teachingRuntimePlatform.aiBoundary`; it does not create direct model/provider access.

The following controls remain non-negotiable under the override:

- central KIWI AI Orchestrator routing;
- D28 execution/rate/retry/cache/telemetry controls;
- schema, domain, provenance and current-state validation;
- protected assessment eligibility/content isolation;
- server-only provider credentials and service-role credentials;
- deterministic academic owner boundaries;
- no hidden chain-of-thought persistence/exposure;
- no AI direct write into marks, gradebook, attendance, progression, locked assessment state, scheduling truth, or other frozen owner domains.

The override changes release authorization only. It does not change D30 evidence to `QUALIFIED` and does not create a second academic truth source.

## Deployment / infrastructure review

Render service `srv-d7p3k9gsfn5c73bh7rv0` is the production deployment surface. Vercel was checked across both connected accounts and has no KIWI project, so it is not part of the production release path.

The monolith-corruption deploys are retained in Render history as failed. The repaired production instance is live and the post-repair application error/warning log query returned no errors/warnings for the reviewed interval.

Production and integration migration ledgers intentionally differ: D29/D30 QA/qualification evidence-only migrations remain integration-side; D31 does not promote those tables to production merely to equalize migration heads.

## Rollback

1. Remove or change `TEACHING_D31_AI_RELEASE_MODE` from `OWNER_OVERRIDE_V1` and redeploy/restart. All D31-composed Teaching AI adapters return to held/null state.
2. If required, revert the D31 release-wiring commit.
3. No academic-record migration is required to disable the owner override.

## Final closure condition

After D31 merge, verify the deployed Render commit equals the accepted D31 main SHA, startup is healthy, no release-time application errors appear, and the server reports `OWNER_OVERRIDE_ENABLED` while preserving `PRESERVE_D30_EVIDENCE_STATE`.
