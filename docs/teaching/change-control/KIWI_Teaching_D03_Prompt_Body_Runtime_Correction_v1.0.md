# KIWI Teaching — D03 Prompt Body Runtime Correction v1.0

**Status:** D03_CORRECTIVE_HARDENING; route qualification remains UNQUALIFIED.
**Date:** 2026-09-26
**Baseline:** accepted D03 closure main `c109888ef5d6e4ff53b3cd96a1213d13f186752e`
**Manifest source SHA-256:** `4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce`
**Combined pack SHA-256:** `173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae`

D03 already implemented the 169-capability Registry, 147 model-capability bindings, 22 promptless T0 contracts, manifest/SHA metadata, Teaching Constitution, structural contracts and unqualified route controls. Runtime inspection found that the exact prose of the frozen families was not available to the model execution path: the D05 adapter passed structural metadata and academic input but no `request.content` to the central AI Orchestrator.

This correction extracts all 19 exact family files from the accepted v1.3 combined pack. Each file's raw bytes match its manifest `prompt_sha256`. The server-side body store verifies the catalog identity, 19-family/filename census and each file hash at readiness and on retrieval. The D05 adapter composes the unchanged family bytes with a separate structural contract and academic input at execution time, then passes the content through the central `aiRun` request. Only metadata remains in durable D05 envelopes and telemetry. The central Orchestrator retains sole provider/model selection authority.

**Change boundaries:** zero prompt wording changes; zero family reassignment; zero authority or owner changes; zero route qualification; zero provider/model decisions in Teaching; zero D06 work. D30 still owns empirical qualification, and D31 production authorization remains held. The accepted D03 closure used an encoded bundle. This storage refinement replaces that bundle with individual auditable files while preserving the exact bytes and runtime contract.

**Verification:** D01–D05 verifiers passed; 19/19 body hashes verified; full unit regression 485 passed, 0 failed, 0 skipped; non-production Supabase integration guard suite 4 passed, 4 skipped; web build passed. The D05 transport regression proves exact family bytes reach a mocked central provider transport and remain absent from the durable envelope. These results are local reconciled-branch evidence; CI and deployment evidence must be appended after merge.

**Individual family hashes:** The authoritative values are the `prompt_sha256` entries in `teaching/prompt-runtime/frozen/prompt-family-catalog.v1.3.part-00` through `part-03`, and each is checked against the corresponding file by the D03 verifier and tests. No duplicate list is maintained here.

**Correction merge SHA:** pending merge.
