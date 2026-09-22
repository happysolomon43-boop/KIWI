'use strict';

const FOCUS_STAGES = Object.freeze({
  DORMANT: 'Dormant',
  WAKING: 'Waking',
  GROWING: 'Growing',
  THRIVING: 'Thriving',
  BLOOMING: 'Blooming',
  FRUITING: 'Fruiting',
});

const TREE_GROWTH_THRESHOLDS = Object.freeze([
  { stage: 1, growthPoints: 0, label: 'SEEDLING' },
  { stage: 2, growthPoints: 25, label: 'SPROUT' },
  { stage: 3, growthPoints: 100, label: 'SAPLING' },
  { stage: 4, growthPoints: 300, label: 'YOUNG TREE' },
  { stage: 5, growthPoints: 700, label: 'THRIVING' },
  { stage: 6, growthPoints: 1200, label: 'BLOOMING' },
  { stage: 7, growthPoints: 2000, label: 'MATURE' },
  { stage: 8, growthPoints: 3000, label: 'ANCIENT' },
]);

const CARD_GROWTH_MILESTONES = Object.freeze([
  { stage: 2, growthPoints: 1, seedlings: 0 },
  { stage: 3, growthPoints: 2, seedlings: 0 },
  { stage: 4, growthPoints: 3, seedlings: 0 },
  { stage: 5, growthPoints: 5, seedlings: 1 },
]);

function clamp(value, min, max) {
  const n = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function computeSessionQuality(input) {
  const uniqueCards = Math.max(0, Number(input.uniqueCards) || 0);
  const cardsReviewed = Math.max(0, Number(input.cardsReviewed) || 0);
  const activeSeconds = Math.max(0, Number(input.activeSeconds) || 0);
  const elapsedSeconds = Math.max(0, Number(input.elapsedSeconds) || 0);
  const averageResponseMs = Math.max(0, Number(input.averageResponseMs) || 0);
  const focusRatio = elapsedSeconds > 0 ? clamp(activeSeconds / elapsedSeconds, 0, 1) : 0;

  // Card dwell is deliberately neutral for the first ~30s, then tapers smoothly.
  // This makes "leave the card open for minutes" reduce Focus without punishing a
  // learner for taking a reasonable amount of time on a difficult card.
  const paceEfficiency = averageResponseMs > 0
    ? clamp(1 - Math.max(0, averageResponseMs - 30000) / 90000, 0, 1)
    : 0.65;
  const breakdown = {
    meaningful_work: round2(Math.min(uniqueCards / 20, 1) * 30),
    active_focus: round2(Math.min(activeSeconds / 1500, 1) * 25),
    attention: round2(focusRatio * 15),
    pace_efficiency: round2(paceEfficiency * 20),
    goal_progress: round2(Math.min(cardsReviewed / 25, 1) * 10),
  };
  let score = Math.round(clamp(
    breakdown.meaningful_work +
      breakdown.active_focus +
      breakdown.attention +
      breakdown.pace_efficiency +
      breakdown.goal_progress,
    0,
    100
  ));

  // High Focus tiers require enough evidence. Fast tapping can count as activity
  // for the streak, but it cannot manufacture a high-quality Focus Seed.
  if (uniqueCards < 5 || activeSeconds < 300) score = Math.min(score, 39);
  if (uniqueCards < 10 || activeSeconds < 600) score = Math.min(score, 59);
  if (uniqueCards < 15 || activeSeconds < 900) score = Math.min(score, 74);
  return { score, breakdown, focusRatio: round2(focusRatio), paceEfficiency: round2(paceEfficiency) };
}

function focusStageForQuality(score) {
  const q = clamp(score, 0, 100);
  if (q >= 85) return FOCUS_STAGES.FRUITING;
  if (q >= 75) return FOCUS_STAGES.BLOOMING;
  if (q >= 60) return FOCUS_STAGES.THRIVING;
  if (q >= 40) return FOCUS_STAGES.GROWING;
  if (q >= 20) return FOCUS_STAGES.WAKING;
  return FOCUS_STAGES.DORMANT;
}

function isMeaningfulSession(input) {
  const uniqueCards = Math.max(0, Number(input && input.uniqueCards) || 0);
  const activeSeconds = Math.max(0, Number(input && input.activeSeconds) || 0);
  return uniqueCards >= 5 && activeSeconds >= 300;
}

function qualifiesForActiveDay(input) {
  const uniqueCards = Math.max(0, Number(input && input.uniqueCards) || 0);
  const cardsReviewed = Math.max(0, Number(input && input.cardsReviewed) || 0);
  const activeSeconds = Math.max(0, Number(input && input.activeSeconds) || 0);
  return activeSeconds >= 60 && (uniqueCards >= 3 || cardsReviewed >= 5);
}

function qualifiesForFruit(input) {
  return Boolean(
    input &&
    input.meaningfulSession &&
    Number(input.qualityScore) >= 85 &&
    Number(input.uniqueCards) >= 15 &&
    Number(input.activeSeconds) >= 1200 &&
    Number(input.focusRatio) >= 0.70
  );
}


function computeTreeStage(growthPoints) {
  const points = Math.max(0, Number(growthPoints) || 0);
  let stage = 1;
  for (const threshold of TREE_GROWTH_THRESHOLDS) {
    if (points >= threshold.growthPoints) stage = threshold.stage;
  }
  return stage;
}

function nextTreeStage(stats) {
  const points = Math.max(0, Number(stats && stats.growth_points) || 0);
  const currentStage = Math.max(1, Number(stats && stats.tree_stage) || computeTreeStage(points));
  const next = TREE_GROWTH_THRESHOLDS.find(function (item) {
    return item.stage === currentStage + 1;
  });
  if (!next) return null;
  return {
    next_stage: next.stage,
    next_stage_label: next.label,
    current_growth_points: points,
    target_growth_points: next.growthPoints,
    growth_points_needed: Math.max(0, next.growthPoints - points),
  };
}

function normalizeLocalDate(value, now) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return today.toISOString().slice(0, 10);
  }
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || Math.abs(parsed.getTime() - today.getTime()) > 86400000) {
    return today.toISOString().slice(0, 10);
  }
  return value;
}

function dayDifference(laterDate, earlierDate) {
  if (!earlierDate) return null;
  const later = new Date(String(laterDate).slice(0, 10) + 'T00:00:00.000Z');
  const earlier = new Date(String(earlierDate).slice(0, 10) + 'T00:00:00.000Z');
  if (!Number.isFinite(later.getTime()) || !Number.isFinite(earlier.getTime())) return null;
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

function createEcosystemV2(options) {
  const pool = options.pool;
  const query = options.query;
  const randomUUID = options.randomUUID;

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function migrate() {
    const statements = [
      "ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS growth_points integer DEFAULT 0",
      "ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS ecosystem_version integer DEFAULT 2",
      "ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS last_active_date date",
      "ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS fruit_count integer DEFAULT 0",
      "ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS streak_shields_consumed integer DEFAULT 0",
      "ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS streak_milestone_rings jsonb DEFAULT '[]'",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_quality numeric DEFAULT 0",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_seconds integer DEFAULT 0",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS focus_ratio numeric DEFAULT 0",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS unique_cards_reviewed integer DEFAULT 0",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS meaningful_session boolean DEFAULT false",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS finalized_at timestamptz",
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS final_outcome jsonb",
      "ALTER TABLE seedling_transactions ADD COLUMN IF NOT EXISTS event_key text",
      "ALTER TABLE seedling_transactions ADD COLUMN IF NOT EXISTS event_type text",
      "ALTER TABLE seedling_transactions ADD COLUMN IF NOT EXISTS description text",
      "ALTER TABLE seedling_transactions ADD COLUMN IF NOT EXISTS balance_after integer DEFAULT 0",
      "ALTER TABLE seedling_transactions ADD COLUMN IF NOT EXISTS type text",
      "ALTER TABLE seedling_transactions ADD COLUMN IF NOT EXISTS reason text",
      "CREATE TABLE IF NOT EXISTS progression_events (" +
        "event_key text PRIMARY KEY, user_id text NOT NULL, event_type text NOT NULL, " +
        "subject_id text, session_id text, growth_points integer DEFAULT 0, seedlings integer DEFAULT 0, " +
        "metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT NOW())",
      "CREATE TABLE IF NOT EXISTS ecosystem_seedling_ledger (" +
        "event_key text PRIMARY KEY, user_id text NOT NULL, amount integer NOT NULL, " +
        "balance_after integer NOT NULL, event_type text NOT NULL, description text, " +
        "created_at timestamptz DEFAULT NOW())",
      "CREATE TABLE IF NOT EXISTS card_growth_milestones (" +
        "event_key text PRIMARY KEY, user_id text NOT NULL, card_id text NOT NULL, " +
        "stage integer NOT NULL, growth_points integer DEFAULT 0, seedlings integer DEFAULT 0, " +
        "session_id text, created_at timestamptz DEFAULT NOW())",
      "CREATE TABLE IF NOT EXISTS daily_activity (" +
        "id text PRIMARY KEY, user_id text NOT NULL, activity_date date NOT NULL, " +
        "meaningful_sessions integer DEFAULT 0, active_seconds integer DEFAULT 0, cards_reviewed integer DEFAULT 0, " +
        "created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), " +
        "UNIQUE(user_id, activity_date))",
      "CREATE TABLE IF NOT EXISTS fruits (" +
        "id text PRIMARY KEY, session_id text NOT NULL UNIQUE, user_id text NOT NULL, subject_id text, " +
        "quality_score numeric NOT NULL, quality_tier text NOT NULL, active_seconds integer NOT NULL, " +
        "unique_cards integer NOT NULL, ks_delta numeric DEFAULT 0, created_at timestamptz DEFAULT NOW())",
      "CREATE TABLE IF NOT EXISTS session_outcomes (" +
        "session_id text PRIMARY KEY, user_id text NOT NULL, subject_id text, quality_score numeric NOT NULL, " +
        "quality_breakdown jsonb NOT NULL, focus_stage text NOT NULL, elapsed_seconds integer NOT NULL, " +
        "active_seconds integer NOT NULL, focus_ratio numeric NOT NULL, unique_cards integer NOT NULL, " +
        "meaningful_session boolean NOT NULL, fruit_id text, seedlings_earned integer DEFAULT 0, " +
        "growth_points_earned integer DEFAULT 0, vitality_after integer NOT NULL, tree_stage_after integer NOT NULL, " +
        "outcome jsonb NOT NULL, created_at timestamptz DEFAULT NOW())",
      "UPDATE seedling_transactions SET " +
        "type = COALESCE(NULLIF(type,''), event_type), reason = COALESCE(reason, description), " +
        "event_type = COALESCE(NULLIF(event_type,''), NULLIF(type,''), 'unspecified'), " +
        "description = COALESCE(description, reason) " +
        "WHERE type IS DISTINCT FROM COALESCE(NULLIF(type,''), event_type) " +
        "OR reason IS DISTINCT FROM COALESCE(reason, description) " +
        "OR event_type IS NULL OR BTRIM(event_type) = '' OR description IS NULL",
      "CREATE OR REPLACE FUNCTION kiwi_sync_seedling_transaction_fields() RETURNS trigger " +
        "LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN " +
        "NEW.event_type := COALESCE(NULLIF(BTRIM(NEW.event_type), ''), NULLIF(BTRIM(NEW.type), ''), 'unspecified'); " +
        "NEW.type := NEW.event_type; NEW.description := COALESCE(NEW.description, NEW.reason); " +
        "NEW.reason := NEW.description; RETURN NEW; END; $$",
      "REVOKE EXECUTE ON FUNCTION kiwi_sync_seedling_transaction_fields() FROM PUBLIC, anon, authenticated",
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger " +
        "WHERE tgname = 'kiwi_sync_seedling_transaction_fields' AND NOT tgisinternal) THEN " +
        "CREATE TRIGGER kiwi_sync_seedling_transaction_fields BEFORE INSERT ON seedling_transactions " +
        "FOR EACH ROW EXECUTE FUNCTION kiwi_sync_seedling_transaction_fields(); END IF; END $$",
      "ALTER TABLE progression_events ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE ecosystem_seedling_ledger ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE card_growth_milestones ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE daily_activity ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE fruits ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE session_outcomes ENABLE ROW LEVEL SECURITY",
      "CREATE UNIQUE INDEX IF NOT EXISTS seedling_transactions_event_key_idx ON seedling_transactions(event_key)",
      "CREATE INDEX IF NOT EXISTS progression_events_user_idx ON progression_events(user_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS progression_events_session_idx ON progression_events(session_id)",
      "CREATE INDEX IF NOT EXISTS daily_activity_user_date_idx ON daily_activity(user_id, activity_date DESC)",
      "CREATE INDEX IF NOT EXISTS fruits_user_idx ON fruits(user_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS session_outcomes_user_idx ON session_outcomes(user_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS ecosystem_seedling_ledger_user_idx " +
        "ON ecosystem_seedling_ledger(user_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS card_growth_milestones_user_card_idx " +
        "ON card_growth_milestones(user_id, card_id, stage)",
      "DO $$ BEGIN " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_stats_ecosystem_ranges_ck' " +
        "AND conrelid = 'user_stats'::regclass) THEN ALTER TABLE user_stats ADD CONSTRAINT " +
        "user_stats_ecosystem_ranges_ck CHECK (COALESCE(growth_points,0) >= 0 AND tree_stage BETWEEN 1 AND 8 " +
        "AND tree_health BETWEEN 0 AND 100 AND seedlings_balance >= 0 AND fruit_count >= 0 " +
        "AND streak_shields_held BETWEEN 0 AND 3 AND COALESCE(streak_shields_consumed,0) >= 0); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_ecosystem_ranges_ck' " +
        "AND conrelid = 'sessions'::regclass) THEN ALTER TABLE sessions ADD CONSTRAINT " +
        "sessions_ecosystem_ranges_ck CHECK (COALESCE(session_quality,0) BETWEEN 0 AND 100 " +
        "AND COALESCE(active_seconds,0) >= 0 AND COALESCE(focus_ratio,0) BETWEEN 0 AND 1 " +
        "AND COALESCE(unique_cards_reviewed,0) >= 0); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progression_events_amounts_ck' " +
        "AND conrelid = 'progression_events'::regclass) THEN ALTER TABLE progression_events ADD CONSTRAINT " +
        "progression_events_amounts_ck CHECK (COALESCE(growth_points,0) >= 0); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecosystem_seedling_ledger_balance_ck' " +
        "AND conrelid = 'ecosystem_seedling_ledger'::regclass) THEN ALTER TABLE ecosystem_seedling_ledger " +
        "ADD CONSTRAINT ecosystem_seedling_ledger_balance_ck CHECK (balance_after >= 0); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_growth_milestones_ranges_ck' " +
        "AND conrelid = 'card_growth_milestones'::regclass) THEN ALTER TABLE card_growth_milestones " +
        "ADD CONSTRAINT card_growth_milestones_ranges_ck CHECK (stage BETWEEN 2 AND 5 " +
        "AND COALESCE(growth_points,0) >= 0 AND COALESCE(seedlings,0) >= 0); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_activity_nonnegative_ck' " +
        "AND conrelid = 'daily_activity'::regclass) THEN ALTER TABLE daily_activity ADD CONSTRAINT " +
        "daily_activity_nonnegative_ck CHECK (COALESCE(meaningful_sessions,0) >= 0 " +
        "AND COALESCE(active_seconds,0) >= 0 AND COALESCE(cards_reviewed,0) >= 0); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fruits_qualification_ck' " +
        "AND conrelid = 'fruits'::regclass) THEN ALTER TABLE fruits ADD CONSTRAINT " +
        "fruits_qualification_ck CHECK (quality_score BETWEEN 85 AND 100 " +
        "AND active_seconds >= 1200 AND unique_cards >= 15); END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_outcomes_ranges_ck' " +
        "AND conrelid = 'session_outcomes'::regclass) THEN ALTER TABLE session_outcomes ADD CONSTRAINT " +
        "session_outcomes_ranges_ck CHECK (quality_score BETWEEN 0 AND 100 AND elapsed_seconds >= 0 " +
        "AND active_seconds BETWEEN 0 AND elapsed_seconds AND focus_ratio BETWEEN 0 AND 1 " +
        "AND unique_cards >= 0 AND COALESCE(seedlings_earned,0) >= 0 " +
        "AND COALESCE(growth_points_earned,0) >= 0 AND vitality_after BETWEEN 0 AND 100 " +
        "AND tree_stage_after BETWEEN 1 AND 8); END IF; END $$",

      "UPDATE user_stats SET last_active_date = last_study_date::date " +
        "WHERE last_active_date IS NULL AND last_study_date IS NOT NULL",
      "UPDATE user_stats SET growth_points = CASE " +
        "WHEN tree_stage >= 8 THEN 3000 WHEN tree_stage = 7 THEN 2000 WHEN tree_stage = 6 THEN 1200 " +
        "WHEN tree_stage = 5 THEN 700 WHEN tree_stage = 4 THEN 300 WHEN tree_stage = 3 THEN 100 " +
        "WHEN tree_stage = 2 THEN 25 ELSE 0 END " +
        "WHERE COALESCE(growth_points,0) = 0 AND COALESCE(tree_stage,1) > 1",
    ];
    for (const statement of statements) await query(statement);
  }

  async function recordEvent(client, event) {
    const insert = await client.query(
      "INSERT INTO progression_events " +
      "(event_key, user_id, event_type, subject_id, session_id, growth_points, seedlings, metadata, created_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (event_key) DO NOTHING RETURNING event_key",
      [
        event.eventKey,
        event.userId,
        event.eventType,
        event.subjectId || null,
        event.sessionId || null,
        Number(event.growthPoints) || 0,
        Number(event.seedlings) || 0,
        JSON.stringify(event.metadata || {}),
      ]
    );
    if (insert.rowCount === 0) return { applied: false, growthPoints: 0, seedlings: 0 };

    const growthPoints = Number(event.growthPoints) || 0;
    const seedlings = Number(event.seedlings) || 0;
    const updated = await client.query(
      "UPDATE user_stats SET growth_points = COALESCE(growth_points,0) + $2, " +
      "seedlings_balance = COALESCE(seedlings_balance,0) + $3, ecosystem_version = 2, updated_at = NOW() " +
      "WHERE user_id = $1 RETURNING growth_points, seedlings_balance",
      [event.userId, growthPoints, seedlings]
    );
    if (updated.rowCount === 0) throw new Error('User stats missing during ecosystem event');

    if (seedlings !== 0) {
      await client.query(
        "INSERT INTO ecosystem_seedling_ledger " +
        "(event_key, user_id, amount, balance_after, event_type, description, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (event_key) DO NOTHING",
        [
          event.eventKey,
          event.userId,
          seedlings,
          Number(updated.rows[0].seedlings_balance) || 0,
          event.eventType,
          event.description || null,
        ]
      );
      await client.query(
        "INSERT INTO seedling_transactions " +
        "(id, user_id, type, amount, reason, event_key, event_type, description, balance_after, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (event_key) DO NOTHING",
        [
          randomUUID(),
          event.userId,
          event.eventType,
          seedlings,
          event.description || null,
          event.eventKey,
          event.eventType,
          event.description || null,
          Number(updated.rows[0].seedlings_balance) || 0,
        ]
      );
    }
    return {
      applied: true,
      growthPoints: growthPoints,
      seedlings: seedlings,
      growthPointsTotal: Number(updated.rows[0].growth_points) || 0,
      seedlingsBalance: Number(updated.rows[0].seedlings_balance) || 0,
    };
  }

  async function awardSeedlingsForEvent(userId, input) {
    if (!input || !input.eventKey) throw new Error('Stable eventKey is required for a Seedling award');
    return transaction(async function (client) {
      await client.query("SELECT user_id FROM user_stats WHERE user_id = $1 FOR UPDATE", [userId]);
      return recordEvent(client, {
        eventKey: input.eventKey,
        userId: userId,
        eventType: input.eventType || 'seedling_award',
        subjectId: input.subjectId || null,
        sessionId: input.sessionId || null,
        growthPoints: 0,
        seedlings: Math.max(0, Number(input.amount) || 0),
        description: input.description || null,
        metadata: input.metadata || {},
      });
    });
  }

  async function applyCardGrowthMilestonesInTransaction(client, input) {
    let growthPoints = 0;
    let seedlings = 0;
    const targetStage = Math.max(1, Math.min(5, Number(input.newStage) || 1));
    for (const milestone of CARD_GROWTH_MILESTONES) {
      if (milestone.stage > targetStage) continue;
      const eventKey = 'card-growth:' + input.userId + ':' + input.cardId + ':' + milestone.stage;
      const milestoneInsert = await client.query(
        "INSERT INTO card_growth_milestones " +
        "(event_key, user_id, card_id, stage, growth_points, seedlings, session_id, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (event_key) DO NOTHING RETURNING event_key",
        [
          eventKey,
          input.userId,
          input.cardId,
          milestone.stage,
          milestone.growthPoints,
          milestone.seedlings,
          input.sessionId || null,
        ]
      );
      if (milestoneInsert.rowCount === 0) continue;
      const result = await recordEvent(client, {
        eventKey: eventKey,
        userId: input.userId,
        eventType: 'card_stage_milestone',
        sessionId: input.sessionId || null,
        growthPoints: milestone.growthPoints,
        seedlings: milestone.seedlings,
        description: milestone.stage === 5 ? 'First Stage 5 mastery for this card' : 'First arrival at card Stage ' + milestone.stage,
        metadata: { card_id: input.cardId, stage: milestone.stage },
      });
      growthPoints += result.growthPoints;
      seedlings += result.seedlings;
    }
    return { growthPoints: growthPoints, seedlings: seedlings };
  }

  async function updateTreeStageInTransaction(client, userId) {
    const result = await client.query(
      "SELECT growth_points, tree_stage FROM user_stats WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (result.rowCount === 0) throw new Error('User stats missing during tree update');
    const stats = result.rows[0];
    const earnedStage = computeTreeStage(stats.growth_points);
    const stage = Math.max(Number(stats.tree_stage) || 1, earnedStage);
    await client.query(
      "UPDATE user_stats SET tree_stage = $2, ecosystem_version = 2, updated_at = NOW() WHERE user_id = $1",
      [userId, stage]
    );
    return stage;
  }

  async function awardCardGrowthMilestones(userId, cardId, newStage, sessionId) {
    return transaction(async function (client) {
      await client.query("SELECT user_id FROM user_stats WHERE user_id = $1 FOR UPDATE", [userId]);
      const result = await applyCardGrowthMilestonesInTransaction(client, {
        userId: userId,
        cardId: cardId,
        newStage: newStage,
        sessionId: sessionId || null,
      });
      const treeStage = await updateTreeStageInTransaction(client, userId);
      return Object.assign({}, result, { treeStage: treeStage });
    });
  }

  async function computeVitalityInTransaction(client, userId, currentQuality) {
    const memoryResult = await client.query(
      "SELECT COUNT(*)::int AS total, AVG(CASE state " +
      "WHEN 'VERIFIED' THEN 100 WHEN 'SEEDLING' THEN 55 WHEN 'FRAGILE' THEN 45 " +
      "WHEN 'STUCK' THEN 30 WHEN 'AVOIDED' THEN 20 WHEN 'DANGEROUS' THEN 10 " +
      "WHEN 'GHOST' THEN 5 ELSE 50 END)::numeric AS score FROM card_states WHERE user_id = $1",
      [userId]
    );
    const memoryCondition = Number(memoryResult.rows[0].total) > 0
      ? clamp(memoryResult.rows[0].score, 0, 100)
      : 100;

    const activityResult = await client.query(
      "SELECT COUNT(DISTINCT activity_date)::int AS days FROM daily_activity " +
      "WHERE user_id = $1 AND activity_date >= CURRENT_DATE - INTERVAL '6 days' " +
      "AND (meaningful_sessions > 0 OR (cards_reviewed >= 3 AND active_seconds >= 60))",
      [userId]
    );
    const activeDays = clamp(activityResult.rows[0].days, 0, 7);
    const consistency = round2((activeDays / 7) * 100);

    const pressureResult = await client.query(
      "SELECT AVG(LEAST(100, GREATEST(0, COALESCE(bp.pressure_score,0))))::numeric AS score " +
      "FROM brain_pressure bp JOIN subjects s ON s.id = bp.subject_id AND s.user_id = bp.user_id " +
      "WHERE bp.user_id = $1",
      [userId]
    );
    const averagePressure = pressureResult.rows[0].score == null
      ? 0
      : clamp(pressureResult.rows[0].score, 0, 100);
    const calmness = round2(100 - averagePressure);

    const recentResult = await client.query(
      "SELECT quality_score FROM session_outcomes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5",
      [userId]
    );
    const recentQualities = recentResult.rows.map(function (row) {
      return clamp(row.quality_score, 0, 100);
    });
    if (currentQuality != null) {
      recentQualities.unshift(clamp(currentQuality, 0, 100));
      if (recentQualities.length > 5) recentQualities.length = 5;
    }
    const sessionQuality = recentQualities.length
      ? round2(recentQualities.reduce(function (sum, value) { return sum + value; }, 0) / recentQualities.length)
      : 100;

    const vitality = Math.round(clamp(
      memoryCondition * 0.40 + consistency * 0.25 + calmness * 0.20 + sessionQuality * 0.15,
      0,
      100
    ));
    return {
      vitality: vitality,
      breakdown: {
        memory_condition: round2(memoryCondition),
        seven_day_consistency: consistency,
        calmness: calmness,
        recent_session_quality: sessionQuality,
      },
    };
  }

  async function refreshVitality(userId) {
    return transaction(async function (client) {
      await client.query("SELECT user_id FROM user_stats WHERE user_id = $1 FOR UPDATE", [userId]);
      const result = await computeVitalityInTransaction(client, userId, null);
      await client.query(
        "UPDATE user_stats SET tree_health = $2, ecosystem_version = 2, updated_at = NOW() WHERE user_id = $1",
        [userId, result.vitality]
      );
      return result;
    });
  }

  async function updateStreakForActiveDay(client, stats, localDate, sessionId) {
    const gap = dayDifference(localDate, stats.last_active_date);
    let streak = Number(stats.current_streak) || 0;
    let consumed = Number(stats.streak_shields_consumed) || 0;
    let held = Number(stats.streak_shields_held) || 0;

    if (gap === null) {
      streak = 1;
    } else if (gap === 1) {
      streak += 1;
    } else if (gap === 2 && held > 0) {
      held -= 1;
      consumed += 1;
      streak += 1;
    } else if (gap !== 0) {
      streak = 1;
    }

    const longest = Math.max(Number(stats.longest_streak) || 0, streak);
    const earned = Math.floor(longest / 30);
    held = Math.min(3, Math.max(held, earned - consumed));

    const existingMilestones = Array.isArray(stats.streak_milestones_earned)
      ? stats.streak_milestones_earned.map(Number)
      : [];
    const milestones = [7, 30, 100, 365];
    const newlyEarned = milestones.filter(function (value) {
      return streak >= value && !existingMilestones.includes(value);
    });
    const allEarned = Array.from(new Set(existingMilestones.concat(newlyEarned))).sort(function (a, b) {
      return a - b;
    });

    for (const milestone of newlyEarned) {
      const seedlingReward = milestone >= 365 ? 20 : milestone >= 100 ? 10 : milestone >= 30 ? 5 : 2;
      await recordEvent(client, {
        eventKey: 'streak-milestone:' + stats.user_id + ':' + milestone,
        userId: stats.user_id,
        eventType: 'streak_milestone',
        sessionId: sessionId || null,
        growthPoints: 0,
        seedlings: seedlingReward,
        description: milestone + '-day streak milestone',
        metadata: { days: milestone, local_date: localDate },
      });
    }

    await client.query(
      "UPDATE user_stats SET current_streak = $2, longest_streak = $3, " +
      "last_active_date = $4::date, last_study_date = NOW(), streak_shields_held = $5, " +
      "streak_shields_earned = $6, streak_shields_consumed = $7, " +
      "streak_milestones_earned = $8, streak_milestone_rings = $8, updated_at = NOW() " +
      "WHERE user_id = $1",
      [stats.user_id, streak, longest, localDate, held, earned, consumed, JSON.stringify(allEarned)]
    );
    return {
      current: streak,
      longest: longest,
      shieldConsumed: gap === 2 && Number(stats.streak_shields_held) > held,
      newMilestones: newlyEarned,
    };
  }

  async function finalizeSession(input) {
    const now = new Date();
    return transaction(async function (client) {
      const sessionResult = await client.query(
        "SELECT * FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [input.sessionId, input.userId]
      );
      if (sessionResult.rowCount === 0) {
        const error = new Error('Session not found');
        error.statusCode = 404;
        throw error;
      }
      const session = sessionResult.rows[0];
      if (session.final_outcome) return session.final_outcome;

      const startedAt = new Date(session.started_at);
      const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
      const hasFocusedSeconds = input.focusedSeconds !== undefined && input.focusedSeconds !== null && input.focusedSeconds !== '';
      const reportedFocused = Number(input.focusedSeconds);
      const reportedIdle = Math.max(0, Number(input.idleSeconds) || 0);
      const activeSeconds = Math.round(clamp(
        hasFocusedSeconds && Number.isFinite(reportedFocused)
          ? reportedFocused
          : elapsedSeconds - reportedIdle,
        0,
        elapsedSeconds
      ));

      const reviewResult = await client.query(
        "SELECT COUNT(*)::int AS reviews, COUNT(DISTINCT card_id)::int AS unique_cards, " +
        "AVG(NULLIF(LEAST(GREATEST(COALESCE(response_time_ms,0),0),120000),0))::numeric AS average_response_ms " +
        "FROM review_logs WHERE user_id = $1 AND session_id = $2",
        [input.userId, input.sessionId]
      );
      const cardsReviewed = Math.max(Number(session.cards_reviewed) || 0, Number(reviewResult.rows[0].reviews) || 0);
      const uniqueCards = Number(reviewResult.rows[0].unique_cards) || 0;
      const averageResponseMs = Number(reviewResult.rows[0].average_response_ms) || 0;
      const quality = computeSessionQuality({
        uniqueCards: uniqueCards,
        cardsReviewed: cardsReviewed,
        activeSeconds: activeSeconds,
        elapsedSeconds: elapsedSeconds,
        averageResponseMs: averageResponseMs,
      });
      const focusStage = focusStageForQuality(quality.score);
      const sessionCompleted = uniqueCards > 0;
      const meaningfulSession = isMeaningfulSession({ uniqueCards: uniqueCards, activeSeconds: activeSeconds });
      const activeDayQualified = qualifiesForActiveDay({
        uniqueCards: uniqueCards,
        cardsReviewed: cardsReviewed,
        activeSeconds: activeSeconds,
      });
      const exactFocusRatio = elapsedSeconds > 0 ? activeSeconds / elapsedSeconds : 0;
      const fruitQualified = qualifiesForFruit({
        meaningfulSession: meaningfulSession,
        qualityScore: quality.score,
        uniqueCards: uniqueCards,
        activeSeconds: activeSeconds,
        focusRatio: exactFocusRatio,
      });
      const localDate = normalizeLocalDate(input.localDate, now);

      const statsResult = await client.query(
        "SELECT * FROM user_stats WHERE user_id = $1 FOR UPDATE",
        [input.userId]
      );
      if (statsResult.rowCount === 0) throw new Error('User stats missing during session finalization');
      let stats = statsResult.rows[0];

      const deckResult = session.deck_id
        ? await client.query("SELECT subject_id FROM decks WHERE id = $1 AND user_id = $2 LIMIT 1", [session.deck_id, input.userId])
        : { rows: [] };
      const subjectId = deckResult.rows[0] ? deckResult.rows[0].subject_id : null;

      const reviewedCards = await client.query(
        "SELECT card_id, MAX(new_stage)::int AS max_stage FROM review_logs " +
        "WHERE user_id = $1 AND session_id = $2 GROUP BY card_id",
        [input.userId, input.sessionId]
      );
      for (const reviewed of reviewedCards.rows) {
        await applyCardGrowthMilestonesInTransaction(client, {
          userId: input.userId,
          cardId: reviewed.card_id,
          newStage: reviewed.max_stage,
          sessionId: input.sessionId,
        });
      }

      const stageRewards = {
        Thriving: { growthPoints: 1, seedlings: 1 },
        Blooming: { growthPoints: 2, seedlings: 2 },
        Fruiting: { growthPoints: 5, seedlings: 3 },
      };
      const stageReward = meaningfulSession ? stageRewards[focusStage] : null;
      if (stageReward) {
        await recordEvent(client, {
          eventKey: 'session-quality:' + input.sessionId,
          userId: input.userId,
          eventType: 'session_quality',
          subjectId: subjectId,
          sessionId: input.sessionId,
          growthPoints: stageReward.growthPoints,
          seedlings: stageReward.seedlings,
          description: focusStage + ' session quality',
          metadata: { quality_score: quality.score, focus_stage: focusStage },
        });
      }

      // Daily activity is an activity ledger, not a reward ledger. Every real
      // reviewed session contributes to the heatmap. Meaningful-session rewards
      // remain gated separately, while streaks require a modest anti-tap threshold.
      if (sessionCompleted) {
        await client.query(
          "INSERT INTO daily_activity " +
          "(id, user_id, activity_date, meaningful_sessions, active_seconds, cards_reviewed, created_at, updated_at) " +
          "VALUES ($1,$2,$3::date,$4,$5,$6,NOW(),NOW()) " +
          "ON CONFLICT (user_id, activity_date) DO UPDATE SET " +
          "meaningful_sessions = daily_activity.meaningful_sessions + EXCLUDED.meaningful_sessions, " +
          "active_seconds = daily_activity.active_seconds + EXCLUDED.active_seconds, " +
          "cards_reviewed = daily_activity.cards_reviewed + EXCLUDED.cards_reviewed, updated_at = NOW()",
          [
            input.userId + ':' + localDate,
            input.userId,
            localDate,
            meaningfulSession ? 1 : 0,
            activeSeconds,
            cardsReviewed,
          ]
        );
      }
      if (activeDayQualified) {
        const activeDayEvent = await recordEvent(client, {
          eventKey: 'active-day:' + input.userId + ':' + localDate,
          userId: input.userId,
          eventType: 'active_study_day',
          subjectId: subjectId,
          sessionId: input.sessionId,
          growthPoints: meaningfulSession ? 2 : 0,
          seedlings: 0,
          description: 'First qualifying study activity on ' + localDate,
          metadata: { local_date: localDate, meaningful_session: meaningfulSession },
        });
        if (activeDayEvent.applied) {
          const refreshedStats = await client.query(
            "SELECT * FROM user_stats WHERE user_id = $1 FOR UPDATE",
            [input.userId]
          );
          await updateStreakForActiveDay(client, refreshedStats.rows[0], localDate, input.sessionId);
        }
      }

      let fruit = null;
      if (fruitQualified) {
        const fruitId = randomUUID();
        const fruitInsert = await client.query(
          "INSERT INTO fruits " +
          "(id, session_id, user_id, subject_id, quality_score, quality_tier, active_seconds, unique_cards, ks_delta, created_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) " +
          "ON CONFLICT (session_id) DO NOTHING RETURNING *",
          [
            fruitId,
            input.sessionId,
            input.userId,
            subjectId,
            quality.score,
            focusStage,
            activeSeconds,
            uniqueCards,
            Number(input.ksDelta) || 0,
          ]
        );
        fruit = fruitInsert.rows[0] || null;
        if (fruit) {
          await client.query(
            "UPDATE user_stats SET fruit_count = COALESCE(fruit_count,0) + 1, updated_at = NOW() WHERE user_id = $1",
            [input.userId]
          );
          if (subjectId) {
            const subjectStatsId = input.userId + '_' + subjectId;
            await client.query(
              "INSERT INTO subject_stats (id, user_id, subject_id, fruit_count, updated_at) " +
              "VALUES ($1,$2,$3,1,NOW()) ON CONFLICT (id) DO UPDATE SET " +
              "fruit_count = COALESCE(subject_stats.fruit_count,0) + 1, updated_at = NOW()",
              [subjectStatsId, input.userId, subjectId]
            );
          }
        }
      }

      await client.query(
        "UPDATE user_stats SET total_sessions_completed = COALESCE(total_sessions_completed,0) + $2, " +
        "total_study_minutes = COALESCE(total_study_minutes,0) + $3, ecosystem_version = 2, updated_at = NOW() " +
        "WHERE user_id = $1",
        [input.userId, sessionCompleted ? 1 : 0, Math.round(activeSeconds / 60)]
      );

      if (subjectId && sessionCompleted) {
        await client.query(
          "INSERT INTO subject_stats (id, user_id, subject_id, last_studied_at, last_study_date, updated_at) " +
          "VALUES ($1,$2,$3,NOW(),NOW(),NOW()) ON CONFLICT (id) DO UPDATE SET " +
          "last_studied_at = NOW(), last_study_date = NOW(), updated_at = NOW()",
          [input.userId + '_' + subjectId, input.userId, subjectId]
        );
      }

      const treeStage = await updateTreeStageInTransaction(client, input.userId);
      const vitality = await computeVitalityInTransaction(client, input.userId, quality.score);
      await client.query(
        "UPDATE user_stats SET tree_health = $2, tree_stage = $3, ecosystem_version = 2, updated_at = NOW() " +
        "WHERE user_id = $1",
        [input.userId, vitality.vitality, treeStage]
      );

      const rewardResult = await client.query(
        "SELECT COALESCE(SUM(growth_points),0)::int AS growth_points, " +
        "COALESCE(SUM(seedlings),0)::int AS seedlings " +
        "FROM progression_events WHERE user_id = $1 AND session_id = $2",
        [input.userId, input.sessionId]
      );
      const finalStatsResult = await client.query(
        "SELECT * FROM user_stats WHERE user_id = $1",
        [input.userId]
      );
      stats = finalStatsResult.rows[0];
      const nextStage = nextTreeStage(stats);
      const rewards = rewardResult.rows[0];

      const outcome = {
        committed: true,
        ecosystem_version: 2,
        session_id: input.sessionId,
        session_completed: sessionCompleted,
        meaningful_session: meaningfulSession,
        duration_seconds: elapsedSeconds,
        active_seconds: activeSeconds,
        cards_reviewed: cardsReviewed,
        unique_cards_reviewed: uniqueCards,
        ks_delta: Number(input.ksDelta) || 0,
        ksDelta: Number(input.ksDelta) || 0,
        session_quality: quality.score,
        quality_breakdown: quality.breakdown,
        focus_ratio: quality.focusRatio,
        focus_seed_stage: focusStage,
        seed_survived: focusStage !== FOCUS_STAGES.DORMANT,
        fruiting_achieved: Boolean(fruit),
        fruit: fruit ? {
          id: fruit.id,
          subject_id: fruit.subject_id,
          quality_score: Number(fruit.quality_score),
          created_at: fruit.created_at,
        } : null,
        seedlings_earned: Number(rewards.seedlings) || 0,
        seedlings_balance: Number(stats.seedlings_balance) || 0,
        growth_points_earned: Number(rewards.growth_points) || 0,
        growth_points_total: Number(stats.growth_points) || 0,
        tree_stage: treeStage,
        tree_health: vitality.vitality,
        tree_vitality: vitality,
        streak: Number(stats.current_streak) || 0,
        next_stage: nextStage,
        local_date: localDate,
        new_achievements: [],
        new_almanac_unlocks: [],
        stage_transitions: [],
      };

      await client.query(
        "UPDATE sessions SET ended_at = $3, duration_seconds = $4, session_completed = $5, " +
        "seed_survived = $6, focus_breaks = $7, focus_seed_stage = $8, fruiting_achieved = $9, " +
        "ks_delta = $10, session_quality = $11, active_seconds = $12, focus_ratio = $13, " +
        "unique_cards_reviewed = $14, meaningful_session = $15, finalized_at = $3, " +
        "final_outcome = $16, updated_at = NOW() WHERE id = $1 AND user_id = $2",
        [
          input.sessionId,
          input.userId,
          now,
          elapsedSeconds,
          sessionCompleted,
          outcome.seed_survived,
          Math.max(0, Number(input.breakCount) || 0),
          focusStage,
          Boolean(fruit),
          Number(input.ksDelta) || 0,
          quality.score,
          activeSeconds,
          quality.focusRatio,
          uniqueCards,
          meaningfulSession,
          JSON.stringify(outcome),
        ]
      );

      await client.query(
        "INSERT INTO session_outcomes " +
        "(session_id, user_id, subject_id, quality_score, quality_breakdown, focus_stage, elapsed_seconds, " +
        "active_seconds, focus_ratio, unique_cards, meaningful_session, fruit_id, seedlings_earned, " +
        "growth_points_earned, vitality_after, tree_stage_after, outcome, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()) " +
        "ON CONFLICT (session_id) DO NOTHING",
        [
          input.sessionId,
          input.userId,
          subjectId,
          quality.score,
          JSON.stringify(quality.breakdown),
          focusStage,
          elapsedSeconds,
          activeSeconds,
          quality.focusRatio,
          uniqueCards,
          meaningfulSession,
          fruit ? fruit.id : null,
          Number(rewards.seedlings) || 0,
          Number(rewards.growth_points) || 0,
          vitality.vitality,
          treeStage,
          JSON.stringify(outcome),
        ]
      );
      return outcome;
    });
  }

  return {
    FOCUS_STAGES: FOCUS_STAGES,
    TREE_GROWTH_THRESHOLDS: TREE_GROWTH_THRESHOLDS,
    migrate: migrate,
    finalizeSession: finalizeSession,
    refreshVitality: refreshVitality,
    awardCardGrowthMilestones: awardCardGrowthMilestones,
    awardSeedlingsForEvent: awardSeedlingsForEvent,
    computeSessionQuality: computeSessionQuality,
    focusStageForQuality: focusStageForQuality,
    isMeaningfulSession: isMeaningfulSession,
    qualifiesForActiveDay: qualifiesForActiveDay,
    qualifiesForFruit: qualifiesForFruit,
    computeTreeStage: computeTreeStage,
    nextTreeStage: nextTreeStage,
  };
}

module.exports = {
  createEcosystemV2,
  FOCUS_STAGES,
  TREE_GROWTH_THRESHOLDS,
  CARD_GROWTH_MILESTONES,
  computeSessionQuality,
  focusStageForQuality,
  isMeaningfulSession,
  qualifiesForActiveDay,
  qualifiesForFruit,
  computeTreeStage,
  nextTreeStage,
};
