# KIWI Teaching — D05 to D06 Implementation Handoff

**Status:** D05 accepted; D06 not started. The D03 prompt-body runtime correction is merged and verified; D06 has not started.

The D05 baseline was `962d6f83f0b1f706606e772ab68d4964430732e9`; D03 runtime closure was subsequently merged as `c109888ef5d6e4ff53b3cd96a1213d13f186752e`. The D03 correction closes the inherited prompt-body runtime gap: the exact v1.3 TPF-01–TPF-19 files are verified at runtime and composed ephemerally into the central AI request. It changes no frozen prose, authority, family assignment, model/provider policy, or route qualification. All Teaching routes remain `UNQUALIFIED` pending D30.

**D06 starting code baseline:** `86541360f85495e35320eb05e97793647a29995a` (direct-file D03 correction merge, PR #105). Later commits are documentation-only; begin from current accepted main containing this merge. Consult `docs/teaching/change-control/KIWI_Teaching_D03_Prompt_Body_Runtime_Correction_v1.0.md` and the D05 authority source-resolution record when implementing D06.

The D00–D05 review hardening correction adds strict outbox replay identity checks, bounded academic-input serialization and atomic process-local idempotency. See `docs/teaching/change-control/KIWI_Teaching_D00_D05_Review_Hardening_v1.0.md`. Once merged, begin D06 from accepted main containing that correction. Database integration skips remain explicit; route qualification remains held.
