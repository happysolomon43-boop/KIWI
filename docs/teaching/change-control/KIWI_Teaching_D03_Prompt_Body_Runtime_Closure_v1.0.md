# KIWI Teaching — D03 Prompt-Body Runtime Closure v1.0

**Date:** 2026-09-26  
**Status:** ACCEPTED IMPLEMENTATION DEFECT CORRECTION (Class A local realization)  
**Owning delivery:** D03 — Capability Registry, Prompt Runtime & Route-Control Foundation  
**Baseline corrected:** D03 runtime as inherited by accepted D05 `962d6f83f0b1f706606e772ab68d4964430732e9`  
**Accepted correction merge:** `c109888ef5d6e4ff53b3cd96a1213d13f186752e`  
**Pull request:** #104

## Problem

The accepted D03 implementation correctly imported and hash-locked the v1.3 Prompt Manifest/catalog, mapped 147 model-eligible capabilities to the 19 frozen prompt families, enforced T0 promptlessness, built the Teaching Constitution/structural contracts, and kept all routes UNQUALIFIED.

However, the runtime stopped at prompt identity metadata. The exact frozen prompt-family prose was not packaged as a runtime-resolvable artifact and the D05 Teaching AI adapter therefore supplied the central KIWI AI Orchestrator with structural metadata but no actual family prompt content. The central AI Orchestrator reads provider content from `request.content`, `request.contents`, or `request.prompt`; absent that bridge, a future qualified Teaching call would have reached the provider with empty content.

This is an implementation gap in the D03 prompt-runtime realization, not a design change and not D30 qualification work.

## Canonical source identity preserved

The correction uses the project-owner-authorized Phase-15 v1.3 prompt baseline already pinned by D03:

- Prompt Manifest v1.3 SHA-256: `4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce`
- Combined frozen 19-family prompt pack SHA-256: `173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae`
- Prompt family count: 19
- Model-eligible capability count: 147

Every extracted family body is verified against the family-specific `prompt_sha256` already present in the v1.3 manifest.

No family prose is rewritten, merged, summarized, normalized, interpolated, or regenerated.

## Runtime packaging

The exact 19 prompt bodies are packaged as a deterministic Brotli-compressed JSON runtime payload split into fixed base64 chunks under:

`teaching/prompt-runtime/frozen/prompt-bodies.v1.3/`

Runtime bundle identities:

- compressed bundle SHA-256: `cda3c9959aade4ee187827708096cb89942d10b209bcefdfeae36b37115ba4ff`
- decompressed JSON payload SHA-256: `ee68f82a48efb038134371cb33aa34e60986a177661be401d2386c54596d2fd1`
- base64 length: 138576
- chunk count: 34
- families: 19

`prompt-body-store.js` reconstructs the chunks, validates allowed base64 form and exact length, verifies the compressed hash, decompresses, verifies the decompressed payload hash, checks manifest/pack identity, checks family census, then checks every family body hash.

Any missing/corrupt/tampered body fails closed before model execution.

## Runtime composition

`prompt-composer.js` composes model content in three structurally separated sections:

1. the exact frozen family prompt text;
2. the typed Teaching runtime contract/Constitution/capability/state/output contract;
3. bounded academic task input treated as data.

The frozen family prose is copied byte-for-byte into the composed model content. Feature code does not edit or interpolate into the frozen family core.

`teaching/orchestrator/ai-adapter.js` now places the composed content into `request.content` before calling the existing central KIWI AI boundary.

Provider/model selection remains entirely inside KIWI platform AI infrastructure.

## Boundaries preserved

This correction does **not**:

- qualify any Teaching route;
- run or replace D30 empirical qualification;
- change any prompt-family text;
- merge prompt families;
- change capability identity;
- change T0–T4 authority ceilings;
- change authoritative owner boundaries;
- make T0 capabilities model-backed;
- add a provider SDK path in Teaching;
- change D05 state revalidation/owner-commit rules;
- begin D06.

All Teaching routes remain `UNQUALIFIED` pending D30.

All 22 T0/no-direct-prompt capabilities remain promptless.

## Verification requirements

The correction is accepted only when automated verification proves:

- all 34 runtime chunks exist;
- compressed/decompressed bundle hashes match the pinned values;
- all 19 runtime bodies resolve;
- each body matches its manifest family SHA-256;
- changed prompt text is rejected;
- a model-backed invocation contains the exact frozen family body;
- the D05 Teaching adapter sends non-empty composed `request.content`;
- central transport receives the composed content in the existing central KIWI AI path;
- T0 capabilities still reject model prompting;
- all routes remain UNQUALIFIED;
- D01–D05 predecessor verifiers still pass;
- Teaching regression tests and full KIWI tests pass.

## Acceptance evidence

The correction was accepted after merge to `main` on `c109888ef5d6e4ff53b3cd96a1213d13f186752e`.

Accepted-main verification:

- D01 verifier: PASS
- D02 verifier: PASS
- D03 verifier: PASS
- D04 verifier: PASS
- D05 verifier: PASS
- Teaching unit tests: 75/75 passed, 0 failed, 0 skipped
- Full KIWI regression tests: 481/481 passed, 0 failed, 0 skipped
- Web build: PASS
- Non-production Supabase integration suite: 8 discovered, 4 passed, 0 failed, 4 skipped because no non-production Supabase project/branch is configured

Deployment verification:

- Vercel production: READY on `c109888ef5d6e4ff53b3cd96a1213d13f186752e`
- Render backend: LIVE on `c109888ef5d6e4ff53b3cd96a1213d13f186752e`
- Render startup reached `[KIWI Teaching] D05 runtime initialized; due-event and durable outbox workers started.`, which occurs only after Teaching prompt-control `assertReady()` validates the frozen prompt-body bundle
- Supabase migration head remained unchanged at `20260926180811_teaching_d05_orchestration_service_rls`; this correction requires no database migration

The four skipped database integration bodies are expected skips and are not represented as passing tests.

## Deployment / persistence impact

No database migration is required.

No Supabase schema or RLS change is required.

No new secret is required.

The correction changes server-side code/runtime assets. After merge, Render deployment must be verified because the backend loads the prompt bundle at runtime. Vercel should be checked for the accepted commit as part of the repository deployment state, but no browser-side prompt authority is introduced.

## Recovery

If runtime prompt-bundle integrity fails after deployment:

1. stop/keep Teaching model execution fail-closed;
2. do not bypass the hash checks;
3. revert/forward-fix the runtime bundle/code;
4. verify all family hashes;
5. redeploy;
6. do not qualify or execute a route using unmanifested prompt text.

Rollback must never replace the frozen prompts with ad-hoc prompt prose merely to restore availability.
