# KIWI Teaching — D03 Class C TPF-20 Successor Correction v1.0

**Status:** CORRECTIVE IMPLEMENTATION — TCH-0919; acceptance pending CI/merge.  
**Owning delivery:** D03 — Capability Registry, Prompt Runtime & Route Control  
**Change class:** Class C/E amendment already approved and design-frozen in the canonical source set.  
**Historical accepted baseline preserved:** 169 total capabilities = 147 model-eligible + 22 T0, 19 prompt families.  
**Successor runtime target:** 170 total capabilities = 148 model-eligible + 22 T0, 20 prompt families.

## Why this correction exists

TPF-20 was approved after the historical D03 implementation and historical 19-family prompt freeze. The earlier D03 acceptance is provenance, not an error to rewrite. TCH-0919 requires a successor correction that appends one new capability/family while leaving TPF-01 through TPF-19 unchanged.

The successor capability is:

- capability ID: `teaching.study.class_grounded_note_generation`
- execution class: `DIRECT-AI`
- authority ceiling: `T3`
- model posture: `MODEL_PRIMARY`
- prompt family: `TPF-20 v1.0`
- route status: `UNQUALIFIED`
- production authorization: `false` until D30 qualification and the later D31 release gate.

The capability may prepare/reconcile a versioned Class-grounded Study Note draft only. It cannot publish itself, rewrite the Class Summary, infer mastery, grade work, schedule review, select cards from the wider collection, choose a provider/model, or mutate authoritative Course/Class state.

## Exact canonical identities

- Capability Registry v1.3 SHA-256: `db2c9c89764b4fbcaffa4fc1d263f99ff0ddb337becbdc56b7ff71d829f5bc16`
- Prompt Manifest v1.4 SHA-256: `7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d`
- Combined 20-family pack SHA-256: `6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d`
- TPF-20 body SHA-256: `d8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67`
- Historical Prompt Manifest v1.3 SHA-256: `4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce`
- Historical 19-family pack SHA-256: `173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae`

## Runtime integration

The accepted historical compiled Registry remains the immutable 169-capability base. D03 appends the one canonical Class C successor capability at runtime and reports Registry v1.3 source identity. This avoids rewriting accepted historical capability data while producing the canonical 170/148/22/20 successor census.

The exact Prompt Manifest v1.4 is packaged as a gzip/base64 repository asset and verified against its canonical SHA before parsing. The exact TPF-20 markdown bytes are likewise packaged as a gzip/base64 repository asset; they are decompressed and verified against the manifest filename/version/SHA before use.

TPF-01 through TPF-19 remain in the accepted individual UTF-8 frozen-body directory and are mechanically compared against the v1.4 successor manifest to prove their filename/version/criticality/capability-count/body-SHA bindings did not change.

The structural prompt path remains unchanged:

```
registered capability
  -> hash-locked prompt family/body
  -> Teaching structural invocation
  -> Teaching Orchestrator
  -> central KIWI AI Orchestrator
```

No feature-level provider SDK or model ID is introduced.

## Route and authority hold

Importing TPF-20 does **not** qualify it.

All 20 Teaching family routes remain:

- qualification status `UNQUALIFIED`;
- no allowed primary route;
- no allowed fallback route;
- production authorization `false`;
- D30 qualification gate retained;
- D31 production-release gate retained.

All 22 T0 capabilities remain promptless.

## TCH-0919 verification contract

Acceptance requires automated proof that:

1. Registry census is exactly 170/148/22/20 with the historical 165 INV aliases retained.
2. `teaching.study.class_grounded_note_generation` is exactly DIRECT-AI/T3 → TPF-20 v1.0.
3. Prompt Manifest v1.4 bytes match the canonical manifest SHA.
4. TPF-20 body bytes match the canonical body SHA.
5. Every historical TPF-01–TPF-19 binding/body remains unchanged.
6. Altered TPF-20 bytes fail closed.
7. All 22 T0 capabilities remain promptless.
8. TPF-20 route remains UNQUALIFIED and production-disabled.
9. The exact TPF-20 body can traverse the existing Teaching Orchestrator/central KIWI AI transport path in tests.
10. Frozen prompt prose remains absent from durable execution envelopes/state.
11. D01–D10 predecessor regressions remain green.
12. Render startup readiness reports the 20/20 v1.4 runtime only after hash verification succeeds.

## Persistence and deployment impact

No Supabase migration is required for the D03 prompt correction.

No prompt text is stored in academic execution rows. Existing durable D05 execution envelopes retain prompt family/version/hash references and structured execution provenance rather than frozen prompt prose.

Render must be redeployed because prompt assets/control-plane code are backend runtime dependencies. Vercel should be verified at the accepted merge SHA, but no new browser prompt authority is introduced.

## Recovery

If successor prompt integrity fails:

1. keep all Teaching model execution fail-closed;
2. do not bypass manifest/body hash checks;
3. do not rewrite or normalize any frozen prompt;
4. forward-fix/revert the successor runtime integration;
5. reverify historical 19 bodies and exact TPF-20 bytes;
6. redeploy;
7. keep TPF-20 UNQUALIFIED until D30 regardless of runtime availability.

This correction does not begin D14 and does not perform D30 qualification.
