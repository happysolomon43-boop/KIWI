// ── PostgreSQL (Supabase) — replaces Firebase Admin SDK ──────────────────────
// Connection via DATABASE_URL env var; ssl required for Supabase
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Thin query wrapper — pool.query returns { rows, rowCount }
const query = (text, params) => pool.query(text, params);

// Transaction helper
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Dynamic SQL builders ─────────────────────────────────────────────────────
// Used for tables where the route handler passes an arbitrary data spread.
// This is a structural necessity of SQL (explicit columns required) and is NOT
// a business-logic change. Preserves the exact Firestore .set(payload) semantics.

function _buildInsert(table, obj) {
  const keys = Object.keys(obj);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const vals = keys.map(k => {
    const v = obj[k];
    return (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
      ? JSON.stringify(v) : v;
  });
  return { text: `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, values: vals };
}

function _buildUpdate(table, whereCol, whereVal, obj, userId = null) {
  // Detects { increment: N } values and emits `"field" = "field" + $N` clauses.
  // This allows any db.X.update() call to receive FieldValue.increment-style objects.
  const setClauses = [];
  const vals = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && v.increment !== undefined) {
      setClauses.push(`"${k}" = "${k}" + ${vals.length + 1}`);
      vals.push(v.increment);
    } else {
      const val = (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
        ? JSON.stringify(v) : v;
      setClauses.push(`"${k}" = ${vals.length + 1}`);
      vals.push(val);
    }
  }
  vals.push(whereVal);
  let whereClause = `WHERE "${whereCol}" = ${vals.length}`;
  if (userId !== undefined && userId !== null) {
    vals.push(userId);
    whereClause += ` AND "user_id" = ${vals.length}`;
  }
  return {
    text: `UPDATE ${table} SET ${setClauses.join(', ')} ${whereClause}`,
    values: vals,
  };
}

function _buildUpsert(table, conflictCols, obj) {
  const keys = Object.keys(obj);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const conflict = Array.isArray(conflictCols) ? conflictCols.join(', ') : conflictCols;
  const updateCols = keys.filter(k => !conflictCols.includes(k));
  const setClauses = updateCols.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
  const vals = keys.map(k => {
    const v = obj[k];
    return (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
      ? JSON.stringify(v) : v;
  });
  return {
    text: `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${setClauses}`,
    values: vals,
  };
}

// ── INCREMENT builder — replaces FieldValue.increment ────────────────────────
// Detects { increment: N } objects in update payloads and emits
// "field" = "field" + $N SQL. Used in userStats.update and sessions.update.
function _buildIncrementUpdate(table, whereCol, whereVal, data) {
  const setClauses = [];
  const values = [];
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && v.increment !== undefined) {
      setClauses.push(`"${k}" = "${k}" + $${values.length + 1}`);
      values.push(v.increment);
    } else {
      setClauses.push(`"${k}" = $${values.length + 1}`);
      const val = (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
        ? JSON.stringify(v) : v;
      values.push(val);
    }
  }
  setClauses.push(`"updated_at" = NOW()`);
  values.push(whereVal);
  return {
    text: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE "${whereCol}" = $${values.length} RETURNING *`,
    values,
    hasIncrements: data && Object.values(data).some(v =>
      v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && v.increment !== undefined
    ),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  INLINE DB LAYER (replaces firestore-db)

// ════════════════════════════════════════════════════════════════════════════
const db = {
// ── users ───────────────────────────────────────────────────────────────────
users: {
async findById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
},
async findByUsernameOrEmail(username, email) {
  const { rows } = await query(
    'SELECT * FROM users WHERE username = $1 OR email = $2 LIMIT 1',
    [username, email]
  );
  return rows[0] || null;
},
async findByEmailWithStats(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  if (!rows[0]) return null;
  const user = rows[0];
  const stats = await db.userStats.get(user.id);
  return { ...user, stats };
},
async create(data) {
  const id = data.id || randomUUID();
  const now = new Date();
  const payload = { ...data, id, created_at: now, updated_at: now };
  const q = _buildInsert('users', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async update(id, data) {
  // Fix #38: eliminate post-write re-fetch; return computed payload
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('users', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async delete(id) {
  await query('DELETE FROM users WHERE id = $1', [id]);
  return true;
},
async findAll() {
  const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC');
  return rows;
},
},
// ── user_stats ──────────────────────────────────────────────────────────────
userStats: {
async get(userId) {
  const { rows } = await query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
  return rows[0] ? { userId: rows[0].user_id, ...rows[0] } : null;
},
async create(userId) {
  const payload = {
    user_id: userId,
    total_xp: 0,
    current_level: 1,
    xp_in_current_level: 0,
    current_streak: 0,
    longest_streak: 0,
    streak_grace_used: false,
    tree_health: 100,
    tree_stage: 1,
    total_cards_reviewed: 0,
    total_cards_mastered: 0,
    total_study_minutes: 0,
    total_sessions_completed: 0,
    total_exams_completed: 0,
    last_study_date: null,
    seedlings_balance: 0,
    streak_shields_held: 0,
    streak_shields_earned: 0,
    knowledge_score_global: 0,
    last_login_at: null,
    created_at: new Date(),
  };
  await query(
    `INSERT INTO user_stats (user_id, total_xp, current_level, xp_in_current_level,
      current_streak, longest_streak, streak_grace_used, tree_health, tree_stage,
      total_cards_reviewed, total_cards_mastered, total_study_minutes,
      total_sessions_completed, total_exams_completed, last_study_date,
      seedlings_balance, streak_shields_held, streak_shields_earned,
      knowledge_score_global, last_login_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [userId, 0, 1, 0, 0, 0, false, 100, 1, 0, 0, 0, 0, 0, null, 0, 0, 0, 0, null, payload.created_at]
  );
  return payload;
},
async update(userId, data) {
  // Fix #38: conditional RETURNING * — only re-fetch when { increment: N } is used
  const built = _buildIncrementUpdate('user_stats', 'user_id', userId, data);
  const { rows } = await query(built.text, built.values);
  return rows[0] ? { userId, ...rows[0] } : { userId, ...data };
},
async leaderboard(limit = 20, offset = 0) {
  const { rows } = await query(
    'SELECT * FROM user_stats ORDER BY total_xp DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows.map(r => ({ userId: r.user_id, ...r }));
},
async countWithMoreXP(totalXP) {
  const { rows } = await query(
    'SELECT COUNT(*) AS count FROM user_stats WHERE total_xp > $1',
    [totalXP]
  );
  return parseInt(rows[0]?.count || '0', 10);
},
async findAll() {
  const { rows } = await query('SELECT * FROM user_stats');
  return rows.map(r => ({ userId: r.user_id, ...r }));
},
},
// ── refresh_tokens ──────────────────────────────────────────────────────────
refreshTokens: {
async create(userId, tokenHash, expiresAt) {
  await query(
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, NOW())',
    [tokenHash, userId, expiresAt]
  );
  return true;
},
async findByHash(hash, userId) {
  const { rows } = await query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2 LIMIT 1',
    [hash, userId]
  );
  return rows[0] || null;
},
async deleteByHash(hash) {
  await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
  return true;
},
async deleteByUserId(userId) {
  // Firestore batch → single DELETE
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  return true;
},
},
// ── subjects ───────────────────────────────────────────────────────────────
subjects: {
async findById(id) {
  const { rows } = await query('SELECT * FROM subjects WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
},
async findManyWithDecks(userId) {
  const { rows: subjects } = await query(
    'SELECT * FROM subjects WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  const { rows: decks } = await query(
    'SELECT * FROM decks WHERE user_id = $1',
    [userId]
  );
  return subjects.map((s) => {
    const sDecks = decks.filter((d) => d.subject_id === s.id);
    return {
      ...s,
      deck_count: sDecks.length,
      total_cards: sDecks.reduce((sum, d) => sum + (d.card_count || 0), 0),
      decks: sDecks,
    };
  });
},
async create(userId, data) {
  const id = randomUUID();
  const payload = { ...data, id, user_id: userId, created_at: new Date(), updated_at: new Date() };
  const q = _buildInsert('subjects', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async update(userId, id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('subjects', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async delete(userId, id) {
  await query('DELETE FROM subjects WHERE id = $1 AND user_id = $2', [id, userId]);
  return true;
},
},
// ── topics ──────────────────────────────────────────────────────────────────
topics: {
async findMany(userId, subjectId) {
  const { rows } = await query(
    'SELECT * FROM topics WHERE user_id = $1 AND subject_id = $2',
    [userId, subjectId]
  );
  return rows;
},
async create(userId, subjectId, name) {
  const id = randomUUID();
  const payload = { user_id: userId, subject_id: subjectId, name, created_at: new Date() };
  await query(
    'INSERT INTO topics (id, user_id, subject_id, name, created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, userId, subjectId, name, payload.created_at]
  );
  return { id, ...payload };
},
},
// ── decks ───────────────────────────────────────────────────────────────────
decks: {
async findMany(userId, filters = {}) {
  let sql = 'SELECT * FROM decks WHERE user_id = $1';
  const vals = [userId];
  if (filters.subject_id) { sql += ` AND subject_id = $${vals.length + 1}`; vals.push(filters.subject_id); }
  if (filters.topic_id)   { sql += ` AND topic_id = $${vals.length + 1}`;   vals.push(filters.topic_id); }
  const { rows } = await query(sql, vals);
  return { decks: rows, total: rows.length };
},
async create(userId, data) {
  const id = randomUUID();
  const payload = { ...data, id, user_id: userId, created_at: new Date(), updated_at: new Date() };
  const q = _buildInsert('decks', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByIdFull(userId, id) {
  const { rows: [deck] } = await query(
    'SELECT * FROM decks WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  if (!deck) return null;
  const { rows: cards } = await query(
    'SELECT * FROM cards WHERE deck_id = $1 AND user_id = $2',
    [id, userId]
  );
  deck.cards = cards;
  return deck;
},
async findById(userId, id) {
  const { rows } = await query(
    'SELECT * FROM decks WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  return rows[0] || null;
},
async update(userId, id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('decks', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async delete(userId, id) {
  await query('DELETE FROM decks WHERE id = $1 AND user_id = $2', [id, userId]);
  return true;
},
async findBySubject(userId, subjectId) {
  const { rows } = await query(
    'SELECT * FROM decks WHERE user_id = $1 AND subject_id = $2',
    [userId, subjectId]
  );
  return rows;
},
async findBySubjectWithCards(userId, subjectId) {
  // Fix #55: 1 findAllForUser read replaces N sequential per-deck queries
  const decks = await this.findBySubject(userId, subjectId);
  if (decks.length === 0) return decks;
  const allCards = await db.cards.findAllForUser(userId);
  const deckIdSet = new Set(decks.map(d => d.id));
  const cardsByDeck = {};
  for (const c of allCards.filter(c => deckIdSet.has(c.deck_id))) {
    if (!cardsByDeck[c.deck_id]) cardsByDeck[c.deck_id] = [];
    cardsByDeck[c.deck_id].push(c);
  }
  for (const deck of decks) {
    deck.cards = cardsByDeck[deck.id] || [];
  }
  return decks;
},
async count(userId, filters = {}) {
  let sql = 'SELECT COUNT(*) AS count FROM decks WHERE user_id = $1';
  const vals = [userId];
  if (filters.is_public !== undefined) { sql += ` AND is_public = $${vals.length + 1}`; vals.push(filters.is_public); }
  const { rows } = await query(sql, vals);
  return parseInt(rows[0]?.count || '0', 10);
},
},
// ── cards ───────────────────────────────────────────────────────────────────
cards: {
async findById(userId, id) {
  const { rows } = await query(
    'SELECT * FROM cards WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  return rows[0] || null;
},
async findMany(userId, filters = {}, { page = 1, limit = 50 } = {}) {
  // Fix #46: use COUNT for total; avoid loading all cards to count
  let baseSQL = 'FROM cards WHERE user_id = $1';
  const vals = [userId];
  if (filters.deck_id) { baseSQL += ` AND deck_id = $${vals.length + 1}`; vals.push(filters.deck_id); }
  if (filters.stage !== undefined) { baseSQL += ` AND stage = $${vals.length + 1}`; vals.push(filters.stage); }
  const { rows: [{ count }] } = await query(`SELECT COUNT(*) AS count ${baseSQL}`, vals);
  const total = parseInt(count || '0', 10);
  const offset = (page - 1) * limit;
  const valsPage = [...vals, limit, offset];
  const { rows: cards } = await query(
    `SELECT * ${baseSQL} ORDER BY created_at ASC LIMIT $${valsPage.length - 1} OFFSET $${valsPage.length}`,
    valsPage
  );
  return { cards, total, page, total_pages: Math.ceil(total / limit) };
},
async create(userId, data) {
  const id = randomUUID();
  const payload = {
    ...data,
    id,
    user_id: userId,
    stage: data.stage || 1,
    interval_days: data.interval_days || 1,
    easiness_factor: data.easiness_factor || 2.5,
    repetition_count: data.repetition_count || 0,
    next_review_at: data.next_review_at || new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  };
  const q = _buildInsert('cards', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async createMany(userId, deckId, cardsData) {
  // Firestore batch → single transaction
  return withTransaction(async (client) => {
    const created = [];
    for (const c of cardsData) {
      const id = randomUUID();
      const payload = {
        id,
        user_id: userId,
        deck_id: deckId,
        stage: 1,
        interval_days: 1,
        easiness_factor: 2.5,
        repetition_count: 0,
        next_review_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        ...c,
      };
      const q = _buildInsert('cards', payload);
      await client.query(q.text, q.values);
      created.push({ id, ...payload });
    }
    return created;
  });
},
async update(userId, id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('cards', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async delete(userId, id) {
  await query('DELETE FROM cards WHERE id = $1 AND user_id = $2', [id, userId]);
  return true;
},
async countByDeck(userId, deckId) {
  const { rows } = await query(
    'SELECT COUNT(*) AS count FROM cards WHERE user_id = $1 AND deck_id = $2',
    [userId, deckId]
  );
  return parseInt(rows[0]?.count || '0', 10);
},
async findAllForUser(userId) {
  const { rows } = await query('SELECT * FROM cards WHERE user_id = $1', [userId]);
  return rows;
},
async findByDeck(userId, deckId) {
  const { rows } = await query(
    'SELECT * FROM cards WHERE user_id = $1 AND deck_id = $2',
    [userId, deckId]
  );
  return rows;
},
async findByDeckIds(userId, deckIds) {
  // Fix #30 + collapse chunking: ANY($1) replaces chunked IN queries
  if (!deckIds || deckIds.length === 0) return [];
  const { rows } = await query(
    'SELECT * FROM cards WHERE user_id = $1 AND deck_id = ANY($2::text[])',
    [userId, deckIds]
  );
  return rows;
},
async countMastered(userId, sinceDate) {
  let sql = 'SELECT COUNT(*) AS count FROM cards WHERE user_id = $1 AND stage = 5';
  const vals = [userId];
  if (sinceDate) { sql += ` AND last_reviewed_at >= $${vals.length + 1}`; vals.push(sinceDate); }
  const { rows } = await query(sql, vals);
  return parseInt(rows[0]?.count || '0', 10);
},
},
// ── review_logs ─────────────────────────────────────────────────────────────
reviewLogs: {
async create(userId, data) {
  const id = randomUUID();
  const payload = { ...data, id, user_id: userId, created_at: new Date() };
  const q = _buildInsert('review_logs', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByCards(userId, cardIds) {
  // Fix #36 + collapse chunking: ANY($1) replaces chunked IN queries
  if (!cardIds || cardIds.length === 0) return [];
  const { rows } = await query(
    'SELECT * FROM review_logs WHERE user_id = $1 AND card_id = ANY($2::text[])',
    [userId, cardIds]
  );
  return rows;
},
async findByUser(userId, sinceDate) {
  const { rows } = await query(
    'SELECT * FROM review_logs WHERE user_id = $1 AND reviewed_at >= $2',
    [userId, sinceDate]
  );
  return rows;
},
async count(userId, filters = {}) {
  let sql = 'SELECT COUNT(*) AS count FROM review_logs WHERE user_id = $1';
  const vals = [userId];
  if (filters.reviewed_at_gte) { sql += ` AND reviewed_at >= $${vals.length + 1}`; vals.push(filters.reviewed_at_gte); }
  const { rows } = await query(sql, vals);
  return parseInt(rows[0]?.count || '0', 10);
},
},
// ── sessions ────────────────────────────────────────────────────────────────
sessions: {
async create(userId, deckId, startedAt) {
  const id = randomUUID();
  const payload = {
    id,
    user_id: userId,
    deck_id: deckId,
    started_at: startedAt,
    ended_at: null,
    duration_seconds: 0,
    cards_reviewed: 0,
    cards_again: 0,
    cards_hard: 0,
    cards_good: 0,
    cards_easy: 0,
    accuracy_pct: 0,
    xp_earned: 0,
    session_completed: false,
    seed_survived: false,
    focus_breaks: 0,
    focus_seed_stage: 'Dormant',
    fruiting_achieved: false,
    created_at: new Date(),
  };
  await query(
    `INSERT INTO sessions (id, user_id, deck_id, started_at, ended_at, duration_seconds,
      cards_reviewed, cards_again, cards_hard, cards_good, cards_easy, accuracy_pct,
      xp_earned, session_completed, seed_survived, focus_breaks, focus_seed_stage,
      fruiting_achieved, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [id, userId, deckId, startedAt, null, 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0, 'Dormant', false, payload.created_at]
  );
  return { id, ...payload };
},
async findById(userId, id) {
  const { rows } = await query(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  return rows[0] || null;
},
async findByIdFull(userId, id) {
  const { rows: [session] } = await query(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  if (!session) return null;
  if (session.deck_id) {
    const { rows: [deck] } = await query('SELECT * FROM decks WHERE id = $1', [session.deck_id]);
    if (deck) session.deck = deck;
  }
  return session;
},
async update(userId, id, data) {
  // Fix #38: conditional RETURNING * — only re-fetch when { increment: N } is used
  const built = _buildIncrementUpdate('sessions', 'id', id, data);
  const { rows } = await query(built.text, built.values);
  return rows[0] ? { id, ...rows[0] } : { id, ...data };
},
async findMany(userId, filters = {}, { limit = 20, offset = 0 } = {}) {
  // Fix #47: use COUNT for accurate total
  let baseSQL = 'FROM sessions WHERE user_id = $1';
  const vals = [userId];
  if (filters.session_completed !== undefined) {
    baseSQL += ` AND session_completed = $${vals.length + 1}`; vals.push(filters.session_completed);
  }
  if (filters.deck_id) { baseSQL += ` AND deck_id = $${vals.length + 1}`; vals.push(filters.deck_id); }
  if (filters.started_at_gte) { baseSQL += ` AND started_at >= $${vals.length + 1}`; vals.push(filters.started_at_gte); }
  const { rows: [{ count }] } = await query(`SELECT COUNT(*) AS count ${baseSQL}`, vals);
  const valsPage = [...vals, limit, offset];
  const { rows: sessions } = await query(
    `SELECT * ${baseSQL} ORDER BY started_at DESC LIMIT $${valsPage.length - 1} OFFSET $${valsPage.length}`,
    valsPage
  );
  return { sessions, total: parseInt(count || '0', 10) };
},
async findBySubject(userId, subjectId, sinceDate) {
  // Fix #37 + collapse chunking: JOIN replaces deck-chunked IN queries
  let sql = `SELECT s.* FROM sessions s
    JOIN decks d ON s.deck_id = d.id
    WHERE s.user_id = $1 AND d.subject_id = $2`;
  const vals = [userId, subjectId];
  if (sinceDate) { sql += ` AND s.started_at >= $${vals.length + 1}`; vals.push(sinceDate); }
  const { rows } = await query(sql, vals);
  return rows;
},
async count(userId, filters = {}) {
  let sql = 'SELECT COUNT(*) AS count FROM sessions WHERE user_id = $1';
  const vals = [userId];
  if (filters.session_completed !== undefined) {
    sql += ` AND session_completed = $${vals.length + 1}`; vals.push(filters.session_completed);
  }
  if (filters.started_at_gte) { sql += ` AND started_at >= $${vals.length + 1}`; vals.push(filters.started_at_gte); }
  const { rows } = await query(sql, vals);
  return parseInt(rows[0]?.count || '0', 10);
},
},
// ── exam_sessions ───────────────────────────────────────────────────────────
examSessions: {
async create(userId, data) {
  const id = randomUUID();
  const payload = {
    ...data,
    id,
    user_id: userId,
    started_at: new Date(),
    is_reckoning: data.is_reckoning || false,
    status: data.status || 'pending',
    created_at: new Date(),
  };
  const q = _buildInsert('exam_sessions', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async update(userId, id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('exam_sessions', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByIdWithQuestions(userId, id) {
  const { rows: [exam] } = await query(
    'SELECT * FROM exam_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  if (!exam) return null;
  const { rows: questions } = await query(
    'SELECT * FROM exam_questions WHERE exam_session_id = $1 AND user_id = $2',
    [id, userId]
  );
  exam.questions = questions;
  return exam;
},
async findMany(userId, filters = {}, { limit = 20, offset = 0 } = {}) {
  let sql = 'SELECT * FROM exam_sessions WHERE user_id = $1';
  const vals = [userId];
  if (filters.status) { sql += ` AND status = $${vals.length + 1}`; vals.push(filters.status); }
  sql += ` ORDER BY created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
  vals.push(limit, offset);
  const { rows } = await query(sql, vals);
  return rows;
},
},
// ── exam_questions ──────────────────────────────────────────────────────────
examQuestions: {
async create(userId, examSessionId, data) {
  const id = randomUUID();
  const payload = {
    ...data,
    id,
    user_id: userId,
    exam_session_id: examSessionId,
    created_at: new Date(),
  };
  const q = _buildInsert('exam_questions', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByNumber(userId, examSessionId, questionNumber) {
  const { rows } = await query(
    `SELECT * FROM exam_questions WHERE user_id = $1 AND exam_session_id = $2
     AND question_number = $3 LIMIT 1`,
    [userId, examSessionId, questionNumber]
  );
  return rows[0] || null;
},
async findById(userId, id) {
  const { rows } = await query(
    'SELECT * FROM exam_questions WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  return rows[0] || null;
},
async update(userId, id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('exam_questions', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
// BUG #4 FIX: findBySession was absent — recomputeAndStoreCardState always received
// examLogs = [] because the guard `db.examQuestions.findBySession ?` silently failed.
async findBySession(userId, examSessionId) {
  const { rows } = await query(
    'SELECT * FROM exam_questions WHERE user_id = $1 AND exam_session_id = $2',
    [userId, examSessionId]
  );
  return rows;
},
},
// ── subject_stats ────────────────────────────────────────────────────────────
subjectStats: {
async get(userId, subjectId) {
  // Fix #8: deterministic id eliminates WHERE scan
  const docId = `${userId}_${subjectId}`;
  const { rows } = await query('SELECT * FROM subject_stats WHERE id = $1 LIMIT 1', [docId]);
  return rows[0] ? { id: docId, ...rows[0] } : null;
},
async upsert(userId, subjectId, data) {
  // Fix #9: deterministic id + ON CONFLICT eliminates read-then-write
  const docId = `${userId}_${subjectId}`;
  const payload = { id: docId, user_id: userId, subject_id: subjectId, ...data, updated_at: new Date() };
  const q = _buildUpsert('subject_stats', ['id'], payload);
  await query(q.text, q.values);
  return { id: docId, ...payload };
},
async findMany(userId) {
  const { rows } = await query('SELECT * FROM subject_stats WHERE user_id = $1', [userId]);
  return rows;
},
},
// ── achievements ─────────────────────────────────────────────────────────────
achievements: {
async upsert(code, data) {
  // Fix #13: code is the natural doc id
  const payload = { id: code, ...data, code, updated_at: new Date() };
  const q = _buildUpsert('achievements', ['id'], payload);
  await query(q.text, q.values);
  _achievementsCache = null; // Fix #49: invalidate cache on write
  return { id: code, ...payload };
},
async findAll() {
  // Fix #49: load once and cache — achievements are static
  if (_achievementsCache) return _achievementsCache;
  const { rows } = await query('SELECT * FROM achievements');
  _achievementsCache = rows;
  return _achievementsCache;
},
},
// ── user_achievements ───────────────────────────────────────────────────────
userAchievements: {
async create(userId, achievementId) {
  // Fix #14: deterministic id enables direct markShown lookup
  const id = `${userId}_${achievementId}`;
  const payload = {
    id,
    user_id: userId,
    achievement_id: achievementId,
    unlocked_at: new Date(),
    shown_to_user: false,
  };
  await query(
    `INSERT INTO user_achievements (id, user_id, achievement_id, unlocked_at, shown_to_user)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [id, userId, achievementId, payload.unlocked_at, false]
  );
  return { id, ...payload };
},
async findManyWithAchievement(userId) {
  // Fix #26: use achievements cache (Fix #49) — eliminates N individual doc fetches
  const { rows } = await query(
    'SELECT * FROM user_achievements WHERE user_id = $1',
    [userId]
  );
  const allAchievements = await db.achievements.findAll();
  const achMap = new Map(allAchievements.map(a => [a.id, a]));
  return rows.map(ua => {
    const ach = achMap.get(ua.achievement_id);
    if (ach) ua.achievement = ach;
    return ua;
  });
},
async markShown(userId, achievementId) {
  // Fix #14: deterministic id eliminates WHERE scan
  const docId = `${userId}_${achievementId}`;
  await query(
    'UPDATE user_achievements SET shown_to_user = true WHERE id = $1',
    [docId]
  ).catch(() => {});
  return true;
},
},
// ── tasks ────────────────────────────────────────────────────────────────────
tasks: {
async findMany(userId, filters = {}) {
  let sql = 'SELECT * FROM tasks WHERE user_id = $1';
  const vals = [userId];
  if (filters.status) { sql += ` AND status = $${vals.length + 1}`; vals.push(filters.status); }
  const { rows } = await query(sql, vals);
  return rows;
},
async create(userId, data) {
  const id = randomUUID();
  const payload = {
    ...data,
    id,
    user_id: userId,
    status: 'active',
    current_value: 0,
    created_at: new Date(),
  };
  const q = _buildInsert('tasks', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async update(userId, taskId, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('tasks', 'id', taskId, payload);
  await query(q.text, q.values);
  return { id: taskId, ...payload };
},
async deleteActive(userId) {
  // Firestore batch → single DELETE
  await query(
    "DELETE FROM tasks WHERE user_id = $1 AND status = 'active'",
    [userId]
  );
  return true;
},
async findById(userId, taskId) {
  const { rows } = await query(
    'SELECT * FROM tasks WHERE id = $1 AND user_id = $2 LIMIT 1',
    [taskId, userId]
  );
  return rows[0] || null;
},
},
// ── community_decks ─────────────────────────────────────────────────────────
communityDecks: {
async findMany({ search, tags } = {}, { page = 1, limit = 20 } = {}) {
  // Fix #52: filter to is_public=true — prevents exposing draft/unlisted decks
  let sql = 'SELECT * FROM community_decks WHERE is_public = true';
  const vals = [];
  if (search) {
    sql += ` AND title ILIKE $${vals.length + 1}`;
    vals.push(`%${search}%`);
  }
  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) AS count FROM community_decks WHERE is_public = true${search ? ` AND title ILIKE '${search.replace(/'/g,"''")}%'` : ''}`,
    []
  );
  const offset = (page - 1) * limit;
  vals.push(limit, offset);
  sql += ` ORDER BY clone_count DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`;
  const { rows: decks } = await query(sql, vals);
  return { decks, total: parseInt(count || '0', 10) };
},
async findById(id) {
  const { rows } = await query('SELECT * FROM community_decks WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
},
async findByIdWithOriginalCards(id) {
  const cd = await this.findById(id);
  if (!cd || !cd.original_deck_id) return cd;
  const { rows: [deck] } = await query('SELECT * FROM decks WHERE id = $1', [cd.original_deck_id]);
  if (deck) {
    cd.originalDeck = deck;
    const { rows: cards } = await query('SELECT * FROM cards WHERE deck_id = $1', [cd.original_deck_id]);
    cd.originalDeck.cards = cards;
  }
  return cd;
},
async upsertByOriginalDeck(originalDeckId, data) {
  // Fix #15: originalDeckId is the natural doc id
  const payload = { ...data, id: originalDeckId, original_deck_id: originalDeckId, updated_at: new Date() };
  if (!payload.created_at) payload.created_at = new Date();
  const q = _buildUpsert('community_decks', ['id'], payload);
  await query(q.text, q.values);
  return { id: originalDeckId, ...payload };
},
async update(id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('community_decks', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async count({ author_id } = {}) {
  if (!author_id) return 0;
  const { rows } = await query(
    'SELECT COUNT(*) AS count FROM community_decks WHERE author_id = $1',
    [author_id]
  );
  return parseInt(rows[0]?.count || '0', 10);
},
},
// ── community_ratings ────────────────────────────────────────────────────────
communityRatings: {
async upsert(communityDeckId, userId, rating) {
  // Fix #16: deterministic id eliminates WHERE scan on every rating write
  const docId = `${communityDeckId}_${userId}`;
  const payload = { id: docId, community_deck_id: communityDeckId, user_id: userId, rating, updated_at: new Date() };
  await query(
    `INSERT INTO community_ratings (id, community_deck_id, user_id, rating, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = EXCLUDED.updated_at`,
    [docId, communityDeckId, userId, rating, payload.updated_at]
  );
  return { id: docId, ...payload };
},
async findByDeck(communityDeckId) {
  const { rows } = await query(
    'SELECT * FROM community_ratings WHERE community_deck_id = $1',
    [communityDeckId]
  );
  return rows;
},
},

// ════════════════════════════════════════════════════════════════════════════
//  P1.7 NOTE: Migration script skeleton
//  A one-time migration is required to:
//    (a) create card_states for every existing card,
//    (b) compute initial KS per subject and global,
//    (c) extend user_stats with seedlings_balance, streak_shields_held, etc.,
//    (d) extend exam_sessions with is_reckoning flag.
//  See migration/ directory for the runnable script.
// ════════════════════════════════════════════════════════════════════════════
// ── knowledge_scores (P2/P1.2 FIX: KS history/snapshot log)
// Stores historical KS values for graphing over time.
knowledgeScores: {
async create(userId, subjectId, score, band) {
  const id = randomUUID();
  const payload = {
    id,
    user_id: userId,
    subject_id: subjectId,
    score,
    band,
    recorded_at: new Date(),
  };
  await query(
    'INSERT INTO knowledge_scores (id, user_id, subject_id, score, band, recorded_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, userId, subjectId, score, band, payload.recorded_at]
  );
  return { id, ...payload };
},
async findBySubject(userId, subjectId, limit = 52) {
  const { rows } = await query(
    'SELECT * FROM knowledge_scores WHERE user_id = $1 AND subject_id = $2 ORDER BY recorded_at DESC LIMIT $3',
    [userId, subjectId, limit]
  );
  return rows;
},
},

//  NEW COLLECTIONS (Phases 2–8)

// ════════════════════════════════════════════════════════════════════════════
// ── card_states ─────────────────────────────────────────────────────────────
cardStates: {
async get(userId, cardId) {
  // Fix #1: deterministic id eliminates collection scan
  const docId = `${userId}_${cardId}`;
  const { rows } = await query('SELECT * FROM card_states WHERE id = $1 LIMIT 1', [docId]);
  return rows[0] ? { id: docId, ...rows[0] } : null;
},
async create(userId, cardId, data) {
  // Fix #2: deterministic id; Fix #39/40: include deck_id/subject_id; Fix #41: exclude weight
  const id = `${userId}_${cardId}`;
  const { weight: _w, ...cleanData } = data; // Fix #41: strip deprecated weight field
  const payload = {
    id,
    user_id: userId,
    card_id: cardId,
    state: cleanData.state || 'SEEDLING',
    stage: cleanData.stage || 1,
    deck_id: cleanData.deck_id || null,       // Fix #39
    subject_id: cleanData.subject_id || null, // Fix #40
    verified: cleanData.verified || false,
    verified_at: cleanData.verified_at || null,
    last_evaluated_at: new Date(),
    created_at: new Date(),
    bubble_ids: cleanData.bubble_ids || [],
    learning_debt: cleanData.learning_debt || false,
    cross_bubble: cleanData.cross_bubble || false,
    parking_expires_at: cleanData.parking_expires_at || null,
    ...cleanData,
  };
  const q = _buildInsert('card_states', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async update(userId, cardId, data) {
  // Fix #3: upsert via ON CONFLICT eliminates read-then-write
  const docId = `${userId}_${cardId}`;
  const updatePayload = { ...data, last_evaluated_at: new Date(), updated_at: new Date() };
  // Try UPDATE first; if no rows affected, fall back to create
  const q = _buildUpdate('card_states', 'id', docId, updatePayload);
  const result = await query(q.text, q.values);
  if (result.rowCount === 0) {
    return this.create(userId, cardId, data);
  }
  return { id: docId, ...updatePayload };
},
async findByUser(userId) {
  const { rows } = await query('SELECT * FROM card_states WHERE user_id = $1', [userId]);
  return rows;
},
async findBySubject(userId, subjectId) {
  const decks = await db.decks.findBySubject(userId, subjectId);
  const deckIds = decks.map((d) => d.id);
  if (deckIds.length === 0) return [];
  // Single JOIN query: replaces nested per-deck/per-card loops
  const { rows } = await query(
    `SELECT cs.* FROM card_states cs
     JOIN cards c ON cs.card_id = c.id
     WHERE cs.user_id = $1 AND c.deck_id = ANY($2::text[])`,
    [userId, deckIds]
  );
  return rows;
},
},
// ── brain_pressure ──────────────────────────────────────────────────────────
brainPressure: {
async get(userId, subjectId) {
  // Fix #10: deterministic id eliminates WHERE scan
  const docId = `${userId}_${subjectId}`;
  const { rows } = await query('SELECT * FROM brain_pressure WHERE id = $1 LIMIT 1', [docId]);
  return rows[0] ? { id: docId, ...rows[0] } : null;
},
async set(userId, subjectId, data) {
  // Fix #11: deterministic id + ON CONFLICT eliminates read-then-write
  const docId = `${userId}_${subjectId}`;
  const payload = {
    id: docId,
    user_id: userId,
    subject_id: subjectId,
    pressure_score: data.pressure_score !== undefined ? data.pressure_score : 0,
    intervention_level: data.intervention_level || 'L0',
    sources: data.sources || {},
    ...data,
    updated_at: new Date(),
  };
  await query(
    `INSERT INTO brain_pressure (id, user_id, subject_id, pressure_score, intervention_level, sources, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       pressure_score = EXCLUDED.pressure_score,
       intervention_level = EXCLUDED.intervention_level,
       sources = EXCLUDED.sources,
       updated_at = EXCLUDED.updated_at`,
    [docId, userId, subjectId, payload.pressure_score, payload.intervention_level,
     JSON.stringify(payload.sources), payload.updated_at]
  );
  return { id: docId, ...payload };
},
async findByUser(userId) {
  const { rows } = await query('SELECT * FROM brain_pressure WHERE user_id = $1', [userId]);
  return rows;
},
},
// ── reckoning_sessions ──────────────────────────────────────────────────────
reckoningSessions: {
async findById(id) {
  const { rows } = await query('SELECT * FROM reckoning_sessions WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
},
async create(userId, data) {
  const id = randomUUID();
  const payload = {
    id,
    user_id: userId,
    status: 'triggered',
    ...data,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const q = _buildInsert('reckoning_sessions', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async update(id, data) {
  // Fix #38: eliminate post-write re-fetch
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('reckoning_sessions', 'id', id, payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findActiveByUser(userId) {
  const { rows } = await query(
    `SELECT * FROM reckoning_sessions WHERE user_id = $1
     AND status IN ('triggered', 'deferred', 'in_progress')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
},
async findByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM reckoning_sessions WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
},
},
// ── chronicle_entries ────────────────────────────────────────────────────────
chronicleEntries: {
async create(userId, data) {
  const id = randomUUID();
  const payload = { id, user_id: userId, ...data, created_at: new Date() };
  const q = _buildInsert('chronicle_entries', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM chronicle_entries WHERE user_id = $1 ORDER BY week_start DESC',
    [userId]
  );
  return rows;
},
async findLatest(userId) {
  const { rows } = await query(
    'SELECT * FROM chronicle_entries WHERE user_id = $1 ORDER BY week_start DESC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
},
},
// ── almanac_entries ─────────────────────────────────────────────────────────
almanacEntries: {
async create(userId, data) {
  // Fix #17: deterministic id enables direct unlock lookup
  const entryCode = data.entry_code || randomUUID();
  const id = `${userId}_${entryCode}`;
  const payload = {
    id,
    user_id: userId,
    unlocked: false,
    unlocked_at: null,
    narrative: null,
    ...data,
    created_at: new Date(),
  };
  const q = _buildInsert('almanac_entries', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByUser(userId) {
  const { rows } = await query('SELECT * FROM almanac_entries WHERE user_id = $1', [userId]);
  return rows;
},
async unlock(userId, entryCode, narrative) {
  // Fix #17: deterministic id eliminates WHERE scan
  const docId = `${userId}_${entryCode}`;
  const { rows: [existing] } = await query('SELECT * FROM almanac_entries WHERE id = $1', [docId]);
  if (!existing) return null;
  const updatePayload = { unlocked: true, unlocked_at: new Date(), narrative, updated_at: new Date() };
  await query(
    `UPDATE almanac_entries SET unlocked = true, unlocked_at = $1, narrative = $2, updated_at = $3 WHERE id = $4`,
    [updatePayload.unlocked_at, narrative, updatePayload.updated_at, docId]
  );
  return { id: docId, ...existing, ...updatePayload };
},
},
// ── user_persona ────────────────────────────────────────────────────────────
userPersona: {
async get(userId) {
  // Fix #12: derive current week's doc id; fallback to query for legacy docs
  const _now = new Date();
  const _day = _now.getDay();
  const _monday = new Date(_now);
  _monday.setDate(_now.getDate() - (_day === 0 ? 6 : _day - 1));
  _monday.setHours(0, 0, 0, 0);
  const _weekStr = _monday.toISOString().slice(0, 10);
  const docId = `${userId}_${_weekStr}`;
  const { rows: [byId] } = await query('SELECT * FROM user_persona WHERE id = $1', [docId]);
  if (byId) return { id: byId.id, ...byId };
  // Fallback: most recent persona (backward compat pre-migration)
  const { rows } = await query(
    'SELECT * FROM user_persona WHERE user_id = $1 ORDER BY assigned_week_start DESC LIMIT 1',
    [userId]
  );
  return rows[0] ? { id: rows[0].id, ...rows[0] } : null;
},
async create(userId, data) {
  // Fix #12: deterministic id keyed to assigned week
  const _ws = data.assigned_week_start
    ? (typeof data.assigned_week_start === 'string'
      ? data.assigned_week_start.slice(0, 10)
      : new Date(data.assigned_week_start).toISOString().slice(0, 10))
    : new Date().toISOString().slice(0, 10);
  const id = `${userId}_${_ws}`;
  const payload = {
    id,
    user_id: userId,
    ...data,
    created_at: new Date(),
  };
  const q = _buildInsert('user_persona', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
},
// ── daily_ritual_cache ──────────────────────────────────────────────────────
dailyRitualCache: {
async get(userId, type, dateStr) {
  // Fix #4: deterministic id eliminates 3-field WHERE scan
  const docId = `${userId}_${type}_${dateStr}`;
  const { rows } = await query('SELECT * FROM daily_ritual_cache WHERE id = $1', [docId]);
  return rows[0] ? { id: docId, ...rows[0] } : null;
},
async set(userId, type, dateStr, data) {
  // Fix #5: deterministic id + ON CONFLICT eliminates read-then-write (2 ops → 1)
  const docId = `${userId}_${type}_${dateStr}`;
  const payload = { id: docId, user_id: userId, type, date: dateStr, ...data, updated_at: new Date() };
  const q = _buildUpsert('daily_ritual_cache', ['id'], payload);
  await query(q.text, q.values);
  return { id: docId, ...payload };
},
},
// ── seedling_transactions ───────────────────────────────────────────────────
seedlingTransactions: {
async create(userId, data) {
  const id = randomUUID();
  const payload = { id, user_id: userId, ...data, created_at: new Date() };
  const q = _buildInsert('seedling_transactions', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM seedling_transactions WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
},
},
// ── user_inventory ──────────────────────────────────────────────────────────
userInventory: {
async getItem(userId, itemCode) {
  // Fix #6: deterministic id eliminates WHERE scan
  const docId = `${userId}_${itemCode}`;
  const { rows } = await query('SELECT * FROM user_inventory WHERE id = $1 LIMIT 1', [docId]);
  return rows[0] ? { id: docId, ...rows[0] } : null;
},
async setItem(userId, itemCode, data) {
  // Fix #7: deterministic id + ON CONFLICT eliminates read-then-write
  const docId = `${userId}_${itemCode}`;
  const payload = {
    id: docId,
    user_id: userId,
    item_code: itemCode,
    quantity: data.quantity !== undefined ? data.quantity : 0,
    unlocked: data.unlocked !== undefined ? data.unlocked : false,
    acquired_at: data.acquired_at || null,
    ...data,
    updated_at: new Date(),
  };
  const q = _buildUpsert('user_inventory', ['id'], payload);
  await query(q.text, q.values);
  return { id: docId, ...payload };
},
async findByUser(userId) {
  const { rows } = await query('SELECT * FROM user_inventory WHERE user_id = $1', [userId]);
  return rows;
},
},
// ── marketplace_items ───────────────────────────────────────────────────────
marketplaceItems: {
async seed() {
  const existing = await this.findAll();
  if (existing.length > 0) return existing;
  const items = [
    {
      item_code: 'reckoning_buffer',
      name: 'Reckoning Buffer',
      description: 'Extends Reckoning deferral from 4 hours to 24 hours.',
      category: 'consumable',
      gate1_condition: { type: 'reckoning_survived', count: 1 },
      gate2_seedling_cost: 25,
      purchase_limit: 3,
    },
    {
      item_code: 'biome_midnight_garden',
      name: 'Midnight Garden',
      description: 'A dark, starlit biome theme.',
      category: 'cosmetic',
      gate1_condition: { type: 'fruition_sessions', count: 10 },
      gate2_seedling_cost: 30,
      purchase_limit: 1,
    },
    {
      item_code: 'biome_autumn_grove',
      name: 'Autumn Grove',
      description: 'Warm amber and crimson biome theme.',
      category: 'cosmetic',
      gate1_condition: { type: 'fruition_sessions', count: 10 },
      gate2_seedling_cost: 30,
      purchase_limit: 1,
    },
    {
      item_code: 'deep_audit',
      name: 'Deep Audit',
      description: 'AI-generated meta-cognitive analysis of a subject.',
      category: 'service',
      gate1_condition: {
        type: 'thriving_sessions_across_subjects',
        count: 20,
        min_subjects: 3,
      },
      gate2_seedling_cost: 40,
      purchase_limit: 999,
    },
    {
      item_code: 'archive_expansion',
      name: 'Archive Expansion',
      description: 'Archive a mastered subject with extended review intervals.',
      category: 'service',
      gate1_condition: { type: 'subject_ks_and_fruiting', ks: 100, fruiting: 15 },
      gate2_seedling_cost: 60,
      purchase_limit: 1,
    },
    // P8.3: Rare Flora per zone — was missing from catalog (spec P8.3)
    {
      item_code: 'rare_flora',
      name: 'Rare Flora',
      description: 'A rare botanical specimen for a specific subject zone in your Biome.',
      category: 'cosmetic',
      gate1_condition: { type: 'fruition_sessions_in_subject', count: 5 },
      gate2_seedling_cost: 10,
      // BUG 8 FIX: no global purchase_limit — per-subject enforcement is in purchaseItem
      // using inventory key `rare_flora_${subjectId}` (one per zone, unlimited zones).
      purchase_limit: null,
    },
    {
      item_code: 'artifact_night_scholar',
      name: 'The Night Scholar',
      description: 'Artifact for studying past midnight.',
      category: 'artifact',
      gate1_condition: { type: 'sessions_after_midnight', count: 10 },
      gate2_seedling_cost: 15,
      purchase_limit: 1,
    },
    {
      item_code: 'artifact_dawn_keeper',
      name: 'The Dawn Keeper',
      description: 'Artifact for early morning sessions.',
      category: 'artifact',
      gate1_condition: { type: 'sessions_before_7am', count: 10 },
      gate2_seedling_cost: 15,
      purchase_limit: 1,
    },
    {
      item_code: 'artifact_unbroken',
      name: 'The Unbroken',
      description: 'Artifact for sustained focus.',
      category: 'artifact',
      gate1_condition: { type: 'consecutive_days_no_wilt', count: 30 },
      gate2_seedling_cost: 20,
      purchase_limit: 1,
    },
    {
      item_code: 'artifact_archivist',
      name: 'The Archivist',
      description: 'Artifact for completing Archive Expansion.',
      category: 'artifact',
      gate1_condition: { type: 'archive_expansion_owned', count: 1 },
      gate2_seedling_cost: 10,
      purchase_limit: 1,
    },
  ];
  // Migrated from Firestore batch: ON CONFLICT DO NOTHING for idempotency
  for (const item of items) {
    const id = randomUUID();
    await query(
      `INSERT INTO marketplace_items (id, item_code, name, description, category, gate1_condition, gate2_seedling_cost, purchase_limit, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (item_code) DO NOTHING`,
      [id, item.item_code, item.name, item.description, item.category,
       JSON.stringify(item.gate1_condition), item.gate2_seedling_cost, item.purchase_limit, new Date()]
    );
  }
  return items;
},
async findAll() {
  const { rows } = await query('SELECT * FROM marketplace_items ORDER BY created_at ASC');
  return rows;
},
async findByCode(code) {
  const { rows } = await query(
    'SELECT * FROM marketplace_items WHERE item_code = $1 LIMIT 1',
    [code]
  );
  return rows[0] || null;
},
},
// ── exam_sessions extension helpers ─────────────────────────────────────────
examSessionsExt: {
async addIsReckoning(userId, examSessionId, isReckoning) {
  return db.examSessions.update(userId, examSessionId, { is_reckoning: isReckoning });
},
},
// ── mastery_goals (PB.1) — [DESIGN: §12.1, §12.2, §12.3] ──────────────────
masteryGoals: {
async create(userId, data) {
  const id = randomUUID();
  const now = new Date();
  const payload = {
    // Identity
    user_id:             userId,
    subject_id:          data.subject_id          || null,
    name:                data.name                || null,
    card_ids:            data.card_ids            || [],
    cross_bubble_card_ids: data.cross_bubble_card_ids || [],
    deck_ids:            data.deck_ids            || [],
    // Timeline [DESIGN: §12.1]
    created_at:          now,
    test_date:           data.test_date           || null,
    exam_date:           data.exam_date           || null,
    deadline_editable:   true,
    status:              data.exam_date ? 'active' : 'dormant',
    // Phase [DESIGN: §12.1]
    phase:               'SEEDING',
    phase_entered_at:    now,
    phase_history:       [],
    // Progress [DESIGN: §12.1]
    current_ks:          0,
    target_ks:           100,
    required_ks_per_day: 0,
    actual_ks_velocity:  0,
    trajectory_gap:      0,
    trajectory_status:   'ON_TRACK',
    projected_completion_date:   null,
    projected_best_case:         null,
    projected_minimum_viable:    null,
    // Daily Contract [DESIGN: §9, §12.1]
    daily_contract_cards:        0,
    daily_contract_breakdown:    {},
    daily_contract_minutes:      0,
    daily_contract_generated_at: null,
    daily_contract_completed:    false,
    daily_contract_consequence:  null,
    // Stall Detection [DESIGN: §6, §12.1]
    stall_active:              false,
    stall_detected_at:         null,
    stall_cause:               null,
    stall_response_active:     null,
    consecutive_low_velocity_days: 0,
    stall_resolved_at:         null,
    // Velocity [DESIGN: §3.4]
    velocity_samples:     [],
    last_recalculated_at: null,
    // Outcomes [DESIGN: §12.1]
    completed_at:              null,
    final_ks_at_deadline:      null,
    rescue_active:             false,
    rescue_mode_entered_at:    null,
    learning_debt_card_count:  0,
    test_date_gate_failed:     false,
    // Rescue and early-stall flags
    rescue_eligible:              false,
    seeding_early_stall_checked:  false,
    // Contract Streaks (GAP-S4)
    contract_streak_current:      0,
    contract_streak_best:         0,
    // Miss-consequence field (GAP-M2)
    daily_contract_miss_consequence: null,
    // Autopsy [DESIGN: §11]
    autopsy_generated:    false,
    autopsy_generated_at: null,
    // Coverage tracking [DESIGN: §2.2]
    coverage_gap_active:  false,
    ...data,
    // These must override any spread — created_at is authoritative
    id,
    user_id:     userId,
    created_at:  now,
    updated_at:  now,
  };
  const q = _buildInsert('mastery_goals', payload);
  await query(q.text, q.values);
  return { id, ...payload };
},
async findById(userId, goalId) {
  const { rows } = await query(
    'SELECT * FROM mastery_goals WHERE id = $1 AND user_id = $2 LIMIT 1',
    [goalId, userId]
  );
  return rows[0] || null;
},
async findByUser(userId, statusFilter = null) {
  let sql = 'SELECT * FROM mastery_goals WHERE user_id = $1';
  const vals = [userId];
  if (statusFilter) { sql += ` AND status = $${vals.length + 1}`; vals.push(statusFilter); }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await query(sql, vals);
  return rows;
},
async findActive(userId) {
  return this.findByUser(userId, 'active');
},
async findBySubject(userId, subjectId) {
  const { rows } = await query(
    "SELECT * FROM mastery_goals WHERE user_id = $1 AND subject_id = $2 AND status = 'active'",
    [userId, subjectId]
  );
  return rows;
},
async update(userId, goalId, data) {
  const payload = { ...data, updated_at: new Date() };
  const q = _buildUpdate('mastery_goals', 'id', goalId, payload, userId);
  const result = await query(q.text, q.values);
  if (result.rowCount === 0) return null;
  const { rows } = await query(
    'SELECT * FROM mastery_goals WHERE id = $1 AND user_id = $2 LIMIT 1',
    [goalId, userId]
  );
  return rows[0] ? { id: goalId, ...rows[0] } : null;
},
async archive(userId, goalId, finalStatus = 'archived') {
  return this.update(userId, goalId, {
    status:      finalStatus,
    archived_at: new Date(),
  });
},
// goal_history sub-collection [DESIGN: §12.2] — migrated to goal_history table
// Event-specific fields live in data JSONB so history writes remain schema-stable.
async addHistoryEntry(goalId, entry) {
  const id = randomUUID();
  const createdAt = entry?.created_at ? new Date(entry.created_at) : new Date();
  const eventType = entry?.event_type || null;
  const data = { ...(entry || {}) };
  delete data.event_type;
  delete data.created_at;
  await query(
    'INSERT INTO goal_history (id, goal_id, event_type, data, created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, goalId, eventType, JSON.stringify(data), createdAt]
  );
  return { id, goal_id: goalId, event_type: eventType, ...data, created_at: createdAt };
},
async getHistory(goalId, limit = 90) {
  const { rows } = await query(
    'SELECT * FROM goal_history WHERE goal_id = $1 ORDER BY created_at DESC LIMIT $2',
    [goalId, limit]
  );
  return rows.map((row) => ({ ...row, ...(row.data || {}) }));
},
async getHistoryForWeek(goalId, weekStart, weekEnd) {
  const { rows } = await query(
    'SELECT * FROM goal_history WHERE goal_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at ASC',
    [goalId, weekStart, weekEnd]
  );
  return rows.map((row) => ({ ...row, ...(row.data || {}) }));
},
// concept_clusters sub-collection [DESIGN: §12.3] — migrated to concept_clusters table
async addCluster(goalId, clusterData) {
  const id = randomUUID();
  const payload = {
    id,
    goal_id:        goalId,
    name:           clusterData.name     || 'All Cards',
    card_ids:       clusterData.card_ids || [],
    cluster_ks:     clusterData.cluster_ks || 0,
    cluster_status: 'WEAK',
    identified_at:  new Date(),
    last_ks_update: new Date(),
    updated_at:     new Date(),
  };
  await query(
    `INSERT INTO concept_clusters (id, goal_id, name, card_ids, cluster_ks, cluster_status, identified_at, last_ks_update, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, goalId, payload.name, JSON.stringify(payload.card_ids), payload.cluster_ks,
     payload.cluster_status, payload.identified_at, payload.last_ks_update, payload.updated_at]
  );
  return { id, ...payload };
},
async getClusters(goalId) {
  const { rows } = await query(
    'SELECT * FROM concept_clusters WHERE goal_id = $1 ORDER BY identified_at ASC',
    [goalId]
  );
  return rows;
},
async updateCluster(goalId, clusterId, data) {
  const payload = { ...data, last_ks_update: new Date(), updated_at: new Date() };
  const q = _buildUpdate('concept_clusters', 'id', clusterId, payload);
  await query(q.text, q.values);
  const { rows } = await query('SELECT * FROM concept_clusters WHERE id = $1', [clusterId]);
  return { id: clusterId, ...rows[0] };
},
},
};
