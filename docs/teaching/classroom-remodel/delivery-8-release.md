# Delivery 8 candidate: qualification and coordinated rollback

Delivery 8 is NOT ACCEPTED. Deliveries 1–7 have candidate implementations, not completed acceptance. Fixture CI is deterministic support evidence. None of the 44 blueprint scenarios has accepted live release evidence. No production migration, rollout or retirement has been performed.

## Implemented controls

An additive service-only PostgreSQL control starts STOPPED. New D11 sessions remain LEGACY until a qualified COHORT or GENERAL transition. D11 pins the selected engine, chapter, preparation binding and release manifest atomically with session creation; it never converts an existing session. Presentation initialization checks the pinned manifest against the adopted policy and runtime fingerprint.

Every delivery transaction locks the control for shared access. Transitions lock it exclusively, use an expected revision, persist operation identity and reject conflicting retries. Stopping admission does not authorize a different engine to serve an existing session. Previously adopted manifest support is explicit. A worker with a different runtime pin holds the session even if the manifest remains supported.

An unsupported session enters RECOVERING with a compatibility hold. Its public cursor, private buffers, pending messages, balance and task deadline are retained. No new portion releases. A compatible restored worker can continue the pinned session without resetting its window or downgrading into legacy UI. A deadline reached during the hold records SYSTEM_RELEASE_HOLD_AT_DEADLINE; no response/evaluation is fabricated. D11 closure and protected academic restrictions remain authoritative.

The manifest mechanically binds source revision, current consumer census, 22 migrated capabilities, aliases/owners/ceilings, prompts/registry, schemas, migrations, assets and policy. Signed evidence must match its hash, permitted category/owner, execution reference and validity interval. Trust roots are operator-managed public keys supplied to the internal runtime; requests cannot supply them. All 44 scenarios require recorded observations. Fixture success cannot supply owner acceptance.

## Qualification commands

Run deterministic verification and emit a candidate report:

```sh
node scripts/run-classroom-release-qualification.js --execute --out /tmp/classroom-release-report.json
```

When an authorized owner has adopted policy and collected genuine evidence, use `--policy /path/policy.json --attestations /path/evidence.json --trust-roots /path/public-roots.json --require-release`. Add `--cohort` for authorized test-instance preflight. GENERAL requires cohort observation; only that complete decision can authorize retirement. The report command performs no deployment or mutation.

An attestation envelope contains `keyId`, `payload` and a base64 Ed25519 `signature` over the UTF-8 canonical `hash(payload)` exported by academic-artifacts. Payload requires version classroom-release-evidence.v1, owner, category, subject, manifestHash, result ACCEPTED, fixture false, executionId, evidenceRefs, observedAt and expiresAt. Scenario records additionally require observation fields given, actionOrFailure, expectedPublicBehavior, expectedPersistedFacts, forbiddenEffects and testedVersions. Migration records include the exact consumerHash. Operator trust roots map keyId to publicKey, owner and allowed categories. Never sign fixture observations as real qualification.

The internal `runtime.releaseControl.transition` is the existing transaction owner's operator interface, not an HTTP route. COHORT/GENERAL require the exact manifest/policy and verified attestations; COHORT also requires explicit student IDs. STOPPED/ROLLBACK require operationKey, expectedRevision and reasonRef. Retained supportedManifestHashes must be previously adopted; arbitrary hashes cannot authorize compatibility. This implementation does not configure or publish an operator endpoint.

## Rollout and rollback procedure

1. Close every D1–D7 acceptance gap; adopt/calibrate policy; qualify mandatory routes and all migration consumers. Obtain real provider, academic and accessibility evidence bound to the candidate. Retained TPF-05/08/20 responsibilities and historical readers remain required.
2. Verify the actual API/worker host, database migration history/RLS, frontend ownership/assets, auth/stream origin and recovery. Rehearse on an authorized test instance. Preserve versioned worker/API/client/prompt/registry/database compatibility.
3. Apply additive migrations through the existing release process. Install compatible code and assets with admission STOPPED. Check durable worker readiness and route qualification. No ephemeral queue or duplicate host is introduced.
4. Submit a qualified COHORT transition with exact student IDs. Observe readiness, starvation, receipt lag, pending queue age, task anomalies, stale rejection, interpretation holds, provider failure/cost and closure reconciliation. A deployment success is not acceptance.
5. Stop expansion for lost commitments, private/unauthorized release, unfair task behavior or persistent incompatible state. Set STOPPED or ROLLBACK by revision CAS. Retain only manifests served by proven compatible versions; unsupported sessions hold with durable state. Do not undo additive database migrations under active sessions.
6. Restore the pinned compatible worker/API/client version and explicitly retain its previously adopted manifest support. Reconcile due events, original deadlines, pending messages and closure. Verify no duplicate JOIN, quota loss, unpublished release or timer reset.
7. Expand GENERAL only after accepted cohort observation and complete gates. Retire obsolete active 04/06/07/new-session legacy paths in a separately reviewable change only then. Retain historical prompt bodies and legacy readers; never delete them automatically at launch.

## Actual infrastructure observation, 2026-10-11

Render KIWI API `srv-d7p3k9gsfn5c73bh7rv0` remains on main baseline a77aec6fbd49b89a4538610e434151e2f5fb8cde, latest live deploy dep-db4a3np7lnhs7390lvdg. It has no configured health-check path. Durable worker restart, leases, stream proxy and adopted environment policy have not been qualified against this candidate.

Supabase production nqdwifqskxkblgdgeutn and integration kmymmwujhotqxtoamyur were ACTIVE_HEALTHY. The candidate academic-artifact table was absent in both inspected databases. No candidate migrations were applied. Native isolated PostgreSQL CI, rather than these real projects, tests candidate migrations and rollback.

Neither connected Vercel account exposed a KIWI project. Frontend ownership, deploy routing, cache/version compatibility and auth origins remain unverified. No duplicate infrastructure was created and no secrets were retrieved.

## Remaining acceptance blockers

TPF-21 close_class live qualification; authorized independent reviewers; adopted runtime policy; trusted D16/D17 readers; actual D27 note publication; source correction/remap evidence; all 22 consumer qualifications; real provider/UI/asset/stream/closure runs; human accessibility and old/new academic comparison; actual-host recovery and rollback; staged rollout observation. The candidate leaves every obsolete active binding and historical body retained.
