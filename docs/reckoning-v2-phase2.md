# Reckoning V2 — Phase 2 Persistence

Phase 2 adds the persistent database contract required by the future adaptive Reckoning engine. It does not activate Reckoning V2.

## Production-safety rule

Legacy Reckoning remains authoritative.

Existing and newly created legacy rows default to:

- `engine_version = 1`
- `engine_mode = LEGACY`

No root backend route imports the V2 engine yet, so adding this migration cannot switch assessment behavior by itself.

## Live-schema compatibility findings

The existing Kiwi database uses text IDs for:

- users
- subjects
- cards
- exam sessions
- exam questions
- Reckoning sessions

Phase 2 therefore keeps text IDs rather than introducing a competing UUID identity model.

The existing `reckoning_sessions` table already owns:

- deferral state
- linked exam session
- raw score
- lifecycle status
- failure count
- failsafe release/penalty state

Those fields remain authoritative for the surrounding Reckoning lifecycle and are not duplicated.

The existing `exam_questions` table already owns student flagging and AI audit state. Phase 2 only adds nullable Reckoning V2 metadata beside that audit system.

## Reckoning session engine metadata

The migration adds additive fields for:

- engine version and authority mode
- internal V2 phase
- questions consumed
- soft/hard question budgets
- raw accuracy and recovery score
- unresolved Critical count
- current block/question
- optimistic-concurrency state version
- preparation/start/safety timestamps
- question-generation status/error
- planner/config versions

All pre-existing rows remain valid legacy rows.

## Persistent evidence units

The new `reckoning_evidence` table stores one auditable evidence unit per source card/concept.

It persists:

- source card/concept identity
- frozen source snapshot/hash
- original card state
- deterministic risk score/level/reasons
- Bubble/debt/control-discovery signals
- evidence lifecycle status
- Diagnostic/Challenge/Confirmation outcomes
- bounded attempt/demonstration counts
- confirmation-spacing position
- final resolution timestamp
- one-time learning-effect timestamp

The source card foreign key uses `ON DELETE SET NULL` because evidence/history must survive a later card deletion. The Reckoning foreign key uses `ON DELETE CASCADE` because evidence has no meaning without its parent Reckoning.

## Security

`reckoning_evidence` is created with RLS enabled.

It is not granted directly to `anon` or `authenticated`; browser clients should receive curated Reckoning state through backend endpoints in later phases rather than querying internal evidence directly.

## Exam-question metadata

The migration adds nullable/default-safe fields for:

- evidence linkage
- question role
- variant index
- blueprint
- unlock state/time
- millisecond response time
- final evidence effect

Normal CBT questions can leave all of these fields null.

## Persistence adapter

`services/reckoning/store.js` now provides an injected-query Postgres adapter for:

- loading a Reckoning session
- loading its evidence
- creating evidence
- safely updating only V2 session fields
- safely updating only V2 evidence fields
- executing future transactional work through an injected transaction function

The adapter remains unused by production routes in Phase 2.

## Migration deployment status

The migration is committed to the isolated feature branch only. It has not been applied to the live Supabase project as part of Phase 2, because this branch is intentionally isolated from the parallel production update.

## Phase 2 exit condition

Phase 2 is complete when:

1. the additive migration matches the live Kiwi schema;
2. legacy rows remain legacy by default;
3. persistent evidence storage exists in the migration;
4. RLS is enabled for the new internal table;
5. exam-question metadata is nullable/backward-compatible;
6. the persistence adapter is query-injection based and test-protected;
7. no production route imports or activates V2.
