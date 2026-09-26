'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveFamilyConcurrency,
} = require('../../services/reckoning/preparation');
const { createReckoningEngine } = require('../../services/reckoning');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Delivery B migration adds durable preparation ownership without destructive schema changes', () => {
  const sql = read('migrations/20260926_ai_resilience_delivery_b_reckoning_claims.sql');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS preparation_claim_id\s+text/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS preparation_claim_expires_at\s+timestamptz/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS preparation_heartbeat_at\s+timestamptz/i);
  assert.match(sql, /idx_reckoning_sessions_preparation_claim/i);
  assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b/i);
});

test('prepared-item persistence is atomically guarded by the live preparation claim', () => {
  const source = read('services/reckoning/store.js');

  const readyStart = source.indexOf('async function savePreparationItemReady');
  const failureStart = source.indexOf('async function savePreparationItemFailure');
  const claimStart = source.indexOf('async function claimPreparation');
  assert.ok(readyStart >= 0 && failureStart > readyStart && claimStart > failureStart);

  const ready = source.slice(readyStart, failureStart);
  const failure = source.slice(failureStart, claimStart);

  for (const block of [ready, failure]) {
    assert.match(block, /FROM reckoning_sessions rs/i);
    assert.match(block, /rs\.preparation_claim_id\s*=\s*\$\d+/i);
    assert.match(block, /rs\.preparation_claim_expires_at\s*>\s*now\(\)/i);
  }

  const activationStart = source.indexOf('async function activatePreparedSession');
  assert.ok(activationStart >= 0);
  const activation = source.slice(activationStart, activationStart + 7000);
  assert.match(activation, /preparation_claim_id\s*=\s*\$11/i);
  assert.match(activation, /preparation_claim_expires_at\s*>\s*now\(\)/i);
  assert.match(activation, /preparation_claim_id = NULL/i);
});

test('route-level pressure lowers Reckoning family concurrency before new provider fan-out', () => {
  const config = {
    preparation: {
      familyConcurrency: 4,
      elevatedFamilyConcurrency: 2,
      highFamilyConcurrency: 1,
      severeFamilyConcurrency: 1,
    },
  };

  const route = (inFlight) => ({ inFlight });

  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 0,
    queued: 0,
    routeScheduler: {
      maxInFlightPerRoute: 1,
      routes: [route(1), route(1), route(0), route(0)],
      models: [],
    },
  }, config), 2);

  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 0,
    queued: 0,
    routeScheduler: {
      maxInFlightPerRoute: 1,
      routes: [route(1), route(1), route(1), route(0)],
      models: [],
    },
  }, config), 1);

  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 0,
    queued: 0,
    routeScheduler: {
      maxInFlightPerRoute: 1,
      routes: [route(0), route(0)],
      models: [{ waitMs: 250 }],
    },
  }, config), 1);

  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 0,
    queued: 0,
    queuedByLane: { CRITICAL: 1 },
    routeScheduler: {
      maxInFlightPerRoute: 1,
      routes: [route(0), route(0)],
      models: [],
    },
  }, config), 1);
});

test('a worker that loses its preparation claim cannot persist another question or activate', async () => {
  const claimed = {
    id: 'reckoning-claim',
    user_id: 'user-claim',
    subject_id: 'subject-claim',
    pressure_score: 50,
    status: 'triggered',
    engine_version: 2,
    engine_mode: 'LIVE',
    engine_phase: 'PREPARING',
    generation_status: 'pending',
    preparation_claim_id: 'claim-1',
    preparation_claim_expires_at: new Date(Date.now() + 60000),
  };

  let readyWrites = 0;
  let activationTransactions = 0;
  const releases = [];

  const store = {
    async getSession() {
      return claimed;
    },
    async claimPreparation(_reckoningId, _userId, _stale, claimId) {
      assert.equal(claimId, 'claim-1');
      return { ...claimed, preparation_claim_id: claimId };
    },
    async touchPreparation() {
      return { preparation_claim_id: 'claim-1' };
    },
    async ownsPreparationClaim() {
      return false;
    },
    async getPreparationManifest() {
      return {
        preparation_version: 2,
        config_version: 6,
        generation_group_id: claimed.id,
        plan: {
          evidence: [{
            id: 'e-1',
            sourceCardId: 'card-1',
            conceptKey: 'card:card-1',
            sourceSnapshot: { front_content: 'Q', back_content: 'A' },
            sourceHash: 'hash',
            originalCardState: 'STUCK',
            riskScore: 90,
            riskLevel: 'CRITICAL',
            riskReasons: [],
            isBubbleCritical: false,
            hasLearningDebt: false,
            requiredConfirmations: 1,
          }],
          softQuestionBudget: 5,
          hardQuestionCap: 30,
          plannerVersion: 1,
        },
        blueprints: [{
          id: 'bp-1',
          evidenceId: 'e-1',
          sourceCardId: 'card-1',
          role: 'DIAGNOSTIC',
          variantIndex: 0,
        }],
        family_order: ['e-1'],
        deck_ids: ['deck-1'],
        total_count: 1,
      };
    },
    async createPreparationManifest() {
      throw new Error('manifest should be reused');
    },
    async getPreparationItems() { return []; },
    async savePreparationItemReady() {
      readyWrites += 1;
      return {};
    },
    async savePreparationItemFailure() { return {}; },
    async releasePreparationFailure(_id, _userId, error, claimId) {
      releases.push({ code: error.code, claimId });
      return null;
    },
    async withTransaction() {
      activationTransactions += 1;
      throw new Error('activation transaction must not run');
    },
  };

  const service = {
    buildManifest() {
      throw new Error('manifest should be reused');
    },
    async prepare({ onQuestionReady }) {
      await onQuestionReady({
        blueprint: {
          id: 'bp-1',
          evidenceId: 'e-1',
        },
        question: {
          id: 'q-1',
          questionNumber: 1,
          evidenceId: 'e-1',
        },
        generationAttempts: 1,
        familyIndex: 0,
        itemIndex: 0,
      });
      throw new Error('unreachable');
    },
  };

  const engine = createReckoningEngine({
    store,
    preparationInputProvider: async () => {
      throw new Error('source input should not reload');
    },
    preparationService: service,
    randomUUID: () => 'claim-1',
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
  });

  await assert.rejects(
    engine.start({
      reckoningId: claimed.id,
      userId: claimed.user_id,
    }),
    (error) => {
      assert.equal(error.code, 'ERR_RECKONING_PREPARATION_CLAIM_LOST');
      assert.equal(error.status, 409);
      return true;
    }
  );

  assert.equal(readyWrites, 0);
  assert.equal(activationTransactions, 0);
  assert.deepEqual(releases, [{
    code: 'ERR_RECKONING_PREPARATION_CLAIM_LOST',
    claimId: 'claim-1',
  }]);
});

test('Daily Ritual persistence uses one JSONB payload contract and never spreads feature fields into columns', () => {
  const db = read('db_layer_supabase.js');
  const start = db.indexOf('dailyRitualCache: {');
  assert.ok(start >= 0);
  const end = db.indexOf('// ── seedling_transactions', start);
  assert.ok(end > start);
  const block = db.slice(start, end);

  assert.match(block, /INSERT INTO daily_ritual_cache[\s\S]*\bdata\b/i);
  assert.match(block, /\$5::jsonb/i);
  assert.match(block, /JSON\.stringify\(data === undefined \? null : data\)/);
  assert.doesNotMatch(block, /\.\.\.data/);
  assert.doesNotMatch(block, /_buildUpsert\(['"]daily_ritual_cache/);
});

test('Daily Ritual producers and consumers use row.data while Knowledge Score cache keeps its own contract', () => {
  const source = read('index.js');

  assert.match(
    source,
    /dailyRitualCache\.set\(userId, 'morning_brief', todayStr, brief\)/
  );
  assert.match(
    source,
    /const prevAnchorText = prevAnchorCache\?\.data\?\.anchor_text \|\| null/
  );
  assert.match(
    source,
    /if \(cached\?\.data\?\.explanation\) return cached\.data/
  );
  assert.match(
    source,
    /dailyRitualCache\.set\(userId, cacheKey, todayStr, \{\s*explanation,\s*sources:/m
  );

  const ksMatches = source.match(/if \(cached\) return cached;/g) || [];
  assert.ok(ksMatches.length >= 2, 'Knowledge Score cache contract was accidentally changed');
});

test('dashboard ritual hydration is asynchronous, single-flight and preserves hydrated values across revalidation', () => {
  const html = read('index.html');

  assert.match(html, /const _DASH_RITUAL_RETRY_COOLDOWN_MS = 60 \* 1000/);
  assert.match(html, /_dashboardRitualHydration = \{/);
  assert.match(html, /if \(state\.promise\) return state\.promise/);
  assert.match(html, /_withHydratedDashboardRituals\(freshData\)/);
  assert.match(html, /_hydrateDashboardRitual\(\s*"morningBrief",\s*\(\) => api\.getMorningBrief\(\)/m);
  assert.match(html, /_hydrateDashboardRitual\(\s*"weeklyAnchor",\s*\(\) => api\.getWeeklyAnchor\(\)/m);

  const renderStart = html.indexOf('async function renderDashboard()');
  assert.ok(renderStart >= 0);
  const render = html.slice(renderStart, renderStart + 6500);
  assert.match(render, /_hydrateMissingDashboardRituals/);
  assert.doesNotMatch(render, /await\s+api\.getMorningBrief\(/);
  assert.doesNotMatch(render, /await\s+api\.getWeeklyAnchor\(/);
});

test('Morning Brief and Study Task background generation are Lite-first without downgrading assessment quality', () => {
  const { AI_TASKS, AI_EXECUTION_LANES, MODEL_POLICIES, QUALITY_FLOORS } =
    require('../../services/ai/task-registry');

  for (const taskId of ['MORNING_BRIEF', 'STUDY_TASK_GENERATION']) {
    const task = AI_TASKS[taskId];
    assert.equal(task.executionLane, AI_EXECUTION_LANES.BACKGROUND, taskId);
    assert.equal(task.modelPolicy, MODEL_POLICIES.TOP_STABLE_FLASH_LITE, taskId);
    assert.equal(task.qualityFloor, QUALITY_FLOORS.FLASH_LITE, taskId);
  }

  for (const taskId of ['MAIN_CBT', 'RECKONING_CBT', 'CBT_COMPLETION']) {
    assert.equal(AI_TASKS[taskId].qualityFloor, QUALITY_FLOORS.FLASH, taskId);
    assert.equal(AI_TASKS[taskId].modelPolicy, MODEL_POLICIES.TOP_STABLE_FLASH, taskId);
  }

  assert.equal(
    AI_TASKS.DAILY_INVITATIONS.executionLane,
    AI_EXECUTION_LANES.INTERACTIVE
  );
  assert.equal(
    AI_TASKS.DAILY_INVITATIONS.modelPolicy,
    MODEL_POLICIES.VIP_STABLE_FLASH
  );
});

test('nightly AI synthesis skips dormant and guest accounts for both background features', () => {
  const source = read('index.js');
  const cronStart = source.indexOf("cron.schedule('0 3 * * *'");
  assert.ok(cronStart >= 0);
  const cron = source.slice(cronStart, cronStart + 9000);

  const inactivityRule =
    /user\.is_guest \|\| \(user\.last_login_at && daysSince\(user\.last_login_at\) > 14\)/g;
  const matches = cron.match(inactivityRule) || [];
  assert.equal(matches.length, 2);
  assert.match(cron, /Morning briefs prepared: \$\{generated\}; skipped inactive\/guest:/);
  assert.match(cron, /Study tasks prepared: \$\{generated\}; skipped inactive\/guest:/);
});
