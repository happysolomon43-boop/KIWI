// ════════════════════════════════════════════════════════════════════════════
//  KIWI BACKEND — Living Ecosystem Edition
//  Output: Index(Kiwi).js
//  Single file. No local imports. All services inlined.

// ════════════════════════════════════════════════════════════════════════════
'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cron = require('node-cron');
// GoogleGenerativeAI SDK replaced with CEE-style raw fetch — see geminiModel below
// ── Firebase Admin (inlined DB layer, replaces firestore-db) ─────────────────
const admin = require('firebase-admin');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
if (!admin.apps.length) {
admin.initializeApp({
credential: admin.credential.cert({
projectId: process.env.FIREBASE_PROJECT_ID,
clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
}),
});
}
const firestore = getFirestore();

// ════════════════════════════════════════════════════════════════════════════
//  INLINE DB LAYER (replaces firestore-db)

// ════════════════════════════════════════════════════════════════════════════
const db = {
// ── users ───────────────────────────────────────────────────────────────────
users: {
async findById(id) {
const doc = await firestore.collection('users').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async findByUsernameOrEmail(username, email) {
let snap = await firestore
.collection('users')
.where('username', '==', username)
.limit(1)
.get();
if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
snap = await firestore.collection('users').where('email', '==', email).limit(1).get();
if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
return null;
},
async findByEmailWithStats(email) {
const snap = await firestore.collection('users').where('email', '==', email).limit(1).get();
if (snap.empty) return null;
const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
const stats = await db.userStats.get(user.id);
return { ...user, stats };
},
async create(data) {
const id = data.id || firestore.collection('users').doc().id;
const now = new Date();
const payload = { ...data, created_at: now, updated_at: now };
await firestore.collection('users').doc(id).set(payload);
return { id, ...payload };
},
async update(id, data) {
const ref = firestore.collection('users').doc(id);
const payload = { ...data, updated_at: new Date() };
await ref.update(payload);
const doc = await ref.get();
return { id, ...doc.data() };
},
async delete(id) {
await firestore.collection('users').doc(id).delete();
return true;
},
async findAll() {
const snap = await firestore.collection('users').get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── user_stats ──────────────────────────────────────────────────────────────
userStats: {
async get(userId) {
const doc = await firestore.collection('user_stats').doc(userId).get();
return doc.exists ? { userId: doc.id, ...doc.data() } : null;
},
async create(userId) {
const payload = {
userId,
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
await firestore.collection('user_stats').doc(userId).set(payload);
return payload;
},
async update(userId, data) {
const ref = firestore.collection('user_stats').doc(userId);
const updatePayload = {};
for (const [k, v] of Object.entries(data)) {
if (v && typeof v === 'object' && v.increment !== undefined) {
updatePayload[k] = FieldValue.increment(v.increment);
} else {
updatePayload[k] = v;
}
}
updatePayload.updated_at = new Date();
await ref.update(updatePayload);
const doc = await ref.get();
return { userId, ...doc.data() };
},
async leaderboard(limit = 20, offset = 0) {
const snap = await firestore
.collection('user_stats')
.orderBy('total_xp', 'desc')
.offset(offset)
.limit(limit)
.get();
return snap.docs.map((d) => ({ userId: d.id, ...d.data() }));
},
async countWithMoreXP(totalXP) {
const snap = await firestore
.collection('user_stats')
.where('total_xp', '>', totalXP)
.count()
.get();
return snap.data().count || 0;
},
async findAll() {
const snap = await firestore.collection('user_stats').get();
return snap.docs.map((d) => ({ userId: d.id, ...d.data() }));
},
},
// ── refresh_tokens ──────────────────────────────────────────────────────────
refreshTokens: {
async create(userId, tokenHash, expiresAt) {
await firestore
.collection('refresh_tokens')
.doc(tokenHash)
.set({ userId, tokenHash, expires_at: expiresAt, created_at: new Date() });
return true;
},
async findByHash(hash, userId) {
const doc = await firestore.collection('refresh_tokens').doc(hash).get();
if (!doc.exists) return null;
const data = doc.data();
return data.userId === userId ? data : null;
},
async deleteByHash(hash) {
await firestore.collection('refresh_tokens').doc(hash).delete();
return true;
},
async deleteByUserId(userId) {
const snap = await firestore.collection('refresh_tokens').where('userId', '==', userId).get();
const batch = firestore.batch();
snap.docs.forEach((d) => batch.delete(d.ref));
await batch.commit();
return true;
},
},
// ── subjects ───────────────────────────────────────────────────────────────
subjects: {
async findById(id) {
const doc = await firestore.collection('subjects').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async findManyWithDecks(userId) {
const subSnap = await firestore.collection('subjects').where('user_id', '==', userId).get();
const subjects = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const deckSnap = await firestore.collection('decks').where('user_id', '==', userId).get();
const decks = deckSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
const id = firestore.collection('subjects').doc().id;
const payload = { ...data, user_id: userId, created_at: new Date(), updated_at: new Date() };
await firestore.collection('subjects').doc(id).set(payload);
return { id, ...payload };
},
async update(userId, id, data) {
const ref = firestore.collection('subjects').doc(id);
const payload = { ...data, updated_at: new Date() };
await ref.update(payload);
const doc = await ref.get();
return { id, ...doc.data() };
},
async delete(userId, id) {
await firestore.collection('subjects').doc(id).delete();
return true;
},
},
// ── topics ──────────────────────────────────────────────────────────────────
topics: {
async findMany(userId, subjectId) {
const snap = await firestore
.collection('topics')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async create(userId, subjectId, name) {
const id = firestore.collection('topics').doc().id;
const payload = { user_id: userId, subject_id: subjectId, name, created_at: new Date() };
await firestore.collection('topics').doc(id).set(payload);
return { id, ...payload };
},
},
// ── decks ───────────────────────────────────────────────────────────────────
decks: {
async findMany(userId, filters = {}) {
let q = firestore.collection('decks').where('user_id', '==', userId);
if (filters.subject_id) q = q.where('subject_id', '==', filters.subject_id);
if (filters.topic_id) q = q.where('topic_id', '==', filters.topic_id);
const snap = await q.get();
const decks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
return { decks, total: decks.length };
},
async create(userId, data) {
const id = firestore.collection('decks').doc().id;
const payload = { ...data, user_id: userId, created_at: new Date(), updated_at: new Date() };
await firestore.collection('decks').doc(id).set(payload);
return { id, ...payload };
},
async findByIdFull(userId, id) {
const doc = await firestore.collection('decks').doc(id).get();
if (!doc.exists) return null;
const deck = { id: doc.id, ...doc.data() };
const cardSnap = await firestore
.collection('cards')
.where('user_id', '==', userId)
.where('deck_id', '==', id)
.get();
deck.cards = cardSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
return deck;
},
async findById(userId, id) {
const doc = await firestore.collection('decks').doc(id).get();
if (!doc.exists) return null;
return { id: doc.id, ...doc.data() };
},
async update(userId, id, data) {
const ref = firestore.collection('decks').doc(id);
const payload = { ...data, updated_at: new Date() };
await ref.update(payload);
const doc = await ref.get();
return { id, ...doc.data() };
},
async delete(userId, id) {
await firestore.collection('decks').doc(id).delete();
return true;
},
async findBySubject(userId, subjectId) {
const snap = await firestore
.collection('decks')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findBySubjectWithCards(userId, subjectId) {
const decks = await this.findBySubject(userId, subjectId);
for (const deck of decks) {
const cardSnap = await firestore
.collection('cards')
.where('user_id', '==', userId)
.where('deck_id', '==', deck.id)
.get();
deck.cards = cardSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
return decks;
},
async count(userId, filters = {}) {
let q = firestore.collection('decks').where('user_id', '==', userId);
if (filters.is_public !== undefined) q = q.where('is_public', '==', filters.is_public);
const snap = await q.count().get();
return snap.data().count || 0;
},
},
// ── cards ───────────────────────────────────────────────────────────────────
cards: {
async findById(userId, id) {
const doc = await firestore.collection('cards').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async findMany(userId, filters = {}, { page = 1, limit = 50 } = {}) {
let q = firestore.collection('cards').where('user_id', '==', userId);
if (filters.deck_id) q = q.where('deck_id', '==', filters.deck_id);
if (filters.stage !== undefined) q = q.where('stage', '==', filters.stage);
const snap = await q.get();
let cards = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const total = cards.length;
const start = (page - 1) * limit;
cards = cards.slice(start, start + limit);
return { cards, total, page, total_pages: Math.ceil(total / limit) };
},
async create(userId, data) {
const id = firestore.collection('cards').doc().id;
const payload = {
...data,
user_id: userId,
stage: data.stage || 1,
interval_days: data.interval_days || 1,
easiness_factor: data.easiness_factor || 2.5,
repetition_count: data.repetition_count || 0,
next_review_at: data.next_review_at || new Date(),
created_at: new Date(),
updated_at: new Date(),
};
await firestore.collection('cards').doc(id).set(payload);
return { id, ...payload };
},
async createMany(userId, deckId, cardsData) {
const batch = firestore.batch();
const created = [];
for (const c of cardsData) {
const id = firestore.collection('cards').doc().id;
const payload = {
...c,
user_id: userId,
deck_id: deckId,
stage: 1,
interval_days: 1,
easiness_factor: 2.5,
repetition_count: 0,
next_review_at: new Date(),
created_at: new Date(),
updated_at: new Date(),
};
batch.set(firestore.collection('cards').doc(id), payload);
created.push({ id, ...payload });
}
await batch.commit();
return created;
},
async update(userId, id, data) {
const ref = firestore.collection('cards').doc(id);
const payload = { ...data, updated_at: new Date() };
await ref.update(payload);
const doc = await ref.get();
return { id, ...doc.data() };
},
async delete(userId, id) {
await firestore.collection('cards').doc(id).delete();
return true;
},
async countByDeck(userId, deckId) {
const snap = await firestore
.collection('cards')
.where('user_id', '==', userId)
.where('deck_id', '==', deckId)
.count()
.get();
return snap.data().count || 0;
},
async findAllForUser(userId) {
const snap = await firestore.collection('cards').where('user_id', '==', userId).get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findByDeck(userId, deckId) {
const snap = await firestore
.collection('cards')
.where('user_id', '==', userId)
.where('deck_id', '==', deckId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findByDeckIds(userId, deckIds) {
if (!deckIds || deckIds.length === 0) return [];
const all = [];
for (const deckId of deckIds) {
const snap = await firestore
.collection('cards')
.where('user_id', '==', userId)
.where('deck_id', '==', deckId)
.get();
all.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}
return all;
},
async countMastered(userId, sinceDate) {
let q = firestore.collection('cards').where('user_id', '==', userId).where('stage', '==', 5);
if (sinceDate) {
q = q.where('last_reviewed_at', '>=', sinceDate);
}
const snap = await q.count().get();
return snap.data().count || 0;
},
},
// ── review_logs ─────────────────────────────────────────────────────────────
reviewLogs: {
async create(userId, data) {
const id = firestore.collection('review_logs').doc().id;
const payload = { ...data, user_id: userId, created_at: new Date() };
await firestore.collection('review_logs').doc(id).set(payload);
return { id, ...payload };
},
async findByCards(userId, cardIds) {
if (!cardIds || cardIds.length === 0) return [];
const snap = await firestore
.collection('review_logs')
.where('user_id', '==', userId)
.where('card_id', 'in', cardIds.slice(0, 10))
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findByUser(userId, sinceDate) {
const snap = await firestore
.collection('review_logs')
.where('user_id', '==', userId)
.where('reviewed_at', '>=', sinceDate)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async count(userId, filters = {}) {
let q = firestore.collection('review_logs').where('user_id', '==', userId);
if (filters.reviewed_at_gte) q = q.where('reviewed_at', '>=', filters.reviewed_at_gte);
const snap = await q.count().get();
return snap.data().count || 0;
},
},
// ── sessions ────────────────────────────────────────────────────────────────
sessions: {
async create(userId, deckId, startedAt) {
const id = firestore.collection('sessions').doc().id;
const payload = {
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
await firestore.collection('sessions').doc(id).set(payload);
return { id, ...payload };
},
async findById(userId, id) {
const doc = await firestore.collection('sessions').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async findByIdFull(userId, id) {
const doc = await firestore.collection('sessions').doc(id).get();
if (!doc.exists) return null;
const session = { id: doc.id, ...doc.data() };
if (session.deck_id) {
const deckDoc = await firestore.collection('decks').doc(session.deck_id).get();
if (deckDoc.exists) session.deck = { id: deckDoc.id, ...deckDoc.data() };
}
return session;
},
async update(userId, id, data) {
const ref = firestore.collection('sessions').doc(id);
const payload = {};
for (const [k, v] of Object.entries(data)) {
if (v && typeof v === 'object' && v.increment !== undefined)
payload[k] = FieldValue.increment(v.increment);
else payload[k] = v;
}
payload.updated_at = new Date();
await ref.update(payload);
const doc = await ref.get();
return { id, ...doc.data() };
},
async findMany(userId, filters = {}, { limit = 20, offset = 0 } = {}) {
let q = firestore.collection('sessions').where('user_id', '==', userId);
if (filters.session_completed !== undefined)
q = q.where('session_completed', '==', filters.session_completed);
if (filters.deck_id) q = q.where('deck_id', '==', filters.deck_id);
if (filters.started_at_gte) q = q.where('started_at', '>=', filters.started_at_gte);
const snap = await q.orderBy('started_at', 'desc').offset(offset).limit(limit).get();
return { sessions: snap.docs.map((d) => ({ id: d.id, ...d.data() })), total: snap.size };
},
async findBySubject(userId, subjectId, sinceDate) {
const decks = await db.decks.findBySubject(userId, subjectId);
const deckIds = decks.map((d) => d.id);
if (deckIds.length === 0) return [];
let q = firestore
.collection('sessions')
.where('user_id', '==', userId)
.where('deck_id', 'in', deckIds.slice(0, 10));
if (sinceDate) q = q.where('started_at', '>=', sinceDate);
const snap = await q.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async count(userId, filters = {}) {
let q = firestore.collection('sessions').where('user_id', '==', userId);
if (filters.session_completed !== undefined)
q = q.where('session_completed', '==', filters.session_completed);
if (filters.started_at_gte) q = q.where('started_at', '>=', filters.started_at_gte);
const snap = await q.count().get();
return snap.data().count || 0;
},
},
// ── exam_sessions ───────────────────────────────────────────────────────────
examSessions: {
async create(userId, data) {
const id = firestore.collection('exam_sessions').doc().id;
const payload = {
...data,
user_id: userId,
started_at: new Date(),
is_reckoning: data.is_reckoning || false,
status: data.status || 'pending',
created_at: new Date(),
};
await firestore.collection('exam_sessions').doc(id).set(payload);
return { id, ...payload };
},
async update(userId, id, data) {
const ref = firestore.collection('exam_sessions').doc(id);
const payload = { ...data, updated_at: new Date() };
await ref.update(payload);
const doc = await ref.get();
return { id, ...doc.data() };
},
async findByIdWithQuestions(userId, id) {
const doc = await firestore.collection('exam_sessions').doc(id).get();
if (!doc.exists) return null;
const exam = { id: doc.id, ...doc.data() };
const qSnap = await firestore
.collection('exam_questions')
.where('exam_session_id', '==', id)
.get();
exam.questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
return exam;
},
async findMany(userId, filters = {}, { limit = 20, offset = 0 } = {}) {
let q = firestore.collection('exam_sessions').where('user_id', '==', userId);
if (filters.status) q = q.where('status', '==', filters.status);
const snap = await q.orderBy('created_at', 'desc').offset(offset).limit(limit).get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── exam_questions ──────────────────────────────────────────────────────────
examQuestions: {
async create(userId, examSessionId, data) {
const id = firestore.collection('exam_questions').doc().id;
const payload = {
...data,
user_id: userId,
exam_session_id: examSessionId,
created_at: new Date(),
};
await firestore.collection('exam_questions').doc(id).set(payload);
return { id, ...payload };
},
async findByNumber(userId, examSessionId, questionNumber) {
const snap = await firestore
.collection('exam_questions')
.where('user_id', '==', userId)
.where('exam_session_id', '==', examSessionId)
.where('question_number', '==', questionNumber)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async findById(userId, id) {
const doc = await firestore.collection('exam_questions').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async update(userId, id, data) {
const ref = firestore.collection('exam_questions').doc(id);
await ref.update({ ...data, updated_at: new Date() });
const doc = await ref.get();
return { id, ...doc.data() };
},
// BUG #4 FIX: findBySession was absent — recomputeAndStoreCardState always received
// examLogs = [] because the guard `db.examQuestions.findBySession ?` silently failed.
async findBySession(userId, examSessionId) {
const snap = await firestore
.collection('exam_questions')
.where('user_id', '==', userId)
.where('exam_session_id', '==', examSessionId)
.get();
return snap.docs.map(d => ({ id: d.id, ...d.data() }));
},
},
// ── subject_stats ────────────────────────────────────────────────────────────
subjectStats: {
async get(userId, subjectId) {
const snap = await firestore
.collection('subject_stats')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async upsert(userId, subjectId, data) {
const snap = await firestore
.collection('subject_stats')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.limit(1)
.get();
if (!snap.empty) {
const ref = snap.docs[0].ref;
await ref.update({ ...data, updated_at: new Date() });
const doc = await ref.get();
return { id: doc.id, ...doc.data() };
}
const id = firestore.collection('subject_stats').doc().id;
const payload = {
user_id: userId,
subject_id: subjectId,
...data,
created_at: new Date(),
updated_at: new Date(),
};
await firestore.collection('subject_stats').doc(id).set(payload);
return { id, ...payload };
},
async findMany(userId) {
const snap = await firestore.collection('subject_stats').where('user_id', '==', userId).get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── achievements ─────────────────────────────────────────────────────────────
achievements: {
async upsert(code, data) {
const snap = await firestore
.collection('achievements')
.where('code', '==', code)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({ ...data, updated_at: new Date() });
return { id: snap.docs[0].id, ...data };
}
const id = firestore.collection('achievements').doc().id;
await firestore
.collection('achievements')
.doc(id)
.set({ ...data, code, created_at: new Date() });
return { id, ...data };
},
async findAll() {
const snap = await firestore.collection('achievements').get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── user_achievements ───────────────────────────────────────────────────────
userAchievements: {
async create(userId, achievementId) {
const id = firestore.collection('user_achievements').doc().id;
const payload = {
user_id: userId,
achievement_id: achievementId,
unlocked_at: new Date(),
shown_to_user: false,
};
await firestore.collection('user_achievements').doc(id).set(payload);
return { id, ...payload };
},
async findManyWithAchievement(userId) {
const snap = await firestore
.collection('user_achievements')
.where('user_id', '==', userId)
.get();
const results = [];
for (const d of snap.docs) {
const ua = { id: d.id, ...d.data() };
const achDoc = await firestore.collection('achievements').doc(ua.achievement_id).get();
if (achDoc.exists) ua.achievement = { id: achDoc.id, ...achDoc.data() };
results.push(ua);
}
return results;
},
async markShown(userId, achievementId) {
const snap = await firestore
.collection('user_achievements')
.where('user_id', '==', userId)
.where('achievement_id', '==', achievementId)
.limit(1)
.get();
if (!snap.empty) await snap.docs[0].ref.update({ shown_to_user: true });
return true;
},
},
// ── tasks ────────────────────────────────────────────────────────────────────
tasks: {
async findMany(userId, filters = {}) {
let q = firestore.collection('tasks').where('user_id', '==', userId);
if (filters.status) q = q.where('status', '==', filters.status);
const snap = await q.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async create(userId, data) {
const id = firestore.collection('tasks').doc().id;
const payload = {
...data,
user_id: userId,
status: 'active',
current_value: 0,
created_at: new Date(),
};
await firestore.collection('tasks').doc(id).set(payload);
return { id, ...payload };
},
async update(userId, taskId, data) {
const ref = firestore.collection('tasks').doc(taskId);
await ref.update({ ...data, updated_at: new Date() });
const doc = await ref.get();
return { id: doc.id, ...doc.data() };
},
async deleteActive(userId) {
const snap = await firestore
.collection('tasks')
.where('user_id', '==', userId)
.where('status', '==', 'active')
.get();
const batch = firestore.batch();
snap.docs.forEach((d) => batch.delete(d.ref));
await batch.commit();
return true;
},
async findById(userId, taskId) {
const doc = await firestore.collection('tasks').doc(taskId).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
},
// ── community_decks ─────────────────────────────────────────────────────────
communityDecks: {
async findMany({ search, tags } = {}, { page = 1, limit = 20 } = {}) {
let q = firestore.collection('community_decks');
if (search) q = q.where('title', '>=', search).where('title', '<=', search + '\uf8ff');
const snap = await q
.offset((page - 1) * limit)
.limit(limit)
.get();
return { decks: snap.docs.map((d) => ({ id: d.id, ...d.data() })), total: snap.size };
},
async findById(id) {
const doc = await firestore.collection('community_decks').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async findByIdWithOriginalCards(id) {
const cd = await this.findById(id);
if (!cd || !cd.original_deck_id) return cd;
const deckDoc = await firestore.collection('decks').doc(cd.original_deck_id).get();
if (deckDoc.exists) cd.originalDeck = { id: deckDoc.id, ...deckDoc.data() };
if (cd.originalDeck) {
const cardSnap = await firestore
.collection('cards')
.where('deck_id', '==', cd.original_deck_id)
.get();
cd.originalDeck.cards = cardSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
return cd;
},
async upsertByOriginalDeck(originalDeckId, data) {
const snap = await firestore
.collection('community_decks')
.where('original_deck_id', '==', originalDeckId)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({ ...data, updated_at: new Date() });
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
const id = firestore.collection('community_decks').doc().id;
await firestore
.collection('community_decks')
.doc(id)
.set({ ...data, original_deck_id: originalDeckId, created_at: new Date() });
return { id, ...data };
},
async update(id, data) {
const ref = firestore.collection('community_decks').doc(id);
await ref.update({ ...data, updated_at: new Date() });
const doc = await ref.get();
return { id, ...doc.data() };
},
async count({ author_id } = {}) {
if (!author_id) return 0;
const snap = await firestore
.collection('community_decks')
.where('author_id', '==', author_id)
.count()
.get();
return snap.data().count || 0;
},
},
// ── community_ratings ────────────────────────────────────────────────────────
communityRatings: {
async upsert(communityDeckId, userId, rating) {
const snap = await firestore
.collection('community_ratings')
.where('community_deck_id', '==', communityDeckId)
.where('user_id', '==', userId)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({ rating, updated_at: new Date() });
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
const id = firestore.collection('community_ratings').doc().id;
await firestore
.collection('community_ratings')
.doc(id)
.set({
community_deck_id: communityDeckId,
user_id: userId,
rating,
created_at: new Date(),
});
return { id, community_deck_id: communityDeckId, user_id: userId, rating };
},
async findByDeck(communityDeckId) {
const snap = await firestore
.collection('community_ratings')
.where('community_deck_id', '==', communityDeckId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
const id = firestore.collection('knowledge_scores').doc().id;
const payload = {
user_id: userId,
subject_id: subjectId,
score,
band,
recorded_at: new Date(),
};
await firestore.collection('knowledge_scores').doc(id).set(payload);
return { id, ...payload };
},
async findBySubject(userId, subjectId, limit = 52) {
const snap = await firestore
.collection('knowledge_scores')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.orderBy('recorded_at', 'desc')
.limit(limit)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},

//  NEW COLLECTIONS (Phases 2–8)

// ════════════════════════════════════════════════════════════════════════════
// ── card_states ─────────────────────────────────────────────────────────────
cardStates: {
async get(userId, cardId) {
const snap = await firestore
.collection('card_states')
.where('user_id', '==', userId)
.where('card_id', '==', cardId)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async create(userId, cardId, data) {
const id = firestore.collection('card_states').doc().id;
const payload = {
user_id: userId,
card_id: cardId,
state: data.state || 'SEEDLING',
stage: data.stage || 1,
// P2.1 FIX: weight removed — always use computeEffectiveWeight() at read time
verified: data.verified || false,
verified_at: data.verified_at || null,
last_evaluated_at: new Date(),
created_at: new Date(),
// PB.1: Mastery Bubble card fields [DESIGN: §12.4]
bubble_ids:          data.bubble_ids         || [],
learning_debt:       data.learning_debt       || false,
cross_bubble:        data.cross_bubble        || false,
parking_expires_at:  data.parking_expires_at  || null,
...data,
};
await firestore.collection('card_states').doc(id).set(payload);
return { id, ...payload };
},
async update(userId, cardId, data) {
const snap = await firestore
.collection('card_states')
.where('user_id', '==', userId)
.where('card_id', '==', cardId)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({
...data,
last_evaluated_at: new Date(),
updated_at: new Date(),
});
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
return this.create(userId, cardId, data);
},
async findByUser(userId) {
const snap = await firestore.collection('card_states').where('user_id', '==', userId).get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findBySubject(userId, subjectId) {
const decks = await db.decks.findBySubject(userId, subjectId);
const deckIds = decks.map((d) => d.id);
if (deckIds.length === 0) return [];
const allStates = [];
for (const deckId of deckIds) {
const cards = await db.cards.findByDeck(userId, deckId);
const cardIds = cards.map((c) => c.id);
for (const cardId of cardIds) {
const state = await this.get(userId, cardId);
if (state) allStates.push(state);
}
}
return allStates;
},
},
// ── brain_pressure ──────────────────────────────────────────────────────────
brainPressure: {
async get(userId, subjectId) {
const snap = await firestore
.collection('brain_pressure')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async set(userId, subjectId, data) {
const snap = await firestore
.collection('brain_pressure')
.where('user_id', '==', userId)
.where('subject_id', '==', subjectId)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({ ...data, updated_at: new Date() });
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
const id = firestore.collection('brain_pressure').doc().id;
const payload = {
user_id: userId,
subject_id: subjectId,
pressure_score: 0,
intervention_level: 'L0',
sources: {},
...data,
created_at: new Date(),
updated_at: new Date(),
};
await firestore.collection('brain_pressure').doc(id).set(payload);
return { id, ...payload };
},
async findByUser(userId) {
const snap = await firestore
.collection('brain_pressure')
.where('user_id', '==', userId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── reckoning_sessions ──────────────────────────────────────────────────────
reckoningSessions: {
async findById(id) {
const doc = await firestore.collection('reckoning_sessions').doc(id).get();
return doc.exists ? { id: doc.id, ...doc.data() } : null;
},
async create(userId, data) {
const id = firestore.collection('reckoning_sessions').doc().id;
const payload = {
user_id: userId,
status: 'triggered',
...data,
created_at: new Date(),
updated_at: new Date(),
};
await firestore.collection('reckoning_sessions').doc(id).set(payload);
return { id, ...payload };
},
async update(id, data) {
const ref = firestore.collection('reckoning_sessions').doc(id);
await ref.update({ ...data, updated_at: new Date() });
const doc = await ref.get();
return { id, ...doc.data() };
},
async findActiveByUser(userId) {
const snap = await firestore
.collection('reckoning_sessions')
.where('user_id', '==', userId)
.where('status', 'in', ['triggered', 'deferred', 'in_progress'])
.orderBy('created_at', 'desc')
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async findByUser(userId) {
const snap = await firestore
.collection('reckoning_sessions')
.where('user_id', '==', userId)
.orderBy('created_at', 'desc')
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── chronicle_entries ────────────────────────────────────────────────────────
chronicleEntries: {
async create(userId, data) {
const id = firestore.collection('chronicle_entries').doc().id;
const payload = { user_id: userId, ...data, created_at: new Date() };
await firestore.collection('chronicle_entries').doc(id).set(payload);
return { id, ...payload };
},
async findByUser(userId) {
const snap = await firestore
.collection('chronicle_entries')
.where('user_id', '==', userId)
.orderBy('week_start', 'desc')
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findLatest(userId) {
const snap = await firestore
.collection('chronicle_entries')
.where('user_id', '==', userId)
.orderBy('week_start', 'desc')
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
},
// ── almanac_entries ─────────────────────────────────────────────────────────
almanacEntries: {
async create(userId, data) {
const id = firestore.collection('almanac_entries').doc().id;
const payload = {
user_id: userId,
unlocked: false,
unlocked_at: null,
narrative: null,
...data,
created_at: new Date(),
};
await firestore.collection('almanac_entries').doc(id).set(payload);
return { id, ...payload };
},
async findByUser(userId) {
const snap = await firestore
.collection('almanac_entries')
.where('user_id', '==', userId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async unlock(userId, entryCode, narrative) {
const snap = await firestore
.collection('almanac_entries')
.where('user_id', '==', userId)
.where('entry_code', '==', entryCode)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({
unlocked: true,
unlocked_at: new Date(),
narrative,
updated_at: new Date(),
});
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
return null;
},
},
// ── user_persona ────────────────────────────────────────────────────────────
userPersona: {
async get(userId) {
const snap = await firestore
.collection('user_persona')
.where('user_id', '==', userId)
.orderBy('assigned_week_start', 'desc')
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async create(userId, data) {
const id = firestore.collection('user_persona').doc().id;
// FIX-9: Do NOT overwrite assigned_week_start — caller supplies Monday 00:00
const payload = {
user_id: userId,
...data,
created_at: new Date(),
};
await firestore.collection('user_persona').doc(id).set(payload);
return { id, ...payload };
},
},
// ── daily_ritual_cache ──────────────────────────────────────────────────────
dailyRitualCache: {
async get(userId, type, dateStr) {
const snap = await firestore
.collection('daily_ritual_cache')
.where('user_id', '==', userId)
.where('type', '==', type)
.where('date', '==', dateStr)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async set(userId, type, dateStr, data) {
const snap = await firestore
.collection('daily_ritual_cache')
.where('user_id', '==', userId)
.where('type', '==', type)
.where('date', '==', dateStr)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({ ...data, updated_at: new Date() });
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
const id = firestore.collection('daily_ritual_cache').doc().id;
const payload = { user_id: userId, type, date: dateStr, ...data, created_at: new Date() };
await firestore.collection('daily_ritual_cache').doc(id).set(payload);
return { id, ...payload };
},
},
// ── seedling_transactions ───────────────────────────────────────────────────
seedlingTransactions: {
async create(userId, data) {
const id = firestore.collection('seedling_transactions').doc().id;
const payload = { user_id: userId, ...data, created_at: new Date() };
await firestore.collection('seedling_transactions').doc(id).set(payload);
return { id, ...payload };
},
async findByUser(userId) {
const snap = await firestore
.collection('seedling_transactions')
.where('user_id', '==', userId)
.orderBy('created_at', 'desc')
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
},
// ── user_inventory ──────────────────────────────────────────────────────────
userInventory: {
async getItem(userId, itemCode) {
const snap = await firestore
.collection('user_inventory')
.where('user_id', '==', userId)
.where('item_code', '==', itemCode)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
},
async setItem(userId, itemCode, data) {
const snap = await firestore
.collection('user_inventory')
.where('user_id', '==', userId)
.where('item_code', '==', itemCode)
.limit(1)
.get();
if (!snap.empty) {
await snap.docs[0].ref.update({ ...data, updated_at: new Date() });
return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
const id = firestore.collection('user_inventory').doc().id;
const payload = {
user_id: userId,
item_code: itemCode,
quantity: 0,
unlocked: false,
acquired_at: null,
...data,
created_at: new Date(),
};
await firestore.collection('user_inventory').doc(id).set(payload);
return { id, ...payload };
},
async findByUser(userId) {
const snap = await firestore
.collection('user_inventory')
.where('user_id', '==', userId)
.get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
for (const item of items) {
const id = firestore.collection('marketplace_items').doc().id;
await firestore
.collection('marketplace_items')
.doc(id)
.set({ ...item, created_at: new Date() });
}
return items;
},
async findAll() {
const snap = await firestore.collection('marketplace_items').get();
return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findByCode(code) {
const snap = await firestore
.collection('marketplace_items')
.where('item_code', '==', code)
.limit(1)
.get();
return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
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
  const id = firestore.collection('mastery_goals').doc().id;
  const now = new Date();
  const payload = {
    // Identity
    user_id:             userId,
    subject_id:          data.subject_id          || null,
    name:                data.name                || null,   // student-given name e.g. "Bio Unit 3"
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
    phase_history:       [],                              // [{phase, entered_at, exited_at, ks_at_entry, ks_at_exit}]
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
    daily_contract_breakdown:    {},                      // {FRAGILE:N, STUCK:N, AVOIDED:N, GROWING:N, ...}
    daily_contract_minutes:      0,
    daily_contract_generated_at: null,
    daily_contract_completed:    false,
    daily_contract_consequence:  null,                   // text shown if contract missed
    // Stall Detection [DESIGN: §6, §12.1]
    stall_active:              false,
    stall_detected_at:         null,
    stall_cause:               null,
    stall_response_active:     null,
    consecutive_low_velocity_days: 0,
    stall_resolved_at:         null,
    // Velocity [DESIGN: §3.4]
    velocity_samples:     [],                            // last 90 daily KS gains
    last_recalculated_at: null,
    // Outcomes [DESIGN: §12.1]
    completed_at:              null,
    final_ks_at_deadline:      null,
    rescue_active:             false,
    rescue_mode_entered_at:    null,
    learning_debt_card_count:  0,
    test_date_gate_failed:     false,
    // Rescue and early-stall flags (G3 / G4 gap fixes)
    rescue_eligible:              false,   // set when KS < 70 entering HARDENING [DESIGN: §2.4]
    seeding_early_stall_checked:  false,   // set after SEEDING midpoint KS < 20 check [DESIGN: §2.2]
    // Contract Streaks (GAP-S4) [DESIGN: §9.4]
    contract_streak_current:      0,        // consecutive days contract was completed
    contract_streak_best:         0,        // all-time best streak
    // Miss-consequence field (GAP-M2) [DESIGN: §9.2]
    daily_contract_miss_consequence: null,  // text shown if today's contract is skipped
    // Autopsy [DESIGN: §11]
    autopsy_generated:    false,
    autopsy_generated_at: null,
    // Coverage tracking [DESIGN: §2.2]
    coverage_gap_active:  false,
    ...data,
    // These must override any spread — created_at is authoritative
    user_id:     userId,
    created_at:  now,
    updated_at:  now,
  };
  await firestore.collection('mastery_goals').doc(id).set(payload);
  return { id, ...payload };
},
async findById(userId, goalId) {
  const doc = await firestore.collection('mastery_goals').doc(goalId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.user_id !== userId) return null;
  return { id: doc.id, ...data };
},
async findByUser(userId, statusFilter = null) {
  let q = firestore.collection('mastery_goals').where('user_id', '==', userId);
  if (statusFilter) q = q.where('status', '==', statusFilter);
  const snap = await q.orderBy('created_at', 'desc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async findActive(userId) {
  return this.findByUser(userId, 'active');
},
async findBySubject(userId, subjectId) {
  const snap = await firestore
    .collection('mastery_goals')
    .where('user_id', '==', userId)
    .where('subject_id', '==', subjectId)
    .where('status', '==', 'active')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async update(userId, goalId, data) {
  const ref = firestore.collection('mastery_goals').doc(goalId);
  await ref.update({ ...data, updated_at: new Date() });
  const doc = await ref.get();
  return { id: goalId, ...doc.data() };
},
async archive(userId, goalId, finalStatus = 'archived') {
  return this.update(userId, goalId, {
    status:      finalStatus,
    archived_at: new Date(),
  });
},
// goal_history sub-collection [DESIGN: §12.2]
async addHistoryEntry(goalId, entry) {
  const id = firestore.collection('mastery_goals').doc(goalId)
    .collection('goal_history').doc().id;
  const payload = { ...entry, created_at: new Date() };
  await firestore.collection('mastery_goals').doc(goalId)
    .collection('goal_history').doc(id).set(payload);
  return { id, ...payload };
},
async getHistory(goalId, limit = 90) {
  const snap = await firestore.collection('mastery_goals').doc(goalId)
    .collection('goal_history')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async getHistoryForWeek(goalId, weekStart, weekEnd) {
  const snap = await firestore.collection('mastery_goals').doc(goalId)
    .collection('goal_history')
    .where('created_at', '>=', weekStart)
    .where('created_at', '<=', weekEnd)
    .orderBy('created_at', 'asc')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
// concept_clusters sub-collection [DESIGN: §12.3]
async addCluster(goalId, clusterData) {
  const id = firestore.collection('mastery_goals').doc(goalId)
    .collection('concept_clusters').doc().id;
  const payload = {
    goal_id:        goalId,
    name:           clusterData.name     || 'All Cards',
    card_ids:       clusterData.card_ids || [],
    cluster_ks:     clusterData.cluster_ks || 0,
    cluster_status: 'WEAK',
    identified_at:  new Date(),
    last_ks_update: new Date(),
    updated_at:     new Date(),
  };
  await firestore.collection('mastery_goals').doc(goalId)
    .collection('concept_clusters').doc(id).set(payload);
  return { id, ...payload };
},
async getClusters(goalId) {
  const snap = await firestore.collection('mastery_goals').doc(goalId)
    .collection('concept_clusters').orderBy('identified_at', 'asc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
},
async updateCluster(goalId, clusterId, data) {
  const ref = firestore.collection('mastery_goals').doc(goalId)
    .collection('concept_clusters').doc(clusterId);
  await ref.update({ ...data, last_ks_update: new Date(), updated_at: new Date() });
  const doc = await ref.get();
  return { id: clusterId, ...doc.data() };
},
},
};

// ════════════════════════════════════════════════════════════════════════════
//  CONFIG & GEMINI

// ════════════════════════════════════════════════════════════════════════════
// Gemini API Key Rotation Pool — CEE-style, daily reset, round-robin
// Supports: GEMINI_API_KEY  +  GEMINI_API_KEY_2 .. GEMINI_API_KEY_15

function buildGeminiPool() {
const keys = [];
if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY.trim());
for (let i = 2; i <= 15; i++) {
const k = process.env[`GEMINI_API_KEY_${i}`];
if (k && k.trim()) keys.push(k.trim());
}
return keys;
}
const _geminiKeyObjs = buildGeminiPool().map((key, idx) => ({
key, index: idx, exhausted: false, lastResetDate: ''
}));
let _geminiRRIdx = 0;

function _resetGeminiKeyIfNewDay(k) {
const today = new Date().toISOString().split('T')[0];
if (k.lastResetDate !== today) { k.exhausted = false; k.lastResetDate = today; }
}

function _pickGeminiKey() {
if (!_geminiKeyObjs.length) return null;
for (let attempt = 0; attempt < _geminiKeyObjs.length; attempt++) {
const idx = (_geminiRRIdx + attempt) % _geminiKeyObjs.length;
const k = _geminiKeyObjs[idx];
_resetGeminiKeyIfNewDay(k);
if (!k.exhausted) { _geminiRRIdx = (idx + 1) % _geminiKeyObjs.length; return k; }
}
return null;
}

// P1.3-C FIX: centralized output parsing helpers
function parseGeminiText(result) {
try { return result?.response?.text()?.trim() || ''; } catch (e) { return ''; }
}
function parseGeminiJSON(result) {
const text = parseGeminiText(result);
try {
const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*/i, '');
return JSON.parse(cleaned);
} catch (e) { return null; }
}

// CEE-style raw fetch — returns SDK-compatible shape so all callers work unchanged
// Model: gemini-3-flash-preview (free, high usage) — no paid Pro model used
const geminiModel = {
async generateContent(content) {
if (!_geminiKeyObjs.length) throw new Error('No Gemini API keys configured');
let lastError = null;
for (let attempt = 0; attempt < Math.max(_geminiKeyObjs.length, 1); attempt++) {
const k = _pickGeminiKey();
if (!k) break;
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${k.key}`;
let reqBody;
if (typeof content === 'string') {
reqBody = { contents: [{ parts: [{ text: content }] }] };
} else if (content && content.contents) {
reqBody = { contents: content.contents };
} else {
reqBody = { contents: [{ parts: [{ text: String(content) }] }] };
}
try {
const res = await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(reqBody)
});
if (res.status === 429) {
k.exhausted = true;
lastError = 'quota_exceeded';
console.warn(`[KIWI] Gemini key #${k.index + 1} exhausted (429) — rotating`);
continue;
}
if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
const data = await res.json();
const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
// Return SDK-compatible object — all existing callers work without changes
return { response: { text: () => text } };
} catch (e) {
lastError = e.message;
console.error(`[KIWI] Gemini fetch error (attempt ${attempt + 1}):`, e.message);
}
}
throw new Error(lastError || 'All Gemini API keys exhausted or unavailable');
},
};

// ════════════════════════════════════════════════════════════════════════════
//  EXISTING SERVICES (SRS, XP, Streak, Tree, Analytics)
//  Modified to integrate with Living Ecosystem hooks

// ════════════════════════════════════════════════════════════════════════════
// ── srsService ───────────────────────────────────────────────────────────────

function calculateNextReview(card, response) {
const qualityMap = { again: 0, hard: 2, good: 3, easy: 5 };
const q = qualityMap[response];
if (q === undefined) throw new Error(`Invalid response: ${response}`);
let { interval_days, easiness_factor, repetition_count, stage } = card;
easiness_factor = Math.max(1.3, easiness_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
if (q < 3) {
repetition_count = 0;
interval_days = 1;
stage = Math.max(1, stage - 1);
} else {
repetition_count += 1;
if (repetition_count === 1) {
interval_days = q === 5 ? 3 : 1;
} else if (repetition_count === 2) {
interval_days = q === 5 ? 7 : 6;
} else {
interval_days = Math.round(interval_days * easiness_factor);
if (q === 5) interval_days = Math.round(interval_days * 1.3);
if (q === 2) interval_days = Math.round(interval_days * 0.8);
}
stage = computeStage(repetition_count, interval_days);
}
const nextReviewAt = new Date();
nextReviewAt.setDate(nextReviewAt.getDate() + interval_days);
return { interval_days, easiness_factor, repetition_count, stage, nextReviewAt };
}

function computeStage(repetitions, interval) {
if (repetitions === 0) return 1;
if (interval <= 1) return 2;
if (interval <= 14) return 3;
if (interval <= 60) return 4;
return 5;
}

function isCardDue(card, now = new Date()) {
if (!card.next_review_at) return true;
const reviewDate = new Date(card.next_review_at);
reviewDate.setHours(0, 0, 0, 0);
const today = new Date(now);
today.setHours(0, 0, 0, 0);
return reviewDate <= today;
}
// ── xpService ────────────────────────────────────────────────────────────────

function computeLevel(totalXP) {
const bands = [
{ upTo: 10, perLevel: 500 },
{ upTo: 20, perLevel: 1000 },
{ upTo: 30, perLevel: 2000 },
{ upTo: 50, perLevel: 3000 },
{ upTo: 75, perLevel: 5000 },
{ upTo: 100, perLevel: 8000 },
{ upTo: Infinity, perLevel: 15000 },
];
let level = 1,
remaining = totalXP;
for (const band of bands) {
const levelsInBand =
band.upTo === Infinity
? 999
: Math.min(band.upTo - (level - 1), Math.floor(remaining / band.perLevel));
if (remaining < band.perLevel) break;
const earned = Math.min(levelsInBand, Math.floor(remaining / band.perLevel));
level += earned;
remaining -= earned * band.perLevel;
if (level > band.upTo) continue;
break;
}
return { level, xpIntoLevel: remaining };
}

function getXpToNextLevel(currentLevel) {
if (currentLevel < 10) return 500;
if (currentLevel < 20) return 1000;
if (currentLevel < 30) return 2000;
if (currentLevel < 50) return 3000;
if (currentLevel < 75) return 5000;
if (currentLevel < 100) return 8000;
return 15000;
}

async function awardXP(userId, amount) {
const stats = await db.userStats.get(userId);
if (!stats) return null;
const newTotal = stats.total_xp + amount;
const { level, xpIntoLevel } = computeLevel(newTotal);
const xpToNext = getXpToNextLevel(level);
await db.userStats.update(userId, {
total_xp: newTotal,
current_level: level,
xp_in_current_level: xpIntoLevel,
});
return { totalXP: newTotal, level, xpIntoLevel, xpToNext };
}
// ════════════════════════════════════════════════════════════════════════════
//  DEADLINE FSRS SERVICE (PB.7)  [DESIGN: §5]
//  FSRS stability values are NEVER modified — only scheduling interval compressed
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §5.2] Phase urgency ceilings (max U per phase)
// ⚠ CORRECTED from v1.0: HARDENING=0.60, FINAL=0.80, RESCUE=0.90
const PHASE_URGENCY_CEILING = {
  SEEDING:   0.10,
  GROWING:   0.30,
  HARDENING: 0.60,
  FINAL:     0.80,
  RESCUE:    0.90,
};

// [DESIGN: §5.2] Card-state multipliers — applied within phase ceiling
// U_final = phase_ceiling × state_multiplier
const CARD_STATE_URGENCY_MULTIPLIER = {
  VERIFIED:  0.3,
  STABLE:    0.5,
  GROWING:   0.5,
  SEEDLING:  0.5,
  AVOIDED:   0.80,
  STUCK:     0.85,
  FRAGILE:   0.9,
  DANGEROUS: 1.0,
};

// [DESIGN: §5.3] Hard interval caps per phase per card state.
// null = no cap (interval governed by urgency multiplier only).
// ⚠ CORRECTED from v1.0: values now match design §5.3 table exactly.
// SEEDING: no caps [DESIGN: §5.3 — "None"]
// HARDENING: global cap of 5 days for all cards [DESIGN: §2.4]
const PHASE_INTERVAL_CAPS = {
  SEEDING: {
    default: null,
  },
  GROWING: {
    STUCK:     7,
    FRAGILE:   7,
    DANGEROUS: 5,
    default:   null,
  },
  HARDENING: {
    STUCK:     4,
    FRAGILE:   4,
    DANGEROUS: 2,
    default:   5,
  },
  FINAL: {
    STUCK:     2,
    FRAGILE:   2,
    DANGEROUS: 1,
    default:   null,
  },
  RESCUE: {
    default:   1,
  },
};

// [DESIGN: §5.2] Compute effective U for a card in a given phase
function computeUrgencyMultiplier(phase, cardState) {
  const ceiling   = PHASE_URGENCY_CEILING[phase] || 0;
  const stateMult = CARD_STATE_URGENCY_MULTIPLIER[cardState] || 0.5;
  return parseFloat((ceiling * stateMult).toFixed(4));
}

// [DESIGN: §5.2, §5.3] Wrap base SRS interval with urgency compression and hard cap.
// NEVER modifies easiness_factor, repetition_count, or stability.
function wrapIntervalWithUrgency(baseInterval, cardStateDoc, phase) {
  if (!phase) return baseInterval;
  const cardState  = cardStateDoc?.state || CARD_STATES.GROWING;
  const U          = computeUrgencyMultiplier(phase, cardState);
  const compressed = Math.max(1, Math.round(baseInterval * (1 - U)));
  const phaseCaps  = PHASE_INTERVAL_CAPS[phase] || {};
  const stateCap   = phaseCaps[cardState] !== undefined ? phaseCaps[cardState] : phaseCaps.default;
  if (stateCap !== null && stateCap !== undefined) {
    return Math.min(compressed, stateCap);
  }
  return compressed;
}

// ════════════════════════════════════════════════════════════════════════════
//  BUBBLE SCHEDULER SERVICE (PB.8)  [DESIGN: §4]
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §4.4] Multi-bubble allocation using trajectory_gap formula
// ⚠ CORRECTED from v1.0: gap-based weights (not status buckets), min 15%, max 70%
function computeAllocationWeights(activeGoals) {
  if (!activeGoals || activeGoals.length === 0) return {};
  if (activeGoals.length === 1) return { [activeGoals[0].id]: 100 };
  const gaps     = activeGoals.map((g) => Math.max(0, g.trajectory_gap || 0));
  const totalGap = gaps.reduce((a, b) => a + b, 0);
  const raw      = {};
  if (totalGap === 0) {
    const share = Math.floor(100 / activeGoals.length);
    activeGoals.forEach((g) => { raw[g.id] = share; });
    raw[activeGoals[0].id] += 100 - share * activeGoals.length;
  } else {
    activeGoals.forEach((g, i) => {
      raw[g.id] = Math.round((gaps[i] / totalGap) * 100);
    });
  }
  for (const id of Object.keys(raw)) raw[id] = Math.min(70, Math.max(15, raw[id]));
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  if (total !== 100) {
    const firstId = Object.keys(raw)[0];
    raw[firstId]  = Math.min(70, Math.max(15, raw[firstId] + (100 - total)));
  }
  return raw;
}

// [DESIGN: §4.2] Cards eligible for parking: STABLE or VERIFIED, next_review ≥ 5 days away.
function isParkable(stateDoc, now = new Date()) {
  if (!stateDoc) return false;
  const parkableStates = [CARD_STATES.STABLE, CARD_STATES.VERIFIED];
  if (!parkableStates.includes(stateDoc.state)) return false;
  if (!stateDoc.next_review_at) return false;
  const nextReview = new Date(stateDoc.next_review_at);
  const daysUntil  = Math.ceil((nextReview - now) / 86400000);
  return daysUntil >= 5;
}

// [DESIGN: §2.6] Build RESCUE deck: cluster leaders + all STUCK/FRAGILE/AVOIDED/DANGEROUS cards
async function buildRescueDeck(userId, goal) {
  const cardIds        = goal.card_ids || [];
  const allStatesDocs  = await db.cardStates.findByUser(userId);
  const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
  const rescueSet      = new Set();
  for (const cardId of cardIds) {
    const state = statesByCardId.get(cardId)?.state;
    if ([CARD_STATES.STUCK, CARD_STATES.FRAGILE, CARD_STATES.AVOIDED, CARD_STATES.DANGEROUS].includes(state)) {
      rescueSet.add(cardId);
    }
  }
  try {
    const clusters = await db.masteryGoals.getClusters(goal.id);
    for (const cluster of clusters) {
      for (const cardId of (cluster.card_ids || [])) {
        const st = statesByCardId.get(cardId)?.state;
        if (st !== CARD_STATES.VERIFIED) { rescueSet.add(cardId); break; }
      }
    }
  } catch (_e) { /* non-fatal */ }
  return [...rescueSet];
}

// ── GAP-C2: composeWeightedSessionQueue — multi-bubble proportional allocation ──
// [DESIGN: §4.4] Each bubble receives a proportional card slot budget.
// Called only when activeGoals.length > 1. Single-bubble path is unchanged.
async function composeWeightedSessionQueue(userId, dedupedQueue, activeGoals, now) {
  try {
    const weights      = computeAllocationWeights(activeGoals);
    const totalSlots   = dedupedQueue.length;
    const urgentStates = new Set([CARD_STATES.STUCK, CARD_STATES.FRAGILE,
                                  CARD_STATES.DANGEROUS, CARD_STATES.AVOIDED]);
    const result       = [];
    const usedIds      = new Set();

    const sorted = [...activeGoals].sort(
      (a, b) => (weights[b.id] || 0) - (weights[a.id] || 0)
    );

    for (const goal of sorted) {
      const weight     = weights[goal.id] || 15;
      const slotBudget = Math.max(1, Math.round(totalSlots * weight / 100));
      const goalSet    = new Set(goal.card_ids || []);
      const status     = goal.trajectory_status || 'ON_TRACK';

      let candidates = dedupedQueue.filter((item) => {
        const id = item.card?.id || item.id;
        return goalSet.has(id) && !usedIds.has(id);
      });

      if (status === 'CRITICAL' || status === 'BEHIND' || status === 'DRIFTING') {
        candidates.sort((a, b) => {
          const aUrgent = urgentStates.has(a.state?.state || a.cardState || '') ? 0 : 1;
          const bUrgent = urgentStates.has(b.state?.state || b.cardState || '') ? 0 : 1;
          return aUrgent - bUrgent;
        });
      }

      const chosen = candidates.slice(0, slotBudget);
      chosen.forEach((item) => usedIds.add(item.card?.id || item.id));
      result.push(...chosen);
    }

    const fillers = dedupedQueue.filter((item) => !usedIds.has(item.card?.id || item.id));
    result.push(...fillers.slice(0, Math.max(0, totalSlots - result.length)));
    return result;
  } catch (e) {
    console.error('[KIWI] composeWeightedSessionQueue failed, using original queue:', e.message);
    return dedupedQueue;
  }
}

// [DESIGN: §4] Main queue modification engine.
// Implements all four intervention levels: DRIFTING, BEHIND, CRITICAL, RESCUE
// SAFETY: always returns original queue on any error — never breaks session start
// ⚠ CORRECTED from v1.0: DRIFTING level added, RESCUE mode added, gap-based logic
// B4-C1 stall response merged in; now hoisted before multi-bubble path

async function modifySessionQueueForBubbles(userId, queue, subjectId = null) {
  try {
    const activeGoals = subjectId
      ? await db.masteryGoals.findBySubject(userId, subjectId)
      : await db.masteryGoals.findActive(userId);
    if (!activeGoals || activeGoals.length === 0) return queue;

    // Step 1: Deduplicate cross-bubble cards [DESIGN: §8.3]
    const seenCrossCards = new Set();
    const dedupedQueue   = [];
    for (const item of queue) {
      const cardId   = item.card?.id || item.id;
      const stateDoc = await db.cardStates.get(userId, cardId).catch(() => null);
      if (stateDoc?.cross_bubble) {
        if (seenCrossCards.has(cardId)) continue;
        seenCrossCards.add(cardId);
      }
      dedupedQueue.push(item);
    }

    // Determine highest-urgency trajectory status
    const statusRank = { RESCUE:4, CRITICAL:3, BEHIND:2, DRIFTING:1, ON_TRACK:0 };
    const topGoal    = activeGoals.reduce((prev, curr) =>
      (statusRank[curr.trajectory_status] || 0) > (statusRank[prev.trajectory_status] || 0) ? curr : prev
    , activeGoals[0]);
    const topStatus  = topGoal?.trajectory_status || 'ON_TRACK';

    // ON_TRACK: return queue unchanged [DESIGN: §15.2]
    if (topStatus === 'ON_TRACK') return dedupedQueue;

    // ── GAP-C1: Apply stall response queue modifications [DESIGN: §6.2] ─────────
    // stall_response_active was set by activateStallResponse but never read here.
    // Applied BEFORE trajectory-level intervention so stall selection refines
    // the card set that trajectory intervention then reorders/counts.
    const stalledGoal = activeGoals.find((g) => g.stall_active && g.stall_response_active);
    if (stalledGoal) {
      const response    = stalledGoal.stall_response_active;
      const goalCardSet = new Set(stalledGoal.card_ids || []);

      if (response === 'RESCUE_REVIEWS') {
        // [DESIGN: §6.2 D1] STUCK cards repeated 3× per session, spaced across queue
        const stuckItems = dedupedQueue.filter((item) => {
          const cardId = item.card?.id || item.id;
          return goalCardSet.has(cardId) &&
            (item.state?.state || item.cardState) === CARD_STATES.STUCK;
        }).slice(0, 3);
        const n = dedupedQueue.length;
        for (let k = stuckItems.length - 1; k >= 0; k--) {
          dedupedQueue.splice(Math.floor((2 * n) / 3), 0, { ...stuckItems[k], _rescue_repeat: 3 });
          dedupedQueue.splice(Math.floor(n / 3),       0, { ...stuckItems[k], _rescue_repeat: 2 });
          dedupedQueue.splice(0, 0,                       { ...stuckItems[k], _rescue_repeat: 1 });
        }

      } else if (response === 'CLUSTER_LOCK') {
        // [DESIGN: §6.2 D2] 50% of session time dedicated to weakest cluster
        try {
          const weakCluster = await getWeakestCluster(stalledGoal.id);
          if (weakCluster) {
            const clusterSet   = new Set(weakCluster.card_ids || []);
            const clusterItems = dedupedQueue.filter((item) => clusterSet.has(item.card?.id || item.id));
            const otherItems   = dedupedQueue.filter((item) => !clusterSet.has(item.card?.id || item.id));
            const clusterSlot  = Math.ceil(dedupedQueue.length * 0.5);
            dedupedQueue.splice(0, dedupedQueue.length,
              ...clusterItems.slice(0, clusterSlot),
              ...otherItems.slice(0, Math.max(0, dedupedQueue.length - clusterSlot))
            );
          }
        } catch (_e) { /* non-fatal */ }

      } else if (response === 'CARD_FREEZE') {
        // [DESIGN: §6.2 D3] Freeze SEEDLING cards from the stalled bubble
        const filtered = dedupedQueue.filter((item) => {
          const cardId = item.card?.id || item.id;
          const state  = item.state?.state || item.cardState;
          return !(goalCardSet.has(cardId) && state === CARD_STATES.SEEDLING);
        });
        dedupedQueue.splice(0, dedupedQueue.length, ...filtered);

      } else if (response === 'AVOIDANCE_FRONT') {
        // [DESIGN: §6.2 D4] AVOIDED cards moved to front
        const avoided = dedupedQueue.filter((item) => {
          const cardId = item.card?.id || item.id;
          const state  = item.state?.state || item.cardState;
          return goalCardSet.has(cardId) && state === CARD_STATES.AVOIDED;
        });
        const others  = dedupedQueue.filter((item) => !avoided.includes(item));
        dedupedQueue.splice(0, dedupedQueue.length, ...avoided, ...others);
      }
    }

    const allBubbleCardIds = new Set(activeGoals.flatMap((g) => g.card_ids || []));
    // now hoisted here so it is available for both composeWeightedSessionQueue and isParkable
    const now              = new Date();

    // ── GAP-C2: Multi-bubble proportional allocation [DESIGN: §4.4] ────────────
    if (activeGoals.length > 1) {
      return await composeWeightedSessionQueue(userId, dedupedQueue, activeGoals, now);
    }

    // ── GAP-3 (B4-GAP3): FINAL phase — VERIFIED warm-up pre-pass [DESIGN: §2.5] ─
    // §2.5: VERIFIED cards appear in a 2-minute warm-up block then are set aside.
    // Runs before trajectory-level logic so all single-bubble paths inherit the warm-up order.
    if (topGoal?.phase === BUBBLE_PHASES.FINAL) {
      const MAX_WARMUP_MINS = 2;
      const VERIFIED_MINS   = CARD_REVIEW_MINUTES[CARD_STATES.VERIFIED] || 0.5;
      let   warmupMins      = 0;
      const warmupItems     = [];
      const nonWarmupItems  = [];
      for (const item of dedupedQueue) {
        const cardId     = item.card?.id || item.id;
        const stateDoc   = await db.cardStates.get(userId, cardId).catch(() => null);
        const inBubble   = allBubbleCardIds.has(cardId);
        const isVerified = stateDoc?.state === CARD_STATES.VERIFIED;
        if (inBubble && isVerified) {
          if (warmupMins < MAX_WARMUP_MINS) {
            warmupItems.push({ ...item, _warmup: true });
            warmupMins += VERIFIED_MINS;
          }
          // VERIFIED budget exhausted → card dropped entirely ("set aside") [DESIGN: §2.5]
        } else {
          nonWarmupItems.push(item);
        }
      }
      dedupedQueue.length = 0;
      dedupedQueue.push(...warmupItems, ...nonWarmupItems);
    }

    // ── RESCUE: 100% RESCUE deck, FSRS bypassed entirely [DESIGN: §4.3, §2.6] ─
    if (topStatus === 'RESCUE') {
      const rescueDeck = await buildRescueDeck(userId, topGoal);
      if (rescueDeck.length === 0) return dedupedQueue;
      const rescueSet   = new Set(rescueDeck);
      const rescueQueue = dedupedQueue.filter((item) => {
        const cardId = item.card?.id || item.id;
        return rescueSet.has(cardId);
      });
      return rescueQueue.length > 0 ? rescueQueue : dedupedQueue;
    }

    // ── DRIFTING: bubble urgent cards sorted to front, no parking [DESIGN: §4.3] ─
    if (topStatus === 'DRIFTING') {
      const urgentStates = new Set([CARD_STATES.STUCK, CARD_STATES.FRAGILE, CARD_STATES.DANGEROUS, CARD_STATES.AVOIDED]);
      return [...dedupedQueue].sort((a, b) => {
        const aId     = a.card?.id || a.id;
        const bId     = b.card?.id || b.id;
        const aUrgent = allBubbleCardIds.has(aId) &&
          urgentStates.has(a.state?.state || a.cardState || '') ? 0 : 1;
        const bUrgent = allBubbleCardIds.has(bId) &&
          urgentStates.has(b.state?.state || b.cardState || '') ? 0 : 1;
        return aUrgent - bUrgent;
      });
    }

    // ── BEHIND / CRITICAL: parking + promotion [DESIGN: §4.3] ──────────────────
    // [DESIGN: §2.4] HARDENING phase parks stable cards for 7 days (once/week)
    const parkDays = (topGoal?.phase === BUBBLE_PHASES.HARDENING || topStatus === 'CRITICAL')
      ? 7
      : 3;
    const modified = [];
    const urgent   = [CARD_STATES.STUCK, CARD_STATES.FRAGILE, CARD_STATES.DANGEROUS, CARD_STATES.AVOIDED];

    for (const item of dedupedQueue) {
      const cardId   = item.card?.id || item.id;
      const stateDoc = await db.cardStates.get(userId, cardId).catch(() => null);
      const inBubble = allBubbleCardIds.has(cardId);
      if (inBubble && isParkable(stateDoc, now)) {
        const parkExpiry = new Date(now.getTime() + parkDays * 86400000);
        await db.cardStates.update(userId, cardId, { parking_expires_at: parkExpiry }).catch(() => {});
        continue;
      }
      modified.push(item);
    }

    modified.sort((a, b) => {
      const aId     = a.card?.id || a.id;
      const bId     = b.card?.id || b.id;
      const aState  = a.state?.state || a.cardState || '';
      const bState  = b.state?.state || b.cardState || '';
      const aUrgent = allBubbleCardIds.has(aId) && urgent.includes(aState) ? 0 : 1;
      const bUrgent = allBubbleCardIds.has(bId) && urgent.includes(bState) ? 0 : 1;
      return aUrgent - bUrgent;
    });

    // [DESIGN: §4.3 CRITICAL] 80% bubble / 20% others
    // [DESIGN: §4.3 BEHIND]   60% bubble / 40% others
    const bubblePct          = topStatus === 'CRITICAL' ? 0.8 : 0.6;
    const targetBubbleCount  = Math.round(modified.length * bubblePct);
    const bubbleCards        = modified.filter((item) =>  allBubbleCardIds.has(item.card?.id || item.id));
    const otherCards         = modified.filter((item) => !allBubbleCardIds.has(item.card?.id || item.id));
    const slicedBubble       = bubbleCards.slice(0, targetBubbleCount);
    const slicedOther        = otherCards.slice(0, modified.length - slicedBubble.length);
    return [...slicedBubble, ...slicedOther];

  } catch (e) {
    console.error('[KIWI] Bubble queue modification failed (non-fatal):', e.message);
    return queue;
  }
}

// ── streakService ────────────────────────────────────────────────────────────

function getDateString(date) {
return new Date(date).toDateString();
}

function checkStreakOnLogin(userStats) {
const today = getDateString(new Date());
const lastStudy = userStats.last_study_date ? getDateString(userStats.last_study_date) : null;
const yesterday = getDateString(new Date(Date.now() - 86400000));
if (lastStudy === today) return { action: 'none', reason: 'already_studied_today' };
if (lastStudy === yesterday) return { action: 'none', reason: 'studied_yesterday' };
// P3.9-B4 FIX: deprecated old grace system. consumeShieldOnMiss (called
// from the login handler after P3.9-B1a fix) now handles missed days.
// Returning action:missed_day with no updates so the grace path is a no-op
// and the shield system takes over.
return { action: 'missed_day', reason: 'use_shield_system' };
}

function computeStreakAfterSession(userStats, now = new Date()) {
const today = getDateString(now);
const lastStudy = userStats.last_study_date ? getDateString(userStats.last_study_date) : null;
let newStreak = userStats.current_streak;
if (lastStudy !== today) newStreak += 1;
// P5.4-F8 FIX: track permanent streak milestone rings (survive streak breaks)
const allMilestoneThresholds = [7, 30, 100, 365];
const earned = userStats.streak_milestones_earned || [];
const newlyEarned = allMilestoneThresholds.filter(m => newStreak >= m && !earned.includes(m));
const updatedEarned = newlyEarned.length > 0 ? [...earned, ...newlyEarned] : earned;
return {
current_streak: newStreak,
longest_streak: Math.max(userStats.longest_streak || 0, newStreak),
last_study_date: now,
streak_grace_used: false,
...(newlyEarned.length > 0 ? { streak_milestones_earned: updatedEarned } : {}),
};
}

async function applyDailyHealthPenalty() {
const yesterday = getDateString(new Date(Date.now() - 86400000));
const allStats = await db.userStats.findAll();
await Promise.all(
allStats.map(async (stat) => {
if (stat.last_study_date && getDateString(stat.last_study_date) !== yesterday) {
await db.userStats.update(stat.userId, {
tree_health: Math.max(0, stat.tree_health - 10),
});
}
})
);
}
// ── treeService ───────────────────────────────────────────────────────────────
const TREE_THRESHOLDS = [
{ stage: 1, streak: 0, mastered: 0 },
{ stage: 2, streak: 7, mastered: 10 },
{ stage: 3, streak: 14, mastered: 50 },
{ stage: 4, streak: 30, mastered: 100 },
{ stage: 5, streak: 60, mastered: 250 },
{ stage: 6, streak: 90, mastered: 500 },
{ stage: 7, streak: 120, mastered: 1000 },
{ stage: 8, streak: 180, mastered: 2000 },
];

function computeTreeStage(currentStreak, totalMastered) {
let stage = 1;
for (const t of TREE_THRESHOLDS) {
if (currentStreak >= t.streak && totalMastered >= t.mastered) stage = t.stage;
else break;
}
return stage;
}

async function updateTreeStage(userId) {
const stats = await db.userStats.get(userId);
if (!stats) return null;
const newStage = computeTreeStage(stats.current_streak, stats.total_cards_mastered);
if (newStage !== stats.tree_stage) {
await db.userStats.update(userId, { tree_stage: newStage });
}
return newStage;
}

function computeDaysUntilNextStage(stats) {
const thresholds = [
{ stage: 2, streak: 7, mastered: 10 },
{ stage: 3, streak: 14, mastered: 50 },
{ stage: 4, streak: 30, mastered: 100 },
{ stage: 5, streak: 60, mastered: 250 },
{ stage: 6, streak: 90, mastered: 500 },
{ stage: 7, streak: 120, mastered: 1000 },
{ stage: 8, streak: 180, mastered: 2000 },
];
const next = thresholds.find((t) => t.stage === stats.tree_stage + 1);
if (!next) return null;
return {
streak_needed: Math.max(0, next.streak - stats.current_streak),
mastered_needed: Math.max(0, next.mastered - stats.total_cards_mastered),
};
}

// ════════════════════════════════════════════════════════════════════════════
//  SERVICE: analyticsService

// ════════════════════════════════════════════════════════════════════════════

async function recalculateSubjectHealth(userId, subjectId) {
const deckList = await db.decks.findBySubjectWithCards(userId, subjectId);
const allCards = deckList.flatMap((d) => d.cards);
const totalCards = allCards.length;
if (totalCards === 0) return null;
const stageCounts = [0, 0, 0, 0, 0, 0];
allCards.forEach((c) => {
const s = Math.min(5, Math.max(1, c.stage));
stageCounts[s] = (stageCounts[s] || 0) + 1;
});
const cardIds = allCards.map((c) => c.id);
const logs = await db.reviewLogs.findByCards(userId, cardIds);
const totalReviews = logs.length;
const responseCounts = { again: 0, hard: 0, good: 0, easy: 0 };
logs.forEach((l) => {
responseCounts[l.response] = (responseCounts[l.response] || 0) + 1;
});
let srsQuality = 0;
if (totalReviews > 0) {
const weighted =
(responseCounts.again || 0) * 0 +
(responseCounts.hard || 0) * 0.5 +
(responseCounts.good || 0) * 0.8 +
(responseCounts.easy || 0) * 1.0;
srsQuality = (weighted / totalReviews) * 100;
}
const stageScore =
(((stageCounts[1] || 0) * 0 +
(stageCounts[2] || 0) * 0.2 +
(stageCounts[3] || 0) * 0.4 +
(stageCounts[4] || 0) * 0.7 +
(stageCounts[5] || 0) * 1.0) /
totalCards) 
100;
const existing = await db.subjectStats.get(userId, subjectId);
let examPerf = srsQuality;
if (existing?.average_exam_score != null) examPerf = parseFloat(existing.average_exam_score);
else if (existing?.average_quiz_score != null) examPerf = parseFloat(existing.average_quiz_score);
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const sessionList = await db.sessions.findBySubject(userId, subjectId, thirtyDaysAgo);
const uniqueDays = new Set(
sessionList.map((s) => new Date(s.started_at).toISOString().split('T')[0])
).size;
const consistency = (uniqueDays / 30) * 100;
const healthScore = srsQuality * 0.4 + examPerf * 0.3 + stageScore * 0.2 + consistency * 0.1;
const sharedData = {
health_score: Math.min(100, Math.max(0, parseFloat(healthScore.toFixed(2)))),
total_cards: totalCards,
stage_1_count: stageCounts[1] || 0,
stage_2_count: stageCounts[2] || 0,
stage_3_count: stageCounts[3] || 0,
stage_4_count: stageCounts[4] || 0,
stage_5_count: stageCounts[5] || 0,
again_ratio:
totalReviews > 0
? parseFloat((((responseCounts.again || 0) / totalReviews) * 100).toFixed(2))
: 0,
hard_ratio:
totalReviews > 0
? parseFloat((((responseCounts.hard || 0) / totalReviews) * 100).toFixed(2))
: 0,
good_ratio:
totalReviews > 0
? parseFloat((((responseCounts.good || 0) / totalReviews) * 100).toFixed(2))
: 0,
easy_ratio:
totalReviews > 0
? parseFloat((((responseCounts.easy || 0) / totalReviews) * 100).toFixed(2))
: 0,
total_reviews: totalReviews,
days_studied_last_30: uniqueDays,
total_study_minutes: existing?.total_study_minutes || 0,
last_studied_at:
sessionList.length > 0
? sessionList[sessionList.length - 1].started_at
: existing?.last_studied_at || null,
};
await db.subjectStats.upsert(userId, subjectId, sharedData);
return healthScore;
}

// ════════════════════════════════════════════════════════════════════════════
//  ACHIEVEMENTS MASTER DATA

// ════════════════════════════════════════════════════════════════════════════
const ACHIEVEMENTS_DATA = [
{
code: 'first_review',
name: 'First Step',
description: 'Complete your first card review',
icon_emoji: '⭐',
category: 'streak',
xp_reward: 25,
is_secret: true,
is_timed: false,
},
{
code: 'streak_7',
name: 'Week Warrior',
description: 'Maintain a 7-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 50,
is_secret: false,
is_timed: false,
},
{
code: 'streak_14',
name: 'Fortnight Force',
description: 'Maintain a 14-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 100,
is_secret: false,
is_timed: false,
},
{
code: 'streak_30',
name: 'Monthly Master',
description: 'Maintain a 30-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 300,
is_secret: false,
is_timed: false,
},
{
code: 'streak_60',
name: 'Iron Will',
description: 'Maintain a 60-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 600,
is_secret: false,
is_timed: false,
},
{
code: 'streak_100',
name: 'Century',
description: 'Maintain a 100-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 1000,
is_secret: false,
is_timed: false,
},
{
code: 'streak_180',
name: 'Unstoppable',
description: 'Maintain a 180-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 2000,
is_secret: false,
is_timed: false,
},
{
code: 'streak_365',
name: 'Legendary',
description: 'Maintain a 365-day streak',
icon_emoji: '🔥',
category: 'streak',
xp_reward: 5000,
is_secret: false,
is_timed: false,
},
{
code: 'first_mastered',
name: 'First Victory',
description: 'Promote your first card to Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 75,
is_secret: false,
is_timed: false,
},
{
code: 'mastered_10',
name: 'Getting There',
description: '10 cards Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 100,
is_secret: false,
is_timed: false,
},
{
code: 'mastered_50',
name: 'Knowledge Builder',
description: '50 cards Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 300,
is_secret: false,
is_timed: false,
},
{
code: 'mastered_100',
name: 'Scholar',
description: '100 cards Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 500,
is_secret: false,
is_timed: false,
},
{
code: 'mastered_250',
name: 'Expert',
description: '250 cards Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 1000,
is_secret: false,
is_timed: false,
},
{
code: 'mastered_500',
name: 'Master',
description: '500 cards Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 2000,
is_secret: false,
is_timed: false,
},
{
code: 'mastered_1000',
name: 'Grandmaster',
description: '1000 cards Mastered',
icon_emoji: '✨',
category: 'mastery',
xp_reward: 4000,
is_secret: false,
is_timed: false,
},
{
code: 'deck_complete',
name: 'Deck Complete',
description: 'Reach Mastered on every card in a deck',
icon_emoji: '📦',
category: 'mastery',
xp_reward: 500,
is_secret: false,
is_timed: false,
},
{
code: 'speed_lightning',
name: 'Lightning',
description: 'Complete a 20+ card session in <10 min with 90%+ accuracy',
icon_emoji: '⚡',
category: 'speed',
xp_reward: 200,
is_secret: false,
is_timed: false,
},
{
code: 'speed_flash',
name: 'Flash Review',
description: 'Review 50 cards in a single day',
icon_emoji: '⚡',
category: 'speed',
xp_reward: 150,
is_secret: false,
is_timed: false,
},
{
code: 'speed_five_sessions',
name: 'Relentless',
description: 'Complete 5 study sessions in one day',
icon_emoji: '⚡',
category: 'speed',
xp_reward: 200,
is_secret: true,
is_timed: false,
},
{
code: 'exam_first',
name: 'Examiner',
description: 'Complete your first CBT exam',
icon_emoji: '📝',
category: 'exam',
xp_reward: 75,
is_secret: false,
is_timed: false,
},
{
code: 'exam_perfect',
name: 'Exam Ace',
description: 'Score 100% on a CBT exam (min 20 questions)',
icon_emoji: '📝',
category: 'exam',
xp_reward: 500,
is_secret: false,
is_timed: false,
},
{
code: 'exam_consistent',
name: 'Consistent',
description: 'Score 80%+ on 5 consecutive CBT exams',
icon_emoji: '??',
category: 'exam',
xp_reward: 400,
is_secret: false,
is_timed: false,
},
{
code: 'exam_10',
name: 'Exam Hunter',
description: 'Complete 10 CBT exams',
icon_emoji: '📝',
category: 'exam',
xp_reward: 300,
is_secret: false,
is_timed: false,
},
{
code: 'exam_100q',
name: 'Marathon',
description: 'Complete a 100-question CBT exam',
icon_emoji: '📝',
category: 'exam',
xp_reward: 400,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_2',
name: 'Sprout',
description: 'Kiwi tree reaches Stage 2',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 50,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_3',
name: 'Taking Root',
description: 'Kiwi tree reaches Stage 3',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 100,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_4',
name: 'Growing Strong',
description: 'Kiwi tree reaches Stage 4',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 200,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_5',
name: 'Thriving',
description: 'Kiwi tree reaches Stage 5',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 350,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_6',
name: 'Blooming',
description: 'Kiwi tree reaches Stage 6',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 500,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_7',
name: 'First Fruit',
description: 'Kiwi tree reaches Stage 7',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 750,
is_secret: false,
is_timed: false,
},
{
code: 'tree_stage_8',
name: 'Ancient Kiwi',
description: 'Kiwi tree reaches Stage 8',
icon_emoji: '🌱',
category: 'growth',
xp_reward: 1500,
is_secret: false,
is_timed: false,
},
{
code: 'secret_night_owl',
name: 'Night Owl',
description: 'Start a study session after midnight',
icon_emoji: '🦉',
category: 'secret',
xp_reward: 100,
is_secret: true,
is_timed: false,
},
{
code: 'secret_early_bird',
name: 'Early Bird',
description: 'Start a study session before 6:00 AM',
icon_emoji: '🐦',
category: 'secret',
xp_reward: 100,
is_secret: true,
is_timed: false,
},
{
code: 'secret_bounce_back',
name: 'Bounce Back',
description: 'Complete a session after the seed wilted',
icon_emoji: '💪',
category: 'secret',
xp_reward: 200,
is_secret: true,
is_timed: false,
},
{
code: 'secret_social',
name: 'Community Spirit',
description: 'Clone 5 community decks',
icon_emoji: '🤝',
category: 'secret',
xp_reward: 100,
is_secret: true,
is_timed: false,
},
{
code: 'secret_creator',
name: 'Content Creator',
description: 'Publish your first community deck',
icon_emoji: '🎨',
category: 'secret',
xp_reward: 150,
is_secret: true,
is_timed: false,
},
{
code: 'secret_deep_dive',
name: 'Deep Diver',
description: 'Study the same subject 5 consecutive days',
icon_emoji: '🤿',
category: 'secret',
xp_reward: 200,
is_secret: true,
is_timed: false,
},
{
code: 'secret_weekend',
name: 'Weekend Warrior',
description: 'Study both Saturday AND Sunday for 4 consecutive weekends',
icon_emoji: '🏖️',
category: 'secret',
xp_reward: 250,
is_secret: true,
is_timed: false,
},
{
code: 'timed_new_year',
name: 'New Year Scholar',
description: 'Complete a study session on January 1st',
icon_emoji: '🎆',
category: 'timed',
xp_reward: 200,
is_secret: false,
is_timed: true,
},
{
code: 'timed_back_to_school',
name: 'Back to School',
description: 'Study on the first Monday of September',
icon_emoji: '🎒',
category: 'timed',
xp_reward: 150,
is_secret: false,
is_timed: true,
},
];

async function seedAchievements() {
try {
await Promise.all(ACHIEVEMENTS_DATA.map((ach) => db.achievements.upsert(ach.code, ach)));
console.log(`[KIWI] ✅ ${ACHIEVEMENTS_DATA.length} achievements seeded`);
} catch (e) {
console.error('[KIWI] Achievement seeding failed:', e.message);
}
}

function isFirstMondayOfSeptember(date) {
if (date.getMonth() !== 8) return false;
const firstDay = new Date(date.getFullYear(), 8, 1);
const firstMonday = new Date(firstDay);
firstMonday.setDate(firstMonday.getDate() + ((1 - firstDay.getDay() + 7) % 7));
return date.toDateString() === firstMonday.toDateString();
}

async function checkAchievements(userId, context = {}) {
const newUnlocks = [];
const [user, statsList, uaList, allAchievements] = await Promise.all([
db.users.findById(userId),
db.userStats.get(userId),
db.userAchievements.findManyWithAchievement(userId),
db.achievements.findAll(),
]);
if (!user || !statsList) return newUnlocks;
const stats = statsList;
const unlockedCodes = new Set(uaList.map((ua) => ua.achievement?.code).filter(Boolean));
for (const ach of allAchievements) {
if (unlockedCodes.has(ach.code)) continue;
if (ach.is_timed) {
const now = new Date();
if (ach.available_from && now < new Date(ach.available_from)) continue;
if (ach.available_until && now > new Date(ach.available_until)) continue;
if (ach.code === 'timed_back_to_school' && !isFirstMondayOfSeptember(now)) continue;
}
let unlocked = false;
switch (ach.code) {
case 'first_review':
unlocked = stats.total_cards_reviewed >= 1;
break;
case 'streak_7':
unlocked = stats.current_streak >= 7;
break;
case 'streak_14':
unlocked = stats.current_streak >= 14;
break;
case 'streak_30':
unlocked = stats.current_streak >= 30;
break;
case 'streak_60':
unlocked = stats.current_streak >= 60;
break;
case 'streak_100':
unlocked = stats.current_streak >= 100;
break;
case 'streak_180':
unlocked = stats.current_streak >= 180;
break;
case 'streak_365':
unlocked = stats.current_streak >= 365;
break;
case 'first_mastered':
unlocked = stats.total_cards_mastered >= 1;
break;
case 'mastered_10':
unlocked = stats.total_cards_mastered >= 10;
break;
case 'mastered_50':
unlocked = stats.total_cards_mastered >= 50;
break;
case 'mastered_100':
unlocked = stats.total_cards_mastered >= 100;
break;
case 'mastered_250':
unlocked = stats.total_cards_mastered >= 250;
break;
case 'mastered_500':
unlocked = stats.total_cards_mastered >= 500;
break;
case 'mastered_1000':
unlocked = stats.total_cards_mastered >= 1000;
break;
case 'deck_complete':
if (context?.deckId) {
const deckCards = await db.cards.findByDeck(userId, context.deckId);
unlocked = deckCards.length > 0 && deckCards.every((c) => c.stage === 5);
}
break;
case 'speed_lightning':
// P11 FIX: Removed accuracy_pct dependency — field is never written to sessions.
// Condition updated: complete a 20+ card session in under 10 minutes.
if (context?.session) {
const s = context.session;
unlocked =
s.cards_reviewed >= 20 &&
(s.duration_seconds || 0) < 600;
}
break;
case 'speed_flash':
if (context?.session) {
const today = new Date();
today.setHours(0, 0, 0, 0);
const todayCount = await db.reviewLogs.count(userId, { reviewed_at_gte: today });
unlocked = todayCount >= 50;
}
break;
case 'speed_five_sessions':
if (context?.session) {
const today = new Date();
today.setHours(0, 0, 0, 0);
const todayCount = await db.sessions.count(userId, {
session_completed: true,
started_at_gte: today,
});
unlocked = todayCount >= 5;
}
break;
case 'exam_first':
unlocked = stats.total_exams_completed >= 1;
break;
case 'exam_10':
unlocked = stats.total_exams_completed >= 10;
break;
case 'exam_perfect':
if (context?.exam)
unlocked = context.exam.score_pct === 100 && context.exam.question_count >= 20;
break;
case 'exam_consistent':
if (context?.exam) {
const recentExams = await db.examSessions.findMany(
userId,
{ status: 'completed' },
{ limit: 5 }
);
unlocked =
recentExams.length >= 5 && recentExams.every((e) => parseFloat(e.score_pct || 0) >= 80);
}
break;
case 'exam_100q':
if (context?.exam) unlocked = context.exam.question_count >= 100;
break;
case 'tree_stage_2':
unlocked = stats.tree_stage >= 2;
break;
case 'tree_stage_3':
unlocked = stats.tree_stage >= 3;
break;
case 'tree_stage_4':
unlocked = stats.tree_stage >= 4;
break;
case 'tree_stage_5':
unlocked = stats.tree_stage >= 5;
break;
case 'tree_stage_6':
unlocked = stats.tree_stage >= 6;
break;
case 'tree_stage_7':
unlocked = stats.tree_stage >= 7;
break;
case 'tree_stage_8':
unlocked = stats.tree_stage >= 8;
break;
case 'secret_night_owl':
if (context?.sessionStart) {
const hour = new Date(context.sessionStart).getHours();
unlocked = hour >= 0 && hour <= 2;
}
break;
case 'secret_early_bird':
if (context?.sessionStart) {
const hour = new Date(context.sessionStart).getHours();
unlocked = hour >= 4 && hour < 6;
}
break;
case 'secret_bounce_back':
if (context?.seedGrowth !== undefined) unlocked = context.seedGrowth < 10;
break;
case 'secret_social': {
const clonesMade = await db.communityDecks.count({ author_id: userId });
unlocked = clonesMade >= 5;
break;
}
case 'secret_creator': {
const published = await db.decks.count(userId, { is_public: true });
unlocked = published >= 1;
break;
}
case 'secret_deep_dive':
if (context?.subjectId) {
const logs = await db.sessions.findBySubject(userId, context.subjectId);
const recent = logs
.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
.slice(0, 5);
if (recent.length >= 5) {
const dates = recent.map((l) => new Date(l.started_at).toISOString().split('T')[0]);
let consecutive = 1;
for (let i = 1; i < dates.length; i++) {
const diff = (new Date(dates[i - 1]) - new Date(dates[i])) / 86400000;
if (diff === 1) consecutive++;
else break;
}
unlocked = consecutive >= 5;
}
}
break;
case 'secret_weekend': {
const allSessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 9999 }
);
const weekendDates = new Set();
for (const s of allSessions.sessions) {
const d = new Date(s.started_at);
const day = d.getDay();
if (day === 0 || day === 6) {
const year = d.getFullYear();
const week = Math.floor((d.getDate() - 1) / 7);
weekendDates.add(`${year}-${week}-${day}`);
}
}
unlocked = weekendDates.size >= 8;
break;
}
case 'timed_new_year': {
const now = new Date();
unlocked = now.getMonth() === 0 && now.getDate() === 1 && context?.sessionCompleted;
break;
}
case 'timed_back_to_school': {
unlocked = isFirstMondayOfSeptember(new Date()) && context?.sessionCompleted;
break;
}

        // PB.19: Bubble Almanac unlock conditions [DESIGN: §15.5]
        // ⚠ CORRECTED from v1.0: all 10 conditions match design §15.5 exactly

        case 'bubble_created': {
          const all = await db.masteryGoals.findByUser(userId);
          unlocked  = all.length >= 1;
          break;
        }

        case 'bubble_first_completed': {
          const completed = await db.masteryGoals.findByUser(userId, 'completed');
          unlocked = completed.length >= 1;
          break;
        }

        case 'test_date_gate_passed_first_attempt': {
          // Passed gate = NOT test_date_gate_failed AND bubble has a test_date AND KS >= 60
          const allBubbles = await db.masteryGoals.findByUser(userId);
          unlocked = allBubbles.some((g) =>
            g.test_date && !g.test_date_gate_failed && (g.current_ks || 0) >= 60
          );
          break;
        }

        case 'bubble_completed_after_rescue': {
          // [DESIGN: §15.5] Complete a Bubble AFTER entering RESCUE
          const completedBubbles = await db.masteryGoals.findByUser(userId, 'completed');
          // rescue_mode_entered_at is set when RESCUE was entered
          unlocked = completedBubbles.some((g) => g.rescue_mode_entered_at != null);
          break;
        }

        case 'stall_resolved_within_days': {
          // [DESIGN: §15.5] Resolve stall within 7 days of detection
          const days     = ach.unlock_condition?.value || 7;
          const allGoals = await db.masteryGoals.findByUser(userId);
          unlocked = allGoals.some((g) => {
            if (!g.stall_detected_at || !g.stall_resolved_at) return false;
            const daysTaken = Math.ceil(
              (new Date(g.stall_resolved_at) - new Date(g.stall_detected_at)) / 86400000
            );
            return daysTaken <= days;
          });
          break;
        }

        case 'bubble_completed_long': {
          // [DESIGN: §15.5] Complete a Bubble of ≥ N days
          const minDays    = ach.unlock_condition?.value || 80;
          const completed  = await db.masteryGoals.findByUser(userId, 'completed');
          unlocked = completed.some((g) => {
            if (!g.exam_date || !g.created_at) return false;
            const totalDays = Math.ceil(
              (new Date(g.exam_date) - new Date(g.created_at)) / 86400000
            );
            return totalDays >= minDays;
          });
          break;
        }

        case 'bubbles_completed_count': {
          // [DESIGN: §15.5] N Bubbles completed
          const minCount  = ach.unlock_condition?.value || 5;
          const completed = await db.masteryGoals.findByUser(userId, 'completed');
          unlocked = completed.length >= minCount;
          break;
        }

        case 'debt_settled': {
          // [DESIGN: §15.5, §10.3] All Learning Debt cleared from a missed Bubble
          // debt_cleared event is logged by checkLearningDebtCleared
          const missedBubbles = await db.masteryGoals.findByUser(userId, 'missed');
          for (const b of missedBubbles) {
            const hist = await db.masteryGoals.getHistory(b.id, 10).catch(() => []);
            if (hist.some((h) => h.event_type === 'learning_debt_cleared')) {
              unlocked = true;
              break;
            }
          }
          break;
        }

        case 'no_active_debt_global': {
          // [DESIGN: §15.5] No active Learning Debt across ALL subjects
          const allStates = await db.cardStates.findByUser(userId);
          unlocked = !allStates.some((s) => s.learning_debt === true);
          break;
        }

        case 'cross_bubble_both_completed': {
          // [DESIGN: §15.5] Complete two overlapping (cross_bubble) Bubbles simultaneously
          const allStates  = await db.cardStates.findByUser(userId);
          const crossCards = allStates.filter((s) => s.cross_bubble === true);
          if (crossCards.length > 0) {
            const completed = await db.masteryGoals.findByUser(userId, 'completed');
            // Two completed bubbles that shared at least one card
            const completedIds = new Set(completed.map((b) => b.id));
            unlocked = crossCards.some((s) => {
              const bubbles = s.bubble_ids || [];
              return bubbles.filter((id) => completedIds.has(id)).length >= 2;
            });
          }
          break;
        }
}
if (unlocked) {
await db.userAchievements.create(userId, ach.id || ach.code);
newUnlocks.push(ach);
}
}
return newUnlocks;
}

// ════════════════════════════════════════════════════════════════════════════
//  SERVICE: geminiService  (existing AI calls + integration hooks)

// ════════════════════════════════════════════════════════════════════════════
const CBT_PROMPT = `
ROLE
You are an expert external examiner with deep subject knowledge. You have studied the provided notes thoroughly — but you do NOT write questions from the notes. You write questions the way a university examiner does: you take the knowledge in the notes and construct entirely independent questions that test whether a student truly understands it.
Your questions should feel like they came from an exam paper, not from a study guide.

---

EXAMINER MINDSET — CRITICAL
This is the most important section. Read it before generating a single question.

You are NOT a summarizer. You are an examiner.

The difference:
- A summarizer reads "Mitosis produces 2 identical diploid cells" and asks: "How many cells does mitosis produce?"
- An examiner reads the same line and asks: "A skin cell with 46 chromosomes completes mitosis. A researcher later counts chromosomes in one of the daughter cells and finds 23. Which of the following best explains this finding?"

The examiner asks questions that require understanding, not retrieval.

The Golden Rule — Never Copy Examples
If the notes contain a worked example, you must NEVER reproduce that example as a question. Instead:
- Change the organism
- Change the trait
- Change the context
- Reverse the direction of reasoning
- Present a scenario where the student applies the same principle to something unfamiliar

The student learned from the example. The exam tests whether they can go beyond it.

---

SUBJECT INTELLIGENCE SYSTEM
Before generating questions, analyze the notes and classify the subject:

Step 1 — Detect content type:
Count the proportion of: definitions/concepts/relationships (Theory) vs. formulas/worked examples/numerical reasoning (Calculation).

Step 2 — Set generation ratio automatically:
| Subject Profile | Theory Questions | Calculation Questions |
| Pure theory (e.g., Biology, History) | 90–95% | 5–10% |
| Mixed with light calculation (e.g., Chemistry, Geography) | 65–75% | 25–35% |
| Calculation-heavy (e.g., Physics, Maths) | 30–40% | 60–70% |
| Pure calculation | 10–15% | 85–90% |

Apply this ratio automatically. Do not ask — infer from the notes.

---

DISTRACTOR ENGINEERING — HOW TO BUILD COMPETITIVE OPTIONS
Weak distractors are the #1 failure of AI-generated CBT questions. Every wrong option must be genuinely believable to a student with partial understanding.

The Four Distractor Types (use all four across your question set):

Type 1 — The Partial Truth
The distractor is correct in a related context but wrong here.

Type 2 — The Vocabulary Trap
Uses the correct technical vocabulary but in the wrong relationship.

Type 3 — The Adjacent Concept
A real concept from the same topic that students frequently confuse with the correct answer.

Type 4 — The Plausible Fabrication
Sounds exactly like something that could be true but is not. Built from the same terminology as the correct answer, just assembled wrongly.

Rules for All Distractors:
- All four options must belong to the same domain/category
- At least 2 options must make a student with 60% knowledge hesitate
- Never use "All of the above" or "None of the above"
- Never make the correct answer obviously longer or more detailed than distractors
- Randomize correct answer position — do not always put it in position B or C

---

QUESTION TWISTING TECHNIQUES
Use these to avoid direct, predictable questions:

1. Reversal — Instead of asking what something is, ask what it is NOT, or what would happen if it were absent.
2. Scenario Injection — Embed the concept in a real or hypothetical scenario the notes never mentioned.
3. The Exception Frame — Ask about boundary cases, exceptions, or conditions where the concept breaks down.
4. Consequence Testing — Ask what happens downstream if a step/component fails.
5. Comparison Inversion — Give a scenario and ask which of A or B it describes, rather than asking how they differ.
6. The Misidentification Trap — Describe something correctly in unfamiliar terms and ask what it is.

---

CALCULATION QUESTION PROTOCOL
For any numerical content in the notes:
1. Never use the same numbers from the notes. Always generate fresh values.
2. Never use the same scenario from the notes. Change the organism, object, or context entirely.
3. Generate three difficulty tiers per concept: Direct application (Easy), Multi-step (Medium), Reverse calculation (Hard).
4. Distractors for calculation questions must be results of common arithmetic errors, wrong formula substitutions, correct magnitude with wrong unit, or off-by-one significant figures.

---

QUESTION QUALITY RULES
- No Trivial Recall: Never ask "What year did X happen?" or "How many stages does mitosis have?" — questions must require the student to use knowledge, not just retrieve it.
- The Atomic Rule: One concept per question. No compound questions.
- The Fairness Rule: A student who genuinely understands the material must be able to answer correctly. No trick wording. No ambiguous stems.
- The No-Padding Rule: Never generate a question just to increase count. Every question must test something not already covered.

---

COGNITIVE DISTRIBUTION TARGET
| Level | Target % |
| Knowledge/Recall | < 10% |
| Comprehension | 15–20% |
| Application | 35–40% |
| Analysis | 20–25% |
| Evaluation/Synthesis | 10–15% |

---

OUTPUT FORMAT

QUESTIONS SECTION

Question [N]

Cognitive Level: [Knowledge | Comprehension | Application | Analysis | Evaluation | Synthesis]
Difficulty: [Easy | Medium | Hard]
Type: [Theory | Calculation]

Stem:
[Question or incomplete statement. Must end with ? or :]

Options:
A) [Option]
B) [Option]
C) [Option]
D) [Option]

ANSWERS SECTION (after ALL questions)

SEPARATOR RULE — CRITICAL: After the last question, output a separator line that is EXACTLY three dashes and nothing else:
---
The separator must be on its own line with no spaces, no extra text, no punctuation before or after the dashes. The parser splits on this exact string.

ANSWERS AND EXPLANATIONS

Question [N]:
Correct Answer: [Letter]
Explanation: [1–2 sentences MAX. Why the correct answer is right + the key misconception in the most dangerous distractor only.]

Output Sequence — Non-negotiable:
1. ALL questions first (no answers, no hints embedded)
2. The separator line: exactly ---
3. ALL answers and explanations

Study Notes:
[NOTES]
Generate exactly [COUNT] questions following all rules above.
`;
const FLASHCARD_PROMPT = `
ROLE: You are an expert educational content creator specializing in building comprehensive, pedagogically-sound Anki flashcard sets. Your task is to analyze the provided notes and generate a complete set of Anki cards that ensures no detail is overlooked.

INTELLIGENCE DIRECTIVE: You must recognize when source material contains enumerated lists, dense paragraphs, or multi-part concepts, and automatically decompose them into atomic, testable units. A card asking for "5 pillars" is a note, not a flashcard — break it into 5 separate cards or use cloze deletions. However, decomposition is only correct when each resulting card has independently testable, distinct content. Items that are minor elaborations of the same idea must be merged, not split.

---

MANDATORY REASONING PHASE (EXECUTE BEFORE GENERATING ANY CARDS)
Before writing a single card, silently complete these checks:
1. Have I read and fully understood the entire source material?
2. Which definitions are dense or textbook-stiff and need rewriting?
3. What is the best angle to test each concept (definition, process, comparison, function, cause-effect)?
4. Where are the lists and multi-part concepts that need decomposition or cloze treatment?
5. Which subject framework applies, and which card types will I use?

Only after this reasoning pass should you begin generating cards.

---

OUTPUT FORMAT SPECIFICATION v4.0 — THIS IS A FORMAT CONTRACT. DEVIATION IS AN ERROR.

Standard Cards (Non-Cloze):

Card [N]

Card Type: [Specific Type from Framework]

Front:
[The question, prompt, or incomplete statement]

Back:
[The complete answer]

Cloze Deletion Cards:

Card [N]

Card Type: Cloze Deletion

Front:
[Text with {{c1::hidden}} content — ALL deletions use {{c1::}} only, never c2/c3/c4]

Back:
(Cloze - see Front)

FIELD RULES:
- Card header: exactly "Card [N]" followed by one blank line
- Card Type line: required on every card
- Front and Back headers each on their own line, content on the line immediately after
- Exactly one blank line between the end of Back content and the next Card header
- No horizontal rules between cards
- No markdown code blocks around cards
- Cloze numbering: ALWAYS {{c1::}} for every deletion. Using c2/c3/c4 is forbidden.

SCIENTIFIC NOTATION:
- Use Unicode subscripts: H₂O, CO₂, V₁ (not H2O, CO2)
- Use Unicode superscripts: m², cm³, 10⁶ (not m2, cm3)
- For variable exponents: caret notation e.g. e^{kx}

---

PLAIN LANGUAGE RULE — CRITICAL
Every Back answer must be written in natural, speakable language. Do not copy definitions verbatim from the source if they are dense or textbook-stiff. Rewrite to flow like one person explaining to another, while keeping all key technical terms.

Test: read the Back answer aloud. If it sounds natural, it passes. If it sounds like reading off a label, rewrite it.

In the rare case notes contain "NOT CBT" anywhere, switch to Precision Mode: prioritise exact academic phrasing and technical completeness where verbatim recall matters — but still avoid unnecessary stiffness.

---

TIERED BACK FORMAT

Tier 1 — Core Answer (always required): The direct, minimal answer. One line where possible.

Tier 2 — Clarification Note (optional): Used only when the core answer alone leaves a genuine gap in understanding. Format:

Back:
[Core answer]

<i>(Clarification note)</i>

Use Tier 2 sparingly — only when the core answer could be misunderstood without context. Do not default to including it on every card.

---

CARD ATOMICITY RULES — CRITICAL

The Decomposition Test — apply before splitting any concept:
DECOMPOSE when an item has its own distinct name, specific function/rule/example, or content that would be genuinely missed if absent.
MERGE when items express the same idea in slightly different words, or are minor elaborations with no unique testable detail.

For lists of 3+ items, choose one approach:
1. Decompose into atomic Component cards (preferred when items are truly distinct)
2. Use Cloze Deletion (for tightly related items that belong together)

Bounded List Exception: A card asking for a complete list is allowed ONLY when the list is a single conceptual unit, has a stable canonical size of 7 or fewer items, and full-set recall is the specific learning objective.

Forbidden: enumeration cards with numbered answers — these are notes, not flashcards.

---

CARD CREATION FRAMEWORK

FOR BIOLOGY NOTES: Cloze Deletion, Process Explanation, Compare & Contrast, Function > Structure, Component, Input-Output.
FOR CHEMISTRY NOTES: Cloze Deletion, Concept Explanation, Formula & Unit, Problem-Solving Trigger, Rules & Naming, Characteristic.
FOR PHYSICS NOTES: Concept Definition, Formula Recall, Variable & Unit, Conceptual Understanding, Problem-Solving Trigger, Common Mistake.
FOR MATHEMATICS NOTES: Formula & Condition, Step-by-Step Procedure, Conceptual Understanding, Theorem & Property, Common Mistake, Connection.
FOR ALL OTHER SUBJECTS: Concept Definition, Component, Compare & Contrast, Cloze Deletion, Rules & Naming, Conceptual Understanding.

Select the framework matching the notes. You may override a card type when the framework produces a clearly inferior card — but name the override explicitly in the Card Type field.

---

VALIDATION RULES
1. Cover every concept, term, rule, and meaningful distinction — but only decompose when each item has independently testable content.
2. No enumeration cards (no "List the 5..." with multi-item backs).
3. Sequential numbering: Card 1, Card 2, Card 3... with no gaps.
4. All cloze deletions use {{c1::}} only — c2/c3/c4 are forbidden.
5. No empty Front sections. Back required for all non-Cloze cards.
6. All scientific notation uses proper Unicode subscripts/superscripts or caret notation.
7. Every Back answer passes the Plain Language Rule before output.
8. Mandatory Reasoning Phase completed before Card 1 is written.
9. Framework discipline: use the subject framework; name any override explicitly.
10. Return all cards as plain text inline in your response — do not reference external files.

---

NOTES TO PROCESS:
[NOTES]
`;

async function generateCBTQuestions(notes, count) {
const prompt = CBT_PROMPT.replace('[NOTES]', notes).replace('[COUNT]', count);
try {
const result = await geminiModel.generateContent(prompt);
return result.response.text();
} catch (e) {
console.error('Gemini CBT error:', e.message);
return null; // B25: caller handles null via generateFallbackExamQuestions
}
}
// B25: Fallback exam question generator (rule-based from card content)

function generateFallbackExamQuestions(cards, examSessionId, count) {
const questions = [];
const selected = cards.slice(0, Math.min(count, cards.length));
selected.forEach((card, idx) => {
// Build a simple 4-option MCQ from card content
const otherCards = selected.filter((c, i) => i !== idx).slice(0, 3);
const options = [
card.back_content || 'Answer A',
...otherCards.map((c) => c.back_content || 'Distractor'),
].slice(0, 4);
while (options.length < 4) options.push('None of the above');
// Shuffle options
for (let i = options.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[options[i], options[j]] = [options[j], options[i]];
}
const correctIndex = options.indexOf(card.back_content || 'Answer A');
const correctLetter = ['A', 'B', 'C', 'D'][Math.max(0, correctIndex)];
questions.push({
exam_session_id: examSessionId,
card_id: card.id,
question_number: idx + 1,
cognitive_level: 'Knowledge',
difficulty: 'Medium',
question_type: 'Theory',
stem: card.front_content || 'What is the correct answer?',
option_a: options[0] || '',
option_b: options[1] || '',
option_c: options[2] || '',
option_d: options[3] || '',
correct_answer: correctLetter,
explanation: `The correct answer is based on the card: "${(card.back_content || '').slice(0, 100)}"`,
});
});
return questions;
}

async function generateFlashcards(notes, subjectHint = '') {
const prompt =
FLASHCARD_PROMPT.replace('[NOTES]', notes) +
(subjectHint ? `\nSubject hint: ${subjectHint}` : '');
try {
const result = await geminiModel.generateContent(prompt);
return result.response.text();
} catch (e) {
console.error('Gemini flashcard error:', e.message);
// B25 fallback: generate basic card format from note lines
const lines = notes.split('\n').filter((l) => l.trim().length > 10);
let fallback = '';
lines.slice(0, 10).forEach((line, idx) => {
const parts = line.split(/[:—–]/);
const front = parts[0]?.trim() || line.slice(0, 60);
const back = parts.slice(1).join(':').trim() || 'See notes for full answer.';
fallback += `Card ${idx + 1}\nCard Type: Standard\nFront:\n${front}\nBack:\n${back}\n\n`;
});
if (!fallback.trim()) throw new Error('AI generation failed and no note content to parse.');
return fallback;
}
}

async function summarizeCard(front, back) {
const prompt = `Summarize this flashcard in one concise sentence:\nFront: ${front}\nBack: ${back}`;
try {
const result = await geminiModel.generateContent(prompt);
return result.response.text();
} catch (e) {
console.error('Gemini summarize error:', e);
return 'Explanation unavailable.';
}
}

async function extractFromImage(base64Image, mimeType) {
const prompt =
'Extract all question-answer pairs or key-value pairs from this image. Return as JSON array of {front, back} objects. If no pairs found, return the raw text.';
try {
const result = await geminiModel.generateContent({
contents: [
{
parts: [
{ text: prompt },
{ inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } },
],
},
],
});
return result.response.text();
} catch (e) {
console.error('Gemini vision error:', e);
return 'Extraction failed.';
}
}

async function generateTasksWithGemini(userData) {
const prompt = `You are a study coach. Generate personalized study tasks for a student.
Student data: ${JSON.stringify(userData)}
Return ONLY valid JSON with this structure:
{
  "daily": [{"title":"...","description":"...","task_category":"review_cards","target_value":20,"xp_reward":50}],
  "weekly": [...],
  "monthly": [...]
}
Categories: review_cards, accuracy_target, study_time, quiz_score, master_cards, reduce_again, streak, complete_deck
Generate 3 daily, 2 weekly, 1 monthly tasks.`;
try {
const result = await geminiModel.generateContent(prompt);
const text = result.response
.text()
.replace(/```json|```/g, '')
.trim();
return JSON.parse(text);
} catch (e) {
return null;
}
}

function parseCBTResponse(text, examSessionId, sourceCards) {
const parts = text.split('---');
const questionsBlock = parts[0] || text;
const answersBlock = parts[1] || '';
const questions = [];
const qLines = questionsBlock.split('\n');
let current = null,
qNum = 0;
for (const rawLine of qLines) {
const line = rawLine.trim();
if (!line) continue;
const qMatch = line.match(/^Question\s(\d+)/i);
if (qMatch) {
if (current && current.stem) questions.push(current);
qNum = parseInt(qMatch[1], 10);
current = {
exam_session_id: examSessionId,
card_id: sourceCards[qNum - 1]?.id || null,
question_number: qNum,
cognitive_level: 'Application',
difficulty: 'Medium',
question_type: 'Theory',
stem: '',
option_a: '',
option_b: '',
option_c: '',
option_d: '',
correct_answer: '',
explanation: '',
};
continue;
}
if (!current) continue;
if (line.match(/^Cognitive Level:/i))
current.cognitive_level =
line.replace(/^Cognitive Level:\s/i, '').trim() || current.cognitive_level;
else if (line.match(/^Difficulty:/i))
current.difficulty = line.replace(/^Difficulty:\s/i, '').trim() || current.difficulty;
else if (line.match(/^Type:/i))
current.question_type = line.replace(/^Type:\s/i, '').trim() || current.question_type;
else if (line.match(/^Stem:/i)) current.stem = line.replace(/^Stem:\s/i, '');
else if (line.match(/^A[)\s]+/i)) current.option_a = line.replace(/^A[)\s]+/i, '');
else if (line.match(/^B[)\s]+/i)) current.option_b = line.replace(/^B[)\s]+/i, '');
else if (line.match(/^C[)\s]+/i)) current.option_c = line.replace(/^C[)\s]+/i, '');
else if (line.match(/^D[)\s]+/i)) current.option_d = line.replace(/^D[)\s]+/i, '');
else if (line.match(/^Options:/i)) {
/ skip label /
} else if (current.stem && !line.match(/^(Cognitive Level|Difficulty|Type|Stem|Options):/i)) {
current.stem += ' ' + line;
} else if (!current.stem) {
current.stem = line;
}
}
if (current && current.stem) questions.push(current);
const answerMap = new Map();
const aLines = answersBlock.split('\n');
let currentAnswerNum = null,
currentAnswer = {};
for (const rawLine of aLines) {
const line = rawLine.trim();
if (!line) continue;
const qNumMatch = line.match(/^Question\s(\d+)\s:/i);
if (qNumMatch) {
if (currentAnswerNum !== null && currentAnswer.correct_answer)
answerMap.set(currentAnswerNum, currentAnswer);
currentAnswerNum = parseInt(qNumMatch[1], 10);
currentAnswer = {};
continue;
}
if (currentAnswerNum === null) continue;
if (line.match(/^Correct Answer:/i)) {
const ans = line.replace(/^Correct Answer:\s/i, '').trim();
currentAnswer.correct_answer = ans.match(/^[A-D]/i) ? ans.toUpperCase() : '';
} else if (line.match(/^Explanation:/i)) {
currentAnswer.explanation = line.replace(/^Explanation:\s/i, '');
} else if (currentAnswer.explanation !== undefined) {
currentAnswer.explanation += ' ' + line;
}
}
if (currentAnswerNum !== null && currentAnswer.correct_answer)
answerMap.set(currentAnswerNum, currentAnswer);
return questions.map((q, idx) => {
const ans = answerMap.get(q.question_number) || {};
return {
...q,
question_number: idx + 1,
option_a: q.option_a || 'Option A',
option_b: q.option_b || 'Option B',
option_c: q.option_c || 'Option C',
option_d: q.option_d || 'Option D',
correct_answer: ans.correct_answer || 'A',
explanation: ans.explanation || 'No explanation provided.',
};
});
}

function parseFlashcards(text) {
const cards = [];
const regex =
/Card\s\d+\s\n(?:Card Type:.\n)?\n?Front:\s([\s\S]?)\nBack:\s([\s\S]?)(?=\nCard\s\d+|\n)/g;
let m;
while ((m = regex.exec(text)) !== null) {
const front = m[1].trim(),
back = m[2].trim();
cards.push({
front_content: front,
back_content: back,
card_type: front.includes('{{c1::') ? 'cloze' : 'standard',
});
}
if (cards.length === 0) {
const lines = text.split('\n').filter((l) => l.trim());
for (let i = 0; i < lines.length - 1; i++) {
if (lines[i].trim().match(/^Front:/i) && lines[i + 1].trim().match(/^Back:/i)) {
cards.push({
front_content: lines[i].replace(/^Front:\s/i, '').trim(),
back_content: lines[i + 1].replace(/^Back:\s/i, '').trim(),
card_type: 'standard',
});
i++;
}
}
}
return cards;
}

// ════════════════════════════════════════════════════════════════════════════
//  SERVICE: taskService

// ════════════════════════════════════════════════════════════════════════════

async function generateTasksForUser(userId) {
const [user, stats, allSubjects] = await Promise.all([
db.users.findById(userId),
db.userStats.get(userId),
db.subjects.findManyWithDecks(userId),
]);
if (!user || !stats) return;
const now = new Date();
const allCards = await db.cards.findAllForUser(userId);
const dueCards = allCards.filter(
(c) => !c.next_review_at || new Date(c.next_review_at) <= now
).length;
const stage1 = allCards.filter((c) => c.stage === 1).length;
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const logs = await db.reviewLogs.findByUser(userId, thirtyDaysAgo);
const againBySubject = {};
for (const log of logs) {
if (log.response === 'again' && log.card_id) {
const card = await db.cards.findById(userId, log.card_id);
if (card?.deck_id) {
const deck = await db.decks.findById(userId, card.deck_id);
if (deck?.subject_id) {
againBySubject[deck.subject_id] = (againBySubject[deck.subject_id] || 0) + 1;
}
}
}
}
let againHeavy = null,
maxAgain = 0;
for (const [sid, count] of Object.entries(againBySubject)) {
if (count > maxAgain) {
maxAgain = count;
againHeavy = allSubjects.find((s) => s.id === sid)?.name;
}
}
const userData = {
due_cards_today: dueCards,
subjects: allSubjects.map((s) => ({
name: s.name,
due: 0,
health_score: 50,
last_studied: '2 days ago',
})),
current_streak: stats.current_streak,
stage_1_cards: stage1,
again_heavy: againHeavy || allSubjects[0]?.name || 'General',
weakest_subject: againHeavy || allSubjects[0]?.name || 'General',
sessions_today: 0,
mastered_this_week: 0,
average_accuracy_7d: 70,
exams_this_month: 0,
};
let tasks;
try {
tasks = await generateTasksWithGemini(userData);
} catch (e) {
tasks = null;
}
if (!tasks) {
tasks = {
daily: [
{
title: `Review ${Math.min(30, dueCards || 20)} cards today`,
description: 'Complete a study session',
task_category: 'review_cards',
target_value: Math.min(30, dueCards || 20),
xp_reward: 50,
},
{
title: 'Maintain your streak',
description: 'Study at least 5 cards to keep your streak alive',
task_category: 'streak',
target_value: 5,
xp_reward: 40,
},
{
title: 'Hit 70% accuracy',
description: 'Get at least 70% Good or Easy responses',
task_category: 'accuracy_target',
target_value: 70,
xp_reward: 50,
},
],
weekly: [
{
title: 'Review 150 cards this week',
description: 'Accumulate 150 card reviews',
task_category: 'review_cards',
target_value: 150,
xp_reward: 200,
},
{
title: 'Study 3 hours this week',
description: 'Accumulate 180 minutes of study time',
task_category: 'study_time',
target_value: 180,
xp_reward: 200,
},
],
monthly: [
{
title: 'Complete 600 reviews this month',
description: 'Study consistently',
task_category: 'review_cards',
target_value: 600,
xp_reward: 600,
},
],
};
}
const expiresDaily = new Date(now);
expiresDaily.setDate(expiresDaily.getDate() + 1);
const expiresWeekly = new Date(now);
expiresWeekly.setDate(expiresWeekly.getDate() + 7);
const expiresMonthly = new Date(now);
expiresMonthly.setDate(expiresMonthly.getDate() + 30);
await db.tasks.deleteActive(userId);
const creates = [
...(tasks.daily || []).map((t) =>
db.tasks.create(userId, { ...t, type: 'daily', expires_at: expiresDaily })
),
...(tasks.weekly || []).map((t) =>
db.tasks.create(userId, { ...t, type: 'weekly', expires_at: expiresWeekly })
),
...(tasks.monthly || []).map((t) =>
db.tasks.create(userId, { ...t, type: 'monthly', expires_at: expiresMonthly })
),
];
await Promise.all(creates);
}

async function updateTaskProgress(userId, sessionData = null, examData = null) {
const taskList = await db.tasks.findMany(userId, { status: 'active' });
await Promise.all(
taskList.map(async (task) => {
let newValue = task.current_value;
switch (task.task_category) {
case 'review_cards':
if (sessionData?.cards_reviewed) newValue += sessionData.cards_reviewed;
break;
case 'accuracy_target':
// P11b FIX: accuracy_pct is never written (removed from session logic per P4.2).
// This branch can never execute. Retain case to avoid default fallthrough.
// TODO: Replace with a meaningful metric when accuracy tracking is redesigned.
break;
case 'study_time':
if (sessionData?.duration_seconds)
newValue += Math.round(sessionData.duration_seconds / 60);
break;
case 'quiz_score':
if (examData?.score_pct) newValue = Math.max(newValue, Math.round(examData.score_pct));
break;
case 'master_cards':
if (sessionData?.new_mastered_count) newValue += sessionData.new_mastered_count;
break;
case 'reduce_again':
if (sessionData?.cards_again !== undefined) newValue = sessionData.cards_again;
break;
case 'streak':
if (sessionData?.cards_reviewed >= 5) newValue += 1;
break;
case 'complete_deck':
if (sessionData?.session_completed) newValue += 1;
break;
}
if (newValue >= task.target_value) {
await db.tasks.update(userId, task.id, {
current_value: newValue,
status: 'completed',
completed_at: new Date(),
});
await awardXP(userId, task.xp_reward);
} else {
await db.tasks.update(userId, task.id, { current_value: newValue });
}
})
);
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — Card Intelligence Layer & Knowledge Score

// ════════════════════════════════════════════════════════════════════════════
// ── cardIntelligenceService ─────────────────────────────────────────────────
const CARD_STATES = {
SEEDLING: 'SEEDLING',
GROWING: 'GROWING',
STABLE: 'STABLE',
FRAGILE: 'FRAGILE',
VERIFIED: 'VERIFIED',
STUCK: 'STUCK',
AVOIDED: 'AVOIDED',
DANGEROUS: 'DANGEROUS',
GHOST: 'GHOST',
};

function daysBetween(dateA, dateB) {
const d1 = new Date(dateA);
d1.setHours(0, 0, 0, 0);
const d2 = new Date(dateB);
d2.setHours(0, 0, 0, 0);
return Math.floor((d2 - d1) / 86400000);
}

function daysSince(date) {
if (!date) return Infinity;
return daysBetween(date, new Date());
}
// getSubjectExamDate: resolves exam date even when not explicitly set
// Priority: (1) subject.exam_date if set, (2) last_exam_at + 90 days,
// (3) subject.created_at + 90 days. Returns null if none resolvable.

async function getSubjectExamDate(userId, subjectId) {
try {
const subject = await db.subjects.findById(subjectId);
if (!subject) return null;
// 1. Explicit exam date: use if not more than 3 days past
if (subject.exam_date) {
const daysToExplicit = daysBetween(new Date(), new Date(subject.exam_date));
if (daysToExplicit >= -3) return new Date(subject.exam_date);
}
// 2. Infer from last KIWI exam on this subject + 90-day semester cycle
const stats = await db.subjectStats.get(userId, subjectId);
if (stats && stats.last_exam_at) {
const projected = new Date(stats.last_exam_at);
projected.setDate(projected.getDate() + 90);
const daysToProjected = daysBetween(new Date(), projected);
if (daysToProjected >= -3 && daysToProjected <= 365) return projected;
}
// 3. Fallback: subject creation + 90 days (first-semester assumption)
if (subject.created_at) {
const projected = new Date(subject.created_at);
projected.setDate(projected.getDate() + 90);
const daysToProjected = daysBetween(new Date(), projected);
if (daysToProjected >= -3 && daysToProjected <= 365) return projected;
}
return null;
} catch (e) {
return null;
}
}

async function determineCardState(card, reviewLogs, examLogs, subjectExamDate = null) {
const { stage, next_review_at, last_reviewed_at, created_at } = card;
const now = new Date();
// SEEDLING: never reviewed
if (!reviewLogs || reviewLogs.length === 0) {
return { state: CARD_STATES.SEEDLING, stage: stage || 1, verified: false };
}
// GHOST: Stage 5, not reviewed in >=60 days
// FIX #2: Preserve verified status — GHOST must not wipe VERIFIED.
if (stage === 5) {
const daysSinceReview = daysSince(last_reviewed_at);
if (daysSinceReview >= 60) {
return {
state: CARD_STATES.GHOST,
stage: 5,
verified: card.verified === true,
ghost_days: daysSinceReview,
};
}
}
// DANGEROUS: subject exam within 14 days, stage 1-2
// FIX #11: Removed deprecated `weight` field
if (stage <= 2 && subjectExamDate) {
const daysToExam = daysBetween(now, new Date(subjectExamDate));
if (daysToExam <= 14 && daysToExam >= 0) {
return { state: CARD_STATES.DANGEROUS, stage, verified: false };
}
}
// STUCK: >=5 reviews, no stage change in 14 days, >=2 of last 3 responses were Again/Hard
const recentLogs = reviewLogs
.filter((l) => l.card_id === card.id)
.sort((a, b) => new Date(b.reviewed_at) - new Date(a.reviewed_at));
if (recentLogs.length >= 5) {
const last14Days = recentLogs.filter((l) => daysSince(l.reviewed_at) <= 14);
// FIX #12: Ensure recent logs match current stage (catches recently promoted cards)
const stagesInLast14 = [...new Set(last14Days.map((l) => l.new_stage))];
if (stagesInLast14.length === 1 && stagesInLast14[0] === stage) {
const last3 = recentLogs.slice(0, 3);
const badResponses = last3.filter(
(l) => l.response === 'again' || l.response === 'hard'
).length;
if (badResponses >= 2) {
return { state: CARD_STATES.STUCK, stage, verified: false };
}
}
}
// AVOIDED: due >=3 days, pattern of >=3 overdue occurrences in last 14 days
if (next_review_at) {
const daysOverdue = daysBetween(new Date(next_review_at), now);
if (daysOverdue >= 3) {
const overdueOccurrences = recentLogs.filter((l) => {
if (!l.next_review_at) return false;
const overdue = daysBetween(new Date(l.next_review_at), new Date(l.reviewed_at)) >= 3;
return overdue && daysSince(l.reviewed_at) <= 14;
}).length;
if (overdueOccurrences >= 3) {
return { state: CARD_STATES.AVOIDED, stage, verified: false };
}
}
}
// Stage 5: FRAGILE vs VERIFIED
// FIX #1: card.verified guard must precede examLogs.some() to prevent
// verified cards being demoted to FRAGILE when examLogs is empty.
if (stage === 5) {
if (card.verified === true) {
return { state: CARD_STATES.VERIFIED, stage: 5, verified: true };
}
const hasCorrectExam =
examLogs && examLogs.some((e) => e.card_id === card.id && e.is_correct === true);
if (hasCorrectExam) {
return { state: CARD_STATES.VERIFIED, stage: 5, verified: true };
}
return { state: CARD_STATES.FRAGILE, stage: 5, verified: false };
}
// STABLE: stage 3-4, no consecutive failures, reviewed on schedule
if (stage >= 3 && stage <= 4) {
const last3 = recentLogs.slice(0, 3);
const allGood = last3.every((l) => l.response === 'good' || l.response === 'easy');
// FIX #5b: Correct daysBetween order — earlier date first, later date second
const onSchedule = last3.every((l) => {
if (!l.previous_interval) return true;
const actualInterval = daysBetween(
l.previous_review_at || l.created_at || now,
l.reviewed_at
);
return actualInterval <= (l.previous_interval || 1) + 1;
});
if (allGood && onSchedule) {
return { state: CARD_STATES.STABLE, stage, verified: false };
}
return { state: CARD_STATES.GROWING, stage, verified: false };
}
// GROWING: stage 1-3, normal progress
// FIX #11: Removed deprecated `weight` field
if (stage >= 1 && stage <= 3) {
return { state: CARD_STATES.GROWING, stage, verified: false };
}
// Default fallback
return { state: CARD_STATES.GROWING, stage: stage || 1, weight: 1, verified: false };
}

async function evaluateCardStateFull(userId, card, subjectExamDate = null) {
if (!subjectExamDate && card.deck_id) {
try {
const deck = await db.decks.findById(userId, card.deck_id);
if (deck && deck.subject_id) {
subjectExamDate = await getSubjectExamDate(userId, deck.subject_id);
}
} catch (e) {
/ non-fatal /
}
}
const reviewLogs = await db.reviewLogs.findByUser(userId, new Date(0));
const cardLogs = reviewLogs.filter((l) => l.card_id === card.id);
// FIX #14: Build examLogs from actual exam history instead of empty array
let examLogs = [];
try {
const userExamSessions = await db.examSessions.findMany(userId, { status: 'completed' }, { limit: 50 });
for (const es of (userExamSessions.sessions || userExamSessions || [])) {
if (!es.id) continue;
const questions = await db.examQuestions.findBySession
? await db.examQuestions.findBySession(userId, es.id).catch(() => [])
: [];
for (const q of (questions || [])) {
if (q.card_id === card.id) {
examLogs.push({ card_id: card.id, is_correct: q.is_correct === true });
}
}
}
} catch (e) {
examLogs = []; // non-fatal
}
return determineCardState(card, cardLogs, examLogs, subjectExamDate);
}

async function initializeCardState(userId, cardId, initialState = CARD_STATES.SEEDLING) {
const existing = await db.cardStates.get(userId, cardId);
if (existing) return existing;
const card = await db.cards.findById(userId, cardId);
if (!card) return null;
const payload = {
state: initialState,
stage: card.stage || 1,
weight: 1,
verified: false,
verified_at: null,
last_evaluated_at: new Date(),
};
await db.cardStates.create(userId, cardId, payload);
return payload;
}

async function recomputeAndStoreCardState(userId, cardId, subjectExamDate = null) {
const card = await db.cards.findById(userId, cardId);
if (!card) return null;
// Auto-resolve subject exam date via getSubjectExamDate (handles null, inferred, and explicit)
if (!subjectExamDate && card.deck_id) {
try {
const deck = await db.decks.findById(userId, card.deck_id);
if (deck && deck.subject_id) {
subjectExamDate = await getSubjectExamDate(userId, deck.subject_id);
}
} catch (e) {
/ non-fatal /
}
}
const reviewLogs = await db.reviewLogs.findByUser(userId, new Date(0));
const cardLogs = reviewLogs.filter((l) => l.card_id === card.id);
// FIX #13: Replaced dead conditional with actual exam-correctness lookup
let examLogs = [];
try {
const userExamSessions = await db.examSessions.findMany(userId, { status: 'completed' }, { limit: 50 });
for (const es of (userExamSessions.sessions || userExamSessions || [])) {
if (!es.id) continue;
const questions = await db.examQuestions.findBySession
? await db.examQuestions.findBySession(userId, es.id).catch(() => [])
: [];
for (const q of (questions || [])) {
if (q.card_id === card.id) {
examLogs.push({ card_id: card.id, is_correct: q.is_correct === true });
}
}
}
} catch (e) {
examLogs = []; // non-fatal
}
const stateResult = await determineCardState(card, cardLogs, examLogs, subjectExamDate);
await db.cardStates.update(userId, cardId, stateResult);
return stateResult;
}

async function batchInitializeSeedlingStates(userId, cardIds) {
const results = [];
for (const cardId of cardIds) {
const state = await initializeCardState(userId, cardId, CARD_STATES.SEEDLING);
results.push(state);
}
return results;
}
// ── knowledgeScoreService ─────────────────────────────────────────────────────
const KS_BANDS = [
{ max: 19, name: '🌱 Seed' },
{ max: 39, name: '🌿 Sprouting' },
{ max: 59, name: '🍃 Growing' },
{ max: 74, name: '🌸 Forming' },
{ max: 89, name: '🌳 Strong' },
{ max: 99, name: '🥝 Mastered' },
{ max: 100, name: '👑 Sovereign' },
];

function getBandName(score) {
const s = Math.min(100, Math.max(0, score));
for (const band of KS_BANDS) {
if (s <= band.max) return band.name;
}
return '👑 Sovereign';
}

function getBaseWeight(stage, verified, isFragile) {
if (stage === 1) return 1;
if (stage === 2) return 2;
if (stage === 3) return 3;
if (stage === 4) return 4.5;
if (stage === 5) {
if (verified) return 5.0;
if (isFragile) return 4.5;
return 4.5; // Stage 5 without verification = FRAGILE weight
}
return 1;
}

function applyGhostDecay(baseWeight, daysSinceReview, verified, isGhost = false) {
// P2.4 fix: GHOST state cards always decay; only skip decay for non-GHOST stage-5 cards
if (!isGhost && (!verified || daysSinceReview < 60)) return baseWeight;
if (daysSinceReview <= 89) return 4.5;
if (daysSinceReview <= 119) return 4.0;
return 3.0;
}

function computeEffectiveWeight(cardState, card) {
const { stage, verified } = cardState;
const isFragile = cardState.state === CARD_STATES.FRAGILE;
const isGhost = cardState.state === CARD_STATES.GHOST;
const baseWeight = getBaseWeight(stage, verified, isFragile);
const daysSinceReview = daysSince(card.last_reviewed_at);
if (isGhost || (stage === 5 && daysSinceReview >= 60)) {
return applyGhostDecay(baseWeight, daysSinceReview, verified, isGhost);
}
return baseWeight;
}

async function computeKnowledgeScore(userId, subjectId = null) {
let allCards = [];
let cardStates = [];
if (subjectId) {
const decks = await db.decks.findBySubject(userId, subjectId);
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id);
allCards.push(...cards);
}
} else {
allCards = await db.cards.findAllForUser(userId);
}
if (allCards.length === 0) {
return { score: 0, band: '🌱 Seed', totalCards: 0, sumWeights: 0 };
}
// B8: Batch-fetch all card states in a single Firestore query
const allStatesDocs = await db.cardStates.findByUser(userId);
const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
let sumWeights = 0;
for (const card of allCards) {
let stateDoc = statesByCardId.get(card.id);
if (!stateDoc) {
stateDoc = await initializeCardState(userId, card.id, CARD_STATES.SEEDLING);
}
const weight = computeEffectiveWeight(stateDoc, card);
sumWeights += weight;
}
const score = (sumWeights / (allCards.length * 5)) * 100;
const clamped = Math.min(100, Math.max(0, score));
return {
score: parseFloat(clamped.toFixed(2)),
band: getBandName(clamped),
totalCards: allCards.length,
sumWeights: parseFloat(sumWeights.toFixed(2)),
};
}

async function computeGlobalKnowledgeScore(userId) {
const subjects = await db.subjects.findManyWithDecks(userId);
if (subjects.length === 0) return { score: 0, band: '🌱 Seed', totalCards: 0 };
let totalWeightedSum = 0;
let totalCardCount = 0;
for (const subject of subjects) {
const ks = await computeKnowledgeScore(userId, subject.id);
totalWeightedSum += ks.score * ks.totalCards;
totalCardCount += ks.totalCards;
}
if (totalCardCount === 0) return { score: 0, band: '🌱 Seed', totalCards: 0 };
const globalScore = totalWeightedSum / totalCardCount;
return {
score: parseFloat(globalScore.toFixed(2)),
band: getBandName(globalScore),
totalCards: totalCardCount,
};
}

async function persistKnowledgeScore(userId, subjectId = null) {
if (subjectId) {
const ks = await computeKnowledgeScore(userId, subjectId);
await db.subjectStats.upsert(userId, subjectId, { knowledge_score: ks.score });
return ks;
}
const globalKS = await computeGlobalKnowledgeScore(userId);
await db.userStats.update(userId, { knowledge_score_global: globalKS.score });
return globalKS;
}

// ════════════════════════════════════════════════════════════════════════════
//  MASTERY BUBBLE SERVICE (PB.2 / PB.3 / PB.4)
//  [DESIGN: §2, §3, §9, §10, §11]
// ════════════════════════════════════════════════════════════════════════════

const BUBBLE_PHASES = {
  SEEDING:   'SEEDING',
  GROWING:   'GROWING',
  HARDENING: 'HARDENING',
  FINAL:     'FINAL',
  RESCUE:    'RESCUE',
};

// ─── PB.3: Phase Boundary Computation ────────────────────────────────────────
// [DESIGN: §2.1] Default boundaries: SEEDING=40%, GROWING=testDate, HARDENING=90%, FINAL=100%

function computePhaseBoundaries(totalDays, testDateDayOffset = null) {
  const seedingEnd      = Math.floor(totalDays * 0.4);
  const growingFallback = Math.floor(totalDays * 0.7); // [DESIGN: §2.3 — 70% of days fallback]
  const testDay         = testDateDayOffset || growingFallback;
  const growingEnd      = Math.min(testDay, growingFallback); // whichever is FIRST
  const hardeningEnd    = Math.floor(totalDays * 0.9);
  return { seedingEnd, growingEnd, hardeningEnd, finalEnd: totalDays };
}

// ─── PB.3: Current Phase Computation ─────────────────────────────────────────
// [DESIGN: §2.1] Phase transition trigger for GROWING: Test Date reached OR 70% days elapsed
// (whichever is first) — both conditions checked here

function computeCurrentPhase(goal, now = new Date()) {
  if (goal.rescue_active) return BUBBLE_PHASES.RESCUE; // RESCUE overrides all
  const examDate = goal.exam_date ? new Date(goal.exam_date) : null;
  if (!examDate) return BUBBLE_PHASES.SEEDING;
  const totalDays  = Math.max(1, Math.ceil((examDate - new Date(goal.created_at)) / 86400000));
  const daysPassed = Math.max(0, Math.ceil((now - new Date(goal.created_at)) / 86400000));
  const testDate   = goal.test_date ? new Date(goal.test_date) : null;
  const testOffset = testDate
    ? Math.ceil((testDate - new Date(goal.created_at)) / 86400000)
    : null;
  const bounds = computePhaseBoundaries(totalDays, testOffset);
  if (daysPassed <= bounds.seedingEnd)   return BUBBLE_PHASES.SEEDING;
  if (daysPassed <= bounds.growingEnd)   return BUBBLE_PHASES.GROWING;
  if (daysPassed <= bounds.hardeningEnd) return BUBBLE_PHASES.HARDENING;
  return BUBBLE_PHASES.FINAL;
}

// ─── PB.2: Fractional KS for a Bubble ────────────────────────────────────────
// [DESIGN: §1.2, §15.6] Reuses existing knowledgeScoreService formula — no new formula

async function computeBubbleKS(userId, goal) {
  const cardIds = goal.card_ids || [];
  if (cardIds.length === 0) return { score: 0, band: '🌱 Seed', totalCards: 0, sumWeights: 0 };
  const allStatesDocs  = await db.cardStates.findByUser(userId);
  const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
  let sumWeights = 0;
  let validCount  = 0;
  for (const cardId of cardIds) {
    const card = await db.cards.findById(userId, cardId).catch(() => null);
    if (!card) continue;
    validCount++;
    let stateDoc = statesByCardId.get(cardId);
    if (!stateDoc) stateDoc = await initializeCardState(userId, cardId, CARD_STATES.SEEDLING);
    sumWeights += computeEffectiveWeight(stateDoc, card);
  }
  if (validCount === 0) return { score: 0, band: '🌱 Seed', totalCards: 0, sumWeights: 0 };
  const score   = (sumWeights / (validCount * 5)) * 100;
  const clamped = Math.min(100, Math.max(0, score));
  return {
    score:      parseFloat(clamped.toFixed(2)),
    band:       getBandName(clamped),
    totalCards: validCount,
    sumWeights: parseFloat(sumWeights.toFixed(2)),
  };
}

// ─── PB.4: Required KS Per Day ───────────────────────────────────────────────
function computeRequiredKSPerDay(goal, currentKS, now = new Date()) {
  if (!goal.exam_date) return 0;
  const examDate      = new Date(goal.exam_date);
  const daysRemaining = Math.max(1, Math.ceil((examDate - now) / 86400000));
  const targetKS      = goal.target_ks || 100;
  const ksNeeded      = Math.max(0, targetKS - currentKS);
  return parseFloat((ksNeeded / daysRemaining).toFixed(3));
}

// ─── PB.4: Rolling Velocity ───────────────────────────────────────────────────
function computeVelocityFromGoal(goal) {
  const samples = goal.velocity_samples || [];
  if (samples.length === 0) return 0;
  const window = samples.slice(-7); // 7-day rolling average [DESIGN: §3.1]
  return parseFloat((window.reduce((a, b) => a + b, 0) / window.length).toFixed(3));
}

// ─── PB.4: Trajectory Status — Gap-Based [DESIGN: §3.2] ─────────────────────
// ⚠ CORRECTED from v1.0: gap-based formula, DRIFTING status added
// gap ≤ 0: ON_TRACK | 0 < gap ≤ 0.3: DRIFTING | 0.3 < gap ≤ 1.0: BEHIND | gap > 1.0: CRITICAL
// RESCUE overrides when rescue_active = true

function computeTrajectoryStatus(goal, currentKS, now = new Date()) {
  if (goal.rescue_active) return 'RESCUE'; // [DESIGN: §3.2 — RESCUE overrides]
  if (!goal.exam_date) return 'ON_TRACK';
  const examDate      = new Date(goal.exam_date);
  const daysRemaining = Math.ceil((examDate - now) / 86400000);
  if (daysRemaining <= 0) return 'CRITICAL';
  const required = computeRequiredKSPerDay(goal, currentKS, now);
  const velocity = computeVelocityFromGoal({ ...goal });
  const gap      = parseFloat((required - velocity).toFixed(3)); // [DESIGN: §3.1]
  if (gap <= 0)   return 'ON_TRACK';
  if (gap <= 0.3) return 'DRIFTING';  // [DESIGN: §3.2]
  if (gap <= 1.0) return 'BEHIND';
  return 'CRITICAL';
}

// ─── PB.4: Three-Line Projection [DESIGN: §3.3] ──────────────────────────────
// Returns { bestCase, currentPace, minimumViable } as projected completion dates

function computeProjections(goal, currentKS, velocity, now = new Date()) {
  if (!goal.exam_date) return { bestCase: null, currentPace: null, minimumViable: null };
  const targetKS      = goal.target_ks || 100;
  const ksNeeded      = Math.max(0, targetKS - currentKS);
  const examDate      = new Date(goal.exam_date);
  const daysRemaining = Math.max(1, Math.ceil((examDate - now) / 86400000));
  const minViableRate = ksNeeded / daysRemaining; // minimum pace to hit deadline
  const bestCaseRate  = velocity * 1.15; // 115% of current pace [DESIGN: §3.3 "100% daily contract"]
  const bestCaseDays  = bestCaseRate > 0 ? Math.ceil(ksNeeded / bestCaseRate) : null;
  const currentDays   = velocity > 0 ? Math.ceil(ksNeeded / velocity) : null;
  const addDays = (d, base) => {
    const r = new Date(base); r.setDate(r.getDate() + d); return r;
  };
  return {
    bestCase:      bestCaseDays != null ? addDays(bestCaseDays, now) : null,
    currentPace:   currentDays  != null ? addDays(currentDays, now)  : null,
    minimumViable: examDate,    // minimum viable is always the hard deadline
    minViableRate: parseFloat(minViableRate.toFixed(3)),
  };
}

// ─── PB.2: Daily Contract Generation [DESIGN: §9] ────────────────────────────
// ⚠ CORRECTED from v1.0: adds time estimate, 35-min cap, 3-day spread, consequence text
// GROWING phase: no new SEEDLING cards unless coverage is complete [DESIGN: §2.3]

const CARD_REVIEW_MINUTES = {
  DANGEROUS: 2.5, FRAGILE: 2.5,
  STUCK: 1.75, AVOIDED: 1.75,
  GROWING: 1.5, STABLE: 1.5, SEEDLING: 1.5,
  VERIFIED: 0.5,
};
const MAX_CONTRACT_MINUTES = 35; // [DESIGN: §9.2]

async function generateDailyContract(userId, goalId) {
  const goal = await db.masteryGoals.findById(userId, goalId);
  if (!goal) return null;

  // ── GAP-S4: Contract streak tracking [DESIGN: §9.4] ──────────────────────
  // Called once per day when a new contract is generated.
  // If the previous contract was completed (daily_contract_completed = true)
  // and it was generated on a different calendar day, increment the streak.
  const prevGenDate = goal.daily_contract_generated_at
    ? new Date(goal.daily_contract_generated_at) : null;
  const _now = new Date();
  const isNewDay = prevGenDate
    ? _now.toDateString() !== prevGenDate.toDateString() : false;
  if (isNewDay) {
    const prevCompleted = goal.daily_contract_completed || false;
    const curStreak     = goal.contract_streak_current || 0;
    const bestStreak    = goal.contract_streak_best    || 0;
    const newStreak     = prevCompleted ? curStreak + 1 : 0;
    const newBest       = Math.max(bestStreak, newStreak);
    await db.masteryGoals.update(userId, goalId, {
      contract_streak_current: newStreak,
      contract_streak_best:    newBest,
    }).catch(() => {});
  }

  const currentKS = goal.current_ks || 0;
  const required  = computeRequiredKSPerDay(goal, currentKS);
  const phase     = goal.phase || BUBBLE_PHASES.SEEDING;

  const allStatesDocs  = await db.cardStates.findByUser(userId);
  const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));

  // [DESIGN: §2.3] GROWING: block new SEEDLING cards unless ≥80% of cards have been reviewed
  let coverageComplete = true;
  if (phase === BUBBLE_PHASES.GROWING) {
    const cardIds = goal.card_ids || [];
    const reviewedCount = cardIds.filter((id) => {
      const st = statesByCardId.get(id);
      return st && st.state !== CARD_STATES.SEEDLING;
    }).length;
    coverageComplete = cardIds.length === 0 || (reviewedCount / cardIds.length) >= 0.8;
  }

  // Phase-based priority table (lower = higher priority) [DESIGN: §2.2–§2.6]
  const phaseStatePriority = {
    SEEDING:   { DANGEROUS:1, AVOIDED:2, STUCK:3, FRAGILE:4, SEEDLING:5, GROWING:6, STABLE:7, VERIFIED:8 },
    GROWING:   { DANGEROUS:1, STUCK:2, FRAGILE:3, AVOIDED:4, GROWING:5, SEEDLING:6, STABLE:7, VERIFIED:8 },
    HARDENING: { DANGEROUS:1, STUCK:1, FRAGILE:2, AVOIDED:2, GROWING:3, STABLE:4, SEEDLING:5, VERIFIED:8 },
    FINAL:     { DANGEROUS:1, STUCK:1, FRAGILE:1, AVOIDED:2, GROWING:3, STABLE:4, SEEDLING:5, VERIFIED:8 },
    RESCUE:    { DANGEROUS:1, STUCK:1, FRAGILE:1, AVOIDED:1, GROWING:2, STABLE:3, SEEDLING:4, VERIFIED:8 },
  };
  const priorityTable = phaseStatePriority[phase] || phaseStatePriority.SEEDING;

  const scored = [];
  for (const cardId of (goal.card_ids || [])) {
    const stateDoc = statesByCardId.get(cardId);
    // Skip parked cards
    if (stateDoc?.parking_expires_at && new Date(stateDoc.parking_expires_at) > new Date()) continue;
    const state = stateDoc?.state || CARD_STATES.SEEDLING;
    // [DESIGN: §2.3] In GROWING, skip SEEDLING if coverage not yet complete
    if (phase === BUBBLE_PHASES.GROWING && !coverageComplete && state === CARD_STATES.SEEDLING) continue;
    const priority = priorityTable[state] || 9;
    scored.push({ cardId, state, priority });
  }
  scored.sort((a, b) => a.priority - b.priority);

  // [DESIGN: §2.5] FINAL phase: VERIFIED cards get a 2-minute warm-up block at the
  // start of the session — brief exposure, then set aside. They are NOT in the main
  // contract queue. Split scored into warm-up and main pools before the loop.
  const MAX_WARMUP_MINUTES = 2;
  const warmupCards  = [];
  let   warmupMins   = 0;
  if (phase === BUBBLE_PHASES.FINAL) {
    for (const { cardId, state } of scored) {
      if (state !== CARD_STATES.VERIFIED) continue;
      const mins = CARD_REVIEW_MINUTES[state] || 1.0;
      if (warmupMins + mins > MAX_WARMUP_MINUTES) break;
      warmupCards.push({ cardId, state, _warmup: true });
      warmupMins += mins;
    }
  }
  // Exclude VERIFIED from main loop in FINAL (they are handled above)
  const mainScored = (phase === BUBBLE_PHASES.FINAL)
    ? scored.filter(({ state }) => state !== CARD_STATES.VERIFIED)
    : scored;

  // [DESIGN: §9.2] Build contract within 35-minute cap; spread excess across 3 days
  const contractCards = [...warmupCards.map(w => w.cardId)];
  const breakdown     = {};
  warmupCards.forEach(({ state }) => { breakdown[state] = (breakdown[state] || 0) + 1; });
  let totalMinutes    = warmupMins;

  // [DESIGN: §2.2] SEEDING phase: no more than 15 new SEEDLING cards per session
  const MAX_SEEDING_NEW = 15;
  let seedlingCount = 0;

  for (const { cardId, state } of mainScored) {
    const mins = CARD_REVIEW_MINUTES[state] || 1.5;
    if (totalMinutes + mins > MAX_CONTRACT_MINUTES) break;
    // §2.2 cap: stop adding SEEDLING cards once the per-session limit is reached
    if (phase === BUBBLE_PHASES.SEEDING && state === CARD_STATES.SEEDLING) {
      if (seedlingCount >= MAX_SEEDING_NEW) continue; // skip this SEEDLING, keep looping
      seedlingCount++;
    }
    contractCards.push(cardId);
    breakdown[state] = (breakdown[state] || 0) + 1;
    totalMinutes += mins;
  }

  // [DESIGN: §9.2] If still behind, show spread-recovery consequence text
  const remainingCards = scored.length - contractCards.length;
  const consequence = remainingCards > 0
    ? `${remainingCards} card${remainingCards > 1 ? 's' : ''} deferred to tomorrow. Complete today's contract to avoid further drift.`
    : required > 0
      ? `Complete today's contract: trajectory stays on track.`
      : `You are ahead of pace. Today's cards maintain your lead.`;

  // Tomorrow's consequence if today is skipped [DESIGN: §9.2]
  const tomorrowCount = required > 0
    ? Math.ceil((required * 2 + currentKS - currentKS) / (CARD_REVIEW_MINUTES.GROWING / 60 || 0.5) * 0.3) // rough
    : 0;
  const missConsequence = tomorrowCount > contractCards.length
    ? `If skipped, you'll need ${tomorrowCount} cards tomorrow instead of ${contractCards.length}.`
    : null;

  const contract = {
    cards:                    contractCards,
    breakdown,
    daily_contract_cards:     contractCards.length,
    daily_contract_breakdown: breakdown,
    daily_contract_minutes:   parseFloat(totalMinutes.toFixed(1)),
    daily_contract_generated_at: new Date(),
    daily_contract_completed: false,
    daily_contract_consequence: consequence,
    miss_consequence:         missConsequence,
    target_ks_today:          parseFloat((currentKS + required).toFixed(2)),
  };

  await db.masteryGoals.update(userId, goalId, {
    daily_contract_cards:            contract.daily_contract_cards,
    daily_contract_breakdown:        contract.daily_contract_breakdown,
    daily_contract_minutes:          contract.daily_contract_minutes,
    daily_contract_generated_at:     contract.daily_contract_generated_at,
    daily_contract_completed:        false,
    daily_contract_consequence:      consequence,
    // GAP-M2: persist miss_consequence so client can display without recomputing [DESIGN: §9.2]
    daily_contract_miss_consequence: missConsequence || null,
  });
  return contract;
}

// ─── PB.4: Main Trajectory Update — called after every session ───────────────
// ⚠ CORRECTED: RESCUE trigger (KS<70 ≤7 days), target_ks=70 fixed, stall check wired
// [DESIGN: §2.6, §3, §6]

async function updateBubbleTrajectory(userId, goalId) {
  const goal = await db.masteryGoals.findById(userId, goalId);
  if (!goal || goal.status !== 'active') return null;

  const now       = new Date();
  const ksResult  = await computeBubbleKS(userId, goal);
  const prevKS    = goal.current_ks || 0;
  const ksDelta   = Math.max(0, ksResult.score - prevKS);

  // Rolling velocity — last 7 samples; keep up to 90 for Autopsy [DESIGN: §3.4]
  const samples   = [...(goal.velocity_samples || []), ksDelta].slice(-90);
  const velocity  = computeVelocityFromGoal({ velocity_samples: samples });

  // Gap and trajectory status [DESIGN: §3.1, §3.2]
  const requiredPerDay   = computeRequiredKSPerDay(goal, ksResult.score, now);
  const trajectoryGap    = parseFloat((requiredPerDay - velocity).toFixed(3));
  const trajectoryStatus = computeTrajectoryStatus(
    { ...goal, velocity_samples: samples }, ksResult.score, now
  );
  const newPhase = computeCurrentPhase(goal, now);

  // Three projections [DESIGN: §3.3]
  const projections = computeProjections(
    { ...goal, velocity_samples: samples }, ksResult.score, velocity, now
  );

  const updates = {
    current_ks:                  ksResult.score,
    actual_ks_velocity:          velocity,
    velocity_samples:            samples,
    trajectory_status:           trajectoryStatus,
    trajectory_gap:              trajectoryGap,
    required_ks_per_day:         requiredPerDay,
    projected_completion_date:   projections.currentPace  || null,
    projected_best_case:         projections.bestCase     || null,
    projected_minimum_viable:    projections.minimumViable || null,
    last_recalculated_at:        now,
  };

  // ── PB.3: Phase transition detection ────────────────────────────────────────
  if (newPhase !== goal.phase && !goal.rescue_active) {
    updates.phase            = newPhase;
    updates.phase_entered_at = now;
    // G3: Early rescue eligibility flag when entering HARDENING below KS 70 [DESIGN: §2.4]
    // This is distinct from the RESCUE activation trigger (which requires ≤7 days).
    // The flag surfaces in the Bubble widget and is used for advisory tone escalation.
    if (newPhase === BUBBLE_PHASES.HARDENING && ksResult.score < 70) {
      updates.rescue_eligible = true;
      await db.masteryGoals.addHistoryEntry(goalId, {
        event_type:  'rescue_eligible_flagged',
        ks_at_event: ksResult.score,
        notes:       `Entered HARDENING at KS ${ksResult.score.toFixed(1)} — below 70. Rescue eligibility flag set.`,
      }).catch(() => {});
    }
    // Append to phase_history array [DESIGN: §12.1]
    const phaseHistoryEntry = {
      phase:       newPhase,
      entered_at:  now,
      exited_at:   null,
      ks_at_entry: ksResult.score,
      ks_at_exit:  null,
    };
    updates.phase_history = FieldValue.arrayUnion(phaseHistoryEntry);
    await db.masteryGoals.addHistoryEntry(goalId, {
      event_type:  'phase_transition',
      from_phase:  goal.phase,
      to_phase:    newPhase,
      ks_at_event: ksResult.score,
      notes:       `Phase transitioned ${goal.phase} → ${newPhase}.`,
    });
  }

  // ── PB.3: Test Date gate — KS must be ≥60 at Test Date [DESIGN: §2.3] ─────
  // ⚠ CORRECTED: threshold is 60 (not configurable), triggers +3 brain pressure on next calculateSubjectPressure call
  if (goal.test_date && !goal.test_date_gate_failed) {
    const testDate = new Date(goal.test_date);
    if (now >= testDate && ksResult.score < 60) {
      updates.phase               = BUBBLE_PHASES.HARDENING;
      updates.phase_entered_at    = now;
      updates.test_date_gate_failed = true;
      // [DESIGN: §2.3] Store honest message for client to surface
      updates.gate_fail_message   = 'Your understanding is behind schedule. KIWI is shifting focus.';
      await db.masteryGoals.addHistoryEntry(goalId, {
        event_type:  'test_date_gate_failed',
        from_phase:  BUBBLE_PHASES.GROWING,
        to_phase:    BUBBLE_PHASES.HARDENING,
        ks_at_event: ksResult.score,
        notes:       'KS below 60 at Test Date. HARDENING activated early.',
      });
    }
  }

  // ── PB.3: RESCUE activation [DESIGN: §2.6] ───────────────────────────────
  // ⚠ CORRECTED from v1.0: KS < 70 with ≤7 days remaining (not KS<40, ≤10 days)
  // target_ks drops to fixed 70 [DESIGN: §2.6]
  if (!goal.rescue_active) {
    const examDate    = goal.exam_date ? new Date(goal.exam_date) : null;
    const daysToExam  = examDate ? Math.ceil((examDate - now) / 86400000) : 999;
    const inLatePhase = newPhase === BUBBLE_PHASES.FINAL || newPhase === BUBBLE_PHASES.HARDENING;
    if (inLatePhase && daysToExam <= 7 && ksResult.score < 70) {
      updates.rescue_active          = true;
      updates.phase                  = BUBBLE_PHASES.RESCUE;
      updates.phase_entered_at       = now;
      updates.rescue_mode_entered_at = now;
      updates.target_ks              = 70;   // [DESIGN: §2.6] fixed 70, NOT computed
      await db.masteryGoals.addHistoryEntry(goalId, {
        event_type:  'rescue_activated',
        from_phase:  goal.phase,
        to_phase:    BUBBLE_PHASES.RESCUE,
        ks_at_event: ksResult.score,
        notes:       `RESCUE mode: ${daysToExam}d to exam, KS=${ksResult.score}. Target drops to 70.`,
      });
    }
  }

  // ── Deadline check — auto-close if exam date has passed ──────────────────
  const examDate   = goal.exam_date ? new Date(goal.exam_date) : null;
  const daysToExam = examDate ? Math.ceil((examDate - now) / 86400000) : 999;
  if (examDate && now >= examDate) {
    const targetKS  = updates.target_ks || goal.target_ks || 100;
    const outcome   = ksResult.score >= targetKS
      ? 'completed'
      : (goal.rescue_active && ksResult.score >= 70)
        ? 'partially_completed'   // [DESIGN: §2.6]
        : 'missed';
    await closeMasteryGoal(userId, goalId, outcome);
    return { ...goal, ...updates, status: outcome };
  }

  // ── Daily KS snapshot (at most once per 12h) [DESIGN: §3.4] ─────────────
  const lastSnap = goal.last_ks_snapshot_at ? new Date(goal.last_ks_snapshot_at) : null;
  if (!lastSnap || (now - lastSnap) / 3600000 >= 12) {
    updates.last_ks_snapshot_at = now;
    // GAP-M1: compute card_state_distribution + session stats for §12.2 compliance
    let _cardsReviewed = 0; let _cardsAdvanced = 0;
    const _cardStateDist = {};
    try {
      const _recentSessions = await db.sessions.findMany(
        userId, { session_completed: true }, { limit: 1 }
      );
      const _lastSess = (_recentSessions.sessions || [])[0];
      if (_lastSess) {
        _cardsReviewed = _lastSess.cards_reviewed || 0;
        _cardsAdvanced = _lastSess.cards_advanced || 0;
      }
      const _bubbleStates = await db.cardStates.findByUser(userId);
      const _goalCardSet  = new Set(goal.card_ids || []);
      for (const _s of _bubbleStates) {
        if (_goalCardSet.has(_s.card_id)) {
          _cardStateDist[_s.state] = (_cardStateDist[_s.state] || 0) + 1;
        }
      }
    } catch (_e) { /* non-fatal — history entry proceeds without distribution */ }
    await db.masteryGoals.addHistoryEntry(goalId, {
      event_type:              'ks_snapshot',
      date:                    now,
      ks_at_event:             ksResult.score,
      ks_gain_today:           ksDelta,
      phase:                   newPhase || goal.phase,
      trajectory_status:       trajectoryStatus,
      trajectory_gap:          trajectoryGap,
      contract_completed:      goal.daily_contract_completed || false,
      // [DESIGN: §12.2] Three previously missing fields — GAP-M1
      cards_reviewed:          _cardsReviewed,
      cards_advanced:          _cardsAdvanced,
      card_state_distribution: _cardStateDist,
      notes: `KS=${ksResult.score}. Velocity=${velocity.toFixed(2)}/day. Gap=${trajectoryGap.toFixed(2)}.`,
    });
  }

  // ── PB.3: SEEDING coverage gap check [DESIGN: §2.2] ────────────────────
  if ((newPhase || goal.phase) === BUBBLE_PHASES.SEEDING) {
    const allStatesDocs  = await db.cardStates.findByUser(userId);
    const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
    const cardIds        = goal.card_ids || [];
    if (cardIds.length > 0) {
      const totalDays  = examDate ? Math.ceil((examDate - new Date(goal.created_at)) / 86400000) : 90;
      const daysPassed = Math.ceil((now - new Date(goal.created_at)) / 86400000);
      const at40Pct    = daysPassed >= Math.floor(totalDays * 0.4);
      if (at40Pct) {
        const reviewed    = cardIds.filter((id) => statesByCardId.get(id)?.state !== CARD_STATES.SEEDLING).length;
        const coveragePct = reviewed / cardIds.length;
        updates.coverage_gap_active = coveragePct < 0.8;
        if (coveragePct < 0.8 && !goal.coverage_gap_active) {
          await db.masteryGoals.addHistoryEntry(goalId, {
            event_type:  'coverage_gap_detected',
            ks_at_event: ksResult.score,
            notes:       `Coverage ${(coveragePct * 100).toFixed(0)}% at SEEDING midpoint. New card introduction paused.`,
          });
        }
      }
      // G4: Early stall trigger — KS < 20 at SEEDING midpoint (20% of days) [DESIGN: §2.2]
      // Bypasses the normal 14-day velocity window requirement.
      // One-shot: seeding_early_stall_checked prevents re-triggering.
      const seedingMidpoint = Math.floor(totalDays * 0.2);
      if (
        daysPassed >= seedingMidpoint &&
        ksResult.score < 20 &&
        !goal.seeding_early_stall_checked &&
        !goal.stall_active
      ) {
        updates.seeding_early_stall_checked = true;
        // Check velocity directly — require only 1 sample (vs normal 3) [DESIGN: §2.2]
        const earlyVelocity = samples.length > 0
          ? samples.slice(-Math.min(7, samples.length)).reduce((a, b) => a + b, 0) /
            Math.min(7, samples.length)
          : 0;
        if (earlyVelocity < 0.3) {
          const cause = await diagnoseStallCause(userId, { ...goal, ...updates }).catch(() => 'STUCK_CLUSTER');
          await activateStallResponse(userId, goalId, cause).catch(() => {});
          await db.masteryGoals.addHistoryEntry(goalId, {
            event_type:  'early_stall_detected',
            ks_at_event: ksResult.score,
            notes:       `Early stall: KS ${ksResult.score.toFixed(1)} at SEEDING midpoint (day ${daysPassed}/${totalDays}). Velocity: ${earlyVelocity.toFixed(2)}/day.`,
          }).catch(() => {});
        }
      }
    }
  }

  await db.masteryGoals.update(userId, goalId, updates);

  // ── PB.5: Stall check — called every trajectory update [DESIGN: §6] ─────
  // ⚠ CORRECTED from v1.0: stall check was defined but never called from here
  await checkAndUpdateStallState(userId, { ...goal, ...updates, current_ks: ksResult.score })
    .catch(() => {});

  await generateDailyContract(userId, goalId).catch(() => {});
  return { ...goal, ...updates, current_ks: ksResult.score };
}

// ─── Update all active bubbles for a user (called from session end hook) ─────
async function updateAllBubblesForUser(userId) {
  try {
    const activeGoals = await db.masteryGoals.findActive(userId);
    for (const goal of activeGoals) {
      await updateBubbleTrajectory(userId, goal.id).catch((e) => {
        console.error(`[KIWI] Bubble trajectory failed for ${goal.id}:`, e.message);
      });
    }
  } catch (e) {
    console.error('[KIWI] updateAllBubblesForUser failed:', e.message);
  }
}

// ─── Full Bubble creation flow ────────────────────────────────────────────────
async function createMasteryGoal(userId, data) {
  let cardIds = data.card_ids || [];
  if (cardIds.length === 0 && (data.deck_ids || []).length > 0) {
    for (const deckId of data.deck_ids) {
      const cards = await db.cards.findByDeck(userId, deckId).catch(() => []);
      cardIds.push(...cards.map((c) => c.id));
    }
  }
  await batchInitializeSeedlingStates(userId, cardIds).catch(() => {});
  // Default bubble name if not provided [DESIGN: §12.1]
  if (!data.name && data.exam_date) {
    const subject = await db.subjects.findById(data.subject_id).catch(() => null);
    const examStr = new Date(data.exam_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    data.name = `${subject?.name || 'Exam'} — ${examStr}`;
  }
  const goal     = await db.masteryGoals.create(userId, { ...data, card_ids: cardIds });
  const ksResult = await computeBubbleKS(userId, goal);
  const now      = new Date();
  const required = computeRequiredKSPerDay(goal, ksResult.score, now);
  await db.masteryGoals.update(userId, goal.id, {
    current_ks:          ksResult.score,
    required_ks_per_day: required,
  });
  await generateDailyContract(userId, goal.id).catch(() => {});
  await db.masteryGoals.addHistoryEntry(goal.id, {
    event_type:  'created',
    ks_at_event:  ksResult.score,
    notes:       `Bubble created. ${cardIds.length} cards. Exam: ${data.exam_date}. Required: ${required.toFixed(2)} KS/day.`,
  });
  return { ...goal, current_ks: ksResult.score, required_ks_per_day: required };
}

// ─── Close a mastery goal [DESIGN: §10.1, §2.6] ──────────────────────────────
// ⚠ CORRECTED from v1.0: handles PARTIALLY_COMPLETED status for RESCUE outcomes
async function closeMasteryGoal(userId, goalId, reason = 'completed') {
  const goal = await db.masteryGoals.findById(userId, goalId);
  if (!goal) return null;
  const ksResult = await computeBubbleKS(userId, goal);
  const validStatuses = ['completed', 'partially_completed', 'missed', 'archived'];
  const finalStatus   = validStatuses.includes(reason) ? reason : 'missed';
  await db.masteryGoals.update(userId, goalId, {
    status:               finalStatus,
    final_ks_at_deadline: ksResult.score,
    completed_at:         new Date(),
  });
  // PB.14: Mark unverified cards as learning_debt when missed or partially completed [DESIGN: §10.1]
  if (finalStatus === 'missed' || finalStatus === 'partially_completed') {
    const allStatesDocs  = await db.cardStates.findByUser(userId);
    const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
    let debtCount = 0;
    for (const cardId of (goal.card_ids || [])) {
      const stateDoc = statesByCardId.get(cardId);
      if (stateDoc && stateDoc.state !== CARD_STATES.VERIFIED) {
        await db.cardStates.update(userId, cardId, { learning_debt: true }).catch(() => {});
        debtCount++;
      }
    }
    await db.masteryGoals.update(userId, goalId, { learning_debt_card_count: debtCount });
  }
  await db.masteryGoals.addHistoryEntry(goalId, {
    event_type:  finalStatus,
    ks_at_event: ksResult.score,
    notes:       `Bubble ${finalStatus}. Final KS: ${ksResult.score.toFixed(1)}.`,
  });
  return { status: finalStatus, final_ks: ksResult.score };
}

// ── Stage 5 Verification Logic ────────────────────────────────────────────────

async function processExamVerification(userId, examSession) {
const results = { verified: [], reclassified: [] };
const questions = examSession.questions || [];
for (const q of questions) {
if (!q.card_id || q.is_correct === undefined) continue;
const card = await db.cards.findById(userId, q.card_id);
if (!card) continue;
const stateDoc = await db.cardStates.get(userId, card.id);
if (!stateDoc) continue;
if (q.is_correct === true) {
if (card.stage === 5 && !stateDoc.verified) {
await db.cardStates.update(userId, card.id, {
state: CARD_STATES.VERIFIED,
verified: true,
verified_at: new Date(),
});
await db.cards.update(userId, card.id, { verified: true, verified_at: new Date() });
results.verified.push(card.id);
// P8.1c: +1 Seedling for first-time VERIFIED card (spec P8.1)
await awardSeedlings(userId, 1, 'card_verified_first_time',
`Card ${card.id} verified for the first time in exam`).catch(() => {});
}
} else {
// B7: Apply full SRS "Again" treatment — recalculate EF and repetitions
const srsResult = calculateNextReview(card, 'again');
await db.cards.update(userId, card.id, {
stage: srsResult.stage,
interval_days: srsResult.interval_days,
easiness_factor: srsResult.easiness_factor,
repetition_count: srsResult.repetition_count,
next_review_at: srsResult.nextReviewAt,
last_response: 'again',
});
const newStateType = srsResult.stage <= 2 ? CARD_STATES.GROWING : CARD_STATES.STABLE;
await db.cardStates.update(userId, card.id, {
state: newStateType,
stage: srsResult.stage,
verified: false,
});
results.reclassified.push({
card_id: card.id,
old_stage: card.stage,
new_stage: srsResult.stage,
});
}
}
return results;
}

// ════════════════════════════════════════════════════════════════════════════
//  CROSS-BUBBLE INTELLIGENCE (PB.10)  [DESIGN: §8]
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §8.2] Mark cards that appear in multiple active bubbles as cross_bubble.
// Semantic overlap check: if a card appears in both, it is shared regardless of naming.
async function detectAndMarkCrossBubbleCards(userId, newGoalCardIds, existingGoals) {
  const existingCardSet  = new Set(existingGoals.flatMap((g) => g.card_ids || []));
  const overlappingCards = newGoalCardIds.filter((id) => existingCardSet.has(id));
  // [DESIGN: §8.2] Only prompt the user if overlap is meaningful (>40% of smaller set)
  const smallerSetSize = Math.min(newGoalCardIds.length, existingCardSet.size);
  const overlapPct     = smallerSetSize > 0 ? overlappingCards.length / smallerSetSize : 0;
  for (const cardId of overlappingCards) {
    await db.cardStates.update(userId, cardId, { cross_bubble: true }).catch(() => {});
    // Update bubble_ids on the card state doc
    const st = await db.cardStates.get(userId, cardId).catch(() => null);
    if (st) {
      const existingGoalIds = existingGoals.map((g) => g.id);
      const merged = [...new Set([...(st.bubble_ids || []), ...existingGoalIds])];
      await db.cardStates.update(userId, cardId, { bubble_ids: merged }).catch(() => {});
    }
  }
  // Return overlap data for the user prompt [DESIGN: §8.2]
  return {
    overlapping_card_count: overlappingCards.length,
    overlap_pct:            parseFloat((overlapPct * 100).toFixed(1)),
    should_prompt_user:     overlapPct > 0.40,   // [DESIGN: §8.2 — >40% threshold]
  };
}

// [DESIGN: §8.2] Called by POST /api/bubbles/overlap-check before creation.
// Returns whether the student should be prompted about shared cards.
async function checkBubbleOverlap(userId, newCardIds) {
  const existingGoals = await db.masteryGoals.findActive(userId);
  if (existingGoals.length === 0) {
    return { should_prompt_user: false, overlap_pct: 0, overlapping_card_count: 0 };
  }
  return detectAndMarkCrossBubbleCards(userId, newCardIds, existingGoals);
}

// [DESIGN: §8.2] When a cross_bubble card is reviewed, propagate KS to all containing bubbles.
async function propagateCrossBubbleKSUpdate(userId, cardId) {
  try {
    const stateDoc = await db.cardStates.get(userId, cardId);
    if (!stateDoc?.cross_bubble) return;
    const activeGoals = await db.masteryGoals.findActive(userId);
    for (const goal of activeGoals) {
      if ((goal.card_ids || []).includes(cardId)) {
        const ksResult = await computeBubbleKS(userId, goal);
        await db.masteryGoals.update(userId, goal.id, {
          current_ks: ksResult.score,
        }).catch(() => {});
      }
    }
  } catch (_e) { /* intentionally non-fatal */ }
}

// [DESIGN: §7.3] Update cluster KS for all clusters containing a reviewed card.
async function updateClusterKSForCard(userId, cardId) {
  try {
    const activeGoals = await db.masteryGoals.findActive(userId);
    for (const goal of activeGoals) {
      if (!(goal.card_ids || []).includes(cardId)) continue;
      const clusters = await db.masteryGoals.getClusters(goal.id);
      for (const cluster of clusters) {
        if ((cluster.card_ids || []).includes(cardId)) {
          const ks = await computeClusterKS(userId, cluster);
          const clusterStatus =
            ks >= 80 ? 'MASTERED' : ks >= 60 ? 'STRONG' : ks >= 30 ? 'DEVELOPING' : 'WEAK';
          await db.masteryGoals.updateCluster(goal.id, cluster.id, {
            cluster_ks:     ks,
            cluster_status: clusterStatus,
          }).catch(() => {});
        }
      }
    }
  } catch (_e) { /* non-fatal */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  STALL DETECTION SERVICE (PB.5)  [DESIGN: §6]
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §6.1] Stall = student IS studying but KS not advancing.
// All three conditions must be true:
//   1. KS velocity < 0.3 points/day (averaged over last 14 samples)
//   2. At least 3 velocity samples exist (student has been active)
//   3. Sufficient study activity confirmed via session history
// ⚠ CORRECTED from v1.0: absolute 0.3 KS/day threshold (not ratio), correct conditions

async function detectStall(userId, goal) {
  const samples = goal.velocity_samples || [];
  // Condition 3: student must be actively studying — not merely absent [DESIGN: §6.1]
  // Requires ≥3 sessions in the last 14 days, each with ≥5 cards reviewed.
  // Falls back to velocity-sample proxy if session query fails (non-fatal).
  // GAP-S3: Phase-specific stall window [DESIGN: §2.4 — 'detects within 5 days' in HARDENING]
  // §6.1 default is 14 days. HARDENING overrides to 5-day window and 1-session minimum.
  const _isHardening  = goal.phase === BUBBLE_PHASES.HARDENING;
  const _stallWindow  = _isHardening ? 5 : 14;
  const _stallMinSess = _isHardening ? 1 : 3;
  const _minSamples   = _isHardening ? 1 : 3;
  if (samples.length < _minSamples) return { isStall: false, cause: null };
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
    const recentResult    = await db.sessions.findMany(
      userId,
      { session_completed: true, started_at_gte: fourteenDaysAgo },
      { limit: 50 }
    );
    const activeSessions = (recentResult.sessions || []).filter(
      (s) => (s.cards_reviewed || 0) >= 5
    );
    // [DESIGN: §6.1 / GAP-S3] Minimum sessions: 3 normally, 1 in HARDENING
    if (activeSessions.length < _stallMinSess) return { isStall: false, cause: null };
  } catch (_e) {
    // Non-fatal: if session query fails, fall through to velocity check below.
    // The samples.length < 3 guard above already handled the zero-samples case.
  }
  // Condition 1: average daily KS gain < 0.3 over last _stallWindow days [DESIGN: §6.1 / GAP-S3]
  const recent      = samples.slice(-Math.min(_stallWindow, samples.length));
  const avgVelocity = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avgVelocity >= 0.3) return { isStall: false, cause: null };
  // Stall confirmed — diagnose cause
  const cause = await diagnoseStallCause(userId, goal);
  return { isStall: true, cause };
}

// [DESIGN: §6.2] Four stall causes identified by card state distribution analysis.
// ⚠ CORRECTED from v1.0: correct names (STUCK_CLUSTER, CONCEPT_CEILING, WIDTH_PROBLEM,
//   AVOIDANCE_PATTERN), percentage-based thresholds (not absolute counts)

async function diagnoseStallCause(userId, goal) {
  const cardIds    = goal.card_ids || [];
  const totalCards = cardIds.length;
  if (totalCards === 0) return 'STUCK_CLUSTER';

  const allStatesDocs  = await db.cardStates.findByUser(userId);
  const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));

  let stuckCount   = 0;
  let avoidedCount = 0;
  let seedlingOrGrowingCount = 0;

  for (const cardId of cardIds) {
    const st = statesByCardId.get(cardId)?.state;
    if (st === CARD_STATES.STUCK)    stuckCount++;
    if (st === CARD_STATES.AVOIDED)  avoidedCount++;
    if (st === CARD_STATES.SEEDLING || st === CARD_STATES.GROWING) seedlingOrGrowingCount++;
  }

  // [DESIGN: §6.2 Diagnosis 1] STUCK_CLUSTER: >35% of cards STUCK
  if (stuckCount / totalCards > 0.35) return 'STUCK_CLUSTER';

  // [DESIGN: §6.2 Diagnosis 4] AVOIDANCE_PATTERN: >20% of cards AVOIDED
  if (avoidedCount / totalCards > 0.20) return 'AVOIDANCE_PATTERN';

  // [DESIGN: §6.2 Diagnosis 3] WIDTH_PROBLEM: >50% still SEEDLING/GROWING after 40+ days
  const createdAt  = goal.created_at ? new Date(goal.created_at) : null;
  const daysPassed = createdAt ? Math.ceil((new Date() - createdAt) / 86400000) : 0;
  if (daysPassed >= 40 && seedlingOrGrowingCount / totalCards > 0.50) return 'WIDTH_PROBLEM';

  // [DESIGN: §6.2 Diagnosis 2] CONCEPT_CEILING: one cluster KS < 30, others > 60
  try {
    const clusters = await db.masteryGoals.getClusters(goal.id);
    if (clusters.length > 1) {
      const weakClusters   = clusters.filter((c) => (c.cluster_ks || 0) < 30);
      const strongClusters = clusters.filter((c) => (c.cluster_ks || 0) > 60);
      if (weakClusters.length >= 1 && strongClusters.length >= 1) return 'CONCEPT_CEILING';
    }
  } catch (_e) { /* non-fatal */ }

  return 'STUCK_CLUSTER'; // default diagnosis
}

// [DESIGN: §6.2] Differentiated stall responses per cause
// ⚠ CORRECTED from v1.0: v1.0 only set intervention_level='L2' for all causes
async function activateStallResponse(userId, goalId, cause) {
  // Map cause to stall_response_active enum [DESIGN: §12.1]
  const responseMap = {
    STUCK_CLUSTER:     'RESCUE_REVIEWS',  // 3x same card in session + CBT [DESIGN: §6.2 D1]
    CONCEPT_CEILING:   'CLUSTER_LOCK',    // 50% session time on weak cluster [DESIGN: §6.2 D2]
    WIDTH_PROBLEM:     'CARD_FREEZE',     // freeze new cards, focus top 40% [DESIGN: §6.2 D3]
    AVOIDANCE_PATTERN: 'AVOIDANCE_FRONT', // avoided cards moved to front of queue [DESIGN: §6.2 D4]
  };
  const response = responseMap[cause] || 'RESCUE_REVIEWS';
  await db.masteryGoals.update(userId, goalId, {
    stall_active:          true,
    stall_detected_at:     new Date(),
    stall_cause:           cause,
    stall_response_active: response,
  });
  await db.masteryGoals.addHistoryEntry(goalId, {
    event_type:  'stall_detected',
    ks_at_event: 0,
    notes:       `Stall detected. Cause: ${cause}. Response: ${response} activated.`,
  });
}

// [DESIGN: §6.3] Stall is resolved when velocity ≥ 0.5 KS/day for 7 consecutive days
// ⚠ CORRECTED from v1.0: absolute 0.5 threshold (not ratio of required pace)
async function resolveStallIfRecovered(userId, goalId) {
  const goal = await db.masteryGoals.findById(userId, goalId);
  if (!goal || !goal.stall_active) return;
  const samples = goal.velocity_samples || [];
  if (samples.length < 7) return;
  const last7  = samples.slice(-7);
  const minOf7 = Math.min(...last7);
  // All 7 consecutive days must be ≥ 0.5 [DESIGN: §6.3]
  if (minOf7 >= 0.5) {
    await db.masteryGoals.update(userId, goalId, {
      stall_active:          false,
      stall_resolved_at:     new Date(),
      stall_response_active: null,
    });
    await db.masteryGoals.addHistoryEntry(goalId, {
      event_type:  'stall_resolved',
      ks_at_event: goal.current_ks || 0,
      notes:       `Stall resolved. 7-day min velocity: ${minOf7.toFixed(2)} KS/day.`,
    });
  }
}

async function checkAndUpdateStallState(userId, goal) {
  if (goal.stall_active) {
    await resolveStallIfRecovered(userId, goal.id).catch(() => {});
  } else {
    const { isStall, cause } = await detectStall(userId, goal).catch(() => ({ isStall: false }));
    if (isStall) await activateStallResponse(userId, goal.id, cause).catch(() => {});
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CONCEPT CLUSTER SERVICE (PB.6)  [DESIGN: §7]
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §7.4] Extend existing notes-to-cards AI call with cluster groupings
async function generateConceptClusters(userId, goalId, notes = '') {
  const goal    = await db.masteryGoals.findById(userId, goalId);
  if (!goal) return [];
  const cardIds = goal.card_ids || [];
  // [DESIGN: §7.4] Fallback: single cluster if too few cards or no notes
  if (!notes || cardIds.length < 5) {
    const fallback = await db.masteryGoals.addCluster(goalId, {
      name:       'All Cards',
      card_ids:   cardIds,
      cluster_ks: goal.current_ks || 0,
    });
    return [fallback];
  }
  // [DESIGN: §7.4] AI prompt extension — 3–7 clusters
  const prompt = `
ROLE
You are a concept clustering expert for a spaced repetition learning app.
STUDY NOTES (first 2000 chars)
${notes.slice(0, 2000)}
TOTAL CARDS
${cardIds.length} cards indexed 0 to ${cardIds.length - 1}
RULES
- Return ONLY valid JSON. No markdown, no preamble, no explanation.
- Format exactly: [{"name":"Cluster Name","card_indices":[0,2,5]},...]
- Produce 3–7 clusters. Every card index must appear in exactly one cluster.
- Cluster names must be specific topic names (not "Group 1", not "Miscellaneous").
- Name each cluster after the central concept it covers.
OUTPUT
JSON array only.
`;
  let clusters = [];
  try {
    const result    = await geminiModel.generateContent(prompt);
    const text      = parseGeminiText(result);
    const cleanText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed    = JSON.parse(cleanText);
    if (Array.isArray(parsed)) {
      for (const c of parsed) {
        const clusterCardIds = (c.card_indices || [])
          .filter((i) => typeof i === 'number' && i >= 0 && i < cardIds.length)
          .map((i) => cardIds[i]);
        if (clusterCardIds.length === 0) continue;
        const cluster = await db.masteryGoals.addCluster(goalId, {
          name:       c.name || 'Unnamed Cluster',
          card_ids:   clusterCardIds,
          cluster_ks: 0,
        });
        clusters.push(cluster);
      }
    }
  } catch (e) {
    console.error('[KIWI] Cluster AI failed, using fallback:', e.message);
  }
  // [DESIGN: §7.4] Fallback if AI parse failed
  if (clusters.length === 0) {
    const fallback = await db.masteryGoals.addCluster(goalId, {
      name:       'All Cards',
      card_ids:   cardIds,
      cluster_ks: goal.current_ks || 0,
    });
    clusters = [fallback];
  }
  return clusters;
}

// [DESIGN: §7.3] Cluster KS — same formula as Bubble KS, scoped to cluster
async function computeClusterKS(userId, cluster) {
  const cardIds = cluster.card_ids || [];
  if (cardIds.length === 0) return 0;
  const allStatesDocs  = await db.cardStates.findByUser(userId);
  const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
  let sumWeights = 0;
  let validCount  = 0;
  for (const cardId of cardIds) {
    const card = await db.cards.findById(userId, cardId).catch(() => null);
    if (!card) continue;
    validCount++;
    let stateDoc = statesByCardId.get(cardId);
    if (!stateDoc) stateDoc = await initializeCardState(userId, cardId, CARD_STATES.SEEDLING);
    sumWeights += computeEffectiveWeight(stateDoc, card);
  }
  if (validCount === 0) return 0;
  return parseFloat(((sumWeights / (validCount * 5)) * 100).toFixed(2));
}

// [DESIGN: §7.3] Weakest cluster — for Concept Ceiling stall response
async function getWeakestCluster(goalId) {
  const clusters = await db.masteryGoals.getClusters(goalId);
  if (clusters.length === 0) return null;
  return clusters.reduce((worst, c) =>
    (c.cluster_ks || 0) < (worst.cluster_ks || 0) ? c : worst
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 3 — The Brain, Credentials & Exam Redesign

// ════════════════════════════════════════════════════════════════════════════
// ── brainService ──────────────────────────────────────────────────────────────

async function calculateSubjectPressure(userId, subjectId) {
const decks = await db.decks.findBySubject(userId, subjectId);
let allCards = [];
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id);
allCards.push(...cards);
}
const cardStates = [];
for (const card of allCards) {
let stateDoc = await db.cardStates.get(userId, card.id);
if (!stateDoc) stateDoc = await initializeCardState(userId, card.id);
cardStates.push({ card, state: stateDoc });
}
const pressureSources = {};
let pressureScore = 0;
// 1. GHOST cards (+3 each)
const ghostCards = cardStates.filter((cs) => cs.state.state === CARD_STATES.GHOST);
if (ghostCards.length > 0) {
pressureSources.ghost = ghostCards.length * 3;
pressureScore += pressureSources.ghost;
}
// 2. FRAGILE cards (+2 each)
const fragileCards = cardStates.filter((cs) => cs.state.state === CARD_STATES.FRAGILE);
if (fragileCards.length > 0) {
pressureSources.fragile = fragileCards.length * 2;
pressureScore += pressureSources.fragile;
}
// 3. 10+ STUCK cards (+2)
const stuckCards = cardStates.filter((cs) => cs.state.state === CARD_STATES.STUCK);
if (stuckCards.length >= 10) {
pressureSources.stuck_bulk = 2;
pressureScore += 2;
}
// 4. KS >70 but credential below Competent (+3)
const ksData = await computeKnowledgeScore(userId, subjectId);
const credential = await getCurrentCredential(userId, subjectId);
if (ksData.score > 70 && credential.tier < 3) {
// Competent is tier 3
pressureSources.ks_divergence = 3;
pressureScore += 3;
}
// 5. No exam in 21+ days (+2) — P3.1-B1 FIX: scoped to this subject.
// Previously used the most recent exam across ALL subjects — cross-subject
// exams were incorrectly clearing this pressure source.
const allCompletedExams = await db.examSessions.findMany(userId, { status: 'completed' }, { limit: 999 });
const subjectExamsForPressure = (Array.isArray(allCompletedExams) ? allCompletedExams : (allCompletedExams.exams || []))
.filter(e => e.subject_id === subjectId)
.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
const lastSubjectExam = subjectExamsForPressure[0] || null;
if (!lastSubjectExam || daysSince(lastSubjectExam.completed_at) >= 21) {
pressureSources.no_exam = 2;
pressureScore += 2;
}
// 6. 5+ AVOIDED cards for 7+ days (+1 each) — P3.1-B2 FIX: enforce duration check.
// Previously fired immediately on AVOIDED state; spec requires 7+ days.
const avoidedCards = cardStates.filter((cs) => {
if (cs.state.state !== CARD_STATES.AVOIDED) return false;
const since = cs.state.avoided_since || cs.state.state_changed_at || cs.state.updated_at;
return since ? daysSince(since) >= 7 : false;
});
if (avoidedCards.length >= 5) {
pressureSources.avoided = avoidedCards.length * 1;
pressureScore += pressureSources.avoided;
}
// 7. Exam within 10 days and KS <60 (+5)
// Use getSubjectExamDate to resolve actual or inferred exam date
const resolvedExamDate = await getSubjectExamDate(userId, subjectId);
if (resolvedExamDate) {
const daysToExam = daysBetween(new Date(), resolvedExamDate);
if (daysToExam >= 0 && daysToExam <= 10 && ksData.score < 60) {
pressureSources.exam_urgency = 5;
pressureScore += 5;
}
}
// 8. Each day DANGEROUS card not reviewed (+1 per day) — P3.1-B3 FIX.
// Previously charged +1 per card total; spec says +1 per card per day unreviewed.
// Capped at 10 per card to prevent runaway pressure from a single ancient card.
const dangerousCards = cardStates.filter((cs) => cs.state.state === CARD_STATES.DANGEROUS);
let dangerousPressure = 0;
for (const cs of dangerousCards) {
const daysUnreviewed = Math.max(1, daysSince(cs.card?.last_reviewed_at || cs.card?.created_at || new Date()));
dangerousPressure += Math.min(daysUnreviewed, 10);
}
if (dangerousPressure > 0) {
pressureSources.dangerous = dangerousPressure;
pressureScore += dangerousPressure;
}
// 9. Ignored reclassification alert 3+ days (+2)
const existingPressure = await db.brainPressure.get(userId, subjectId);
if (existingPressure?.alert_ignored_at && daysSince(existingPressure.alert_ignored_at) >= 3) {
pressureSources.ignored_alert = 2;
pressureScore += 2;
}
// ── PB.11: 7 Bubble pressure sources [DESIGN: §15.1] ────────────────────────
// ⚠ CORRECTED from v1.0: correct pressure values, DRIFTING added (+1),
//   BEHIND=+3, CRITICAL=+5, RESCUE=+7, debt max=+5 [DESIGN: §15.1 table]
try {
  const subjectBubbles = await db.masteryGoals.findBySubject(userId, subjectId);
  for (const bubble of subjectBubbles) {
    if (bubble.status !== 'active') continue;
    // Source 10: Bubble DRIFTING (+1 per bubble) [DESIGN: §15.1]
    if (bubble.trajectory_status === 'DRIFTING') {
      pressureSources.bubble_drifting = (pressureSources.bubble_drifting || 0) + 1;
      pressureScore += 1;
    }
    // Source 11: Bubble BEHIND (+3 per bubble) [DESIGN: §15.1]
    if (bubble.trajectory_status === 'BEHIND') {
      pressureSources.bubble_behind = (pressureSources.bubble_behind || 0) + 3;
      pressureScore += 3;
    }
    // Source 12: Bubble CRITICAL (+5 per bubble) [DESIGN: §15.1]
    if (bubble.trajectory_status === 'CRITICAL') {
      pressureSources.bubble_critical = (pressureSources.bubble_critical || 0) + 5;
      pressureScore += 5;
    }
    // Source 13: Bubble RESCUE (+7 per bubble) [DESIGN: §15.1]
    if (bubble.rescue_active || bubble.phase === 'RESCUE') {
      pressureSources.bubble_rescue = (pressureSources.bubble_rescue || 0) + 7;
      pressureScore += 7;
    }
    // Source 14: Test Date gate failed (+3, one-time per bubble) [DESIGN: §15.1]
    if (bubble.test_date_gate_failed && !pressureSources.test_date_gate) {
      pressureSources.test_date_gate = 3;
      pressureScore += 3;
    }
    // Source 15: Stall detected and active (+2 per bubble) [DESIGN: §15.1]
    if (bubble.stall_active) {
      pressureSources.bubble_stall = (pressureSources.bubble_stall || 0) + 2;
      pressureScore += 2;
    }
  }
  // Source 16: Learning debt cards below Stage 3 (+1 per card, max +5) [DESIGN: §15.1, §10.4]
  // ⚠ CORRECTED from v1.0: max +5 (not +10) [DESIGN: §10.4]
  const allCardStatesForDebt = db.cardStates.findBySubject
    ? await db.cardStates.findBySubject(userId, subjectId)
    : (await db.cardStates.findByUser(userId)).filter((s) => s.learning_debt === true);
  const debtCards = allCardStatesForDebt.filter((s) => s.learning_debt === true);
  if (debtCards.length > 0) {
    const debtPressure = Math.min(5, debtCards.length); // [DESIGN: §10.4 — max +5]
    pressureSources.learning_debt = debtPressure;
    pressureScore += debtPressure;
  }
} catch (e) {
  // Non-fatal — bubble pressure sources are best-effort
}
// P5.6 FIX: cap pressure at 100 before storing/returning to prevent bar overflow
const cappedPressureScore = Math.min(100, pressureScore);
const interventionLevel = computeInterventionLevel(cappedPressureScore);
await db.brainPressure.set(userId, subjectId, {
pressure_score: cappedPressureScore,
intervention_level: interventionLevel,
sources: pressureSources,
});
return {
pressure_score: cappedPressureScore,
intervention_level: interventionLevel,
sources: pressureSources,
};
}

function computeInterventionLevel(pressureScore) {
if (pressureScore >= 20) return 'L4';
if (pressureScore >= 15) return 'L3';
if (pressureScore >= 5) return 'L2';
// FIX #8: Return 'L0' for calm state (pressure < 5), not 'L1'
return 'L0';
}

async function calculateAllSubjectPressures(userId) {
const subjects = await db.subjects.findManyWithDecks(userId);
const results = {};
for (const subject of subjects) {
results[subject.id] = await calculateSubjectPressure(userId, subject.id);
}
return results;
}
// ── Reckoning State Machine ───────────────────────────────────────────────────

async function triggerReckoning(userId, subjectId) {
const active = await db.reckoningSessions.findActiveByUser(userId);
if (active) return { reckoning_id: active.id, status: active.status };
// BUG 13 FIX: db.subjects.findById is a function — always truthy. Ternary guard was dead code.
const subject = await db.subjects.findById(subjectId).catch(() => null);
const pressureData = await calculateSubjectPressure(userId, subjectId);
const decks = await db.decks.findBySubject(userId, subjectId);
let flaggedCards = [];
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id);
for (const card of cards) {
let stateDoc = await db.cardStates.get(userId, card.id);
if (!stateDoc) stateDoc = await initializeCardState(userId, card.id);
if (
[
CARD_STATES.DANGEROUS,
CARD_STATES.GHOST,
CARD_STATES.STUCK,
CARD_STATES.AVOIDED,
CARD_STATES.FRAGILE,
].includes(stateDoc.state)
) {
flaggedCards.push(card);
}
}
}
// PB.11: Bubble-critical card weighting for Reckoning pool [DESIGN: §15.2]
// Cards belonging to active Bubbles are sorted to the front so they are
// preferentially included when the pool is sliced to questionCount.
// Each group (bubble / non-bubble) is independently shuffled to preserve
// within-group randomness. Non-fatal: if Bubble query fails, the unweighted
// pool is used and Reckoning proceeds normally.
try {
  const activeBubbles = await db.masteryGoals.findActive(userId).catch(() => []);
  if (activeBubbles.length > 0) {
    const bubbleCardSet  = new Set(activeBubbles.flatMap((g) => g.card_ids || []));
    const bubbleCards    = flaggedCards.filter((c) =>  bubbleCardSet.has(c.id));
    const nonBubbleCards = flaggedCards.filter((c) => !bubbleCardSet.has(c.id));
    const shuffle = (arr) => arr.sort(() => 0.5 - Math.random());
    flaggedCards = [...shuffle(bubbleCards), ...shuffle(nonBubbleCards)];
  }
} catch (_e) { /* non-fatal — Reckoning proceeds with unweighted pool */ }
const questionCount = Math.min(25, Math.max(15, flaggedCards.length));
const reckoning = await db.reckoningSessions.create(userId, {
subject_id: subjectId,
subject_name: subject?.name || 'Unknown',
pressure_score: pressureData.pressure_score,
flagged_card_count: flaggedCards.length,
question_count: questionCount,
status: 'triggered',
deferral_used: false,
deferred_until: null,
exam_session_id: null,
score_pct: null,
debrief_text: null,
// P3.7-B1a FIX: store flagged card IDs so the exam generator can use
// the correct pool instead of the standard stage >= 3 eligibility filter.
flagged_card_ids: flaggedCards.map(c => c.id),
});
return {
reckoning_id: reckoning.id,
status: 'triggered',
flagged_card_count: flaggedCards.length,
question_count,
};
}

async function deferReckoning(reckoningId) {
// NEW-L2 FIX: db.reckoningSessions.findById is a function reference — always
// truthy, so the null branch was dead code. Same BUG 13 pattern fixed in
// generateDeepAudit but missed here. Use .catch(() => null) instead.
const reckoning = await db.reckoningSessions.findById(reckoningId).catch(() => null);
if (!reckoning) return null;
if (reckoning.deferral_used) return { error: 'Deferral already used' };
const deferredUntil = new Date(Date.now() + 4 * 3600000); // 4 hours
await db.reckoningSessions.update(reckoningId, {
status: 'deferred',
deferral_used: true,
deferred_until: deferredUntil,
});
return { status: 'deferred', deferred_until: deferredUntil };
}

async function startReckoningExam(reckoningId, examSessionId) {
await db.reckoningSessions.update(reckoningId, {
status: 'in_progress',
exam_session_id: examSessionId,
});
return { status: 'in_progress' };
}

async function completeReckoning(reckoningId, scorePct, debriefText) {
// NEW-L2 FIX (completeReckoning): same always-truthy guard pattern — fixed.
const reckoning = await db.reckoningSessions.findById(reckoningId).catch(() => null);
if (!reckoning) return null;
const subjectId = reckoning.subject_id;
const userId = reckoning.user_id;
// P3.3-B4 FIX: pressure resets ONLY when reckoning is survived (score >= 70).
// Previously unconditional — a failed reckoning gave a free pressure escape.
const survived = parseFloat(scorePct) >= 70;
if (survived) {
await db.brainPressure.set(userId, subjectId, {
pressure_score: 0,
intervention_level: 'L0',
sources: {},
});
}
await db.reckoningSessions.update(reckoningId, {
status: 'completed',
score_pct: scorePct,
debrief_text: debriefText,
completed_at: new Date(),
});
// Award seedling for survival
if (survived) {
await awardSeedlings(
userId,
5,
'reckoning_survival',
`Survived Reckoning in ${reckoning.subject_name} with ${scorePct}%`
);
}
return { status: 'completed', pressure_reset: survived, survived, debrief_text: debriefText };
}
// ── credentialService ─────────────────────────────────────────────────────────
const CREDENTIAL_TIERS = [
{
tier: 0,
code: 'untested',
name: '🌱 Untested',
thresholdPct: 0,
minExams: 0,
consecutiveRequired: false,
},
{
tier: 1,
code: 'attempted',
name: '⬜ Attempted',
thresholdPct: 0,
minExams: 1,
consecutiveRequired: false,
},
{
tier: 2,
code: 'foundational',
name: '🟫 Foundational',
thresholdPct: 60,
minExams: 2,
consecutiveRequired: false,
},
{
tier: 3,
code: 'competent',
name: '🟩 Competent',
thresholdPct: 70,
minExams: 3,
consecutiveRequired: false,
},
{
tier: 4,
code: 'proficient',
name: '🟦 Proficient',
thresholdPct: 80,
minExams: 5,
consecutiveRequired: false,
},
{
tier: 5,
code: 'advanced',
name: '🟪 Advanced',
thresholdPct: 90,
minExams: 5,
consecutiveRequired: false,
},
{
tier: 6,
code: 'expert',
name: '🟡 Expert',
thresholdPct: 95,
minExams: 3,
consecutiveRequired: true,
},
{
tier: 7,
code: 'sovereign',
name: '🔴 Sovereign',
thresholdPct: 100,
minExams: 1,
consecutiveRequired: false,
},
];

async function evaluateCredential(userId, subjectId) {
const exams = await db.examSessions.findMany(userId, { status: 'completed' }, { limit: 999 });
const subjectExams = exams.filter((e) => e.subject_id === subjectId);
if (subjectExams.length === 0) {
return { tier: 0, code: 'untested', name: '🌱 Untested', nextRequirement: '1 exam' };
}
const scores = subjectExams.map((e) => parseFloat(e.score_pct || 0)).sort((a, b) => b - a);
let currentTier = 1; // Attempted
for (let i = CREDENTIAL_TIERS.length - 1; i >= 0; i--) {
const tierDef = CREDENTIAL_TIERS[i];
if (tierDef.tier === 0) continue;
if (tierDef.tier === 1 && subjectExams.length >= 1) {
currentTier = 1;
break;
}
const qualifying = subjectExams.filter(
(e) => parseFloat(e.score_pct || 0) >= tierDef.thresholdPct
);
if (qualifying.length >= tierDef.minExams) {
if (tierDef.consecutiveRequired) {
// Check last N consecutive exams all >= threshold
const sortedByDate = subjectExams.sort(
(a, b) => new Date(b.completed_at) - new Date(a.completed_at)
);
const lastN = sortedByDate.slice(0, tierDef.minExams);
if (lastN.every((e) => parseFloat(e.score_pct || 0) >= tierDef.thresholdPct)) {
currentTier = tierDef.tier;
break;
}
} else {
currentTier = tierDef.tier;
break;
}
}
}
const tierDef = CREDENTIAL_TIERS[currentTier];
// P3.4-B1 FIX: load previously stored tier to detect advancement.
// credential.newlyEarned was always undefined — credentialEarned at the
// exam submit call site was permanently false, so celebrations never fired.
const storedStatsForCred = await db.subjectStats.get(userId, subjectId).catch(() => null);
const previousStoredTier = storedStatsForCred?.credential_tier || 0;
return {
tier: currentTier,
code: tierDef.code,
name: tierDef.name,
exams_taken: subjectExams.length,
average_score: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
newlyEarned: currentTier > previousStoredTier,
};
}

async function getCurrentCredential(userId, subjectId) {
return evaluateCredential(userId, subjectId);
}

async function checkCredentialRegression(userId, subjectId) {
const credential = await evaluateCredential(userId, subjectId);
const exams = await db.examSessions.findMany(userId, { status: 'completed' }, { limit: 10 });
const subjectExams = exams
.filter((e) => e.subject_id === subjectId)
.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
if (subjectExams.length < 3) return null;
const tierDef = CREDENTIAL_TIERS[credential.tier];
if (!tierDef || tierDef.tier <= 1) return null;
const last3 = subjectExams.slice(0, 3);
const allBelow = last3.every((e) => parseFloat(e.score_pct || 0) < tierDef.thresholdPct);
if (allBelow) {
return {
warning: true,
message: `Your ${tierDef.name} credential in this subject is under review. Last 3 exams averaged ${parseFloat((last3.reduce((s, e) => s + parseFloat(e.score_pct || 0), 0) / 3).toFixed(2))}%.`,
credential_tier: credential.tier,
};
}
return null;
}
// ── Streak Engine Redesign ────────────────────────────────────────────────────

async function evaluateStreakShield(userId) {
const stats = await db.userStats.get(userId);
if (!stats) return null;
// P3.9-B2 FIX: use streak days (longest ever), not session count.
// Session count is inflated by multi-session days, causing premature shield earnings.
const longestStreak = Math.max(stats.current_streak || 0, stats.longest_streak || 0);
const shieldsEarned = Math.floor(longestStreak / 30);
const shieldsHeld = Math.min(3, shieldsEarned - (stats.streak_shields_consumed || 0));
await db.userStats.update(userId, {
streak_shields_earned: shieldsEarned,
streak_shields_held: shieldsHeld,
});
return { shields_held: shieldsHeld, shields_earned: shieldsEarned };
}

async function consumeShieldOnMiss(userId) {
const stats = await db.userStats.get(userId);
if (!stats) return { streak_broken: true };
if (stats.streak_shields_held > 0) {
await db.userStats.update(userId, {
streak_shields_held: stats.streak_shields_held - 1,
streak_shields_consumed: (stats.streak_shields_consumed || 0) + 1,
});
return { streak_broken: false, shield_consumed: true };
}
await db.userStats.update(userId, {
current_streak: 0,
tree_health: Math.max(0, stats.tree_health - 20),
});
return { streak_broken: true, shield_consumed: false };
}

// P3.9-B3 FIX: use >= with stored-rings guard so milestones fire once and
// are PERMANENTLY recorded — spec says ring marks survive streak breaks.
async function detectStreakMilestones(userId) {
const stats = await db.userStats.get(userId);
if (!stats) return [];
const streak = stats.current_streak;
const milestones = [7, 30, 100, 365];
// Use streak_milestone_rings as the permanent record (streak_milestones_earned
// also covers this via computeStreakAfterSession — both are kept in sync).
const existingRings = new Set(
stats.streak_milestone_rings || stats.streak_milestones_earned || []
);
const triggered = [];
for (const m of milestones) {
// >= not === : fires even if streak jumps over the threshold
// existingRings guard: fires only once per lifetime
if (streak >= m && !existingRings.has(m)) {
existingRings.add(m);
triggered.push(m);
if (m === 7) {
const earnedMilestones = stats.streak_milestones_earned || [];
if (!earnedMilestones.includes(7)) {
await awardSeedlings(userId, 2, 'streak_7', '7-day streak');
}
}
if (m === 30)
await awardSeedlings(userId, 5, 'streak_milestone_30', '30-day streak milestone');
if (m === 100)
await awardSeedlings(userId, 10, 'streak_milestone_100', '100-day streak milestone');
}
}
if (triggered.length > 0) {
// Persist the updated ring set so it survives streak resets
await db.userStats.update(userId, {
streak_milestone_rings: Array.from(existingRings),
streak_milestones_earned: Array.from(existingRings), // keep both fields in sync
});
}
return triggered;
}
// ── P3.10: Reclassification Alert (D3) ───────────────────────────────────────────

async function triggerReclassificationAlert(userId, subjectId, scorePct, reclassifiedCards) {
const alertTimestamp = new Date();
const existingPressureDoc = await db.brainPressure.get(userId, subjectId).catch(() => null);
await db.brainPressure.set(userId, subjectId, {
...(existingPressureDoc || {}),
reclassification_alert_at: alertTimestamp,
alert_ignored_at: null,
alert_acknowledged_at: null,
});
let alertText = '';
try {
const cardNames = reclassifiedCards.slice(0, 6).map(r =>
`Card ${r.card_id} (was Stage ${r.old_stage}, now Stage ${r.new_stage})`
).join('\n');
const d3Prompt = `## ROLE
You are KIWIs Brain — the authoritative academic intelligence layer.
EVIDENCE
Subject exam score: {scorePct}% (below the 60% threshold)
Cards reclassified downward ({reclassifiedCards.length} total):
{cardNames}
RULES
- Write exactly 2 sentences.
- Sentence 1: Name the contradiction directly — high stage, low score.
- Sentence 2: Explain exactly what was done and what it means for the student.
- Tone: Authoritative but not punitive.
OUTPUT
Return only the 2-sentence alert text.`;
    const aiResult = await geminiModel.generateContent(d3Prompt);
    alertText = aiResult.response.text().trim();
  } catch (_) {
    alertText = `Your exam score of ${scorePct}% contradicts the advanced stage of ` +
      `${reclassifiedCards.length} card(s) — their SRS progress was ahead of your ` +
      `demonstrated knowledge. The Brain has reclassified these cards to earlier stages.`;
  }
  const freshPressureDoc = await db.brainPressure.get(userId, subjectId).catch(() => null);
  await db.brainPressure.set(userId, subjectId, {
    ...(freshPressureDoc || {}),
    reclassification_alert_text: alertText,
    reclassification_alert_at: alertTimestamp,
  });
  return { alert_text: alertText, reclassified_count: reclassifiedCards.length };
}

// ── Exam SRS Feedback Loop ────────────────────────────────────────────────────

async function applyExamSRSFeedback(userId, examSession) {
const questions = examSession.questions || [];
const reclassified = [];
for (const q of questions) {
if (q.is_correct === false && q.card_id) {
const card = await db.cards.findById(userId, q.card_id);
if (!card) continue;
const newStage = Math.max(1, card.stage - 1);
await db.cards.update(userId, card.id, {
stage: newStage,
interval_days: 1,
repetition_count: 0,
next_review_at: new Date(Date.now() + 86400000),
});
await db.cardStates.update(userId, card.id, {
state: newStage === 1 ? CARD_STATES.GROWING : CARD_STATES.STABLE,
stage: newStage,
verified: false,
});
reclassified.push({ card_id: card.id, old_stage: card.stage, new_stage: newStage });
}
}
return reclassified;
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 4 — Study Session & Focus Seed

// ════════════════════════════════════════════════════════════════════════════
// ── Session Priority Queue ────────────────────────────────────────────────────
const PRIORITY_ORDER = [
CARD_STATES.GHOST,
CARD_STATES.DANGEROUS,
CARD_STATES.STUCK,
'DUE_UNSCHEDULED',
'DUE_SCHEDULED',
CARD_STATES.VERIFIED, // NEWLY_VERIFIED = Stage 5 verified, reviewed today
CARD_STATES.SEEDLING,
];

// P10 NOTE: buildSessionQueue is a canonical service function but is currently NOT called
// by the session start endpoint (which uses its own inline sort). Both are now fixed to
// use the same spec-compliant priority order so any future wiring is correct.
async function buildSessionQueue(userId, deckId) {
const cards = await db.cards.findByDeck(userId, deckId);
const now = new Date();
const queue = [];
for (const card of cards) {
let stateDoc = await db.cardStates.get(userId, card.id);
if (!stateDoc) stateDoc = await initializeCardState(userId, card.id);
let priority = -1;
let category = 'OTHER';
// P2b FIX: Spec P4.1 order — DANGEROUS=0, AVOIDED=1, GHOST=2, STUCK=3, FRAGILE=4
if (stateDoc.state === CARD_STATES.DANGEROUS) {
priority = 0;
category = CARD_STATES.DANGEROUS;
} else if (stateDoc.state === CARD_STATES.AVOIDED) {
priority = 1;
category = CARD_STATES.AVOIDED;
} else if (stateDoc.state === CARD_STATES.GHOST) {
priority = 2;
category = CARD_STATES.GHOST;
} else if (stateDoc.state === CARD_STATES.STUCK) {
priority = 3;
category = CARD_STATES.STUCK;
} else if (stateDoc.state === CARD_STATES.FRAGILE) {
priority = 4;
category = CARD_STATES.FRAGILE;
} else if (isCardDue(card, now)) {
priority = 5;
category = 'DUE_SCHEDULED';
} else if (
stateDoc.state === CARD_STATES.VERIFIED &&
card.last_reviewed_at &&
daysSince(card.last_reviewed_at) === 0
) {
priority = 6;
category = CARD_STATES.VERIFIED;
} else if (stateDoc.state === CARD_STATES.SEEDLING) {
priority = 7;
category = CARD_STATES.SEEDLING;
}
if (priority >= 0) {
queue.push({ card, state: stateDoc, priority, category });
}
}
// P12 FIX: Secondary sort by overdue date within same priority tier (most overdue first)
queue.sort((a, b) => {
if (a.priority !== b.priority) return a.priority - b.priority;
const aOverdue = a.card.next_review_at ? new Date(a.card.next_review_at).getTime() : 0;
const bOverdue = b.card.next_review_at ? new Date(b.card.next_review_at).getTime() : 0;
return aOverdue - bOverdue;
});
return queue;
}
// ── Focus Seed Progression ────────────────────────────────────────────────────
// B10: Corrected 6-stage Focus Seed design
const FOCUS_STAGES = {
DORMANT: 'Dormant',
WAKING: 'Waking',
GROWING: 'Growing',
THRIVING: 'Thriving',
GLOWING: 'Glowing',
FRUITING: 'Fruiting',
};
// B10: Correct five-interval six-stage progression

// P3 FIX: Accept focusDurationSec (actual focused time, idle excluded) from frontend.
// Accept seedKilled flag so a single long idle (>5 min) forces DORMANT regardless of time.
function computeFocusStage(startTime, breaks, focusDurationSec = 0, seedKilled = false) {
if (seedKilled) return FOCUS_STAGES.DORMANT; // frontend detected death event
if (breaks >= 3) return FOCUS_STAGES.DORMANT;
const now = new Date();
const elapsedSec = Math.max(0, Math.floor((now - new Date(startTime)) / 1000));
// Use actual focused duration from frontend when provided — prevents idle time
// from counting toward Fruiting (was measuring absence, not focus).
const effectiveSec = focusDurationSec > 0 ? focusDurationSec : elapsedSec;
if (effectiveSec >= 3600) return FOCUS_STAGES.FRUITING; // 60 min — deep fruiting
if (effectiveSec >= 2400) return FOCUS_STAGES.GLOWING;  // 40 min
if (effectiveSec >= 1500) return FOCUS_STAGES.THRIVING;  // 25 min
if (effectiveSec >= 900)  return FOCUS_STAGES.GROWING;   // 15 min
if (effectiveSec >= 300)  return FOCUS_STAGES.WAKING;    // 5 min
return FOCUS_STAGES.DORMANT;
}

async function persistFocusSeed(sessionId, stage) {
await db.sessions.update(null, sessionId, { focus_seed_stage: stage });
}
// B11: Per-subject fruit count + global counter

async function processFruiting(userId, session) {
if (session.focus_seed_stage === FOCUS_STAGES.FRUITING) {
// Global counter (kept for backward compat)
await db.userStats.update(userId, { fruit_count: FieldValue.increment(1) });
// Per-subject fruit count stored in subject_stats
let subjectId = null;
try {
if (session.deck_id) {
const deck = await db.decks.findById(userId, session.deck_id);
if (deck && deck.subject_id) {
subjectId = deck.subject_id;
await db.subjectStats.upsert(userId, subjectId, { fruit_count: FieldValue.increment(1) });
}
}
} catch (e) {}
return { fruiting_achieved: true, subject_id: subjectId };
}
return { fruiting_achieved: false };
}
// ── Return Mechanic ─────────────────────────────────────────────────────────

async function computeReturnStatus(userId) {
// P5.3-F FIX: removed misplaced rate-limit guard (this function makes no AI calls)
const stats = await db.userStats.get(userId);
if (!stats || !stats.last_study_date) return { status: 'new', days_since: null };
const days = daysSince(stats.last_study_date);
if (days >= 14) return { status: 'abandoned', days_since: days, greeting_type: 'A3_full_return' };
if (days >= 3)
return { status: 'slipping', days_since: days, greeting_type: 'A3_partial_return' };
return { status: 'active', days_since: days };
}
// ── Card Summarizer ───────────────────────────────────────────────────────────
const SUMMARY_CACHE = new Map(); // in-memory with TTL

// P7 FIX: On cache miss, check Firestore cards.ai_summary before calling Gemini.
// After generating, write permanently to Firestore so server restarts don't lose it.
// P14 FIX: Removed the in-memory per-minute rate limiter — the global checkAIRateLimit
// at the route level (20/hour) is the correct and sufficient guard.
async function getCardSummary(userId, cardId, front, back) {
const cacheKey = `${userId}:${cardId}`;
const cached = SUMMARY_CACHE.get(cacheKey);
if (cached && cached.expires > Date.now()) {
return cached.summary;
}
// Check Firestore permanent cache before calling Gemini
try {
const cardDoc = await db.cards.findById(userId, cardId);
if (cardDoc && cardDoc.ai_summary) {
// Warm the in-memory cache and return — avoids any Gemini call
SUMMARY_CACHE.set(cacheKey, { summary: cardDoc.ai_summary, expires: Date.now() + 3600000 });
return cardDoc.ai_summary;
}
} catch (e) { / non-fatal — proceed to generate / }
try {
const summary = await summarizeCard(front, back);
SUMMARY_CACHE.set(cacheKey, { summary, expires: Date.now() + 3600000 }); // 1 hour in-memory
// Write permanently to Firestore — fire and forget, non-blocking
db.cards.update(userId, cardId, { ai_summary: summary }).catch(() => {});
return summary;
} catch (e) {
return { error: true, fallback: 'AI summary unavailable.' };
}
}

// ── Mastery Moment AI (B1) ────────────────────────────────────────────────────
// P5 FIX: Called the first time a card advances to Stage 5. Generates 1 personalized
// sentence and stores it permanently on cards.mastery_moment in Firestore.
// Fire-and-forget — does not block the card response.
async function generateMasteryMoment(userId, cardId, front, back) {
const prompt = `You are KIWI, a study companion. A student has just mastered a flashcard for the first time — it has reached Stage 5, the highest level of long-term retention.

Card front: {front}
Card back: {back}

Write exactly 1 sentence (maximum 20 words) of warm, specific acknowledgement that this concept is now part of their long-term memory. Reference the card content directly. No preamble. Just the sentence.`;
try {
const result = await geminiModel.generateContent(prompt);
const mastery_moment = result.response.text().trim();
await db.cards.update(userId, cardId, { mastery_moment }).catch(() => {});
return mastery_moment;
} catch (e) {
const fallback = 'This concept has crossed into long-term memory — it is yours now.';
await db.cards.update(userId, cardId, { mastery_moment: fallback }).catch(() => {});
return fallback;
}
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 5 — Biome & Visualization

// ════════════════════════════════════════════════════════════════════════════
// ── biomeService ──────────────────────────────────────────────────────────────
// BIOME_ZONES constant removed — dead 3-zone KS-only system. Replaced by 4-state determineZoneState(). (P5.1-F1)
// P5.1 FIX: 4-signal, 4-state zone determination (replaces KS-only 3-state function)
// Inputs: knowledgeScore (0-100), pressure (0-100+), cardStateCounts {STATE: count}, daysSinceLastSession

function determineZoneState(knowledgeScore, pressure, cardStateCounts, daysSinceLastSession) {
const totalCards = Object.values(cardStateCounts || {}).reduce((a, b) => a + b, 0);
const troubleCount = (cardStateCounts['GHOST'] || 0) + (cardStateCounts['STUCK'] || 0);
const troublePct = totalCards > 0 ? (troubleCount / totalCards) * 100 : 0;
const days = daysSinceLastSession || 0;
// Neglected — highest priority; any single condition triggers it
if (pressure >= 50 || knowledgeScore < 15 || days >= 14) {
return { zoneName: 'Neglected', stateClass: 'zone-neglected' };
}
// Struggling — any single condition triggers it
if (pressure >= 30 || troublePct >= 10 || knowledgeScore < 30) {
return { zoneName: 'Struggling', stateClass: 'zone-struggling' };
}
// Thriving — all three conditions must be met
if (pressure < 10 && troublePct < 5 && knowledgeScore > 60) {
return { zoneName: 'Thriving', stateClass: 'zone-thriving' };
}
// Growing — default for everything in between
return { zoneName: 'Growing', stateClass: 'zone-growing' };
}

async function buildBiomeData(userId) {
const user = await db.users.findById(userId);
const stats = await db.userStats.get(userId);
const subjects = await db.subjects.findManyWithDecks(userId);
const now = new Date();
const todayStr = now.toISOString().split('T')[0];
// P5.2-F7 FIX: parallelise at subject level to meet <300ms requirement
const subjectsData = await Promise.all(subjects.map(async (subject) => {
const [ks, credential, pressure, decks] = await Promise.all([
computeKnowledgeScore(userId, subject.id),
evaluateCredential(userId, subject.id),
db.brainPressure.get(userId, subject.id),
db.decks.findBySubject(userId, subject.id),
]);
// Parallelise deck card fetches
const deckCardArrays = await Promise.all(
decks.map(deck => db.cards.findByDeck(userId, deck.id))
);
let allCards = [];
for (const dc of deckCardArrays) allCards.push(...dc);
// Parallelise card-state reads
const cardStatesDocs = await Promise.all(allCards.map(async card => {
let stateDoc = await db.cardStates.get(userId, card.id);
if (!stateDoc) stateDoc = await initializeCardState(userId, card.id);
return stateDoc;
}));
const stateCounts = {};
for (const s of Object.values(CARD_STATES)) stateCounts[s] = 0;
for (const cs of cardStatesDocs) stateCounts[cs.state] = (stateCounts[cs.state] || 0) + 1;
const subjectStatDoc = await db.subjectStats.get(userId, subject.id);
let daysSinceLastSession = 0;
const lastStudied = subjectStatDoc?.last_studied_at;
if (lastStudied) {
const diffMs = now.getTime() - new Date(lastStudied).getTime();
daysSinceLastSession = Math.floor(diffMs / 86400000);
} else {
daysSinceLastSession = 999;
}
const pressureScore = pressure?.pressure_score || 0;
const zoneResult = determineZoneState(ks.score, pressureScore, stateCounts, daysSinceLastSession);
// P5.2-F5 FIX: pre-populate cached zone description if generated today
const descCacheType = `zone_desc_${subject.id}`;
const cachedDesc = await db.dailyRitualCache.get(userId, descCacheType, todayStr).catch(() => null);
return {
subject_id: subject.id,
subject_name: subject.name,
knowledge_score: ks.score,
knowledge_band: ks.band,
credential_tier: credential.tier,
credential_name: credential.name,
pressure_score: pressureScore,
// P3.2-B1 FIX: L1 is never returned by computeInterventionLevel; calm = L0.
intervention_level: pressure?.intervention_level || 'L0',
zone: zoneResult.zoneName,
stateClass: zoneResult.stateClass,
card_count: allCards.length,
state_distribution: stateCounts,
fruit_count: subjectStatDoc?.fruit_count || 0,
last_studied_at: lastStudied || null,
days_since_last_session: daysSinceLastSession,
exam_date: subject.exam_date || null,
zone_description: cachedDesc?.data || null,
};
}));
const globalKS = await computeGlobalKnowledgeScore(userId);
const globalZoneResult = determineZoneState(
globalKS.score,
0,
subjectsData.reduce((acc, s) => {
for (const [k, v] of Object.entries(s.state_distribution || {})) {
acc[k] = (acc[k] || 0) + v;
}
return acc;
}, {}),
0
);
// P5.4-F8 FIX: streak milestones are permanent — survive streak breaks
const currentStreak = stats?.current_streak || 0;
const allMilestoneThresholds = [7, 30, 100, 365];
const earnedMilestones = stats?.streak_milestones_earned || [];
const activeMilestones = [...new Set([
...earnedMilestones,
...allMilestoneThresholds.filter(m => currentStreak >= m),
])].sort((a, b) => a - b);
// P5.4-F9 FIX: derive tree health from zone states (blended with stored health)
const zoneHealthMap = { Thriving: 100, Growing: 70, Struggling: 40, Neglected: 10 };
const zoneHealthValues = subjectsData.map(s => zoneHealthMap[s.zone] || 50);
const derivedTreeHealth = zoneHealthValues.length > 0
? Math.round(zoneHealthValues.reduce((a, b) => a + b, 0) / zoneHealthValues.length)
: 100;
const blendedTreeHealth = Math.round((derivedTreeHealth + (stats?.tree_health || 100)) / 2);
return {
user_id: userId,
username: user?.username,
global_knowledge_score: globalKS.score,
global_zone: globalZoneResult.zoneName,
tree_stage: stats?.tree_stage || 1,
tree_health: blendedTreeHealth,
current_streak: currentStreak,
streak_milestones: activeMilestones,
subjects: subjectsData,
};
}
// ── Zone Description AI (D1) ─────────────────────────────────────────────────

async function generateZoneDescription(userId, subjectId) {
// P5.3-F FIX: checkAIRateLimit is sync — remove await; guard on return value
if (checkAIRateLimit(userId, 'zone_description', 20)) {
return 'Your knowledge forest awaits your return.';
}
const todayStr = new Date().toISOString().split('T')[0];
const cacheType = `zone_desc_${subjectId || 'global'}`;
const cached = await db.dailyRitualCache.get(userId, cacheType, todayStr);
if (cached) return cached.data;
// Fetch subject data for prompt construction
const subjectDoc = await db.subjects.findById(subjectId);
const subjectDecks = await db.decks.findBySubject(userId, subjectId);
const subjectDeckIds = subjectDecks.map((d) => d.id);
let subjectCards = [];
for (const did of subjectDeckIds) {
const dc = await db.cards.findByDeck(userId, did);
subjectCards.push(...dc);
}
const ks = await computeKnowledgeScore(userId, subjectId).catch(() => ({ score: 0, band: 'Seed' }));
// P5.3-G FIX: read-only pressure fetch — calculateSubjectPressure has write side-effects
const pressureDoc = await db.brainPressure.get(userId, subjectId).catch(() => null);
const pressureScore = pressureDoc?.pressure_score || 0;
const stateCounts = {};
for (const card of subjectCards) {
const sd = await db.cardStates.get(userId, card.id);
const st = sd?.state || 'SEEDLING';
stateCounts[st] = (stateCounts[st] || 0) + 1;
}
// P5.3-E FIX: fetch days since last session (required prompt input per spec)
const subjectStatDoc = await db.subjectStats.get(userId, subjectId).catch(() => null);
const lastStudied = subjectStatDoc?.last_studied_at;
const daysSinceLastSession = lastStudied
? Math.floor((Date.now() - new Date(lastStudied).getTime()) / 86400000)
: 999;
// P5.3-B FIX: compute zone via determineZoneState (subject.zone was always undefined)
const zoneResult = determineZoneState(ks.score, pressureScore, stateCounts, daysSinceLastSession);
const zone = zoneResult.zoneName;
// P5.3-C FIX: use stateCounts directly (subject.state_distribution was always undefined)
const stateDistForZone = stateCounts;
const pressureForZone = pressureScore;
// P5.3-D FIX: fetch credential directly (subject.credential_name was always undefined)
const credentialResult = await evaluateCredential(userId, subjectId).catch(() => ({ name: 'Untested' }));
const credentialForZone = credentialResult.name || 'Untested';
const zoneTones = {
Thriving: 'flourishing and abundant — roots deep, canopy full, fruit ripe',
Growing: 'vital but still forming — new growth pushing through, some patches thin',
Struggling: 'stressed — thorns visible, soil dry, growth stalled under pressure',
Neglected: 'drought-stricken and silent — cracked earth, bare branches, waiting',
};
// P5.3-A FIX: use {} interpolation (was using {} — all values sent as literal placeholder text)
const prompt = `
You are a mystical ecological guide in the KIWI study application. Describe the "{zone}" zone for a student.
Zone character: {zoneTones[zone] || 'alive and complex'}
Context (do NOT mention these numbers directly — let them colour the imagery):
- Knowledge Score: {ks.score.toFixed(1)}/100
- Credential tier: {credentialForZone}
- Pressure level: {pressureForZone} pts
- Days since last session: {daysSinceLastSession}
- Dangerous cards: {stateDistForZone['DANGEROUS'] || 0}
- Ghost cards: {stateDistForZone['GHOST'] || 0}
- Stuck cards: {stateDistForZone['STUCK'] || 0}
- Verified mastered cards: {stateDistForZone['VERIFIED'] || 0}
Rules:
- Write exactly 2 sentences.
- Match the tone precisely to the zone character.
- Reference ecological imagery — roots, thorns, fruits, light, soil — based on the card-state data.
- Do not mention numbers or technical terms.
- Keep it atmospheric and honest.
Respond with only the description text.
`;
  const fallbacks = {
    Thriving: 'Your knowledge forest flourishes — deep roots, full canopy, fruit hanging heavy. Keep tending this garden.',
    Growing: 'Your forest grows with purpose, though some paths are still forming. Stay vigilant and the clearing will come.',
    Struggling: 'Thorns crowd the knowledge paths and the soil is thinning here. Urgent care is needed — begin with the closest danger.',
    Neglected: 'The forest has fallen silent in this zone, the earth cracked and waiting. One session is all it takes to wake it again.',
  };
  try {
    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    await db.dailyRitualCache.set(userId, cacheType, todayStr, { data: text });
    return text;
  } catch (e) {
    return fallbacks[zone] || 'Your knowledge forest awaits your return.';
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 6 — Narrative Systems

// ════════════════════════════════════════════════════════════════════════════
// ── chronicleService ──────────────────────────────────────────────────────────
// Fallback chronicle when AI is unavailable

function buildFallbackChronicle(userId) {
const now = new Date();
const weekStart = new Date(now);
weekStart.setDate(weekStart.getDate() - now.getDay());
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekEnd.getDate() + 6);
return {
chronicles: [
{
week_start: weekStart.toISOString().split('T')[0],
week_end: weekEnd.toISOString().split('T')[0],
summary:
'This week you continued building your knowledge ecosystem. Cards moved through stages, some flourished, others need attention.',
key_events: [
{ day: 'Monday', text: 'Weekly study session began' },
{ day: 'Wednesday', text: 'Mid-week review checkpoint' },
{ day: 'Friday', text: 'Weekend consolidation phase' },
],
strongest_subject: 'Your strongest subject continues to thrive.',
weakest_subject: 'One subject needs more attention — consider a focused session.',
mood: 'Steady',
generated_by: 'fallback',
},
],
};
}

async function generateWeeklyChronicle(userId) {
// P5.3-F FIX: checkAIRateLimit is sync — removed await; guard on return value
if (checkAIRateLimit(userId, 'chronicle', 5)) {
const cached = await db.chronicleEntries.findLatest(userId).catch(() => null);
if (cached) return cached;
return null;
}
const now = new Date();
const weekStart = new Date(now);
// FIX-10: Monday-anchored week. (getDay()+6)%7 = 0 on Mon, 6 on Sun.
weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
weekStart.setHours(0, 0, 0, 0);
const weekStr = weekStart.toISOString().split('T')[0];
const existing = await db.chronicleEntries.findLatest(userId);
if (existing && existing.week_start === weekStr) return existing;
const stats = await db.userStats.get(userId);
const subjects = await db.subjects.findManyWithDecks(userId);
const logs = await db.reviewLogs.findByUser(userId, weekStart);
const sessions = await db.sessions.findMany(userId, { session_completed: true }, { limit: 999 });
const weekSessions = sessions.sessions.filter((s) => new Date(s.started_at) >= weekStart);
// B12: Collect rich per-subject stats for the chronicle prompt
const subjectSnapshots = [];
for (const sub of subjects) {
try {
const ks = await computeKnowledgeScore(userId, sub.id);
const cred = await evaluateCredential(userId, sub.id);
const press = await db.brainPressure.get(userId, sub.id);
const sStat = await db.subjectStats.get(userId, sub.id);
subjectSnapshots.push({
name: sub.name,
ks: ks.score,
credential: cred.name,
pressure: press?.pressure_score || 0,
fruit_count: sStat?.fruit_count || 0,
total_cards: sub.total_cards || 0,
});
} catch (e) {}
}
const fruitings = weekSessions.filter((s) => s.fruiting_achieved).length;
const totalXPEarned = weekSessions.reduce((s, sess) => s + (sess.xp_earned || 0), 0);
// P6.1 FIX: gather previous 2 chronicles for continuity context
const allChronicles = await db.chronicleEntries.findByUser(userId).catch(() => []);
// GAP-1 FIX: fetch exam sessions for the week so Chronicle narrator knows about CBT results
const allExamSessions = await db.examSessions.findMany(userId, { limit: 999 }).catch(() => []);
const weekExams = allExamSessions.filter(
(e) => new Date(e.created_at) >= weekStart && e.score_percentage != null
);
const examLines = weekExams.map((e) => {
const subName = subjects.find((s) => s.id === e.subject_id)?.name || 'Unknown';
return `${subName}: ${Math.round(e.score_percentage)}% (${
    e.is_reckoning ? 'Reckoning' : 'CBT'
  })`;
}).join(', ') || 'None';
const prevChronicles = allChronicles
.sort((a, b) => new Date(b.week_start) - new Date(a.week_start))
.slice(0, 2);
const prevChronicleText =
prevChronicles.length > 0
? prevChronicles
.map((c, i) => `Week of ${c.week_start}: ${(c.narrative || '').slice(0, 200)}...`)
.join('\n')
: 'None yet — this is the first entry.';
// P6.1 FIX: gather reckoning events this week
const allReckonings = await db.reckoningSessions.findByUser(userId).catch(() => []);
const weekReckonings = allReckonings.filter((r) => new Date(r.triggered_at) >= weekStart);
const reckoningLine =
weekReckonings.length > 0
? `${weekReckonings.length} Reckoning(s) this week — statuses: ${weekReckonings.map((r) => r.status).join(', ')}`
: 'No Reckoning this week.';
// P6.1 FIX: get current persona for chronicle context
const currentPersona = await db.userPersona.get(userId).catch(() => null);
const personaLine = currentPersona
? `${currentPersona.persona_label} — ${currentPersona.persona_description}`
: 'Unclassified';
// Most-attended subject (by session count this week)
const subjectSessionCounts = {};
for (const s of weekSessions) {
if (s.subject_id)
subjectSessionCounts[s.subject_id] = (subjectSessionCounts[s.subject_id] || 0) + 1;
}
const mostAttendedId = Object.entries(subjectSessionCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
const mostAttendedSubject =
subjects.find((s) => s.id === mostAttendedId)?.name ||
subjectSnapshots[0]?.name ||
'your primary subject';
// Biggest stage advance this week (from review logs)
// FIX-7: count actual stage advances, not proxy ratings
const stageAdvances = logs.filter(
(l) =>
l.new_stage !== undefined &&
l.previous_stage !== undefined &&
l.new_stage > l.previous_stage
).length;
// Weakest subject (highest pressure or lowest KS)
const weakest = subjectSnapshots.sort((a, b) => b.pressure - a.pressure || a.ks - b.ks)[0];

// PB.18 / GAP-S1: Inject Bubble Chronicle events into the narrative context [DESIGN: §15.4]
// getBubbleEventsForChronicle is defined in B7-CHRONICLE block.
// weekStart is already in scope from this function's earlier lines.
const weekEndDate = new Date(weekStart.getTime() + 6 * 86400000);
const bubbleEvents = await getBubbleEventsForChronicle(userId, weekStart, weekEndDate)
  .catch(() => []);
const bubbleChronicleContext = bubbleEvents.length > 0
  ? '\nMASTERY BUBBLE EVENTS THIS WEEK\n' +
    bubbleEvents.map((b) =>
      `${b.bubble_name} (${b.subject_id || 'unknown'}): ` +
      b.events.map((e) =>
        `${e.type.replace(/_/g, ' ')} at KS ${e.ks != null ? e.ks.toFixed(1) : '?'}` +
        (e.notes ? ` — ${e.notes.slice(0, 80)}` : '')
      ).join('; ')
    ).join('\n')
  : '';

const prompt = `
ROLE
You are the Keeper of the Kiwi Forest — a wise, atmospheric narrator who writes a weekly Chronicle for a student\'s knowledge ecosystem. You write in second person, with a tone that is warm, honest, and slightly mystical. You never flatter — you observe.
PREVIOUS ENTRIES (for continuity — do not repeat them, but let their themes evolve)
${prevChronicleText}
THIS WEEK\'S DATA
Student: ${stats ? stats.total_xp + ' XP, Level ' + stats.current_level : 'New Student'}
Streak: ${stats?.current_streak || 0} days (shields held: ${stats?.streak_shields_held || 0})
Sessions this week: ${weekSessions.length}
Cards reviewed: ${logs.length}
Fruitings achieved: ${fruitings}
Week XP earned: ${totalXPEarned}
Most-attended subject: ${mostAttendedSubject}
Stage advances this week: ${stageAdvances}
Reckoning events: ${reckoningLine}
Exams taken this week: ${examLines}
Current persona: ${personaLine}
${bubbleChronicleContext}Subject state:
${subjectSnapshots.map((s) => `  - ${s.name}: KS=${s.ks.toFixed(1)}, Credential=${s.credential}, Pressure=${s.pressure}, Fruits=${s.fruit_count}`).join('\n')}
FIVE REQUIRED PILLARS — address each one in the narrative:
1. Most-attended subject this week — name it specifically.
2. Most significant stage advance or mastery moment — name a concept or card if possible.
3. Honest weakness observation — name the subject or pattern that needs attention. Do not soften this.
4. Genuine growth acknowledgment — something real that improved.
5. Next-week focus — one clear, specific action or intention.
RULES
- Write exactly 5 short paragraphs, one per pillar.
- Each paragraph is 2–4 sentences.
- Use the student\'s actual subject names. Never say "a subject" when you have the name.
- Tone: warm but truthful. If the week was poor, say so with care.
- Never use bullet points or headers inside the narrative.
- Total length: 200–350 words.
OUTPUT
Return only the narrative text. No labels, no headers.
`;
  let narrative;
  try {
    const result = await geminiModel.generateContent(prompt);
    narrative = result.response.text().trim();
  } catch (e) {
    // P6.1 FIX: Use buildFallbackChronicle() instead of inline sentence
    // to produce the structured data summary the spec requires.
    const fallback = buildFallbackChronicle(userId);
    narrative =
      fallback.chronicles && fallback.chronicles[0]
        ? `This week you studied ${weekSessions.length} session${weekSessions.length === 1 ? '' : 's'} across ${subjects.length} subject${subjects.length === 1 ? '' : 's'}. ` +
          `${stageAdvances} cards advanced in stage. ` +
          (weakest ? `${weakest.name} needs the most attention. ` : '') +
          `Streak: ${stats?.current_streak || 0} days. Focus: ${fruitings} fruiting session${fruitings === 1 ? '' : 's'} this week.`
        : `Your forest continued to grow this week. ${weekSessions.length} sessions deepened your roots.`;
  }
  const entry = await db.chronicleEntries.create(userId, {
    week_start: weekStr,
    week_end: new Date(weekStart.getTime() + 6 * 86400000).toISOString().split('T')[0],
    narrative,
    stats_snapshot: {
      streak: stats?.current_streak || 0,
      sessions: weekSessions.length,
      cards_reviewed: logs.length,
    },
  });
  return entry;
}
// ── almanacService ────────────────────────────────────────────────────────────
const ALMANAC_DEFINITIONS = [
  // ── Chapter 1: Origins ──────────────────────────────────────────────────────
  {
    chapter: 1,
    entry_code: 'first_step',
    name: 'The First Step',
    unlock_condition: { type: 'first_review' },
    narrative:
      'Every great forest begins with a single seed. You held knowledge in your hands for the first time.',
  },
  {
    chapter: 1,
    entry_code: 'most_reviewed_card',
    name: 'The Worn Path',
    unlock_condition: { type: 'card_review_count', value: 20 },
    narrative:
      'One concept drew you back twenty times. Repetition is not weakness — it is the path becoming a road.',
  },
  {
    chapter: 1,
    entry_code: 'first_stage_2',
    name: 'The First Leaf',
    unlock_condition: { type: 'stage_reached', value: 2 },
    narrative:
      'A concept took root and pushed upward. Stage 2 is where memory becomes familiarity.',
  },
  // P6.3 FIX: Added missing first_stage_3 and first_stage_4 entries (spec requires Stage 2-5 all defined)
  {
    chapter: 1,
    entry_code: 'first_stage_3',
    name: 'The Growing Branch',
    unlock_condition: { type: 'stage_reached', value: 3 },
    narrative:
      'A concept has grown roots deep enough to branch. Stage 3 is knowledge gaining structure.',
  },
  {
    chapter: 1,
    entry_code: 'first_stage_4',
    name: 'The Reaching Canopy',
    unlock_condition: { type: 'stage_reached', value: 4 },
    narrative:
      'You have carried a concept long enough for it to reach toward the light. Stage 4 is memory becoming reliable.',
  },
  {
    chapter: 1,
    entry_code: 'first_stage_5',
    name: 'The Tall Tree',
    unlock_condition: { type: 'stage_reached', value: 5 },
    narrative: 'A card reached its highest stage. You no longer remember this — you know it.',
  },
  {
    chapter: 1,
    entry_code: 'again_scholar',
    name: 'The Honest Learner',
    unlock_condition: { type: 'again_count', value: 50 },
    narrative: 'You pressed Again fifty times. That honesty is rarer than any perfect score.',
  },
  {
    chapter: 1,
    entry_code: 'rooting',
    name: 'The Rooting',
    unlock_condition: { type: 'streak', value: 7 },
    narrative: 'Seven days of study sent roots into the soil. Your memory begins to anchor.',
  },
  // ── Chapter 2: Garden ───────────────────────────────────────────────────────
  {
    chapter: 2,
    entry_code: 'first_verified',
    name: 'The First Verified',
    unlock_condition: { type: 'verified_count', value: 1 },
    narrative: 'A card survived the exam fire. You know it — not just remember it.',
  },
  {
    chapter: 2,
    entry_code: 'deep_garden',
    name: 'The Deep Garden',
    unlock_condition: { type: 'card_count', value: 100 },
    narrative: 'One hundred cards in your ecosystem. The forest is no longer a seedling.',
  },
  {
    chapter: 2,
    entry_code: 'fastest_growth',
    name: 'The Swift Vine',
    unlock_condition: { type: 'cards_advanced_in_week', value: 30 },
    narrative:
      'Thirty cards advanced in a single week. You moved through the forest like sunlight.',
  },
  {
    chapter: 2,
    entry_code: 'first_credential',
    name: 'The First Badge',
    unlock_condition: { type: 'credential', value: 1 },
    narrative: 'Your first exam credential. Evidence, not assumption, that you have learned.',
  },
  {
    chapter: 2,
    entry_code: 'competent',
    name: 'The Competent Hand',
    unlock_condition: { type: 'credential', value: 3 },
    narrative:
      'Competence is no longer a goal but a baseline. You handle this subject with growing ease.',
  },
  {
    chapter: 2,
    entry_code: 'most_verified',
    name: 'The Certified Forest',
    unlock_condition: { type: 'verified_count', value: 25 },
    narrative:
      'Twenty-five cards have passed the exam trial. Your knowledge has been tested, not just reviewed.',
  },
  // GAP-2 FIX: two missing Chapter 2 entries from spec
  {
    chapter: 2,
    entry_code: 'highest_ks',
    name: 'The Flourishing Zone',
    unlock_condition: { type: 'subject_ks_threshold', value: 80 },
    narrative: 'One subject reached 80. That zone is no longer growing — it is thriving.',
  },
  {
    chapter: 2,
    entry_code: 'first_neglected',
    name: 'The Abandoned Corner',
    unlock_condition: { type: 'zone_state_reached', value: 'Neglected' },
    narrative: 'A zone went dark. You let it happen. The forest remembers what you ignored.',
  },
  // ── Chapter 4: Mastery (PB.19) — [DESIGN: §15.5 exact 10 entries] ───────────
  // ⚠ CORRECTED from v1.0: names, entry_codes, and unlock_conditions now match
  //   design §15.5 exactly. v1.0 had 10 different entries with wrong conditions.
  {
    chapter: 4,
    entry_code: 'first_promise',
    name: 'The First Promise',
    unlock_condition: { type: 'bubble_created', value: 1 },
    narrative: 'You made a promise to yourself with a deadline. The forest now knows your exam date.',
  },
  {
    chapter: 4,
    entry_code: 'deadline_gardener',
    name: 'The Deadline Gardener',
    // [DESIGN: §15.5] "First Bubble completed"
    unlock_condition: { type: 'bubble_first_completed' },
    narrative: 'A Mastery Bubble reached its exam date with the goal intact. The first garden kept.',
  },
  {
    chapter: 4,
    entry_code: 'gate_keeper',
    name: 'The Gate Keeper',
    // [DESIGN: §15.5] "Pass the Test Date gate (KS ≥ 60) on first attempt"
    unlock_condition: { type: 'test_date_gate_passed_first_attempt' },
    narrative: 'The checkpoint arrived and your understanding held. You passed the gate on the first try.',
  },
  {
    chapter: 4,
    entry_code: 'the_comeback',
    name: 'The Comeback',
    // [DESIGN: §15.5] "Complete a Bubble after entering RESCUE mode"
    unlock_condition: { type: 'bubble_completed_after_rescue' },
    narrative: 'You entered RESCUE mode and still closed the goal. Recovery under pressure is a different kind of mastery.',
  },
  {
    chapter: 4,
    entry_code: 'stall_breaker',
    name: 'The Stall Breaker',
    // [DESIGN: §15.5] "Resolve a stall within 7 days of detection"
    unlock_condition: { type: 'stall_resolved_within_days', value: 7 },
    narrative: 'A stall was detected. Seven days later, it was broken. You did not wait for the wall to crack on its own.',
  },
  {
    chapter: 4,
    entry_code: 'marathon_scholar',
    name: 'The Marathon Scholar',
    // [DESIGN: §15.5] "Complete a Bubble of ≥ 80 days"
    unlock_condition: { type: 'bubble_completed_long', value: 80 },
    narrative: 'Eighty days of consistent forward motion. The long game is its own form of intelligence.',
  },
  {
    chapter: 4,
    entry_code: 'the_archivist',
    name: 'The Archivist',
    // [DESIGN: §15.5] "5 Bubbles completed"
    unlock_condition: { type: 'bubbles_completed_count', value: 5 },
    narrative: 'Five mastery goals closed. The forest holds a record of every promise you kept.',
  },
  {
    chapter: 4,
    entry_code: 'debt_settled',
    name: 'Debt Settled',
    // [DESIGN: §15.5] "Clear all Learning Debt from a missed Bubble"
    unlock_condition: { type: 'debt_settled' },
    narrative: 'Every card from the missed goal has reached VERIFIED. The debt is gone. The slate is not clean — it is earned.',
  },
  {
    chapter: 4,
    entry_code: 'the_creditor',
    name: 'The Creditor',
    // [DESIGN: §15.5] "Have no active Learning Debt across all subjects"
    unlock_condition: { type: 'no_active_debt_global' },
    narrative: 'No outstanding debt across any subject. You owe yourself nothing.',
  },
  {
    chapter: 4,
    entry_code: 'cross_subject',
    name: 'Cross-Subject',
    // [DESIGN: §15.5] "Complete two overlapping Bubbles simultaneously"
    unlock_condition: { type: 'cross_bubble_both_completed' },
    narrative: 'Two goals sharing material — both completed. The overlap became a bridge, not a conflict.',
  },
  // ── Chapter 3: Storms ───────────────────────────────────────────────────────
  {
    chapter: 3,
    entry_code: 'long_streak',
    name: 'The Unbroken Chain',
    unlock_condition: { type: 'streak', value: 30 },
    narrative: 'Thirty consecutive days. You made a promise and you kept it.',
  },
  {
    chapter: 3,
    entry_code: 'most_sessions_day',
    name: 'The Storm Day',
    unlock_condition: { type: 'sessions_in_one_day', value: 3 },
    narrative: 'Three sessions in a single day. The forest felt the weight of your intention.',
  },
  {
    chapter: 3,
    entry_code: 'reckoning_survived',
    name: 'The Reckoning Survived',
    unlock_condition: { type: 'reckoning_completed', value: 1 },
    narrative:
      'You faced the Reckoning and came through the other side. The forest trusts you more now.',
  },
  {
    chapter: 3,
    entry_code: 'return_after_gap',
    name: 'The Return',
    unlock_condition: { type: 'return_after_days', value: 7 },
    narrative: 'You were away for a week and you came back. The forest waited.',
  },
  // P6.3 FIX: Added missing ks_biggest_gain and ks_biggest_drop entries (spec: Storms chapter)
  {
    chapter: 3,
    entry_code: 'ks_biggest_gain',
    name: 'The Great Surge',
    unlock_condition: { type: 'ks_gain_in_week', value: 10 },
    narrative:
      'One week, your knowledge score surged more than any other. That was a week of deep cultivation.',
  },
  {
    chapter: 3,
    entry_code: 'ks_biggest_drop',
    name: 'The Storm That Broke Branches',
    unlock_condition: { type: 'ks_drop_in_week', value: 5 },
    narrative:
      'Once, the ecosystem shook. Cards fell, stages dropped, and the forest felt it. You stayed anyway.',
  },
  {
    chapter: 3,
    entry_code: 'proficient',
    name: 'The Proficient Path',
    unlock_condition: { type: 'credential', value: 4 },
    narrative:
      'Proficiency means the path is clear even in dim light. Your knowledge guides others.',
  },
  {
    chapter: 3,
    entry_code: 'advanced',
    name: 'The Advanced Canopy',
    unlock_condition: { type: 'credential', value: 5 },
    narrative: 'You climb where most cannot reach. The air is thin but the view is vast.',
  },
  {
    chapter: 3,
    entry_code: 'expert',
    name: 'The Expert Root System',
    unlock_condition: { type: 'credential', value: 6 },
    narrative: 'Your roots run deeper than the questions. You see the soil, not just the surface.',
  },
  {
    chapter: 3,
    entry_code: 'sovereign',
    name: 'The Sovereign Tree',
    unlock_condition: { type: 'credential', value: 7 },
    narrative: 'You are the sovereign of this knowledge. The forest belongs to you.',
  },
  // ── Chapter 4: Firelight ────────────────────────────────────────────────────
  {
    chapter: 4,
    entry_code: 'night_scholar',
    name: 'The Night Scholar',
    unlock_condition: { type: 'sessions_after_midnight', value: 10 },
    narrative: 'While the world sleeps, your mind lights candles in the dark.',
  },
  {
    chapter: 4,
    entry_code: 'dawn_keeper',
    name: 'The Dawn Keeper',
    unlock_condition: { type: 'sessions_before_7am', value: 10 },
    narrative: 'You greet knowledge before the sun greets the earth. Discipline is your dawn.',
  },
  {
    chapter: 4,
    entry_code: 'unbroken',
    name: 'The Unbroken',
    unlock_condition: { type: 'consecutive_days_no_wilt', value: 30 },
    narrative: 'Thirty days without a broken focus. Your will is forged, not found.',
  },
  {
    chapter: 4,
    entry_code: 'preferred_length',
    name: 'The Steady Rhythm',
    unlock_condition: { type: 'total_sessions', value: 20 },
    narrative: 'Twenty sessions completed. A rhythm has emerged from what was once effort.',
  },
  {
    chapter: 4,
    entry_code: 'morning_learner',
    name: 'The Morning Mind',
    unlock_condition: { type: 'sessions_before_noon', value: 15 },
    narrative: 'You have given fifteen mornings to knowledge. The early hours remember you.',
  },
  // P6.3 FIX: Added missing productive_day entry (spec: most productive day of week — Firelight chapter)
  {
    chapter: 4,
    entry_code: 'productive_day',
    name: 'The Day That Bloomed',
    unlock_condition: { type: 'single_day_reviews', value: 30 },
    narrative:
      'One day, you reviewed thirty cards in a single sitting. The forest grew faster that day than any other.',
  },
  // ── P8.7: Auto-earned Chronicle Artifacts (spec P8.7) — previously missing ──────
  {
    chapter: 3,
    entry_code: 'thirty_day_gardener',
    name: 'The 30-Day Gardener',
    unlock_condition: { type: 'streak', value: 30 },
    narrative:
      'Thirty consecutive days of cultivation. The forest has learned to trust your hands.',
    is_artifact: true,
  },
  {
    chapter: 3,
    entry_code: 'century_streak',
    name: 'Century Streak',
    unlock_condition: { type: 'streak', value: 100 },
    narrative:
      'One hundred days unbroken. Most gardens grow tall in years — yours grew in months.',
    is_artifact: true,
  },
  {
    chapter: 4,
    entry_code: 'the_honest_one_artifact',
    name: 'The Honest One',
    unlock_condition: { type: 'again_greater_than_easy', min_sessions: 300 },
    narrative:
      'Three hundred sessions where truth outweighed pride. That is a rare discipline.',
    is_artifact: true,
  },
  {
    chapter: 2,
    entry_code: 'the_polymath',
    name: 'The Polymath',
    unlock_condition: { type: 'subjects_above_ks', ks_threshold: 60, min_subjects: 3 },
    narrative:
      'Three subjects flowering above 60. The forest grows wide and deep at once.',
    is_artifact: true,
  },
  // ── Chapter 5: Canopy (hidden AI discoveries — seeded locked, unlocked by D4) ──
  {
    chapter: 5,
    entry_code: 'hidden_pattern_1',
    name: '???',
    unlock_condition: {
      type: 'hidden_discovery',
      trigger: 'sessions_after_midnight',
      threshold: 12,
    },
    narrative: null, // Generated by D4 AI call on unlock
    is_ai_generated: true,
  },
  {
    chapter: 5,
    entry_code: 'hidden_pattern_2',
    name: '???',
    unlock_condition: {
      type: 'hidden_discovery',
      trigger: 'reckoning_deferred_then_passed',
      threshold: 1,
    },
    narrative: null,
    is_ai_generated: true,
  },
  {
    chapter: 5,
    entry_code: 'hidden_pattern_3',
    name: '???',
    unlock_condition: {
      type: 'hidden_discovery',
      trigger: 'same_card_reviewed_many_times',
      threshold: 25,
    },
    narrative: null,
    is_ai_generated: true,
  },
  {
    chapter: 5,
    entry_code: 'hidden_pattern_4',
    name: '???',
    unlock_condition: {
      type: 'hidden_discovery',
      trigger: 'subject_resurrected_from_neglect',
      threshold: 1,
    },
    narrative: null,
    is_ai_generated: true,
  },
];

async function seedAlmanacForUser(userId) {
const existing = await db.almanacEntries.findByUser(userId);
const existingCodes = new Set(existing.map((e) => e.entry_code));
// Upsert any new definitions not yet seeded (idempotent)
for (const def of ALMANAC_DEFINITIONS) {
if (!existingCodes.has(def.entry_code)) {
await db.almanacEntries.create(userId, def);
}
}
return db.almanacEntries.findByUser(userId);
}
// P6.5: D4 Hidden Almanac Discovery — AI-generated narrative for novel behavioral patterns

async function generateHiddenDiscovery(userId, entryCode, triggerType, behaviorContext) {
const promptMap = {
sessions_after_midnight: `The student has studied past midnight more than 12 times. They are a creature of the night hours.`,
reckoning_deferred_then_passed: `The student once deferred their Reckoning — then returned and passed it. They retreated, but they did not flee.`,
same_card_reviewed_many_times: `One card was reviewed 25+ times by the student. Some concepts are mountains you circle before you climb.`,
subject_resurrected_from_neglect: `The student resurrected a neglected subject after leaving it behind. The garden was dying — and they returned.`,
};
const behaviorLine =
promptMap[triggerType] || `A unique behavioral pattern was detected: ${triggerType}.`;
const prompt = `
ROLE
You are the Archivist of the Kiwi Forest — an ancient, observant voice who records the hidden truths of each student\'s journey. You write with quiet authority and metaphoric depth.
PATTERN OBSERVED
{behaviorLine}
ADDITIONAL CONTEXT
{JSON.stringify(behaviorContext || {})}
TASK
Write a Hidden Almanac Discovery entry for this student.
- Title: 3–6 evocative words (title case, no punctuation)
- Narrative: exactly one paragraph, 2–4 sentences, second person, metaphoric but grounded in the actual behavior
- Tone: contemplative, slightly archaic, never generic
OUTPUT FORMAT (JSON only, no markdown)
{"title": "...", "narrative": "..."}
`;
  try {
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response
      .text()
      .trim()
      .replace(/```json|```/g, '')
      .trim();
    const parsed = JSON.parse(raw);
    return { title: parsed.title || '???', narrative: parsed.narrative || null };
  } catch (e) {
    return { title: '???', narrative: null }; // Chapter 5 waits — fallback is silence
  }
}

async function checkAlmanacUnlocks(userId) {
const entries = await db.almanacEntries.findByUser(userId);
const stats = await db.userStats.get(userId);
const unlocked = [];
for (const entry of entries) {
if (entry.unlocked) continue;
let shouldUnlock = false;
let hiddenContext = {};
switch (entry.unlock_condition.type) {
case 'first_review':
shouldUnlock = (stats?.total_cards_reviewed || 0) >= 1;
break;
case 'streak':
shouldUnlock = (stats?.current_streak || 0) >= entry.unlock_condition.value;
break;
case 'stage_reached': {
const allCards = await db.cards.findAllForUser(userId);
shouldUnlock = allCards.some((c) => c.stage >= entry.unlock_condition.value);
break;
}
case 'verified_count': {
const allStates = await db.cardStates.findByUser(userId);
const verified = allStates.filter((s) => s.verified).length;
shouldUnlock = verified >= entry.unlock_condition.value;
break;
}
case 'card_count': {
const allCards = await db.cards.findAllForUser(userId);
shouldUnlock = allCards.length >= entry.unlock_condition.value;
break;
}
case 'card_review_count': {
// Check if any single card has been reviewed >= value times
const allCards = await db.cards.findAllForUser(userId);
shouldUnlock = allCards.some((c) => (c.review_count || 0) >= entry.unlock_condition.value);
break;
}
case 'again_count': {
// Use total review logs where rating === 'again'
const allLogs = await db.reviewLogs.findByUser(userId, new Date(0)).catch(() => []);
const againCount = allLogs.filter((l) => l.rating === 'again').length;
shouldUnlock = againCount >= entry.unlock_condition.value;
break;
}
case 'cards_advanced_in_week': {
const weekStart = new Date();
weekStart.setDate(weekStart.getDate() - weekStart.getDay());
weekStart.setHours(0, 0, 0, 0);
const logs = await db.reviewLogs.findByUser(userId, weekStart).catch(() => []);
const advances = logs.filter((l) => l.stage_after > l.stage_before).length;
shouldUnlock = advances >= entry.unlock_condition.value;
break;
}
case 'credential': {
const subjects = await db.subjects.findManyWithDecks(userId);
for (const sub of subjects) {
const cred = await evaluateCredential(userId, sub.id);
if (cred.tier >= entry.unlock_condition.value) {
shouldUnlock = true;
break;
}
}
break;
}
case 'sessions_after_midnight': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const count = sessions.sessions.filter((s) => {
const h = new Date(s.started_at).getHours();
return h >= 0 && h <= 2;
}).length;
shouldUnlock = count >= entry.unlock_condition.value;
break;
}
case 'sessions_before_7am': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const count = sessions.sessions.filter((s) => {
const h = new Date(s.started_at).getHours();
return h >= 4 && h < 7;
}).length;
shouldUnlock = count >= entry.unlock_condition.value;
break;
}
case 'sessions_before_noon': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const count = sessions.sessions.filter(
(s) => new Date(s.started_at).getHours() < 12
).length;
shouldUnlock = count >= entry.unlock_condition.value;
break;
}
case 'total_sessions':
shouldUnlock = (stats?.total_sessions_completed || 0) >= entry.unlock_condition.value;
break;
case 'consecutive_days_no_wilt':
shouldUnlock = (stats?.current_streak || 0) >= entry.unlock_condition.value;
break;
case 'sessions_in_one_day': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const byDay = {};
for (const s of sessions.sessions) {
const d = new Date(s.started_at).toISOString().slice(0, 10);
byDay[d] = (byDay[d] || 0) + 1;
}
shouldUnlock = Object.values(byDay).some((c) => c >= entry.unlock_condition.value);
break;
}
case 'reckoning_completed': {
const reckonings = await db.reckoningSessions.findByUser(userId).catch(() => []);
shouldUnlock =
reckonings.filter((r) => r.status === 'completed').length >= entry.unlock_condition.value;
break;
}
case 'return_after_days': {
// Check if user has a login gap >= value days in their history
const userDoc = await db.users.findById(userId).catch(() => null);
if (userDoc?.last_login_at && userDoc?.previous_login_at) {
const gap =
(new Date(userDoc.last_login_at) - new Date(userDoc.previous_login_at)) / 86400000;
shouldUnlock = gap >= entry.unlock_condition.value;
}
break;
}
case 'archive_expansion_owned': {
const inv = await db.userInventory.getItem(userId, 'archive_expansion');
shouldUnlock = inv && inv.unlocked;
break;
}
case 'seedlings_balance':
shouldUnlock = (stats?.seedlings_balance || 0) >= entry.unlock_condition.value;
break;
// P6.3 FIX: New condition handlers for missing entry types
case 'ks_gain_in_week': {
const subjectsForKS = await db.subjects.findManyWithDecks(userId);
for (const sub of subjectsForKS) {
const currentKS = await computeKnowledgeScore(userId, sub.id).catch(() => ({ score: 0 }));
const subStatDoc = await db.subjectStats.get(userId, sub.id).catch(() => null);
const prevKS = subStatDoc?.previous_week_ks;
if (prevKS === undefined || prevKS === null) break; // no history yet — don't unlock
if (currentKS.score - prevKS >= entry.unlock_condition.value) {
shouldUnlock = true;
break;
}
}
break;
}
case 'ks_drop_in_week': {
const subjectsForDrop = await db.subjects.findManyWithDecks(userId);
for (const sub of subjectsForDrop) {
const currentKS = await computeKnowledgeScore(userId, sub.id).catch(() => ({ score: 0 }));
const subStatDoc = await db.subjectStats.get(userId, sub.id).catch(() => null);
const prevKS = subStatDoc?.previous_week_ks || currentKS.score;
if (prevKS - currentKS.score >= entry.unlock_condition.value) {
shouldUnlock = true;
break;
}
}
break;
}
case 'single_day_reviews': {
const allLogsForDay = await db.reviewLogs.findByUser(userId, new Date(0)).catch(() => []);
const dayCountMap = {};
for (const log of allLogsForDay) {
const d = new Date(log.reviewed_at).toISOString().slice(0, 10);
dayCountMap[d] = (dayCountMap[d] || 0) + 1;
}
shouldUnlock = Object.values(dayCountMap).some((c) => c >= entry.unlock_condition.value);
break;
}
// P8.7b: The Honest One — again count > easy count across min_sessions (spec P8.7)
case 'again_greater_than_easy': {
const minSessions = entry.unlock_condition.min_sessions || 300;
const totalSessionsDone = stats?.total_sessions_completed || 0;
if (totalSessionsDone < minSessions) break;
const allLogsHonest = await db.reviewLogs
.findByUser(userId, new Date(0))
.catch(() => []);
const againCnt = allLogsHonest.filter(
(l) => l.response === 'again' || l.rating === 'again'
).length;
const easyCnt = allLogsHonest.filter(
(l) => l.response === 'easy' || l.rating === 'easy'
).length;
shouldUnlock = againCnt > easyCnt;
break;
}
// P8.7b: The Polymath — N subjects with KS >= threshold (spec P8.7)
case 'subjects_above_ks': {
const threshold = entry.unlock_condition.ks_threshold || 60;
const needed = entry.unlock_condition.min_subjects || 3;
const allSubjectsKS = await db.subjects.findManyWithDecks(userId);
let subjectsAbove = 0;
for (const sub of allSubjectsKS) {
const ksData = await computeKnowledgeScore(userId, sub.id).catch(() => ({ score: 0 }));
if (ksData.score >= threshold) subjectsAbove++;
if (subjectsAbove >= needed) break; // short-circuit
}
shouldUnlock = subjectsAbove >= needed;
break;
}
// P6.5: Hidden discovery conditions — Chapter 5 AI-generated entries
case 'hidden_discovery': {
const trigger = entry.unlock_condition.trigger;
const threshold = entry.unlock_condition.threshold || 1;
if (trigger === 'sessions_after_midnight') {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const count = sessions.sessions.filter(
(s) => new Date(s.started_at).getHours() <= 2
).length;
if (count >= threshold) {
shouldUnlock = true;
hiddenContext = { count };
}
} else if (trigger === 'reckoning_deferred_then_passed') {
const reckonings = await db.reckoningSessions.findByUser(userId).catch(() => []);
const deferredAndPassed = reckonings.filter(
(r) => r.was_deferred && r.status === 'completed'
);
if (deferredAndPassed.length >= threshold) {
shouldUnlock = true;
hiddenContext = { count: deferredAndPassed.length };
}
} else if (trigger === 'same_card_reviewed_many_times') {
const allCards = await db.cards.findAllForUser(userId);
const mostReviewed = allCards.reduce(
(max, c) => ((c.review_count || 0) > (max.review_count || 0) ? c : max),
{}
);
if ((mostReviewed.review_count || 0) >= threshold) {
shouldUnlock = true;
hiddenContext = { card: mostReviewed.front, count: mostReviewed.review_count };
}
} else if (trigger === 'subject_resurrected_from_neglect') {
const subjects = await db.subjects.findManyWithDecks(userId);
for (const sub of subjects) {
const subStat = await db.subjectStats.get(userId, sub.id).catch(() => null);
if (subStat?.was_neglected_then_resumed) {
shouldUnlock = true;
hiddenContext = { subject: sub.name };
break;
}
}
}
break;
}
case 'subject_ks_threshold': {
// FIX-5: Unlock when any subject's Knowledge Score meets or exceeds threshold.
// unlock_condition = { type: 'subject_ks_threshold', value: <0-100> }
const ksThreshold = entry.unlock_condition.value;
const allSubjectsForKS = await db.subjects.findManyWithDecks(userId);
for (const sub of allSubjectsForKS) {
const ksData = await computeKnowledgeScore(userId, sub.id).catch(() => ({ score: 0 }));
if (ksData.score >= ksThreshold) { shouldUnlock = true; break; }
}
break;
}
case 'zone_state_reached': {
// FIX-6: Unlock when any Biome zone reaches the specified zone_state string.
// unlock_condition = { type: 'zone_state_reached', value: 'Neglected' | 'Thriving' | ... }
const targetZoneState = entry.unlock_condition.value;
const subjectsForZone = await db.subjects.findManyWithDecks(userId);
for (const sub of subjectsForZone) {
const subStat = await db.subjectStats.get(userId, sub.id).catch(() => null);
if (subStat && subStat.zone_state === targetZoneState) { shouldUnlock = true; break; }
}
break;
}
} // close switch (entry.unlock_condition.type)
if (shouldUnlock) {
let narrative = entry.narrative;
let entryName = entry.name;
// P6.5: For Chapter 5 AI entries, generate narrative via D4
if (entry.is_ai_generated) {
const discovery = await generateHiddenDiscovery(
userId,
entry.entry_code,
entry.unlock_condition.trigger,
hiddenContext
);
if (discovery.narrative) {
narrative = discovery.narrative;
entryName = discovery.title;
} else {
continue; // Chapter 5 waits — do not unlock without AI narrative
}
}
await db.almanacEntries.unlock(userId, entry.entry_code, narrative);
// Update name if AI-generated
if (entry.is_ai_generated && entryName !== '???') {
const snap = await firestore
.collection('almanac_entries')
.where('user_id', '==', userId)
.where('entry_code', '==', entry.entry_code)
.limit(1)
.get();
if (!snap.empty) await snap.docs[0].ref.update({ name: entryName });
}
// Award seedlings for almanac unlock
await hookSeedlingEarnings(userId, 'almanac_unlock', { entry_code: entry.entry_code }).catch(
() => {}
);
unlocked.push(entry.entry_code);
}
}
return unlocked;
}
// ── personaService ────────────────────────────────────────────────────────────

async function generateWeeklyPersona(userId) {
const weekStart = new Date();
weekStart.setDate(weekStart.getDate() - weekStart.getDay());
weekStart.setHours(0, 0, 0, 0);
const existing = await db.userPersona.get(userId);
if (existing && new Date(existing.assigned_week_start) >= weekStart) return existing;
const stats = await db.userStats.get(userId);
// FIX-8: spec P6.6 requires last 4 weeks only
const sessions = await db.sessions.findMany(
userId,
{
session_completed: true,
started_at_gte: new Date(Date.now() - 28 * 86400000),
},
{ limit: 200 }
);
const allStates = await db.cardStates.findByUser(userId);
const ghostPct =
allStates.length > 0
? (allStates.filter((s) => s.state === CARD_STATES.GHOST).length / allStates.length) * 100
: 0;
const avgSessionTime =
sessions.sessions.length > 0
? sessions.sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) /
sessions.sessions.length
: 0;
const personas = [
{
code: 'the_tide',
label: 'The Tide',
icon: '🌊',
desc: 'You ebb and flow. Intense stretches followed by quiet — your rhythm is tidal, not daily.',
},
{
code: 'the_storm',
label: 'The Storm',
icon: '⛈️',
desc: 'You arrive suddenly and study hard. Sessions are intense, frequent, then gone — until the next front.',
},
{
code: 'the_dawn',
label: 'The Dawn',
icon: '🌄',
desc: 'You study in the early hours before the world wakes. Your focus is deep and solitary.',
},
{
code: 'the_night',
label: 'The Night',
icon: '🌙',
desc: 'The night fuels your mind. You learn when the world sleeps.',
},
{
code: 'the_specialist',
label: 'The Specialist',
icon: '🔬',
desc: 'One subject, one obsession. You go deep rather than wide.',
},
{
code: 'the_resilient',
label: 'The Resilient',
icon: '🌱',
desc: 'You stumble, but you never stop. Reckoning, gaps, hard weeks — you return every time.',
},
{
code: 'the_honest_one',
label: 'The Honest One',
icon: '🪞',
desc: 'You press Again when you should. No inflated streaks, no easy ratings. Just truth.',
},
{
code: 'the_avoider',
label: 'The Avoider',
icon: '🌫️',
desc: 'Certain cards keep getting pushed to the bottom. The pattern is known — the question is when you face it.',
},
];
let selected = personas[Math.floor(Math.random() * personas.length)];
// Rule-based fallback
const hourCounts = {};
for (const s of sessions.sessions) {
const h = new Date(s.started_at).getHours();
hourCounts[h] = (hourCounts[h] || 0) + 1;
}
let maxHour = -1,
maxCount = 0;
for (const [h, c] of Object.entries(hourCounts)) {
if (c > maxCount) {
maxCount = c;
maxHour = parseInt(h);
}
}
if (maxHour >= 4 && maxHour < 7)
selected = personas.find((p) => p.code === 'the_dawn') || selected;
else if (maxHour >= 0 && maxHour <= 2)
selected = personas.find((p) => p.code === 'the_night') || selected;
else if (avgSessionTime > 600) selected = personas.find((p) => p.code === 'the_tide') || selected;
else if (avgSessionTime < 180)
selected = personas.find((p) => p.code === 'the_storm') || selected;
else if (ghostPct < 5) selected = personas.find((p) => p.code === 'the_honest_one') || selected;
// B14: Full AI-driven classification with extensive behavioral data
try {
const verifiedCards = allStates.filter((s) => s.verified).length;
const stuckCards = allStates.filter((s) => s.state === 'STUCK').length;
const avoidedCards = allStates.filter((s) => s.state === 'AVOIDED').length;
const subjectCount = (await db.subjects.findManyWithDecks(userId)).length;
const totalMastered = stats?.total_cards_mastered || 0;
const reckonings = await db.reckoningSessions.findByUser(userId).catch(() => []);
const shieldsUsed = (stats?.streak_shields_earned || 0) - (stats?.streak_shields_held || 0);
const prompt = `
ROLE
You are a behavioral learning analyst who classifies students into precise study personas.
BEHAVIORAL DATA
- Total sessions completed: ${sessions.sessions.length}
- Average session duration (seconds): ${Math.round(avgSessionTime)}
- Longest single session: ${Math.max(0, ...sessions.sessions.map((s) => s.duration_seconds || 0))}s
- Ghost card %: ${ghostPct.toFixed(1)}
- Avoided cards count: ${avoidedCards}
- Verified (exam-tested) cards: ${verifiedCards}
- Stuck cards: ${stuckCards}
- Current streak: ${stats?.current_streak || 0}
- Total XP: ${stats?.total_xp || 0}
- Total cards mastered: ${totalMastered}
- Number of subjects: ${subjectCount}
- Peak study hour: ${maxHour >= 0 ? maxHour + ':00' : 'unknown'}
- Fruitings achieved: ${sessions.sessions.filter((s) => s.fruiting_achieved).length}
- Reckonings faced: ${reckonings.length} (survived: ${reckonings.filter((r) => r.status === 'completed').length})
- Streak shields used: ${shieldsUsed}
PERSONAS AVAILABLE
${personas.map((p) => p.code + ': ' + p.desc).join('\n')}
INSTRUCTIONS
Analyse the behavioral data holistically. Select the ONE persona code that best describes this student\'s dominant pattern.
Return ONLY the persona code — no explanation, no punctuation.
`;
    const result = await geminiModel.generateContent(prompt);
    const code = result.response.text().trim().toLowerCase();
    const found = personas.find((p) => p.code === code);
    if (found) selected = found;
  } catch (e) {
    // keep rule-based selection from above
  }
  const persona = await db.userPersona.create(userId, {
    persona_code: selected.code,
    persona_label: selected.label,
    persona_icon: selected.icon,
    persona_description: selected.desc,
    assigned_week_start: weekStart,
  });
  return persona;
}
// ── weeklyAnchor ──────────────────────────────────────────────────────────────

async function getWeeklyAnchor(userId) {
// M-7 FIX: Rate limit moved below cache check — should gate Gemini only, not cached reads
const now = new Date();
const weekStart = new Date(now);
// H-7 FIX: Monday-based week key — aligns with Chronicle (FIX-10) and spec week definition
weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
weekStart.setHours(0, 0, 0, 0);
const weekStr = weekStart.toISOString().split('T')[0];
// P6.7 FIX: Return cached anchor if it exists for this week
const cached = await db.dailyRitualCache.get(userId, 'weekly_anchor', weekStr).catch(() => null);
if (cached) return cached;
// P6.7 FIX: Gather spec-required inputs for C2 AI call
const subjects = await db.subjects.findManyWithDecks(userId).catch(() => []);
const pressures = await db.brainPressure.findByUser(userId).catch(() => []);
// Subject with biggest KS-to-credential gap
let biggestGapSubject = null;
let biggestGap = -1;
for (const sub of subjects) {
try {
const ks = await computeKnowledgeScore(userId, sub.id);
const cred = await evaluateCredential(userId, sub.id);
// Normalize: KS is 0-100, credential tier is 0-7 (scaled to 0-100)
const credNormalized = (cred.tier / 7) * 100;
const gap = ks.score - credNormalized;
if (gap > biggestGap) {
biggestGap = gap;
biggestGapSubject = { name: sub.name, ks: ks.score, credential: cred.name };
}
} catch (e) {}
}
// Highest pressure subject
const highestPressure = pressures.sort(
(a, b) => (b.pressure_score || 0) - (a.pressure_score || 0)
)[0];
const highPressureSubject = highestPressure
? subjects.find((s) => s.id === highestPressure.subject_id)?.name || 'Unknown'
: null;
// Previous anchor for continuity
const prevAnchorCache = await db.dailyRitualCache
.get(userId, 'weekly_anchor', 'prev')
.catch(() => null);
const prevAnchorText = prevAnchorCache?.anchor_text || null;
// This week's chronicle
const latestChronicle = await db.chronicleEntries.findLatest(userId).catch(() => null);
// P6.7 FIX: Gemini C2 call
// M-7 FIX: Rate limit applied here only — after cache check, so cached value always served
let anchorText;
try {
if (checkAIRateLimit(userId, 'weekly_anchor', 5)) {
throw new Error('AI_RATE_LIMITED');
}
const prompt = `
ROLE
You are The Brain of the Kiwi ecosystem — an advisor who provides a single weekly focus directive. You are precise, direct, and never vague.
INPUTS
Subject with biggest KS-to-credential gap: ${biggestGapSubject ? `${biggestGapSubject.name} (KS: ${biggestGapSubject.ks.toFixed(1)}, Credential: ${biggestGapSubject.credential})` : 'None'}
Highest pressure subject: {highPressureSubject || 'None'} (pressure: {highestPressure?.pressure_score || 0})
Previous week's anchor: {prevAnchorText || 'None'}
This week's Chronicle excerpt: {latestChronicle ? (latestChronicle.narrative || '').slice(0, 200) : 'None'}
TASK
Write exactly 3 sentences naming the single most important focus for this week.
- Sentence 1: Name the subject and the specific gap or pressure to address.
- Sentence 2: Give a concrete, actionable target (e.g., "Take 2 exams this week" or "Review 20 STUCK cards before Thursday").
- Sentence 3: One sentence of honest encouragement — not generic.
Tone: direct, confident, warm.
Return only the 3 sentences.
`;
    const result = await geminiModel.generateContent(prompt);
    anchorText = result.response.text().trim();
  } catch (_) {
    // P6.7 Fallback: derived from highest-pressure subject or KS gap
    if (biggestGapSubject) {
      anchorText = `This week: close the gap in ${biggestGapSubject.name}. Your KS is ${biggestGapSubject.ks.toFixed(0)} but your credential hasn\'t caught up — take an exam. Every verified card is evidence, not assumption.`;
    } else if (highPressureSubject) {
      anchorText = `This week: address the pressure building in ${highPressureSubject}. Review the flagged cards before the Brain escalates. Pressure is not failure — it is a signal.`;
    } else {
      anchorText =
        'This week: one consistent session every day. The forest grows by showing up, not by intensity alone.';
    }
  }
  // P6.7 FIX: Persist to daily_ritual_cache (keyed by weekStr so it lasts all week)
  const anchorPayload = {
    week: weekStr,
    anchor_text: anchorText,
    generated_at: new Date().toISOString(),
    focus_subject: biggestGapSubject?.name || highPressureSubject || null,
  };
  await db.dailyRitualCache.set(userId, 'weekly_anchor', weekStr, anchorPayload).catch(() => {});
  // Also store under 'prev' for next week's continuity
  await db.dailyRitualCache.set(userId, 'weekly_anchor', 'prev', anchorPayload).catch(() => {});
  return anchorPayload;
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 7 — Daily Ritual

// ════════════════════════════════════════════════════════════════════════════
// ── Morning Brief (A1) ──────────────────────────────────────────────────────

async function getMorningBrief(userId) {
const todayStr = new Date().toISOString().split('T')[0];
const cached = await db.dailyRitualCache.get(userId, 'morning_brief', todayStr);
if (cached) return cached.data;
const stats = await db.userStats.get(userId);
const subjects = await db.subjects.findManyWithDecks(userId);
const now = new Date();
const dueCards = [];
for (const sub of subjects) {
const decks = await db.decks.findBySubject(userId, sub.id);
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id);
dueCards.push(...cards.filter((c) => isCardDue(c, now)));
}
}
const pressureList = await db.brainPressure.findByUser(userId);
const maxPressure =
pressureList.length > 0
? pressureList.reduce(
(max, p) => (p.pressure_score > max.pressure_score ? p : max),
pressureList[0]
)
: null;
const allBriefStates = await db.cardStates.findByUser(userId);
const briefDangerous = allBriefStates.filter((s) => s.state === 'DANGEROUS').length;
const briefGhost = allBriefStates.filter((s) => s.state === 'GHOST').length;
const briefStuck = allBriefStates.filter((s) => s.state === 'STUCK').length;
const activeReckForBrief = await db.reckoningSessions.findActiveByUser(userId);
const recentAchievements = await db.userAchievements.findManyWithAchievement(userId);
const newAchievementsToday = recentAchievements
.filter((ua) => ua.unlocked_at && daysSince(ua.unlocked_at) < 1)
.map((ua) => ua.achievement?.name || '')
.filter(Boolean)
.slice(0, 2);
// P7.1 FIX: Add missing spec inputs — shields, verified this week, neglected subjects, exam dates
const shieldsHeld = stats?.streak_shields_held || 0;
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const verifiedThisWeek = allBriefStates.filter(
(s) => s.state === 'VERIFIED' && s.verified_at && new Date(s.verified_at) >= weekAgo
).length;
const neglectedSubjects = [];
const upcomingExams = [];
const perSubjectKSLines = [];
for (const sub of subjects) {
const subStats = await db.subjectStats.get(userId, sub.id).catch(() => null);
if (subStats?.last_session_date) {
const daysSinceSession = daysSince(subStats.last_session_date);
if (daysSinceSession >= 14) neglectedSubjects.push(sub.name);
}
if (sub.exam_date) {
const daysToExam = Math.ceil((new Date(sub.exam_date) - now) / (1000 * 60 * 60 * 24));
// H-2 FIX: Align exam collection window to 7 days — matches prompt rule ("within 7 days")
if (daysToExam >= 0 && daysToExam <= 7) {
upcomingExams.push(`${sub.name} in ${daysToExam}d`);
}
}
// H-1 FIX: Per-subject KS for prompt
const subKS = await computeKnowledgeScore(userId, sub.id).catch(() => ({ score: 0 }));
perSubjectKSLines.push(`${sub.name}: ${Math.round(subKS.score)}`);
}
// H-1 FIX: Global KS
const globalKSForBrief = await computeKnowledgeScore(userId).catch(() => ({ score: 0, band: 'Seed' }));
// H-1 FIX: Yesterday's session summary
const yesterdayForBrief = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const yesterdaySessionsResult = await db.sessions
.findMany(userId, { session_completed: true, started_at_gte: yesterdayForBrief }, { limit: 20 })
.catch(() => ({ sessions: [] }));
const yesterdayCards = (yesterdaySessionsResult.sessions || [])
.reduce((sum, s) => sum + (s.cards_reviewed || 0), 0);
const yesterdaySummary = yesterdayCards > 0
? `Reviewed ${yesterdayCards} cards across ${yesterdaySessionsResult.sessions.length} session(s)`
: 'No completed sessions yesterday';
// H-1 FIX: Subjects with 5+ STUCK or AVOIDED cards (spec: "subjects with 5+ STUCK/AVOIDED cards")
const stuckCountBySubject = {};
const avoidedCountBySubject = {};
for (const st of allBriefStates) {
if (st.state === 'STUCK') stuckCountBySubject[st.subject_id] = (stuckCountBySubject[st.subject_id] || 0) + 1;
if (st.state === 'AVOIDED') avoidedCountBySubject[st.subject_id] = (avoidedCountBySubject[st.subject_id] || 0) + 1;
}
const urgentStagnantSubjects = subjects
.filter(s => ((stuckCountBySubject[s.id] || 0) + (avoidedCountBySubject[s.id] || 0)) >= 5)
.map(s => `${s.name} (${(stuckCountBySubject[s.id] || 0) + (avoidedCountBySubject[s.id] || 0)} stagnant)`);
// H-1 FIX: Last Reckoning result
const allReckoningsForBrief = await db.reckoningSessions.findByUser(userId).catch(() => []);
const lastFinishedReckoning = allReckoningsForBrief
.find(r => r.status === 'completed' || r.status === 'failed');
const lastReckoningLine = lastFinishedReckoning
? `${lastFinishedReckoning.status === 'completed' ? 'Survived' : 'Failed'} Reckoning in ${lastFinishedReckoning.subject_name || 'a subject'} (score: ${lastFinishedReckoning.score_pct || 0}%)`
: 'None';
  // PB.17: Gather bubble context for morning brief [DESIGN: §15.3, §16.3]
  let bubbleContext = '';
  try {
    const activeBubbles = await db.masteryGoals.findActive(userId);
    if (activeBubbles.length > 0) {
      const bubbleLines = activeBubbles.map((g) => {
        const daysToExam = g.exam_date
          ? Math.max(0, Math.ceil((new Date(g.exam_date) - new Date()) / 86400000))
          : '?';
        const contractInfo = g.daily_contract_cards
          ? `${g.daily_contract_cards} cards (${g.daily_contract_minutes || '?'} min)`
          : 'contract pending';
        return `  - ${g.name || g.subject_id}: ${g.phase} phase, KS=${(g.current_ks || 0).toFixed(1)}, ` +
               `${g.trajectory_status}, ${daysToExam}d to exam, today: ${contractInfo}`;
      });
      const stallWarnings = activeBubbles
        .filter((g) => g.stall_active)
        .map((g) => `  ⚠ STALL in ${g.name || g.subject_id}: ${g.stall_cause || 'diagnosing'}`);
      bubbleContext = '\nACTIVE MASTERY GOALS\n' + bubbleLines.join('\n');
      if (stallWarnings.length > 0) {
        bubbleContext += '\nSTALL ALERTS\n' + stallWarnings.join('\n');
      }
    }
  } catch (_e) { /* non-fatal — morning brief works without bubble context */ }
const prompt = `
ROLE
You are the KIWI Morning Guide — a warm, personalised narrator who delivers a 3-sentence daily briefing directly to the student in second person (you/your).
INPUT
- Global Knowledge Score: {Math.round(globalKSForBrief.score)} / 100 ({globalKSForBrief.band || 'Seed'})
- Per-subject KS: {perSubjectKSLines.join(' | ') || 'none'}
- Streak: {stats?.current_streak || 0} days (shields held: {shieldsHeld})
- Due cards today: {dueCards.length}
- Total subjects: {subjects.length}
- Dangerous cards (exam urgent): {briefDangerous}
- Ghost cards (dormant): {briefGhost}
- Stuck cards: {briefStuck}
- Cards verified this week: {verifiedThisWeek}
- Subjects with 5+ stagnant cards: {urgentStagnantSubjects.join(', ') || 'none'}
- Neglected subjects (14+ days idle): {neglectedSubjects.join(', ') || 'none'}
- Upcoming exams (within 7 days): {upcomingExams.join(', ') || 'none'}
- Yesterday's activity: {yesterdaySummary}
- Highest pressure subject: {maxPressure ? maxPressure.intervention_level + ' (' + maxPressure.pressure_score + ' pts)' : 'None'}
- Active Reckoning: {activeReckForBrief ? 'YES — ' + activeReckForBrief.subject_name : 'None'}
- Last Reckoning result: {lastReckoningLine}
- Achievements unlocked today: {newAchievementsToday.join(', ') || 'none'}
{bubbleContext}
RULES
- Exactly 3 sentences. Always address the student directly in second person (you/your). Never write in third person.
- Sentence 1: Greeting + due-card count; mention dangerous/ghost cards or upcoming exams if present.
- Sentence 2: If active Reckoning, warn about it. If upcoming exam within 7 days, name it. Otherwise name the highest-pressure or most stagnant subject.
- Sentence 3: One specific, actionable encouragement naming a concrete next step tied to the data above.
- If new achievements were earned today, weave one in naturally.
- Never mention "AI", "algorithm", or technical terms.
- Tone: warm, slightly mystical, concise.
OUTPUT
Return only the 3 sentences.
`;
  let brief;
  try {
    const result = await geminiModel.generateContent(prompt);
    brief = result.response.text().trim();
  } catch (e) {
    // P7.1 FIX: Richer fallback using the new context
    const examWarn = upcomingExams.length > 0 ? ` ${upcomingExams[0]} exam approaching.` : '';
    brief = `Good morning. You have ${dueCards.length} cards waiting today.${examWarn} Step into the clearing and begin with the one that calls to you.`;
  }
  await db.dailyRitualCache.set(userId, 'morning_brief', todayStr, { data: brief });
  return brief;
}
// ── Daily Invitations (A2) ─────────────────────────────────────────────────

// P7-01 FIX: helper to derive visible action label from action_type
function invitationActionLabel(actionType) {
if (actionType === 'exam') return 'Enter Exam Hall →';
if (actionType === 'review_specific_cards') return 'Review These Cards →';
return 'Start Study Session →';
}

async function getDailyInvitations(userId) {
const todayStr = new Date().toISOString().split('T')[0];
const cached = await db.dailyRitualCache.get(userId, 'daily_invitations', todayStr);
if (cached) return cached.data;
const subjects = await db.subjects.findManyWithDecks(userId);
const pressureList = await db.brainPressure.findByUser(userId);
// B15: AI-generated invitations with specific card names and situations
const invitations = [];
// Gather rich context for AI
const activeReckoning = await db.reckoningSessions.findActiveByUser(userId);
const allCardStatesForInv = await db.cardStates.findByUser(userId);
const dangerousCardStates = allCardStatesForInv
.filter((s) => s.state === 'DANGEROUS')
.slice(0, 3);
const ghostCardStates = allCardStatesForInv.filter((s) => s.state === 'GHOST').slice(0, 3);
const stuckCardStates = allCardStatesForInv.filter((s) => s.state === 'STUCK').slice(0, 3);
// Resolve card front texts for named cards
async function getCardFronts(states, limit = 2) {
const names = [];
for (const st of states.slice(0, limit)) {
try {
const c = await db.cards.findById(userId, st.card_id);
if (c) names.push(`"${(c.front_content || '').slice(0, 60)}"`);
} catch (e) {}
}
return names;
}
const dangerousFronts = await getCardFronts(dangerousCardStates);
const ghostFronts = await getCardFronts(ghostCardStates);
const stuckFronts = await getCardFronts(stuckCardStates);
// H-5 FIX: Load recently dismissed invitations — spec input "yesterday's dismissed invitations"
const yesterdayStrForDismiss = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const dismissHistoryDoc = await db.dailyRitualCache
.get(userId, 'dismissal_history', 'persistent')
.catch(() => null);
const recentDismissedLines = ((dismissHistoryDoc?.data) || [])
.filter(d => d.date >= yesterdayStrForDismiss)
.map(d => {
const subName = d.subject_id
? (subjects.find(s => s.id === d.subject_id)?.name || d.subject_id)
: null;
return subName ? `${d.action_type} for ${subName}` : d.action_type;
});
const dismissedContext = recentDismissedLines.length > 0
? recentDismissedLines.join(', ')
: 'none';
const maxPressure =
pressureList.length > 0
? pressureList.reduce(
(max, p) => (p.pressure_score > max.pressure_score ? p : max),
pressureList[0]
)
: null;
const highPressureSubject = maxPressure
? subjects.find((s) => s.id === maxPressure.subject_id)
: null;
// G6: Gather at-risk Bubble context for Bubble-specific invitations [DESIGN: §15.2, §15.3]
let urgentBubbles = [];
let bubblePromptContext = '';
try {
  const activeBubbles = await db.masteryGoals.findActive(userId).catch(() => []);
  urgentBubbles = activeBubbles.filter((b) =>
    ['BEHIND', 'CRITICAL', 'RESCUE'].includes(b.trajectory_status) || b.stall_active
  );
  if (urgentBubbles.length > 0) {
    const lines = urgentBubbles.map((b) => {
      const daysToExam   = b.exam_date
        ? Math.max(0, Math.ceil((new Date(b.exam_date) - new Date()) / 86400000))
        : '?';
      const contractInfo = b.daily_contract_cards
        ? `${b.daily_contract_cards} cards due (${b.daily_contract_minutes || '?'} min)`
        : 'contract pending';
      const stallNote    = b.stall_active
        ? `, STALL active (${b.stall_cause || 'diagnosing'})`
        : '';
      return `  - "${b.name || 'Exam Goal'}": ${b.trajectory_status}, ${daysToExam}d to exam, ${contractInfo}${stallNote}`;
    });
    bubblePromptContext = '\n- Exam goals behind pace (must be mentioned in at least one invitation):\n' +
      lines.join('\n');
  }
} catch (_e) { /* non-fatal — invitations work without Bubble context */ }
// P7.2 FIX: Reckoning invitation always first if active — updated to spec shape
if (activeReckoning) {
invitations.push({
title: 'The Reckoning Awaits',
context: `${activeReckoning.flagged_card_count} cards have been flagged in ${activeReckoning.subject_name}. The forest holds its breath.`,
action_type: 'exam',
subject_id: activeReckoning.subject_id || null,
card_ids: [],
dismissed: false,
action: invitationActionLabel('exam'),
});
}
// AI generates the remaining 2 (or 3 if no reckoning) invitations
const needed = 3 - invitations.length;
try {
// P7.2 FIX: Updated prompt to request spec-compliant shape and action_types
const aiPrompt = `
ROLE
You are KIWI\'s invitation generator. Create {needed} specific, motivating daily study invitations.
STUDENT CONTEXT
- Dangerous cards (exam approaching, stage 1-2): {dangerousFronts.join(', ') || 'none'}
- Ghost cards (stage 5, dormant 60+ days): {ghostFronts.join(', ') || 'none'}
- Stuck cards (no progress in 14 days): {stuckFronts.join(', ') || 'none'}
- Highest-pressure subject: {highPressureSubject?.name || 'none'}
- Total due cards: {allCardStatesForInv.filter((s) => s.state !== 'SEEDLING').length}
- Recently dismissed invitations (do not repeat these today): {dismissedContext}
{bubblePromptContext}
RULES
- Each invitation must name a SPECIFIC card or subject from the context above.
- If any exam goals are listed above as behind pace, at least one invitation MUST reference that goal by name, its contract card count, and its trajectory status.
- Invitations should feel like gentle but urgent nudges from the forest.
- action_type must be one of: study_session | exam | review_specific_cards
- title: short imperative (3-6 words). context: 1 sentence of honest urgency.
- If a subject is named, include it as target_subject_name.
- Total of {needed} invitations.
- Return ONLY valid JSON array: [{"title":"...","context":"...","action_type":"study_session|exam|review_specific_cards","target_subject_name":"..."}]
`;
    const aiResult = await geminiModel.generateContent(aiPrompt);
    // H-4 FIX: Robust JSON extraction — slice from first [ to last ] to survive preambles/fences
    const rawAiText = aiResult.response.text();
    const jsonStartIdx = rawAiText.indexOf('[');
    const jsonEndIdx = rawAiText.lastIndexOf(']');
    const aiText = (jsonStartIdx !== -1 && jsonEndIdx > jsonStartIdx)
      ? rawAiText.slice(jsonStartIdx, jsonEndIdx + 1)
      : rawAiText.replace(/```[a-zA-Z]*|```/g, '').trim();
    const aiInvs = JSON.parse(aiText);
    for (const inv of aiInvs.slice(0, needed)) {
      // H-3 FIX: Case-insensitive, trimmed matching — Gemini often returns different casing
      const targetSubject = subjects.find(
        (s) => s.name.toLowerCase() === (inv.target_subject_name || '').toLowerCase().trim()
      );
      // Resolve card_ids for review_specific_cards action type
      let cardIds = [];
      if (inv.action_type === 'review_specific_cards' && targetSubject) {
        const relevantStates = allCardStatesForInv
          .filter((s) => s.subject_id === targetSubject.id &&
            ['DANGEROUS', 'GHOST', 'STUCK', 'AVOIDED'].includes(s.state))
          .slice(0, 5);
        cardIds = relevantStates.map((s) => s.card_id);
      }
      invitations.push({
        title: inv.title || 'Tend Your Cards',
        context: inv.context || 'Your weakest cards need attention today.',
        action_type: ['study_session', 'exam', 'review_specific_cards'].includes(inv.action_type)
          ? inv.action_type
          : 'study_session',
        subject_id: targetSubject?.id || null,
        card_ids: cardIds,
        dismissed: false,
        action: invitationActionLabel(
          ['study_session', 'exam', 'review_specific_cards'].includes(inv.action_type)
            ? inv.action_type
            : 'study_session'
        ),
      });
    }
    // C-5 FIX: Pad to 3 if AI returned fewer items than needed (partial/trimmed response)
    while (invitations.length < 3) {
      invitations.push({
        title: 'Open the Forest',
        context: 'Spend 10 minutes reviewing your weakest cards. Small steps build forests.',
        action_type: 'study_session',
        subject_id: null,
        card_ids: [],
        dismissed: false,
        action: invitationActionLabel('study_session'),
      });
    }
  } catch (_) {
    // P7.2 FIX: Fallback now uses spec-compliant shape
    if (dangerousFronts.length > 0 && invitations.length < 3) {
      invitations.push({
        title: 'Danger Cards Due',
        context: `${dangerousFronts[0]} is stage 1-2 with an exam approaching. Review it now.`,
        action_type: 'review_specific_cards',
        subject_id: dangerousCardStates[0]?.subject_id || null,
        card_ids: dangerousCardStates.slice(0, 3).map((s) => s.card_id),
        dismissed: false,
        action: invitationActionLabel('review_specific_cards'),
      });
    }
    if (ghostFronts.length > 0 && invitations.length < 3) {
      invitations.push({
        title: 'A Ghost Stirs',
        context: `${ghostFronts[0]} has been dormant for 60+ days. Bring it back before it fades.`,
        action_type: 'review_specific_cards',
        subject_id: ghostCardStates[0]?.subject_id || null,
        card_ids: ghostCardStates.slice(0, 3).map((s) => s.card_id),
        dismissed: false,
        action: invitationActionLabel('review_specific_cards'),
      });
    }
    if (highPressureSubject && invitations.length < 3) {
      invitations.push({
        title: `Tend ${highPressureSubject.name}`,
        context: `Pressure is rising in ${highPressureSubject.name}. A study session will help the forest breathe.`,
        action_type: 'study_session',
        subject_id: highPressureSubject.id,
        card_ids: [],
        dismissed: false,
        action: invitationActionLabel('study_session'),
      });
    }
      // G6: Bubble-specific fallback invitation [DESIGN: §15.3]
      if (urgentBubbles.length > 0 && invitations.length < 3) {
        const ub          = urgentBubbles[0];
        const ubSubject   = subjects.find((s) => s.id === ub.subject_id);
        const statusLabel = ub.rescue_active ? 'RESCUE' : (ub.trajectory_status || 'BEHIND');
        invitations.push({
          title:       ub.stall_active ? 'Break the Stall' : `${statusLabel} — Act Now`,
          context:     ub.stall_active
            ? `"${ub.name || 'Your exam goal'}" is stalling — studying but not advancing. Complete today's ${ub.daily_contract_cards || '?'} contract cards to break it.`
            : `"${ub.name || 'Your exam goal'}" is ${statusLabel} with ${ub.daily_contract_cards || '?'} cards due today. Complete the contract to restore trajectory.`,
          action_type: 'study_session',
          subject_id:  ubSubject?.id || ub.subject_id || null,
          card_ids:    [],
          dismissed:   false,
          action:      invitationActionLabel('study_session'),
        });
      }
    while (invitations.length < 3) {
      invitations.push({
        title: 'Open the Forest',
        context: 'Spend 10 minutes reviewing your weakest cards. Small steps build forests.',
        action_type: 'study_session',
        subject_id: null,
        card_ids: [],
        dismissed: false,
        action: invitationActionLabel('study_session'),
      });
    }
  }
  await db.dailyRitualCache.set(userId, 'daily_invitations', todayStr, { data: invitations });
  return invitations;
}

async function dismissInvitation(userId, invitationIndex) {
const todayStr = new Date().toISOString().split('T')[0];
const cached = await db.dailyRitualCache.get(userId, 'daily_invitations', todayStr);
if (!cached || !cached.data) return { error: 'No invitations found' };
const invitations = cached.data;
if (invitationIndex < 0 || invitationIndex >= invitations.length) {
return { error: 'Invalid invitation index' };
}
const invitation = invitations[invitationIndex];
invitation.dismissed = true;
await db.dailyRitualCache.set(userId, 'daily_invitations', todayStr, { data: invitations });

// P7.3 FIX: Cross-day dismissal history tracking.
// Spec: if same action_type dismissed 5+ times in 2 weeks for same subject → +1 pressure on that subject.
// History stored as a rolling log in daily_ritual_cache under type 'dismissal_history', date 'persistent'.
let pressureApplied = false;
let pressureSubjectId = null;
try {
const historyDoc = await db.dailyRitualCache.get(userId, 'dismissal_history', 'persistent');
const history = historyDoc?.data || [];

    // Append this dismissal
    history.push({
      date: todayStr,
      action_type: invitation.action_type || 'unknown',
      subject_id: invitation.subject_id || null,
    });

    // Prune entries older than 14 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const pruned = history.filter((entry) => entry.date >= cutoffStr);

    // Check threshold: 5+ dismissals of same action_type for same subject in last 14 days
    if (invitation.subject_id && invitation.action_type) {
      const matchingDismissals = pruned.filter(
        (entry) =>
          entry.action_type === invitation.action_type &&
          entry.subject_id === invitation.subject_id
      ).length;

      // M-1 FIX: Exact threshold crossing only — prevents +1 stacking on every dismiss above 5
      if (matchingDismissals === 5) {
        // P7.3 FIX: +1 pressure to that specific subject only (not all subjects)
        const currentPressure = await db.brainPressure.get(userId, invitation.subject_id);
        if (currentPressure) {
          // M-2 FIX: Compute new score and level inline — don't defer to cron
          const newPressureScore = (currentPressure.pressure_score || 0) + 1;
          const newInterventionLevel =
            newPressureScore >= 20 ? 'L4' :
            newPressureScore >= 15 ? 'L3' :
            newPressureScore >= 5  ? 'L2' :
            newPressureScore >= 1  ? 'L1' : 'L0';
          await db.brainPressure.set(userId, invitation.subject_id, {
            pressure_score: newPressureScore,
            intervention_level: newInterventionLevel,
            sources: {
              ...(currentPressure.sources || {}),
              repeated_invitation_dismissal: (currentPressure.sources?.repeated_invitation_dismissal || 0) + 1,
            },
          });
          pressureApplied = true;
          pressureSubjectId = invitation.subject_id;
        }
      }
    }

    // Persist pruned history
    await db.dailyRitualCache.set(userId, 'dismissal_history', 'persistent', { data: pruned });

} catch (e) {
console.error('[KIWI] Dismissal history update failed:', e.message);
}

return {
dismissed: true,
pressure_applied: pressureApplied,
pressure_subject_id: pressureSubjectId,
};
}
// ── Return Greeting (A3) ────────────────────────────────────────────────────

async function getReturnGreeting(userId) {
const status = await computeReturnStatus(userId);
if (status.status === 'active') return null;
// C-2 FIX: Cache enforcement — generate once per absence period, never on every page load
const greetingTodayStr = new Date().toISOString().split('T')[0];
const cachedGreeting = await db.dailyRitualCache
.get(userId, 'return_greeting', greetingTodayStr)
.catch(() => null);
if (cachedGreeting?.data?.greeting) return cachedGreeting.data;
// P7.4 FIX: Gather rich context — spec requires overdue count, KS decay, pressure, upcoming exams
const now = new Date();
const subjects = await db.subjects.findManyWithDecks(userId).catch(() => []);
let overdueCount = 0;
const upcomingExamsForReturn = [];
for (const sub of subjects) {
const decks = await db.decks.findBySubject(userId, sub.id).catch(() => []);
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id).catch(() => []);
overdueCount += cards.filter((c) => isCardDue(c, now)).length;
}
if (sub.exam_date) {
const daysToExam = Math.ceil((new Date(sub.exam_date) - now) / (1000 * 60 * 60 * 24));
if (daysToExam >= 0 && daysToExam <= 21) {
upcomingExamsForReturn.push(`${sub.name} in ${daysToExam} days`);
}
}
}
const pressureList = await db.brainPressure.findByUser(userId).catch(() => []);
const highestPressure = pressureList.length > 0
? pressureList.reduce((max, p) => (p.pressure_score > max.pressure_score ? p : max), pressureList[0])
: null;
// Ghost cards accumulate while away — estimate KS decay exposure
const allStates = await db.cardStates.findByUser(userId).catch(() => []);
const ghostCount = allStates.filter((s) => s.state === 'GHOST').length;
const prompt = `
ROLE
You are the KIWI Return Guide. A student is returning after {status.days_since} days away.
CONTEXT (use this data — be honest and specific)
- Days absent: {status.days_since}
- Absence type: {status.status === 'abandoned' ? 'long absence (14+ days)' : 'short gap (3-13 days)'}
- Overdue cards: {overdueCount}
- Ghost cards (dormant, KS at risk): {ghostCount}
- Highest pressure subject: {highestPressure ? highestPressure.intervention_level + ' pressure' : 'none'}
- Upcoming exams: {upcomingExamsForReturn.join(', ') || 'none'}
RULES
- 1 paragraph, 2-3 sentences.
- Be honest about what was missed — name the overdue count and ghost cards if significant.
- If an exam is upcoming, name it and the days remaining.
- No guilt. No punishment. Warmth and clarity.
- Tone: honest, warm, forward-looking.
OUTPUT
Return only the greeting paragraph.
`;
  let greeting;
  try {
    const result = await geminiModel.generateContent(prompt);
    greeting = result.response.text().trim();
  } catch (e) {
    // P7.4 FIX: Richer fallback using the new context
    const examLine = upcomingExamsForReturn.length > 0
      ? ` ${upcomingExamsForReturn[0]} is approaching.`
      : '';
    if (status.status === 'abandoned') {
      greeting = `You've been away for ${status.days_since} days — ${overdueCount} cards fell overdue.${examLine} The forest waited. Come back when you're ready; one session is all it takes.`;
    } else {
      greeting = `${overdueCount} cards are waiting after your ${status.days_since}-day gap.${examLine} The clearing is still here — start with whatever feels closest.`;
    }
  }
  // C-2 FIX: Persist so subsequent loads serve cached value — prevents Gemini spam
  const greetingPayload = { greeting, status: status.status, days_since: status.days_since };
  await db.dailyRitualCache
    .set(userId, 'return_greeting', greetingTodayStr, greetingPayload)
    .catch(() => {});
  return greetingPayload;
}
// ════════════════════════════════════════════════════════════════════════════
//  BUBBLE ADVISORY + AUTOPSY (PB.15 / PB.16)  [DESIGN: §11, §16.1]
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §16.1] A5 — AI advisory with deterministic fallback
// Cached per Bubble per calendar day. Output: exactly 2 sentences. [DESIGN: §16.1]
async function generateBubbleAdvisory(userId, goal, subjectName) {
  const velocity   = computeVelocityFromGoal(goal);
  const required   = goal.required_ks_per_day || 0;
  const currentKS  = goal.current_ks || 0;
  const targetKS   = goal.target_ks || 100;
  const examDate   = goal.exam_date ? new Date(goal.exam_date) : null;
  const daysToExam = examDate
    ? Math.max(0, Math.ceil((examDate - new Date()) / 86400000))
    : '?';
  const gap        = parseFloat((required - velocity).toFixed(2));

  // GAP-S2: Enrich advisory prompt with card_state_counts + weakest_cluster [DESIGN: §16.1]
  // These three inputs are required by design — sentence 2 names the exact cluster to address.
  let _cardStateCounts  = {};
  let _weakestCluster   = null;
  let _weakestClusterKS = 0;
  try {
    const _allStates   = await db.cardStates.findByUser(userId);
    const _goalCardSet = new Set(goal.card_ids || []);
    for (const _s of _allStates) {
      if (_goalCardSet.has(_s.card_id)) {
        _cardStateCounts[_s.state] = (_cardStateCounts[_s.state] || 0) + 1;
      }
    }
    const _weakCluster = await getWeakestCluster(goal.id).catch(() => null);
    if (_weakCluster) {
      _weakestCluster   = _weakCluster.name || 'Unknown Cluster';
      _weakestClusterKS = await computeClusterKS(userId, _weakCluster).catch(() => 0);
    }
  } catch (_e) { /* non-fatal — advisory proceeds with reduced context */ }

  const _stateCountLine = Object.entries(_cardStateCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:${v}`).join(', ') || 'none';

  const prompt = `
ROLE
You are KIWI's Mastery Guide. Give an honest, concise study advisory for a student.
BUBBLE DATA
Subject: ${subjectName}
Current KS: ${currentKS.toFixed(1)} / ${targetKS}
Phase: ${goal.phase}
Trajectory: ${goal.trajectory_status}
Days to exam: ${daysToExam}
Daily velocity: ${velocity.toFixed(2)} KS/day (required: ${required.toFixed(2)})
Gap: ${gap.toFixed(2)} KS/day ${gap > 0 ? 'behind' : 'ahead'}
Stall active: ${goal.stall_active ? 'YES — cause: ' + (goal.stall_cause || 'diagnosing') : 'NO'}
Card state counts: ${_stateCountLine}
Weakest cluster: ${_weakestCluster || 'N/A'} (cluster KS: ${_weakestClusterKS.toFixed(1)})
RULES
- Exactly 2 sentences. No more, no less.
- Sentence 1: honest assessment of current situation.
- Sentence 2: one specific, actionable instruction naming exact cards or clusters.
- Tone: calm, direct, honest — not alarming, not vague.
- No bullet points. Plain prose only.
OUTPUT
Return only the 2-sentence advisory text.
`;
  try {
    const result = await geminiModel.generateContent(prompt);
    const text   = parseGeminiText(result);
    if (text && text.trim().length > 10) return text.trim();
    return buildFallbackAdvisory(goal, subjectName, daysToExam, velocity, required, gap, _weakestCluster, _weakestClusterKS);
  } catch (e) {
    return buildFallbackAdvisory(goal, subjectName, daysToExam, velocity, required, gap, _weakestCluster, _weakestClusterKS);
  }
}

// [DESIGN: §16.1] Deterministic fallback when AI call fails
// GAP-S2: fallback now accepts cluster params to match §16.1 fallback spec
function buildFallbackAdvisory(goal, subjectName, daysToExam, velocity, required, gap,
                               weakestCluster = null, weakestClusterKS = 0) {
  if (goal.trajectory_status === 'ON_TRACK') {
    return `${subjectName} is on track at ${velocity.toFixed(1)} KS/day — ahead of the ${required.toFixed(1)} required. Keep your current routine and complete today's contract cards.`;
  }
  if (goal.rescue_active) {
    return `${subjectName} is in RESCUE mode with ${daysToExam} days remaining — only the highest-priority cards matter now. Open your Daily Contract and work through every card on the list before doing anything else.`;
  }
  if (goal.trajectory_status === 'CRITICAL') {
    return `${subjectName} is critically behind — you need ${required.toFixed(1)} KS/day but are averaging ${velocity.toFixed(1)}, a gap of ${gap.toFixed(1)}. Today, prioritise every STUCK and FRAGILE card in your contract without skipping any.`;
  }
  // [DESIGN: §16.1] Fallback sentence 2 names the exact cluster [DESIGN: §16.1]
  const clusterRef = weakestCluster
    ? `Prioritise the '${weakestCluster}' cluster — it sits at ${weakestClusterKS.toFixed(0)}% mastery and is your biggest gap.`
    : 'Prioritise the STUCK and FRAGILE cards in today\'s contract to close the gap before your exam.';
  return `${subjectName} is ${gap.toFixed(1)} KS/day behind schedule. ${clusterRef}`;
}

// [DESIGN: §11] Bubble Autopsy — deterministic, 4 sections, generated 24h after Bubble closes
// ⚠ CORRECTED from v1.0: all 4 sections present, 3 specific recommendations [DESIGN: §11.2]
async function generateBubbleAutopsy(userId, goal) {
  const history        = await db.masteryGoals.getHistory(goal.id, 200).catch(() => []);
  const phaseTransitions = history.filter((h) => h.event_type === 'phase_transition');
  const stallEvents      = history.filter((h) => h.event_type === 'stall_detected');
  const stallResolved    = history.filter((h) => h.event_type === 'stall_resolved');
  const ksSnapshots      = history.filter((h) => h.event_type === 'ks_snapshot')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const contractComplete = ksSnapshots.filter((h) => h.contract_completed).length;
  const contractTotal    = ksSnapshots.length;
  const examDate   = goal.exam_date ? new Date(goal.exam_date) : null;
  const totalDays  = examDate
    ? Math.ceil((examDate - new Date(goal.created_at)) / 86400000)
    : 0;
  const finalKS    = goal.final_ks_at_deadline || goal.current_ks || 0;
  const firstKS    = ksSnapshots.length > 0 ? ksSnapshots[0].ks_at_event : 0;

  // Card analysis
  const allStatesDocs  = await db.cardStates.findByUser(userId);
  const statesByCardId = new Map(allStatesDocs.map((s) => [s.card_id, s]));
  let verifiedCount = 0;
  let debtCount     = 0;
  for (const cardId of (goal.card_ids || [])) {
    const s = statesByCardId.get(cardId);
    if (s?.state === CARD_STATES.VERIFIED) verifiedCount++;
    if (s?.learning_debt)                  debtCount++;
  }
  const totalCards = (goal.card_ids || []).length;

  // Velocity analysis for best/worst week
  const weeklyVelocities = [];
  const samples = goal.velocity_samples || [];
  for (let i = 0; i < samples.length - 6; i += 7) {
    const week = samples.slice(i, i + 7);
    weeklyVelocities.push(week.reduce((a, b) => a + b, 0) / week.length);
  }
  const bestWeekVelocity  = weeklyVelocities.length > 0 ? Math.max(...weeklyVelocities) : 0;
  const worstWeekVelocity = weeklyVelocities.length > 0 ? Math.min(...weeklyVelocities) : 0;

  // Cluster performance
  const clusters = await db.masteryGoals.getClusters(goal.id).catch(() => []);
  const clusterPerformance = await Promise.all(clusters.map(async (c) => {
    const ks = await computeClusterKS(userId, c).catch(() => 0);
    return { name: c.name, ks };
  }));
  const masteredClusters = clusterPerformance.filter((c) => c.ks >= 80).map((c) => c.name);
  const stalledClusters  = clusterPerformance.filter((c) => c.ks < 40).map((c) => c.name);

  // ── SECTION 1: Timeline [DESIGN: §11.2 Section 1] ─────────────────────────
  const section1 = {
    title:             'Timeline',
    phase_transitions: phaseTransitions.map((t) => ({
      from:  t.from_phase,
      to:    t.to_phase,
      ks:    (t.ks_at_event || 0).toFixed(1),
    })),
    stall_events:      stallEvents.map((s, i) => ({
      cause:    s.notes?.split('Cause: ')[1]?.split('.')[0] || 'Unknown',
      resolved: i < stallResolved.length,
    })),
    contract_completion_rate: contractTotal > 0
      ? parseFloat(((contractComplete / contractTotal) * 100).toFixed(1))
      : 0,
    best_week_velocity:  parseFloat(bestWeekVelocity.toFixed(2)),
    worst_week_velocity: parseFloat(worstWeekVelocity.toFixed(2)),
  };

  // ── SECTION 2: Card Analysis [DESIGN: §11.2 Section 2] ────────────────────
  const section2 = {
    title:            'Card Analysis',
    started_at_ks:    parseFloat(firstKS.toFixed(1)),
    finished_at_ks:   parseFloat(finalKS.toFixed(1)),
    ks_gain:          parseFloat((finalKS - firstKS).toFixed(1)),
    verified:         `${verifiedCount} of ${totalCards}`,
    learning_debt:    debtCount,
    mastered_clusters: masteredClusters,
    stalled_clusters:  stalledClusters,
  };

  // ── SECTION 3: What Caused the Outcome [DESIGN: §11.2 Section 3] ──────────
  let causeText = '';
  if (goal.status === 'completed') {
    const driverParts = [];
    if (section1.contract_completion_rate >= 80) driverParts.push('consistent Daily Contract completion');
    if (stallEvents.length === 0) driverParts.push('no stall events');
    if (bestWeekVelocity >= 2) driverParts.push(`strong velocity peak of ${bestWeekVelocity.toFixed(1)} KS/day`);
    causeText = driverParts.length > 0
      ? `Primary drivers of completion: ${driverParts.join('; ')}.`
      : 'Goal completed through consistent study over the full period.';
  } else if (goal.status === 'missed') {
    const longestStall = stallEvents.length > 0
      ? `GROWING phase stall (${stallEvents[0].notes?.split('Cause: ')[1]?.split('.')[0] || 'unknown cause'}) unresolved`
      : null;
    causeText = longestStall
      ? `Primary failure point: ${longestStall}. Final KS was ${finalKS.toFixed(1)} — ${(100 - finalKS).toFixed(1)} points short of the target.`
      : `Deadline reached at KS ${finalKS.toFixed(1)} — ${(100 - finalKS).toFixed(1)} points short. Insufficient study velocity in the final phase.`;
  } else {
    causeText = `Partially completed: KS reached ${finalKS.toFixed(1)} of the original 100 target. RESCUE mode narrowed the scope to 70.`;
  }
  const section3 = { title: 'What Caused the Outcome', cause: causeText };

  // ── SECTION 4: 3 Specific Data-Derived Recommendations [DESIGN: §11.2 Section 4] ─
  const recommendations = [];
  // Recommendation 1: SEEDING phase timing
  const seedingTransition = phaseTransitions.find((t) => t.to_phase === 'GROWING');
  if (seedingTransition) {
    const seedingKS = parseFloat(seedingTransition.ks_at_event || 0);
    if (seedingKS < 30) {
      recommendations.push('Your SEEDING phase ended below KS 30. Start your next bubble 2 weeks earlier to allow more coverage time before the GROWING phase begins.');
    }
  }
  // Recommendation 2: CBT and FRAGILE cards
  if (stalledClusters.length > 0) {
    recommendations.push(`Your ${stalledClusters[0]} cluster stalled — cluster_KS stayed below 40. In your next bubble, schedule a dedicated CBT exam session specifically for this cluster every 5 days during HARDENING.`);
  }
  // Recommendation 3: Best velocity reference
  if (bestWeekVelocity >= 1.5) {
    recommendations.push(`Your peak velocity was ${bestWeekVelocity.toFixed(1)} KS/day in your strongest week — you are capable of that pace. Starting your next bubble at that rate would change the outcome.`);
  }
  // Fill to 3 if needed with generic recommendations
  if (recommendations.length < 3) {
    recommendations.push(
      ...[
        `Daily Contract completion rate was ${section1.contract_completion_rate}%. Completing the contract 80%+ of days is the single strongest predictor of bubble success.`,
        `${debtCount > 0 ? `${debtCount} cards carry learning debt forward.` : 'No learning debt.'} ${debtCount > 0 ? 'Resolve them through CBT exam sessions before starting a new bubble on this subject.' : 'Maintain this by completing the FINAL phase before each exam.'}`,
      ].slice(0, 3 - recommendations.length)
    );
  }
  const section4 = { title: 'Recommendations for Next Time', items: recommendations.slice(0, 3) };

  return {
    status:    goal.status,
    final_ks:  finalKS,
    total_days: totalDays,
    section1,
    section2,
    section3,
    section4,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  BUBBLE CHRONICLE INTEGRATION (PB.18)  [DESIGN: §15.4]
// ════════════════════════════════════════════════════════════════════════════

// [DESIGN: §15.4] Bubble event types for Chronicle context.
// Called at key lifecycle moments. Stores events for weekly Chronicle generation.
// Events are stored in goal_history with a chronicle-ready format.

const BUBBLE_CHRONICLE_EVENTS = {
  BUBBLE_CREATED:       'bubble_created',
  PHASE_TRANSITION:     'phase_transition',      // already wired in updateBubbleTrajectory
  TEST_DATE_GATE_PASSED: 'test_date_gate_passed',
  TEST_DATE_GATE_FAILED: 'test_date_gate_failed', // already wired
  STALL_DETECTED:       'stall_detected',         // already wired in activateStallResponse
  STALL_RESOLVED:       'stall_resolved',         // already wired in resolveStallIfRecovered
  RESCUE_ENTERED:       'rescue_activated',       // already wired in updateBubbleTrajectory
  BUBBLE_COMPLETED:     'completed',              // already wired in closeMasteryGoal
  BUBBLE_MISSED:        'missed',                 // already wired in closeMasteryGoal
  DEBT_CLEARED:         'learning_debt_cleared',
};

// [DESIGN: §15.4] Get all bubble events for a user in a given week (for Chronicle context)
async function getBubbleEventsForChronicle(userId, weekStart, weekEnd) {
  try {
    const allGoals = await db.masteryGoals.findByUser(userId);
    const weekEvents = [];
    for (const goal of allGoals) {
      const events = await db.masteryGoals
        .getHistoryForWeek(goal.id, weekStart, weekEnd)
        .catch(() => []);
      const chronicleWorthy = [
        'bubble_created', 'phase_transition', 'test_date_gate_passed',
        'test_date_gate_failed', 'stall_detected', 'stall_resolved',
        'rescue_activated', 'completed', 'missed', 'partially_completed',
        'learning_debt_cleared',
      ];
      const filtered = events.filter((e) => chronicleWorthy.includes(e.event_type));
      if (filtered.length > 0) {
        weekEvents.push({
          bubble_id:    goal.id,
          bubble_name:  goal.name || goal.subject_id || 'Unknown',
          subject_id:   goal.subject_id,
          final_status: goal.status,
          events:       filtered.map((e) => ({
            type:  e.event_type,
            date:  e.created_at,
            notes: e.notes || '',
            ks:    e.ks_at_event,
          })),
        });
      }
    }
    return weekEvents;
  } catch (e) {
    console.error('[KIWI] getBubbleEventsForChronicle failed:', e.message);
    return [];
  }
}

// [DESIGN: §10.3] Check if all learning debt is cleared for a subject; fire Almanac event
async function checkLearningDebtCleared(userId, subjectId) {
  try {
    const allStates = await db.cardStates.findByUser(userId);
    const subjectDebt = allStates.filter((s) =>
      s.learning_debt === true && s.subject_id === subjectId
    );
    if (subjectDebt.length === 0) {
      // All debt cleared — add Chronicle event and fire Almanac check
      const missedBubbles = await db.masteryGoals.findByUser(userId, 'missed');
      for (const b of missedBubbles.filter((b) => b.subject_id === subjectId)) {
        await db.masteryGoals.addHistoryEntry(b.id, {
          event_type:  'learning_debt_cleared',
          ks_at_event:  b.current_ks || 0,
          notes:       `All learning debt cleared for subject ${subjectId}.`,
        }).catch(() => {});
      }
      // Fire Almanac check for 'Debt Settled' [DESIGN: §15.5]
      await checkAlmanacUnlocks(userId, 'debt_settled', { subjectId }).catch(() => {});
    }
  } catch (_e) { /* non-fatal */ }
}

// ── Pressure Explanation (D2) ─────────────────────────────────────────────────

async function getPressureExplanation(userId, subjectId) {
const pressure = await db.brainPressure.get(userId, subjectId);
if (!pressure || pressure.pressure_score === 0) {
  return { explanation: 'This subject is calm. No pressure detected.', sources: {} };
}
// P7.5 FIX: Cache per subject per day — spec requires this, was missing entirely
const todayStr = new Date().toISOString().split('T')[0];
const cacheKey = `pressure_${subjectId}`;
const cached = await db.dailyRitualCache.get(userId, cacheKey, todayStr).catch(() => null);
// F5-1-P: return sources from cache alongside explanation text
if (cached?.data) return { explanation: cached.data, sources: cached.sources || {} };
// H-8 FIX: Pre-translate raw source keys into plain language before injecting into prompt.
// The prompt forbids state labels (GHOST, STUCK etc.) but JSON.stringify leaks them as keys.
// F5-1-P: added 7 bubble source keys [DESIGN: §15.1] so AI prompt describes them correctly
const sourceLabelMap = {
  ghost_cards:                   'cards that have gone dormant (not reviewed in 60+ days)',
  stuck_cards:                   "cards that haven't advanced in two weeks",
  avoided_cards:                 'cards that are consistently skipped when overdue',
  fragile_cards:                 'cards never correctly answered in a practice exam',
  dangerous_cards:               'beginner-level cards with an upcoming exam',
  overdue_count:                 'overdue cards waiting for review',
  repeated_invitation_dismissal: 'repeatedly ignoring suggested study sessions',
  exam_failure:                  'a recent exam that did not go well',
  ks_decay:                      'knowledge score decay from long inactivity',
  ignored_alert:                 'a reclassification alert ignored for 3+ days',
  // PB.11 bubble sources [DESIGN: §15.1]
  bubble_drifting:  'a mastery goal slightly behind its learning trajectory',
  bubble_behind:    'a mastery goal falling behind its required pace',
  bubble_critical:  'a mastery goal critically behind — exam risk is high',
  bubble_rescue:    'RESCUE mode active — exam is near and mastery is critically low',
  test_date_gate:   'knowledge score below 60 when the checkpoint date passed',
  bubble_stall:     'a mastery goal where studying is not advancing understanding',
  learning_debt:    'unmastered cards carried forward from a missed exam goal',
};
const translatedSources = Object.entries(pressure.sources || {})
.filter(([, v]) => v > 0)
.map(([k, v]) => `${sourceLabelMap[k] || k.replace(/_/g, ' ')} (×${v})`)
.join('; ') || 'general inactivity';
const prompt = `
ROLE
You are the KIWI Pressure Interpreter. Explain why a subject has pressure in simple, warm terms.
DATA
Pressure score: {pressure.pressure_score}
Intervention level: {pressure.intervention_level}
Sources: {translatedSources}
RULES
- 3-4 sentences. (P7.5 FIX: was 2-3, spec requires 3-4)
- Sentence 1: State the pressure level and overall situation plainly.
- Sentence 2-3: Explain the PRIMARY and SECONDARY sources of pressure, naming specific card types or behaviours.
- Sentence 4: Suggest one concrete, actionable step to begin reducing pressure.
- Never use technical jargon. No state labels like GHOST or STUCK — describe them in plain language.
- Tone: caring, slightly urgent if pressure is high, calm if pressure is low.
OUTPUT
Return only the explanation text.
`;
  let explanation;
  try {
    const result = await geminiModel.generateContent(prompt);
    explanation = result.response.text().trim();
  } catch (e) {
    const sources = Object.keys(pressure.sources || {});
    // M-4 FIX: Humanise intervention level codes — users must never see "L3" or "L4"
    const fallbackLevelLabel = { L0: 'low', L1: 'mild', L2: 'moderate', L3: 'high', L4: 'critical' }[pressure.intervention_level] || 'moderate';
    explanation = `This subject is under ${fallbackLevelLabel} pressure (score: ${pressure.pressure_score}). ${sources.length > 0 ? 'The main contributors are: ' + sources.join(', ') + '.' : ''} Cards that have gone unreviewed for a long time are the most common cause. Start with a short study session focused on your most overdue material.`;
  }
  // P7.5 FIX: Persist to cache so subsequent taps today serve instantly
  // F5-1-P: also persist sources so cached responses can render labelled chips [DESIGN: §15.1]
  await db.dailyRitualCache.set(userId, cacheKey, todayStr, {
    data: explanation,
    sources: pressure.sources || {},
  }).catch(() => {});
  return { explanation, sources: pressure.sources || {} };
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 8 — Marketplace & Seedlings

// ════════════════════════════════════════════════════════════════════════════
// ── seedlingService ───────────────────────────────────────────────────────────

async function awardSeedlings(userId, amount, eventType, description) {
const stats = await db.userStats.get(userId);
if (!stats) return null;
await db.userStats.update(userId, {
seedlings_balance: { increment: amount },
});
// BUG 9 FIX: re-read stats after the atomic increment so balance_after in the
// transaction log reflects the real committed balance, not the pre-read value.
const updatedStatsAward = await db.userStats.get(userId);
await db.seedlingTransactions.create(userId, {
amount,
event_type: eventType,
description,
balance_after: updatedStatsAward?.seedlings_balance || 0,
});
return { awarded: amount, new_balance: updatedStatsAward?.seedlings_balance || 0 };
}

async function spendSeedlings(userId, amount, eventType, description) {
const stats = await db.userStats.get(userId);
if (!stats || (stats.seedlings_balance || 0) < amount) {
return { error: 'Insufficient seedlings', balance: stats?.seedlings_balance || 0 };
}
await db.userStats.update(userId, {
seedlings_balance: { increment: -amount },
});
// BUG 9 FIX: re-read stats after the atomic decrement for accurate balance_after.
const updatedStatsSpend = await db.userStats.get(userId);
await db.seedlingTransactions.create(userId, {
amount: -amount,
event_type: eventType,
description,
balance_after: updatedStatsSpend?.seedlings_balance || 0,
});
return { spent: amount, new_balance: updatedStatsSpend?.seedlings_balance || 0 };
}
// Hook into existing events

async function hookSeedlingEarnings(userId, eventType, context = {}) {
switch (eventType) {
case 'session_end':
if (context.session_completed && (context.cards_reviewed || 0) >= 10) {
await awardSeedlings(userId, 1, 'session_10_cards', 'Completed a 10+ card session');
}
// P8.1a: award Seedlings for Glowing (+2) and Thriving (+1) sessions (spec P8.1)
if (context.fruiting_achieved || context.focus_seed_stage === 'Fruiting') {
await awardSeedlings(userId, 3, 'fruition', 'Achieved focus fruiting');
} else if (context.focus_seed_stage === 'Glowing') {
await awardSeedlings(userId, 2, 'session_glowing', 'Achieved Glowing focus seed');
} else if (context.focus_seed_stage === 'Thriving') {
await awardSeedlings(userId, 1, 'session_thriving', 'Achieved Thriving focus seed');
}
break;
case 'stage_change':
if (context.new_stage === 5 && context.old_stage === 4) {
await awardSeedlings(userId, 1, 'stage_5_mastery', 'Card promoted to Stage 5');
}
break;
case 'exam_pass':
if (context.score_pct >= 80) {
await awardSeedlings(userId, 5, 'exam_pass_80', `Passed exam with ${context.score_pct}%`);
}
break;
case 'exam_perfect':
if (context.score_pct === 100) {
await awardSeedlings(userId, 10, 'exam_perfect', 'Perfect exam score');
}
break;
case 'streak_milestone':
if (context.days === 7) {
await awardSeedlings(userId, 2, 'streak_7', '7-day streak');
}
break;
case 'weekly_chronicle':
await awardSeedlings(userId, 2, 'weekly_chronicle', 'Weekly chronicle generated');
break;
case 'almanac_unlock':
await awardSeedlings(
userId,
5,
'almanac_unlock',
`Unlocked almanac entry: ${context.entry_code}`
);
break;
}
}
// ── Marketplace Catalog ──────────────────────────────────────────────────────

async function getMarketplaceCatalog(userId) {
await db.marketplaceItems.seed();
const items = await db.marketplaceItems.findAll();
const stats = await db.userStats.get(userId);
const inventory = await db.userInventory.findByUser(userId);
const enriched = [];
for (const item of items) {
const owned = inventory.find((i) => i.item_code === item.item_code);
const gate1Progress = await checkGate1Progress(userId, item.gate1_condition);
const gate2Met = (stats?.seedlings_balance || 0) >= item.gate2_seedling_cost;
enriched.push({
...item,
owned_quantity: owned?.quantity || 0,
gate1_met: gate1Progress.met,
gate1_current: gate1Progress.current, // B18
gate1_target: gate1Progress.target, // B18
// CATALOG FIX (enables NEW-L1 + NEW-L3): forward extra gate1Progress fields
// so the frontend can render the progress_note and subject diversity label.
gate1_progress_note: gate1Progress.progress_note || null,
subject_diversity_current: gate1Progress.subject_diversity_current ?? null,
subject_diversity_target: gate1Progress.subject_diversity_target ?? null,
gate2_met: gate2Met,
gate2_current: stats?.seedlings_balance || 0,
gate2_target: item.gate2_seedling_cost,
purchasable: gate1Progress.met && gate2Met,
});
}
// P8-01 FIX: wrap return with top-level seedlings_balance for reliable frontend access
return {
items: enriched,
seedlings_balance: stats?.seedlings_balance || 0,
};
}
// B18: Gate 1 progress helper — returns {met, current, target}

async function checkGate1Progress(userId, condition) {
if (!condition) return { met: true, current: null, target: null };
try {
switch (condition.type) {
case 'reckoning_survived': {
const sessions = await db.reckoningSessions.findByUser(userId);
const current = sessions.filter(
(s) => s.status === 'completed' && (s.score_pct || 0) >= 70
).length;
return { met: current >= condition.count, current, target: condition.count };
}
case 'fruition_sessions': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const current = sessions.sessions.filter((s) => s.fruiting_achieved).length;
return { met: current >= condition.count, current, target: condition.count };
}
case 'thriving_sessions_across_subjects': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const thriving = sessions.sessions.filter((s) => s.fruiting_achieved);
const current = thriving.length;
// NEW-M4 FIX (checkGate1Progress): deduplicate by subject_id, not deck_id.
// NEW-L3 FIX: expose subject_diversity_current/target so the frontend can
// show "X / 3 subjects" when the session count bar is full but item is locked.
const allSubjectsM4p = await db.subjects.findManyWithDecks(userId);
const deckToSubjectM4p = {};
for (const sub of allSubjectsM4p) {
const decksM4p = await db.decks.findBySubject(userId, sub.id);
for (const dk of decksM4p) deckToSubjectM4p[dk.id] = sub.id;
}
const uniqueSubjectsM4p = new Set(thriving.map((s) => deckToSubjectM4p[s.deck_id] || s.deck_id));
return {
met: current >= condition.count && uniqueSubjectsM4p.size >= (condition.min_subjects || 1),
current,
target: condition.count,
subject_diversity_current: uniqueSubjectsM4p.size,
subject_diversity_target: condition.min_subjects || 1,
};
}
case 'consecutive_days_no_wilt': {
const stats = await db.userStats.get(userId);
const current = stats?.current_streak || 0;
return { met: current >= condition.count, current, target: condition.count };
}
case 'sessions_after_midnight': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const current = sessions.sessions.filter((s) => {
const h = new Date(s.started_at).getHours();
return h >= 0 && h <= 2;
}).length;
return { met: current >= condition.count, current, target: condition.count };
}
case 'sessions_before_7am': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const current = sessions.sessions.filter((s) => {
const h = new Date(s.started_at).getHours();
return h >= 4 && h < 7;
}).length;
return { met: current >= condition.count, current, target: condition.count };
}
// NEW-M2 FIX: add subject_ks_and_fruiting case to checkGate1Progress.
// Was missing entirely — Archive Expansion showed a binary 0%/100% bar with
// no useful intermediate value. Returns the best subject's fruiting count
// and KS so the frontend can display dual-progress.
case 'subject_ks_and_fruiting': {
const subjectsM2 = await db.subjects.findManyWithDecks(userId);
let bestKsM2 = 0;
let bestFruitingsM2 = 0;
let metM2 = false;
for (const subM2 of subjectsM2) {
const ksM2 = await computeKnowledgeScore(userId, subM2.id);
const sessionsM2 = await db.sessions.findMany(userId, { session_completed: true }, { limit: 999 });
const subjectDecksM2 = await db.decks.findBySubject(userId, subM2.id);
const deckIdsM2 = new Set(subjectDecksM2.map((d) => d.id));
const fruitingsM2 = sessionsM2.sessions.filter(
(s) => s.fruiting_achieved && deckIdsM2.has(s.deck_id)
).length;
if (ksM2.score > bestKsM2 || (ksM2.score === bestKsM2 && fruitingsM2 > bestFruitingsM2)) {
bestKsM2 = ksM2.score;
bestFruitingsM2 = fruitingsM2;
}
if (ksM2.score >= condition.ks && fruitingsM2 >= condition.fruiting) metM2 = true;
}
return {
met: metM2,
current: bestFruitingsM2,
target: condition.fruiting,
ks_current: Math.round(bestKsM2),
ks_target: condition.ks,
};
}
// P8.3: progress display for fruition_sessions_in_subject
// BUG 6 FIX: scope to the target subject when condition.subject_id is present.
// At catalog-display time (no subject_id) the check is global — surface an
// honest progress_note so the UI can warn the user the purchase gate is per-zone.
case 'fruition_sessions_in_subject': {
const allSessP = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const allFruiting = allSessP.sessions.filter((s) => s.fruiting_achieved);
if (condition.subject_id) {
const subjectDecks = await db.decks.findBySubject(userId, condition.subject_id);
const deckIds = new Set(subjectDecks.map((d) => d.id));
const current = allFruiting.filter((s) => deckIds.has(s.deck_id)).length;
return { met: current >= condition.count, current, target: condition.count };
}
// Catalog view — no subject context yet; report global total with note
const current = allFruiting.length;
return {
met: current >= condition.count,
current,
target: condition.count,
progress_note: 'Shown across all subjects; purchase gate will be checked per zone',
};
}
default:
return { met: await checkGate1Condition(userId, condition), current: null, target: null };
}
} catch (e) {
return { met: false, current: 0, target: null };
}
}

async function checkGate1Condition(userId, condition) {
if (!condition) return true;
switch (condition.type) {
case 'reckoning_survived': {
const sessions = await db.reckoningSessions.findByUser(userId);
const survived = sessions.filter(
(s) => s.status === 'completed' && (s.score_pct || 0) >= 70
).length;
return survived >= condition.count;
}
case 'fruition_sessions': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
return sessions.sessions.filter((s) => s.fruiting_achieved).length >= condition.count;
}
case 'thriving_sessions_across_subjects': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const thriving = sessions.sessions.filter((s) => s.fruiting_achieved);
// NEW-M4 FIX (checkGate1Condition): deduplicate by subject_id, not deck_id.
// 3 decks inside one Biology subject must count as 1 unique subject, not 3.
const allSubjectsM4c = await db.subjects.findManyWithDecks(userId);
const deckToSubjectM4c = {};
for (const sub of allSubjectsM4c) {
const decksM4c = await db.decks.findBySubject(userId, sub.id);
for (const dk of decksM4c) deckToSubjectM4c[dk.id] = sub.id;
}
const uniqueSubjectsM4c = new Set(thriving.map((s) => deckToSubjectM4c[s.deck_id] || s.deck_id));
return thriving.length >= condition.count && uniqueSubjectsM4c.size >= (condition.min_subjects || 1);
}
case 'subject_ks_and_fruiting': {
const subjects = await db.subjects.findManyWithDecks(userId);
for (const sub of subjects) {
const ks = await computeKnowledgeScore(userId, sub.id);
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
// NEW-M1 FIX: scope fruiting sessions to this subject's decks only.
// Cross-subject fruitings must not satisfy the per-subject Archive Expansion gate.
const subjectDecksM1 = await db.decks.findBySubject(userId, sub.id);
const deckIdsM1 = new Set(subjectDecksM1.map((d) => d.id));
const fruitings = sessions.sessions.filter(
(s) => s.fruiting_achieved && deckIdsM1.has(s.deck_id)
).length;
if (ks.score >= condition.ks && fruitings >= condition.fruiting) return true;
}
return false;
}
case 'sessions_after_midnight': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
return (
sessions.sessions.filter((s) => {
const h = new Date(s.started_at).getHours();
return h >= 0 && h <= 2;
}).length >= condition.count
);
}
case 'sessions_before_7am': {
const sessions = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
return (
sessions.sessions.filter((s) => {
const h = new Date(s.started_at).getHours();
return h >= 4 && h < 7;
}).length >= condition.count
);
}
case 'consecutive_days_no_wilt': {
const stats = await db.userStats.get(userId);
return (stats?.current_streak || 0) >= condition.count;
}
case 'archive_expansion_owned': {
const inv = await db.userInventory.getItem(userId, 'archive_expansion');
return !!(inv && inv.unlocked);
}
// P8.3: gate condition for Rare Flora — subject-scoped fruiting count
case 'fruition_sessions_in_subject': {
// When subjectId is available in closure (purchase context), use it;
// otherwise fall back to any-subject fruiting count for catalog display.
const allSess = await db.sessions.findMany(
userId,
{ session_completed: true },
{ limit: 999 }
);
const fruitingSessions = allSess.sessions.filter((s) => s.fruiting_achieved);
// Subject-scoped count: sessions whose deck belongs to the requested subject.
// condition.subject_id is injected at purchase time; absent = catalog view (use total).
if (condition.subject_id) {
const subjectDecks = await db.decks.findBySubject(userId, condition.subject_id);
const deckIds = new Set(subjectDecks.map((d) => d.id));
const subjectFruitings = fruitingSessions.filter((s) => deckIds.has(s.deck_id)).length;
return subjectFruitings >= condition.count;
}
return fruitingSessions.length >= condition.count;
}
default:
return false;
}
}

async function purchaseItem(userId, itemCode, subjectId = null) {
const item = await db.marketplaceItems.findByCode(itemCode);
if (!item) return { error: 'Item not found' };

// P8.8: Block reckoning_buffer purchase during an active Reckoning (spec P8.8)
if (itemCode === 'reckoning_buffer') {
const activeReckoning = await db.reckoningSessions.findActiveByUser(userId).catch(() => null);
if (activeReckoning) {
return {
error: 'Cannot purchase Reckoning Buffer during an active Reckoning',
code: 'RECKONING_ACTIVE',
};
}
}

// P8.3: for Rare Flora, inject subject_id into gate condition so per-subject count works
const gate1Condition =
item.item_code === 'rare_flora' && subjectId
? { ...item.gate1_condition, subject_id: subjectId }
: item.gate1_condition;

// BUG 8 FIX: Rare Flora is limited to one per subject zone, not one globally.
// Check per-zone ownership using a subject-scoped inventory key before purchase.
if (item.item_code === 'rare_flora') {
if (!subjectId) return { error: 'subject_id required to purchase Rare Flora for a zone' };
const subjectInventoryKey = `rare_flora_${subjectId}`;
const existingForZone = await db.userInventory.getItem(userId, subjectInventoryKey);
if ((existingForZone?.quantity || 0) >= 1) {
return { error: 'Rare Flora already owned for this zone', limit: 1, owned: 1 };
}
}

const gate1Met = await checkGate1Condition(userId, gate1Condition);
if (!gate1Met) return { error: 'Gate 1 condition not met', gate: 1 };

// P8.4a: Enforce purchase_limit — prevent repurchase of permanent items (spec P8.4)
const existingForLimit = await db.userInventory.getItem(userId, itemCode);
if (item.purchase_limit && (existingForLimit?.quantity || 0) >= item.purchase_limit) {
return {
error: 'Purchase limit reached',
limit: item.purchase_limit,
owned: existingForLimit.quantity,
};
}

const spendResult = await spendSeedlings(
userId,
item.gate2_seedling_cost,
'marketplace_purchase',
`Purchased ${item.name}`
);
if (spendResult.error) return spendResult;
// Update inventory
// BUG 8 FIX: use per-subject key for rare_flora so each zone tracks independently
const inventoryKey = (item.item_code === 'rare_flora' && subjectId)
? `rare_flora_${subjectId}`
: itemCode;
const existing = await db.userInventory.getItem(userId, inventoryKey);
const newQty = (existing?.quantity || 0) + 1;
await db.userInventory.setItem(userId, inventoryKey, {
quantity: newQty,
unlocked: true,
acquired_at: new Date(),
});

// BUG 11 FIX: Purchased artifacts must appear in Chronicle and Almanac, just like
// auto-earned artifacts. Call checkAlmanacUnlocks after any successful artifact purchase.
if (item.category === 'artifact') {
await checkAlmanacUnlocks(userId, { event: 'artifact_purchased', item_code: itemCode }).catch(
(e) => console.error('[KIWI] Almanac unlock after artifact purchase failed:', e.message)
);
}

// P8.4b + P8.5: For Deep Audit (service), auto-trigger AI call immediately.
// If Gemini fails, refund Seedlings and roll back inventory. (spec P8.4, P8.5)
if (item.item_code === 'deep_audit') {
if (!subjectId) {
// No subject provided — purchase succeeds but audit deferred to explicit call
return {
purchased: true,
item_code: itemCode,
quantity: newQty,
balance: spendResult.new_balance,
note: 'Provide subject_id in purchase body to trigger Deep Audit immediately.',
};
}
try {
const auditResult = await generateDeepAudit(userId, subjectId);
return {
purchased: true,
item_code: itemCode,
quantity: newQty,
balance: spendResult.new_balance,
audit: auditResult,
};
} catch (auditErr) {
console.error('[KIWI] Deep Audit AI failed after purchase — refunding:', auditErr.message);
// P8.5: Refund Seedlings
await awardSeedlings(
userId,
item.gate2_seedling_cost,
'deep_audit_refund',
'Deep Audit AI failed — Seedlings refunded'
).catch(() => {});
// Roll back inventory quantity
await db.userInventory.setItem(userId, itemCode, {
quantity: existing?.quantity || 0,
unlocked: (existing?.quantity || 0) > 0,
acquired_at: existing?.acquired_at || null,
}).catch(() => {});
return { error: 'Audit unavailable; please retry.' };
}
}

// NEW-C1 FIX: Archive Expansion must auto-trigger applyArchiveExpansion().
// BUG 1 removed the dedicated route correctly, but the trigger was never added here.
// The purchase completed without ever archiving any cards or setting subject status.
if (item.item_code === 'archive_expansion') {
if (!subjectId) return { error: 'subject_id required to archive a subject' };
await applyArchiveExpansion(userId, subjectId).catch((e) =>
console.error('[KIWI] applyArchiveExpansion failed:', e.message)
);
}
return {
purchased: true,
item_code: itemCode,
quantity: newQty,
balance: spendResult.new_balance,
};
}
// ── Deep Audit AI (E4) ───────────────────────────────────────────────────────

async function generateDeepAudit(userId, subjectId) {
// BUG 13 FIX: db.subjects.findById is a function — always truthy. Ternary guard was dead code.
const subject = await db.subjects.findById(subjectId).catch(() => null);
const ks = await computeKnowledgeScore(userId, subjectId);
const decks = await db.decks.findBySubject(userId, subjectId);
let allCards = [];
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id);
allCards.push(...cards);
}
const stateCounts = {};
for (const s of Object.values(CARD_STATES)) stateCounts[s] = 0;
for (const card of allCards) {
let stateDoc = await db.cardStates.get(userId, card.id);
if (!stateDoc) stateDoc = await initializeCardState(userId, card.id);
stateCounts[stateDoc.state] = (stateCounts[stateDoc.state] || 0) + 1;
}
// B19: Collect front text of weakest cards for concrete analysis
const weakCardFronts = [];
for (const card of allCards) {
const st = await db.cardStates.get(userId, card.id);
if (st && ['GHOST', 'STUCK', 'FRAGILE', 'AVOIDED', 'DANGEROUS'].includes(st.state)) {
weakCardFronts.push({ state: st.state, front: (card.front_content || '').slice(0, 80) });
}
}
const weakSample = weakCardFronts.slice(0, 6);
const prompt = `
ROLE
You are the KIWI Deep Audit — a meta-cognitive analyst who produces a student-facing audit of a knowledge subject.
INPUT
Subject: ${subject?.name || 'Unknown'}
Knowledge Score: ${ks.score.toFixed(1)}/100 (${ks.band})
Total Cards: ${allCards.length}
State Distribution: ${JSON.stringify(stateCounts)}
Weakest Cards (front text sample):
${weakSample.map((w) => `  [${w.state}] ${w.front}`).join('\n') || '  (none identified)'}
RULES
- Write exactly 4 short paragraphs. // BUG 12 FIX: spec P8.5 says 3-4 paragraphs
- Paragraph 1: Overall assessment with KS context.
- Paragraph 2: Strengths — cite specific card counts for VERIFIED and STABLE states.
- Paragraph 3: Weaknesses — reference the specific card front texts above by name/concept.
// NEW-M3 FIX: removed Paragraph 5 from the numbered list — merged into
// Paragraph 4 so the rule ("Write exactly 4") and the list both say 4.
- Paragraph 4: One specific pattern observed AND one precise, actionable recommendation (e.g., "The student avoids calculation cards. Review the first 3 GHOST cards listed above.").
- Tone: analytical but warm. No jargon. No bullet points.
- Total length: 250-400 words.
OUTPUT
Return only the audit text.
`;
  let audit;
  try {
    const result = await geminiModel.generateContent(prompt);
    audit = result.response.text().trim();
  } catch (e) {
    audit = `Your ${subject?.name || 'subject'} audit shows a knowledge score of ${ks.score.toFixed(1)}. Strengths lie in stable cards. Weaknesses gather where cards are stuck or ghosted. Review the flagged cards first. Schedule a reckoning if pressure persists.`;
  }
  return {
    subject_id: subjectId,
    subject_name: subject?.name,
    audit,
    ks_score: ks.score,
    state_distribution: stateCounts,
  };
}
// ── Archive Expansion ───────────────────────────────────────────────────────

async function applyArchiveExpansion(userId, subjectId) {
const decks = await db.decks.findBySubject(userId, subjectId);
let archivedCount = 0;
for (const deck of decks) {
const cards = await db.cards.findByDeck(userId, deck.id);
for (const card of cards) {
if (card.stage === 5) {
const stateDoc = await db.cardStates.get(userId, card.id);
if (stateDoc?.verified) {
// P8.6b: Graduated 90-180 day interval — not a flat 180 (spec P8.6)
const archiveInterval = 90 + Math.floor(Math.random() * 91); // [90, 180]
await db.cards.update(userId, card.id, {
interval_days: archiveInterval,
next_review_at: new Date(Date.now() + archiveInterval * 86400000),
archived: true,
});
archivedCount++;
}
}
}
}
// P8.6a: Flag the subject document as archived so Biome can render golden zone + badge (spec P8.6)
if (archivedCount > 0) {
await db.subjects.update(userId, subjectId, {
status: 'archived',
archived: true,
archived_at: new Date(),
}).catch((e) => console.error('[KIWI] applyArchiveExpansion subject flag failed:', e.message));
await db.subjectStats.upsert(userId, subjectId, {
archived: true,
archived_at: new Date(),
}).catch(() => {});
}
return { archived_count: archivedCount, subject_id: subjectId };
}
// ── Reckoning Buffer Consumption ────────────────────────────────────────────

async function consumeReckoningBuffer(userId, reckoningId) {
const buffer = await db.userInventory.getItem(userId, 'reckoning_buffer');
if (!buffer || buffer.quantity <= 0) return { error: 'No Reckoning Buffer owned' };
// NEW-L2 FIX (consumeReckoningBuffer): same always-truthy guard pattern — the
// original NEW-L2 audit target. Fixed here to match the deferReckoning fix.
const reckoning = await db.reckoningSessions.findById(reckoningId).catch(() => null);
// BUG 4 FIX: Buffer is valid on both 'triggered' (first use) and 'deferred'
// (user already used the 4-hour deferral and now wants to extend to 24 hours).
if (!reckoning || !['triggered', 'deferred'].includes(reckoning.status)) {
return { error: 'No active reckoning to buffer' };
}
// BUG 10 FIX: verify the reckoning belongs to this user before consuming their buffer.
// reckoning_id leaks via the 403 lockout response; without this check, User A
// could extend User B's Reckoning at User A's inventory cost.
if (reckoning.user_id !== userId) {
return { error: 'Not your reckoning' };
}
const newQty = buffer.quantity - 1;
await db.userInventory.setItem(userId, 'reckoning_buffer', {
quantity: newQty,
});
// Extend deferral to 24 hours
const deferredUntil = new Date(Date.now() + 24 * 3600000);
await db.reckoningSessions.update(reckoningId, {
status: 'deferred',
deferral_used: true,
deferred_until: deferredUntil,
});
return { consumed: true, deferred_until: deferredUntil, remaining: newQty };
}
// ── Chronicle Artifacts ──────────────────────────────────────────────────────

async function generateChronicleArtifact(userId, weekStart) {
const chronicle = await db.chronicleEntries.findLatest(userId);
if (!chronicle || chronicle.week_start !== weekStart) return null;
const prompt = `
ROLE
You are a mystical chronicler who writes a short artifact inscription based on a weekly study summary.
INPUT
{chronicle.narrative}
RULES
- Write exactly 2 sentences.
- Style: ancient inscription, poetic, slightly mysterious.
- Do not mention modern concepts (apps, phones, etc.).
OUTPUT
Return only the inscription.
`;
  let artifact;
  try {
    const result = await geminiModel.generateContent(prompt);
    artifact = result.response.text().trim();
  } catch (e) {
    artifact = 'The forest remembers this week. Your path is recorded in the roots of time.';
  }
  await db.chronicleEntries.create(userId, {
    week_start: weekStart,
    narrative: chronicle.narrative,
    artifact_text: artifact,
    is_artifact: true,
  });
  return { artifact_text: artifact, week: weekStart };
}

// ════════════════════════════════════════════════════════════════════════════
//  EXPRESS APP, MIDDLEWARE & ROUTES

// ════════════════════════════════════════════════════════════════════════════
const app = express();

const _allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim())
  : ['https://happysolomon43-boop.github.io', 'http://localhost:5500', 'http://localhost:8080'];

const _corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (_allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(_corsOptions));
// Handle preflight OPTIONS requests for all routes
app.options('*', cors(_corsOptions));

app.use(express.json({ limit: '10mb' }));

app.use(cookieParser());
// Serve frontend static files for single-domain deployment

app.use(express.static('public'));
// ── Additional requires for file parsing ────────────────────────────────────
let pdfParse, mammoth;
try {
pdfParse = require('pdf-parse');
} catch (e) {
pdfParse = null;
}
try {
mammoth = require('mammoth');
} catch (e) {
mammoth = null;
}
// ── AI Rate Limiter (B5) ──────────────────────────────────────────────────────
const aiCallTracker = new Map(); // key: `${userId}:${endpoint}` → {count, resetAt}

function checkAIRateLimit(userId, endpoint, maxPerHour) {
const key = `${userId}:${endpoint}`;
const now = Date.now();
const entry = aiCallTracker.get(key);
if (!entry || now > entry.resetAt) {
aiCallTracker.set(key, { count: 1, resetAt: now + 3_600_000 });
return false; // not limited
}
if (entry.count >= maxPerHour) return true; // limited
entry.count += 1;
return false;
}
// ── authMiddleware ──────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';

function generateAccessToken(user) {
return jwt.sign({ userId: user.id, role: user.role || 'user' }, JWT_SECRET, {
expiresIn: ACCESS_EXPIRY,
});
}

function generateRefreshToken(user) {
return jwt.sign({ userId: user.id, tokenType: 'refresh' }, JWT_SECRET, {
expiresIn: REFRESH_EXPIRY,
});
}

async function authenticate(req, res, next) {
const authHeader = req.headers.authorization;
if (!authHeader?.startsWith('Bearer '))
return res.status(401).json({ error: 'Missing access token' });
const token = authHeader.slice(7);
try {
const decoded = jwt.verify(token, JWT_SECRET);
const user = await db.users.findById(decoded.userId);
if (!user) return res.status(401).json({ error: 'User not found' });
req.user = user;
next();
} catch (e) {
return res.status(401).json({ error: 'Invalid or expired access token' });
}
}

function requireAdmin(req, res, next) {
if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
next();
}
// ── Reckoning Lockout Middleware (B4) ─────────────────────────────────────────

async function reckoningLockout(req, res, next) {
// P3.3-B1 FIX: reckoning action routes must never be blocked by this middleware.
// Without this, /reckoning/submit is unreachable while status = in_progress
// because findActiveByUser returns the in_progress session and triggers the 403.
const RECKONING_EXEMPT_PATHS = [
'/reckoning/submit',
'/reckoning/defer',
'/reckoning/use-buffer',
'/pressure/',  // acknowledge-alert sub-path
];
if (RECKONING_EXEMPT_PATHS.some(p => req.path === p || req.path.endsWith(p))) return next();
// P3-C1 FIX: /exams/generate must be reachable to START a reckoning exam.
// The lockout middleware is mounted on examRouter which intercepts this path.
// A body guard (not a blanket exemption) prevents the path being used to bypass.
if (req.path === '/generate' && (req.body?.is_reckoning || req.body?.reckoning_id)) return next();
if (!req.user) return next();
try {
const active = await db.reckoningSessions.findActiveByUser(req.user.id);
if (!active) return next();
// Honour deferral window — if still deferred and timer has NOT expired, pass through
if (active.status === 'deferred' && active.deferred_until) {
if (new Date(active.deferred_until) > new Date()) return next();
}
// P3-01 FIX: add all fields consumed by frontend showReckoningOverlay()
const userStatsForLockout = await db.userStats.get(req.user.id).catch(() => null);
return res.status(403).json({
error: 'A Reckoning is active. Complete or defer it before resuming other activity.',
reckoning: {
id: active.id,
subject_id: active.subject_id,
// Provide both snake_case and camelCase for frontend compatibility
subject_name: active.subject_name,
subjectName: active.subject_name,
status: active.status,
flagged_card_count: active.flagged_card_count,
question_count: active.question_count,
deferred_until: active.deferred_until || null,
deferral_expires_at: active.deferred_until || null,
reason: `Pressure reached ${active.pressure_score || 20} in ${active.subject_name || 'this subject'}`,
requiredScore: 70,
pressure: active.pressure_score || 0,
shields: userStatsForLockout?.streak_shields_held || 0,
canDefer: !active.deferral_used,
can_defer: !active.deferral_used,
deferHours: 4,
deferPenalty: 5,
},
});
} catch (e) {
console.error('[KIWI] Reckoning lockout check failed:', e.message);
next(); // fail-open — never block the user due to internal errors
}
}

// ════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES

// ════════════════════════════════════════════════════════════════════════════
const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
try {
const { name, username: rawUsername, email, password } = req.body;
const username = (name || rawUsername || '').trim();
if (!username || !email || !password)
return res
.status(400)
.json({ error: 'Missing required fields (name/username, email, password)' });
if (password.length < 6)
return res.status(400).json({ error: 'Password must be at least 6 characters' });
const existing = await db.users.findByUsernameOrEmail(username, email);
if (existing) return res.status(409).json({ error: 'Username or email already in use' });
const hashedPassword = await bcrypt.hash(password, 10);
const telegramLinkToken = crypto.randomBytes(8).toString('hex');
const user = await db.users.create({
id: crypto.randomUUID(),
username,
email,
password_hash: hashedPassword,
full_name: '',
avatar_url: '',
bio: '',
role: 'user',
is_active: true,
last_login_at: new Date(),
telegram_link_token: telegramLinkToken,
notification_preferences: { email: true, telegram: false },
});
await db.userStats.create(user.id);
await seedAlmanacForUser(user.id);
// Send welcome email
await sendEmailNotification(user.id, 'welcome', { name: username }).catch((e) =>
console.error('[KIWI] Welcome email failed:', e.message)
);
const accessToken = generateAccessToken(user);
const refreshToken = generateRefreshToken(user);
const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
const expiresAt = new Date(Date.now() + 30 * 86400000);
await db.refreshTokens.create(user.id, refreshHash, expiresAt);
const { password_hash, ...safeUser } = user;
res.status(201).json({ user: safeUser, accessToken, refreshToken, expiresIn: 900 });
} catch (e) {
console.error('Registration error:', e);
res.status(500).json({ error: 'Registration failed', details: e.message });
}
});

authRouter.post('/login', async (req, res) => {
try {
const { usernameOrEmail, email: rawEmail, password } = req.body;
const loginId = (usernameOrEmail || rawEmail || '').trim();
if (!loginId || !password)
return res.status(400).json({ error: 'Email/username and password required' });
const userBase = await db.users.findByUsernameOrEmail(loginId, loginId);
if (!userBase) return res.status(401).json({ error: 'Invalid credentials' });
const userStatsTmp = await db.userStats.get(userBase.id);
const user = { ...userBase, stats: userStatsTmp };
const valid = await bcrypt.compare(password, user.password_hash);
if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
await db.users.update(user.id, { last_login_at: new Date() });
// Check streak on login
const streakCheck = checkStreakOnLogin(user.stats || {});
if (streakCheck.updates) {
await db.userStats.update(user.id, streakCheck.updates);
}
// P3.9-B1a FIX: consume shield (or break streak) for missed days.
// checkStreakOnLogin returns action:'missed_day' after P3.9-B4 deprecates the grace system.
if (streakCheck.action === 'missed_day' || streakCheck.action === 'streak_broken') {
await consumeShieldOnMiss(user.id).catch(e =>
console.error('[KIWI] Shield miss check failed on login:', e.message)
);
}
// Phase 7: Return greeting
const returnStatus = await computeReturnStatus(user.id);
// P8 FIX: If 14+ day absence, proactively trigger GHOST decay recompute for all
// Stage-5 cards that are 60+ days dormant. Without this, GHOST state is only
// detected lazily when a card is loaded — returnees would see a falsely healthy dashboard.
if (returnStatus.status === 'abandoned') {
(async () => {
try {
const allCards = await db.cards.findAllForUser(user.id);
const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);
const stage5Dormant = allCards.filter(c =>
c.stage === 5 &&
c.last_reviewed_at &&
new Date(c.last_reviewed_at) <= sixtyDaysAgo
);
for (const card of stage5Dormant) {
await recomputeAndStoreCardState(user.id, card.id).catch(() => {});
}
if (stage5Dormant.length > 0) {
console.log(`[KIWI] GHOST decay pass: recomputed ${stage5Dormant.length} card(s) for user ${user.id}`);
}
} catch (e) {
console.error('[KIWI] GHOST decay pass failed:', e.message);
}
})();
}
const accessToken = generateAccessToken(user);
const refreshToken = generateRefreshToken(user);
const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
const expiresAt = new Date(Date.now() + 30 * 86400000);
await db.refreshTokens.create(user.id, refreshHash, expiresAt);
// Seedling hook: login streak
const stats = await db.userStats.get(user.id);
// BUG 7 FIX (login path): guard with streak_milestones_earned so the login hook
// cannot double-award +2 Seedlings on day 7 when detectStreakMilestones also runs.
if (stats && stats.current_streak > 0 && stats.current_streak % 7 === 0) {
const earnedAtLogin = stats.streak_milestones_earned || [];
if (!earnedAtLogin.includes(stats.current_streak)) {
await hookSeedlingEarnings(user.id, 'streak_milestone', { days: stats.current_streak });
}
}
// Generate persona weekly
await generateWeeklyPersona(user.id);
// P6.2 FIX: Chronicle catch-up — if last chronicle is older than 7 days, generate on login
const latestChronicle = await db.chronicleEntries.findLatest(user.id).catch(() => null);
const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
if (!latestChronicle || new Date(latestChronicle.week_start) < sevenDaysAgo) {
// GAP-3 FIX: award seedlings on catch-up path so Wednesday users get their 2 seedlings
generateWeeklyChronicle(user.id)
.then(() => hookSeedlingEarnings(user.id, 'weekly_chronicle', {}).catch(() => {}))
.catch((e) => console.error('[KIWI] Chronicle catch-up failed:', e.message));
}
// B13: Almanac unlock check on login
checkAlmanacUnlocks(user.id).catch((e) =>
console.error('[KIWI] Almanac check failed:', e.message)
);
const { password_hash, stats: _stats, ...safeUser } = user;
res.json({
user: safeUser,
accessToken,
refreshToken,
expiresIn: 900,
return_status: returnStatus,
is_streak_frozen: !!(userStats?.streak_shield_held),
});
} catch (e) {
console.error('Login error:', e);
res.status(500).json({ error: 'Login failed', details: e.message });
}
});

authRouter.post('/refresh', async (req, res) => {
try {
const { refreshToken } = req.body;
if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
const decoded = jwt.verify(refreshToken, JWT_SECRET);
const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
const tokenDoc = await db.refreshTokens.findByHash(refreshHash, decoded.userId);
if (!tokenDoc || new Date(tokenDoc.expires_at) < new Date()) {
return res.status(401).json({ error: 'Invalid or expired refresh token' });
}
const user = await db.users.findById(decoded.userId);
if (!user) return res.status(401).json({ error: 'User not found' });
const newAccessToken = generateAccessToken(user);
const newRefreshToken = generateRefreshToken(user);
const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
const newExpires = new Date(Date.now() + 30 * 86400000);
await db.refreshTokens.deleteByHash(refreshHash);
await db.refreshTokens.create(user.id, newHash, newExpires);
res.json({
accessToken: newAccessToken,
refreshToken: newRefreshToken,
expiresIn: 900,
is_streak_frozen: !!(user?.streak_shield_held),
});
} catch (e) {
console.error('Refresh error:', e);
res.status(401).json({ error: 'Invalid refresh token' });
}
});

authRouter.post('/guest', async (req, res) => {
// B21: Create a temporary guest user with 10 pre-seeded demo cards
try {
const guestId = crypto.randomUUID();
const guestName = 'Guest' + guestId.slice(0, 8);
const dummyHash = await bcrypt.hash('guest' + guestId, 6);
const user = await db.users.create({
id: guestId,
username: guestName,
email: `${guestName}@kiwi.guest`,
password_hash: dummyHash,
full_name: 'Guest Explorer',
avatar_url: '',
bio: '',
role: 'guest',
is_active: true,
is_guest: true,
guest_expires_at: new Date(Date.now() + 7 * 86400000),
last_login_at: new Date(),
});
await db.userStats.create(user.id);
await seedAlmanacForUser(user.id);
// Seed a demo subject and deck with 10 cards
const demoSubject = await db.subjects.create(user.id, {
name: 'Demo: Study Skills',
color_hex: '#10B981',
emoji: '🌱',
});
const demoDeck = await db.decks.create(user.id, {
name: 'Introduction Deck',
description: 'Sample cards to explore KIWI',
subject_id: demoSubject.id,
card_count: 0,
});
const DEMO_CARDS = [
{
front_content: 'What is spaced repetition?',
back_content:
'A learning technique that reviews material at increasing intervals to improve long-term retention.',
},
{
front_content: 'What does SRS stand for?',
back_content:
'Spaced Repetition System — a method of reviewing flashcards based on how well you know them.',
},
{
front_content: 'What is active recall?',
back_content:
'Actively retrieving information from memory rather than passively re-reading, proven to strengthen memory.',
},
{
front_content: 'What is the Ebbinghaus Forgetting Curve?',
back_content:
'A graph showing how memory fades over time without reinforcement — the basis for spaced repetition.',
},
{
front_content: 'What is interleaving?',
back_content:
'Mixing different subjects or problem types during study sessions to improve long-term learning.',
},
{
front_content: 'What does "Again" mean in KIWI?',
back_content:
'You did not remember the card. It will be shown again soon at a shorter interval.',
},
{
front_content: 'What does "Good" mean in KIWI?',
back_content:
'You remembered the card with some effort. The interval increases by a standard amount.',
},
{
front_content: 'What does Stage 5 mean?',
back_content:
'A card at Stage 5 (Mastered) has been reviewed successfully many times and has a long review interval.',
},
{
front_content: 'What is a Knowledge Score?',
back_content:
"KIWI's metric (0–100) reflecting the effective mastery of all your cards, weighted by stage and state.",
},
{
front_content: 'What is a Reckoning?',
back_content:
'A mandatory exam triggered when brain pressure is too high — face it to reset pressure and prove mastery.',
},
];
const createdCards = await db.cards.createMany(user.id, demoDeck.id, DEMO_CARDS);
await db.decks.update(user.id, demoDeck.id, { card_count: createdCards.length });
await batchInitializeSeedlingStates(
user.id,
createdCards.map((c) => c.id)
);
const accessToken = generateAccessToken(user);
const refreshToken = generateRefreshToken(user);
const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
await db.refreshTokens.create(user.id, refreshHash, new Date(Date.now() + 7 * 86400000));
const { password_hash, ...safeUser } = user;
res.status(201).json({
user: safeUser,
accessToken,
refreshToken,
expiresIn: 900,
is_guest: true,
demo_cards: createdCards.length,
is_streak_frozen: false,
});
} catch (e) {
console.error('Guest creation error:', e);
res.status(500).json({ error: 'Failed to create guest session', details: e.message });
}
});

authRouter.post('/logout', async (req, res) => {
try {
const { refreshToken } = req.body;
if (refreshToken) {
const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
await db.refreshTokens.deleteByHash(refreshHash);
}
res.json({ message: 'Logged out successfully' });
} catch (e) {
res.status(500).json({ error: 'Logout failed' });
}
});

authRouter.get('/me', authenticate, async (req, res) => {
try {
const stats = await db.userStats.get(req.user.id);
const { password_hash, ...safeUser } = req.user;
res.json({ ...safeUser, stats });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch user' });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  SUBJECT ROUTES

// ════════════════════════════════════════════════════════════════════════════
const subjectRouter = express.Router();

subjectRouter.use(authenticate);

subjectRouter.use(reckoningLockout);

subjectRouter.get('/', async (req, res) => {
try {
const subjects = await db.subjects.findManyWithDecks(req.user.id);
const healthPromises = subjects.map(async (s) => {
try {
const h = await recalculateSubjectHealth(req.user.id, s.id);
return { ...s, health_score: h ? Math.min(100, Math.max(0, h)) : 50 };
} catch (e) {
return { ...s, health_score: 50 };
}
});
res.json(await Promise.all(healthPromises));
} catch (e) {
res.status(500).json({ error: 'Failed to fetch subjects', details: e.message });
}
});

subjectRouter.post('/', async (req, res) => {
try {
const { name, color_hex, emoji } = req.body;
if (!name) return res.status(400).json({ error: 'Name required' });
const subject = await db.subjects.create(req.user.id, {
name,
color_hex: color_hex || '#4F46E5',
emoji: emoji || '📚',
});
res.status(201).json(subject);
} catch (e) {
res.status(500).json({ error: 'Failed to create subject' });
}
});

subjectRouter.put('/:id', async (req, res) => {
try {
const subject = await db.subjects.update(req.user.id, req.params.id, req.body);
res.json(subject);
} catch (e) {
res.status(500).json({ error: 'Failed to update subject' });
}
});

subjectRouter.delete('/:id', async (req, res) => {
try {
await db.subjects.delete(req.user.id, req.params.id);
res.json({ message: 'Subject deleted' });
} catch (e) {
res.status(500).json({ error: 'Failed to delete subject' });
}
});

subjectRouter.get('/:id/topics', async (req, res) => {
try {
const topics = await db.topics.findMany(req.user.id, req.params.id);
res.json(topics);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch topics' });
}
});

subjectRouter.post('/:id/topics', async (req, res) => {
try {
const { name } = req.body;
if (!name) return res.status(400).json({ error: 'Name required' });
const topic = await db.topics.create(req.user.id, req.params.id, name);
res.status(201).json(topic);
} catch (e) {
res.status(500).json({ error: 'Failed to create topic' });
}
});

subjectRouter.get('/:id/health', async (req, res) => {
try {
const health = await recalculateSubjectHealth(req.user.id, req.params.id);
res.json({ health_score: health });
} catch (e) {
res.status(500).json({ error: 'Failed to calculate health' });
}
});

subjectRouter.get('/:id/biome', async (req, res) => {
try {
const ks = await computeKnowledgeScore(req.user.id, req.params.id);
const credential = await evaluateCredential(req.user.id, req.params.id);
const pressure = await db.brainPressure.get(req.user.id, req.params.id);
const zoneDesc = await generateZoneDescription(req.user.id, req.params.id);
res.json({
knowledge_score: ks,
credential,
pressure,
zone_description: zoneDesc,
});
} catch (e) {
res.status(500).json({ error: 'Failed to build biome', details: e.message });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  DECK ROUTES

// ════════════════════════════════════════════════════════════════════════════
const deckRouter = express.Router();

deckRouter.use(authenticate);

deckRouter.use(reckoningLockout);

deckRouter.get('/', async (req, res) => {
try {
const { subject_id, topic_id, page = 1, limit = 20 } = req.query;
const result = await db.decks.findMany(req.user.id, { subject_id, topic_id });
const start = (page - 1) * limit;
const paginated = result.decks.slice(start, start + parseInt(limit));
res.json({
decks: paginated,
total: result.total,
page: parseInt(page),
total_pages: Math.ceil(result.total / limit),
});
} catch (e) {
res.status(500).json({ error: 'Failed to fetch decks' });
}
});

deckRouter.post('/', async (req, res) => {
try {
const { subject_id, topic_id, name, description, is_public } = req.body;
if (!name || !subject_id)
return res.status(400).json({ error: 'Name and subject_id required' });
const deck = await db.decks.create(req.user.id, {
subject_id,
topic_id,
name,
description,
is_public: is_public || false,
card_count: 0,
});
res.status(201).json(deck);
} catch (e) {
res.status(500).json({ error: 'Failed to create deck' });
}
});

deckRouter.get('/:id', async (req, res) => {
try {
const deck = await db.decks.findByIdFull(req.user.id, req.params.id);
if (!deck) return res.status(404).json({ error: 'Deck not found' });
res.json(deck);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch deck' });
}
});

deckRouter.put('/:id', async (req, res) => {
try {
const deck = await db.decks.update(req.user.id, req.params.id, req.body);
res.json(deck);
} catch (e) {
res.status(500).json({ error: 'Failed to update deck' });
}
});

deckRouter.delete('/:id', async (req, res) => {
try {
await db.decks.delete(req.user.id, req.params.id);
res.json({ message: 'Deck deleted' });
} catch (e) {
res.status(500).json({ error: 'Failed to delete deck' });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  CARD ROUTES

// ════════════════════════════════════════════════════════════════════════════
const cardRouter = express.Router();

cardRouter.use(authenticate);

cardRouter.use(reckoningLockout);

cardRouter.get('/', async (req, res) => {
try {
const { deck_id, stage, page = 1, limit = 50 } = req.query;
const result = await db.cards.findMany(
req.user.id,
{ deck_id, stage },
{ page: parseInt(page), limit: parseInt(limit) }
);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch cards' });
}
});

cardRouter.get('/:id', async (req, res) => {
try {
const card = await db.cards.findById(req.user.id, req.params.id);
if (!card) return res.status(404).json({ error: 'Card not found' });
const stateDoc = await db.cardStates.get(req.user.id, card.id);
res.json({ ...card, intelligence: stateDoc || null });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch card' });
}
});

cardRouter.post('/', async (req, res) => {
try {
const { deck_id, front_content, back_content, front_image_url, back_image_url, tags } =
req.body;
if (!deck_id || !front_content || !back_content)
return res.status(400).json({ error: 'Required fields missing' });
const ai_summary = await summarizeCard(front_content, back_content);
const card = await db.cards.create(req.user.id, {
deck_id,
front_content,
back_content,
front_image_url,
back_image_url,
tags: tags || [],
ai_summary,
});
await db.decks.update(req.user.id, deck_id, { card_count: FieldValue.increment(1) });
await initializeCardState(req.user.id, card.id, CARD_STATES.SEEDLING);
res.status(201).json(card);
} catch (e) {
res.status(500).json({ error: 'Failed to create card', details: e.message });
}
});

cardRouter.put('/:id', async (req, res) => {
try {
const card = await db.cards.update(req.user.id, req.params.id, req.body);
res.json(card);
} catch (e) {
res.status(500).json({ error: 'Failed to update card' });
}
});

cardRouter.delete('/:id', async (req, res) => {
try {
const card = await db.cards.findById(req.user.id, req.params.id);
if (card?.deck_id)
await db.decks.update(req.user.id, card.deck_id, { card_count: FieldValue.increment(-1) });
await db.cards.delete(req.user.id, req.params.id);
res.json({ message: 'Card deleted' });
} catch (e) {
res.status(500).json({ error: 'Failed to delete card' });
}
});

cardRouter.get('/:id/summary', async (req, res) => {
try {
const card = await db.cards.findById(req.user.id, req.params.id);
if (!card) return res.status(404).json({ error: 'Card not found' });
// P1.5: Rate-limited -> fallback to stored ai_summary instead of 429
if (checkAIRateLimit(req.user.id, 'summarizer', 20)) {
const fallback =
card.ai_summary ||
(card.front_content || '').slice(0, 80) + ' -- ' + (card.back_content || '').slice(0, 80);
return res.json({ summary: fallback, rate_limited: true });
}
const summary = await getCardSummary(
req.user.id,
card.id,
card.front_content,
card.back_content
);
res.json({ summary });
} catch (e) {
res.status(500).json({ error: 'Failed to summarize card' });
}
});
// Import routes with SEEDLING adaptation

cardRouter.post('/import/ai', async (req, res) => {
try {
const { deck_id, notes, card_count = 10, subject_hint = '' } = req.body;
if (!deck_id || !notes) return res.status(400).json({ error: 'deck_id and notes required' });
const aiText = await generateFlashcards(notes, subject_hint);
const parsed = parseFlashcards(aiText);
if (parsed.length === 0)
return res.status(422).json({ error: 'Could not parse flashcards from AI response' });
const cardsData = parsed.map((c) => ({ ...c, ai_summary: '' }));
const created = await db.cards.createMany(req.user.id, deck_id, cardsData);
await db.decks.update(req.user.id, deck_id, {
card_count: FieldValue.increment(created.length),
import_source: 'ai',
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
// PB.13: Resolve subject_id for Bubble onboarding prompt in frontend [DESIGN: §18 PB.13]
const aiImportDeck      = await db.decks.findById(req.user.id, deck_id).catch(() => null);
const aiImportSubjectId = aiImportDeck?.subject_id || null;
res.status(201).json({
  cards:          created,
  count:          created.length,
  source:         'ai',
  deck_id,
  subject_id:     aiImportSubjectId,
  suggest_bubble: aiImportSubjectId !== null && created.length >= 5,
});
} catch (e) {
res.status(500).json({ error: 'AI import failed', details: e.message });
}
});

cardRouter.post('/import/text', async (req, res) => {
try {
const { deck_id, text, format = 'qa_pairs', delimiter = '::' } = req.body;
if (!deck_id || !text) return res.status(400).json({ error: 'deck_id and text required' });
const lines = text.split('\n').filter((l) => l.trim());
const cardsData = [];
if (format === 'qa_pairs') {
for (const line of lines) {
const [front, back] = line.split(delimiter);
if (front && back)
cardsData.push({ front_content: front.trim(), back_content: back.trim() });
}
} else if (format === 'csv') {
// Simple CSV: front,back per line
for (const line of lines) {
const [front, back] = line.split(',');
if (front && back)
cardsData.push({ front_content: front.trim(), back_content: back.trim() });
}
}
if (cardsData.length === 0)
return res.status(422).json({ error: 'No valid cards found in text' });
const created = await db.cards.createMany(req.user.id, deck_id, cardsData);
await db.decks.update(req.user.id, deck_id, {
card_count: FieldValue.increment(created.length),
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
res.status(201).json({ cards: created, count: created.length });
} catch (e) {
res.status(500).json({ error: 'Text import failed', details: e.message });
}
});

cardRouter.post('/import/image', async (req, res) => {
try {
const { deck_id, image_base64, mime_type = 'image/jpeg' } = req.body;
if (!deck_id || !image_base64)
return res.status(400).json({ error: 'deck_id and image_base64 required' });
const extracted = await extractFromImage(Buffer.from(image_base64, 'base64'), mime_type);
let cardsData = [];
try {
const parsed = JSON.parse(extracted);
if (Array.isArray(parsed))
cardsData = parsed
.map((p) => ({
front_content: p.front || p.question || '',
back_content: p.back || p.answer || '',
}))
.filter((c) => c.front_content && c.back_content);
} catch (e) {
const lines = extracted.split('\n').filter((l) => l.includes(':') || l.includes('—'));
for (const line of lines) {
const parts = line.split(/[:—]/);
if (parts.length >= 2)
cardsData.push({ front_content: parts[0].trim(), back_content: parts[1].trim() });
}
}
if (cardsData.length === 0)
return res.status(422).json({ error: 'Could not extract cards from image' });
const created = await db.cards.createMany(req.user.id, deck_id, cardsData);
await db.decks.update(req.user.id, deck_id, {
card_count: FieldValue.increment(created.length),
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
res.status(201).json({ cards: created, count: created.length, source: 'image' });
} catch (e) {
res.status(500).json({ error: 'Image import failed', details: e.message });
}
});

cardRouter.post('/import/pdf', async (req, res) => {
try {
const { deck_id, pdf_base64 } = req.body;
if (!deck_id || !pdf_base64)
return res.status(400).json({ error: 'deck_id and pdf_base64 required' });
if (!pdfParse) return res.status(503).json({ error: 'PDF parsing not available' });
const buffer = Buffer.from(pdf_base64, 'base64');
const parsed = await pdfParse(buffer);
let text = (parsed.text || '').trim();
// P2.8: Enforce 50,000-character limit
if (text.length > 50000) text = text.slice(0, 50000);
if (!text) return res.status(422).json({ error: 'No usable text extracted from PDF' });
// P2.8: Chunk into <=4000-char segments and send each to Gemini
const chunks = [];
for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
let cardsData = [];
for (const chunk of chunks) {
try {
const aiText = await generateFlashcards(chunk, req.body.subject_hint || '');
const parsed2 = parseFlashcards(aiText);
cardsData.push(...parsed2);
} catch (e) {
// Fallback: pair consecutive lines as front/back
const lines = chunk.split('\n').filter((l) => l.trim().length > 10);
for (let i = 0; i < lines.length - 1; i += 2) {
cardsData.push({ front_content: lines[i].trim(), back_content: lines[i + 1].trim() });
}
}
}
if (cardsData.length === 0)
return res.status(422).json({ error: 'No usable text extracted from PDF' });
const created = await db.cards.createMany(req.user.id, deck_id, cardsData);
await db.decks.update(req.user.id, deck_id, {
card_count: FieldValue.increment(created.length),
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
res.status(201).json({ cards: created, count: created.length, source: 'pdf' });
} catch (e) {
res.status(500).json({ error: 'PDF import failed', details: e.message });
}
});

cardRouter.post('/import/docx', async (req, res) => {
try {
const { deck_id, docx_base64 } = req.body;
if (!deck_id || !docx_base64)
return res.status(400).json({ error: 'deck_id and docx_base64 required' });
if (!mammoth) return res.status(503).json({ error: 'DOCX parsing not available' });
const buffer = Buffer.from(docx_base64, 'base64');
const result = await mammoth.extractRawText({ buffer });
let text = (result.value || '').trim();
// P2.8: Enforce 50,000-character limit
if (text.length > 50000) text = text.slice(0, 50000);
if (!text) return res.status(422).json({ error: 'No usable text extracted from DOCX' });
// P2.8: Chunk into <=4000-char segments and send each to Gemini
const chunks = [];
for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
let cardsData = [];
for (const chunk of chunks) {
try {
const aiText = await generateFlashcards(chunk, req.body.subject_hint || '');
const parsed2 = parseFlashcards(aiText);
cardsData.push(...parsed2);
} catch (e) {
const lines = chunk.split('\n').filter((l) => l.trim().length > 10);
for (let i = 0; i < lines.length - 1; i += 2) {
cardsData.push({ front_content: lines[i].trim(), back_content: lines[i + 1].trim() });
}
}
}
if (cardsData.length === 0)
return res.status(422).json({ error: 'No usable text extracted from DOCX' });
const created = await db.cards.createMany(req.user.id, deck_id, cardsData);
await db.decks.update(req.user.id, deck_id, {
card_count: FieldValue.increment(created.length),
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
// FIX #4a: Recalculate KS after DOCX import
const docxDeck = await db.decks.findById(req.user.id, deck_id).catch(() => null);
if (docxDeck?.subject_id) {
await persistKnowledgeScore(req.user.id, docxDeck.subject_id).catch(() => {});
}
res.status(201).json({ cards: created, count: created.length, source: 'docx' });
} catch (e) {
res.status(500).json({ error: 'DOCX import failed', details: e.message });
}
});
// Quizlet parser (B9 — accepts URL or plain text)

cardRouter.post('/import/quizlet', async (req, res) => {
try {
const { deck_id, text, url } = req.body;
if (!deck_id || (!text && !url))
return res.status(400).json({ error: 'deck_id and either text or url required' });
// P2.9: Rate limit - 5 Quizlet URL imports per day per user
// FIX #6: Pass 24-hour window (86400000 ms) instead of default 1-hour
if (url && checkAIRateLimit(req.user.id, 'quizlet_import', 5, 86400000)) {
return res.status(429).json({ error: 'Rate limit: max 5 Quizlet URL imports per day' });
}
let cardsData = [];
if (url) {
// B9: Fetch Quizlet page and extract embedded JSON
try {
const https = require('https');
const rawHtml = await new Promise((resolve, reject) => {
const req2 = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
let body = '';
response.on('data', (chunk) => (body += chunk));
response.on('end', () => resolve(body));
});
req2.on('error', reject);
req2.setTimeout(10000, () => {
req2.destroy();
reject(new Error('Timeout'));
});
});
// Quizlet embeds card data in window.Quizlet["setData"] or similar JSON blobs
// FIX #7: Use \s for zero-or-more whitespace around setData
const jsonMatch = rawHtml.match(/"setData"\s:\s({[\s\S]?})\s[,}]/);
if (jsonMatch) {
const setData = JSON.parse(jsonMatch[1]);
const terms = setData.terms || setData.studiableItems || [];
for (const term of terms) {
const front = term.word || term.term || (term.sides && term.sides[0]?.label) || '';
const back = term.definition || (term.sides && term.sides[1]?.label) || '';
if (front && back)
cardsData.push({ front_content: front.trim(), back_content: back.trim() });
}
}
if (cardsData.length === 0) {
// Fallback: scan for any JSON array with word/definition pairs
const allJsonMatch = rawHtml.match(/\{[^]?"word"[^]?\}/g);
if (allJsonMatch) {
for (const chunk of allJsonMatch) {
try {
const parsed = JSON.parse(chunk);
for (const item of parsed) {
if (item.word && item.definition) {
cardsData.push({
front_content: item.word.trim(),
back_content: item.definition.trim(),
});
}
}
} catch (e) {}
}
}
}
} catch (fetchErr) {
return res
.status(422)
.json({ error: 'Failed to fetch Quizlet URL', details: fetchErr.message });
}
} else {
// Plain text path
const lines = text.split('\n').filter((l) => l.trim());
for (const line of lines) {
let parts = line.split('\t');
if (parts.length < 2) parts = line.split(/[—–]/);
if (parts.length >= 2) {
cardsData.push({
front_content: parts[0].trim(),
back_content: parts.slice(1).join(' — ').trim(),
});
}
}
}
if (cardsData.length === 0)
return res.status(422).json({ error: 'No valid Quizlet cards found' });
const created = await db.cards.createMany(req.user.id, deck_id, cardsData);
await db.decks.update(req.user.id, deck_id, {
card_count: FieldValue.increment(created.length),
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
// FIX #4b: Recalculate KS after Quizlet import
const quizletDeck = await db.decks.findById(req.user.id, deck_id).catch(() => null);
if (quizletDeck?.subject_id) {
await persistKnowledgeScore(req.user.id, quizletDeck.subject_id).catch(() => {});
}
res
.status(201)
.json({
cards: created,
count: created.length,
source: url ? 'quizlet_url' : 'quizlet_text',
});
} catch (e) {
res.status(500).json({ error: 'Quizlet import failed', details: e.message });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  STUDY ROUTES

// ════════════════════════════════════════════════════════════════════════════
const studyRouter = express.Router();

studyRouter.use(authenticate);

studyRouter.use(reckoningLockout);

studyRouter.post('/start', async (req, res) => {
try {
const { deck_id, card_limit, include_all_decks_in_subject, subject_id, card_ids } = req.body;
// Fixed: Allow subject_id + include_all_decks_in_subject without explicit deck_id
if (!deck_id && !(include_all_decks_in_subject && subject_id)) {
return res
.status(400)
.json({
error: 'deck_id required, or provide subject_id with include_all_decks_in_subject=true',
});
}
// If no deck_id but subject_id + include_all, get first deck of subject to satisfy subsequent logic
if (!deck_id && include_all_decks_in_subject && subject_id) {
const firstDecks = await db.decks.findBySubject(req.user.id, subject_id);
if (!firstDecks.length)
return res.status(400).json({ error: 'No decks found for this subject' });
// deck_id will be overridden by the deckIds array below, this satisfies the variable reference
}
let deck = null;
if (deck_id) {
deck = await db.decks.findById(req.user.id, deck_id);
if (!deck) return res.status(404).json({ error: 'Deck not found' });
}
let deckIds = deck_id ? [deck_id] : [];
if (include_all_decks_in_subject && subject_id) {
const subjectDecks = await db.decks.findBySubject(req.user.id, subject_id);
deckIds = subjectDecks.map((d) => d.id);
}
let allCards = [];
for (const id of deckIds) {
const cards = await db.cards.findByDeck(req.user.id, id);
allCards.push(...cards);
}
// FIX-A: If card_ids provided, scope session to those specific cards only.
// Used by review_specific_cards invitation action_type.
if (card_ids && Array.isArray(card_ids) && card_ids.length > 0) {
const idSet = new Set(card_ids);
allCards = allCards.filter((c) => idSet.has(c.id));
}
// Phase 4: Build priority queue
const queue = [];
for (const card of allCards) {
let stateDoc = await db.cardStates.get(req.user.id, card.id);
if (!stateDoc) stateDoc = await initializeCardState(req.user.id, card.id);
queue.push({ card, state: stateDoc });
}
// Sort by priority (spec P4.1): DANGEROUS > AVOIDED > GHOST > STUCK > FRAGILE > normal due > seedling
// P2 FIX: Corrected order — DANGEROUS must surface before GHOST (exam urgency > dormancy)
// P12 FIX: Secondary sort by overdue date within same priority tier (most overdue first)
queue.sort((a, b) => {
const priorityMap = {
[CARD_STATES.DANGEROUS]: 0,
[CARD_STATES.AVOIDED]:   1,
[CARD_STATES.GHOST]:     2,
[CARD_STATES.STUCK]:     3,
[CARD_STATES.FRAGILE]:   4,
};
const pa =
priorityMap[a.state.state] !== undefined
? priorityMap[a.state.state]
: isCardDue(a.card)
? 5
: 6;
const pb =
priorityMap[b.state.state] !== undefined
? priorityMap[b.state.state]
: isCardDue(b.card)
? 5
: 6;
if (pa !== pb) return pa - pb;
// Within the same priority tier, surface most overdue cards first
const aOverdue = a.card.next_review_at ? new Date(a.card.next_review_at).getTime() : 0;
const bOverdue = b.card.next_review_at ? new Date(b.card.next_review_at).getTime() : 0;
return aOverdue - bOverdue; // earlier next_review_at = more overdue = first
});
// PB.9: Apply bubble queue modifications [DESIGN: §4, §15.2]
const bubbleSubjectId  = subject_id || (deck ? deck.subject_id : null);
const modifiedQueue    = await modifySessionQueueForBubbles(
  req.user.id, queue, bubbleSubjectId
).catch(() => queue);
const limitedQueue = card_limit && card_limit > 0
  ? modifiedQueue.slice(0, parseInt(card_limit))
  : modifiedQueue;
let sessionCards = limitedQueue.map((q) => q.card || q);
const sessionDeckId = deck_id || (deckIds.length > 0 ? deckIds[0] : null);
const session = await db.sessions.create(req.user.id, sessionDeckId, new Date());
// Normalize cards for frontend: map front_content→front, back_content→back
// MISS-1+MISS-2 FIX: reads from limitedQueue (bubble-modified), propagates _warmup flag [DESIGN: §2.5]
const normalizedCards = limitedQueue.map((q) => ({
  ...q.card,
  front:    q.card.front_content || q.card.front || '',
  back:     q.card.back_content  || q.card.back  || '',
  priority: q.state?.state       || null,
  _warmup:  q._warmup            || false,
}));
// P9 FIX: Detect first-return session so frontend can trigger zone restoration animation.
// is_first_return_session = true when user last studied 3+ days ago (return threshold).
// After this session ends, last_study_date updates to today, preventing false positives.
let is_first_return_session = false;
try {
const returnStats = await db.userStats.get(req.user.id);
if (returnStats && returnStats.last_study_date) {
const daysSinceLastStudy = Math.floor(
(Date.now() - new Date(returnStats.last_study_date).getTime()) / 86400000
);
is_first_return_session = daysSinceLastStudy >= 3;
}
} catch (e) { / non-fatal / }
res.status(201).json({
session,
sessionId: session.id, // alias for frontend compatibility
cards: normalizedCards,
total_due: normalizedCards.length,
subject_id: subject_id || (deck ? deck.subject_id : null),
is_first_return_session,
});
} catch (e) {
res.status(500).json({ error: 'Failed to start session', details: e.message });
}
});

studyRouter.post('/card/:cardId/response', async (req, res) => {
try {
const { session_id, response, response_time_ms } = req.body;
const cardId = req.params.cardId;
if (!session_id || !response)
return res.status(400).json({ error: 'session_id and response required' });
const session = await db.sessions.findById(req.user.id, session_id);
if (!session) return res.status(404).json({ error: 'Session not found' });
const card = await db.cards.findById(req.user.id, cardId);
if (!card) return res.status(404).json({ error: 'Card not found' });
const qualityMap = { again: 0, hard: 2, good: 3, easy: 5 };
const q = qualityMap[response];
if (q === undefined) return res.status(400).json({ error: 'Invalid response' });
const prevStage = card.stage;
const nextReview = calculateNextReview(card, response);
let xpEarned = 0;
if (response === 'good') xpEarned = 5;
if (response === 'easy') xpEarned = 8;
if (response === 'hard') xpEarned = 2;
if (response === 'again') xpEarned = 1;
let sessionUpdates = {};
if (response === 'again') sessionUpdates.cards_again = FieldValue.increment(1);
if (response === 'hard') sessionUpdates.cards_hard = FieldValue.increment(1);
if (response === 'good') sessionUpdates.cards_good = FieldValue.increment(1);
if (response === 'easy') sessionUpdates.cards_easy = FieldValue.increment(1);
sessionUpdates.cards_reviewed = FieldValue.increment(1);
sessionUpdates.xp_earned = FieldValue.increment(xpEarned);
await db.sessions.update(req.user.id, session_id, sessionUpdates);
await db.cards.update(req.user.id, cardId, {
...nextReview,
last_reviewed_at: new Date(),
last_response: response,
});
const newMastered = nextReview.stage === 5 && prevStage !== 5 ? 1 : 0;
const statsUpdates = {
total_cards_reviewed: FieldValue.increment(1),
total_xp: FieldValue.increment(xpEarned),
};
if (newMastered) statsUpdates.total_cards_mastered = FieldValue.increment(1);
await db.userStats.update(req.user.id, statsUpdates);
await db.reviewLogs.create(req.user.id, {
card_id: cardId,
session_id,
response,
response_time_ms: response_time_ms || 0,
previous_stage: prevStage,
new_stage: nextReview.stage,
previous_interval: card.interval_days,
new_interval: nextReview.interval_days,
// FIX #3: next_review_at enables AVOIDED detection (overdue >= 3 days)
next_review_at: card.next_review_at || null,
// FIX #5a: previous_review_at enables correct interval math in STABLE check
previous_review_at: card.last_reviewed_at || null,
});
// Phase 2: Recompute card state
await recomputeAndStoreCardState(req.user.id, cardId);
// PB.9: Propagate KS update to any bubble containing this card as cross_bubble
await propagateCrossBubbleKSUpdate(req.user.id, cardId).catch(() => {});
// PB.9: Update cluster KS for any cluster containing this card
await updateClusterKSForCard(req.user.id, cardId).catch(() => {});
// Phase 3: Seedling hook for stage change
if (nextReview.stage !== prevStage) {
await hookSeedlingEarnings(req.user.id, 'stage_change', {
old_stage: prevStage,
new_stage: nextReview.stage,
});
}
// P5 FIX: AI Mastery Moment (B1) — first time card reaches Stage 5
// Fire-and-forget: does not delay response; sentence stored in Firestore for frontend to read
if (nextReview.stage === 5 && prevStage !== 5) {
generateMasteryMoment(
req.user.id,
cardId,
card.front_content || card.front || '',
card.back_content || card.back || ''
).catch(() => {});
}
// Phase 4: Focus seed tracking
const updatedSession = await db.sessions.findById(req.user.id, session_id);
const focusStage = computeFocusStage(
updatedSession.started_at,
updatedSession.focus_breaks || 0
);
await db.sessions.update(req.user.id, session_id, { focus_seed_stage: focusStage });
// FIX P9.4-05: compute per-button interval hints so frontend shows dynamic values
const _fmtInterval = (days) => {
  if (!days || days < 1) return '<1d';
  if (days < 7)  return `${days}d`;
  if (days < 30) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
};
const _hA = calculateNextReview(card, 'again');
const _hH = calculateNextReview(card, 'hard');
const _hG = calculateNextReview(card, 'good');
const _hE = calculateNextReview(card, 'easy');
res.json({
success: true,
new_stage: nextReview.stage,
newStage: nextReview.stage,
interval_days: nextReview.interval_days,
xp_earned: xpEarned,
next_review_at: nextReview.nextReviewAt,
intervalHintAgain: _fmtInterval(_hA?.interval_days),
intervalHintHard:  _fmtInterval(_hH?.interval_days),
intervalHintGood:  _fmtInterval(_hG?.interval_days),
intervalHintEasy:  _fmtInterval(_hE?.interval_days),
});
} catch (e) {
res.status(500).json({ error: 'Failed to record response', details: e.message });
}
});

studyRouter.post('/end', async (req, res) => {
try {
// P3b FIX: Accept focused_seconds (idle excluded) and seed_killed from frontend
const { session_id, break_count = 0, focused_seconds = 0, seed_killed = false, reason = 'user_ended' } = req.body;
if (!session_id) return res.status(400).json({ error: 'session_id required' });
const session = await db.sessions.findById(req.user.id, session_id);
if (!session) return res.status(404).json({ error: 'Session not found' });
const now = new Date();
const durationSec = Math.floor((now - new Date(session.started_at)) / 1000);
const completed = (session.cards_reviewed || 0) >= 10;
// Compute focus-only duration: if frontend provided focused_seconds, use it;
// otherwise fallback to durationSec minus any break time (rough estimate)
const focusDurationSec = focused_seconds > 0 ? focused_seconds : 0;
const focusStage = computeFocusStage(session.started_at, break_count, focusDurationSec, seed_killed);
const seedSurvived = focusStage !== FOCUS_STAGES.DORMANT;
const updates = {
ended_at: now,
duration_seconds: durationSec,
session_completed: completed,
focus_breaks: break_count,
focus_seed_stage: focusStage,
seed_survived: seedSurvived,
};
await db.sessions.update(req.user.id, session_id, updates);
// P4 FIX: Fruiting consequence is gated on seed state only, not on cards_reviewed.
// A student can study unbroken for 90 min with only 8 cards — Fruiting must still fire.
if (focusStage === FOCUS_STAGES.FRUITING) {
await processFruiting(req.user.id, { ...session, focus_seed_stage: focusStage });
}
if (completed) {
const streakUpdates = computeStreakAfterSession(await db.userStats.get(req.user.id), now);
await db.userStats.update(req.user.id, streakUpdates);
// Phase 3: Streak milestones
await detectStreakMilestones(req.user.id);
// Phase 8: Seedling earnings
// P8.1b: include focus_seed_stage so Glowing/Thriving cases in the hook can fire
await hookSeedlingEarnings(req.user.id, 'session_end', {
session_completed: completed,
cards_reviewed: session.cards_reviewed || 0,
fruiting_achieved: focusStage === FOCUS_STAGES.FRUITING,
focus_seed_stage: focusStage,
});
} else {
await db.userStats.update(req.user.id, {
tree_health: { increment: -10 },
});
}
const stats = await db.userStats.get(req.user.id);
await updateTreeStage(req.user.id);
// Phase 2: Recalculate KS for subject
const deck = await db.decks.findById(req.user.id, session.deck_id);
let ksDelta = 0;
// P4-02 FIX: build stage_transitions from this session's review logs
let stageTransitions = [];
try {
const sessionLogs = await db.reviewLogs.findByUser(req.user.id, new Date(session.started_at)).catch(() => []);
for (const log of sessionLogs) {
if (
log.session_id === session_id &&
log.new_stage !== undefined &&
log.previous_stage !== undefined &&
log.new_stage > log.previous_stage
) {
stageTransitions.push({
card_id: log.card_id,
from: log.previous_stage,
to: log.new_stage,
});
}
}
} catch (e) { / non-fatal / }
if (deck?.subject_id) {
// P4-01 FIX: compute ksDelta pre/post recalculation
const preKsDoc = await db.subjectStats.get(req.user.id, deck.subject_id).catch(() => null);
const preKsScore = preKsDoc?.knowledge_score || 0;
await persistKnowledgeScore(req.user.id, deck.subject_id);
const postKs = await computeKnowledgeScore(req.user.id, deck.subject_id).catch(() => ({ score: preKsScore }));
ksDelta = parseFloat(((postKs.score || 0) - preKsScore).toFixed(2));
const pressureAfterSession = await calculateSubjectPressure(req.user.id, deck.subject_id);
if (pressureAfterSession?.intervention_level === 'L4') {
triggerReckoning(req.user.id, deck.subject_id).catch(() => {});
}
// PB.9: Update all active bubble trajectories + stall checks for this user [DESIGN: §15.2]
await updateAllBubblesForUser(req.user.id).catch(() => {});
}
// Check achievements
const sessionFull = await db.sessions.findByIdFull(req.user.id, session_id);
const newAchievements = await checkAchievements(req.user.id, {
deckId: session.deck_id,
session: sessionFull,
sessionStart: session.started_at,
sessionCompleted: completed,
seedGrowth: 100, // approximate
});
await updateTaskProgress(req.user.id, sessionFull);
// BUG-6 FIX: detect subject resurrection from Neglected zone and record flag
if (deck?.subject_id) {
try {
const prevSubStat = await db.subjectStats.get(req.user.id, deck.subject_id);
const daysSinceLastStudied = prevSubStat?.last_study_date
? Math.floor((Date.now() - new Date(prevSubStat.last_study_date).getTime()) / 86400000)
: 0;
if (prevSubStat?.last_zone_state === 'Neglected' && daysSinceLastStudied >= 14) {
await db.subjectStats.update(req.user.id, deck.subject_id, { was_neglected_then_resumed: true });
}
} catch (_e) { /* non-fatal */ }
}
// Phase 6: Check almanac unlocks — P6.4 FIX: capture return value to send in response
const newAlmanacUnlocks = await checkAlmanacUnlocks(req.user.id).catch(() => []);

    res.json({
      session_id,
      session_completed: completed,
      duration_seconds: durationSec,
      cards_reviewed: session.cards_reviewed || 0,
      xp_earned: session.xp_earned || 0,
      focus_seed_stage: focusStage,
      // M4 FIX: stageLabel removed — was duplicate of focus_seed_stage and
      // misleadingly named (implies KiwiTree stage, not seed stage)
      seed_survived: seedSurvived,
      new_achievements: newAchievements,
      streak: stats.current_streak,
      tree_health: stats.tree_health,
      tree_stage: stats.tree_stage,
      // P6.4 FIX: Include almanac unlocks so frontend can show notification
      new_almanac_unlocks: newAlmanacUnlocks,
      // P4-01 FIX: include ksDelta (snake_case + camelCase for compat)
      ks_delta: ksDelta,
      ksDelta: ksDelta,
      // P4-02 FIX: build stage_transitions from this session's review logs
      stage_transitions: stageTransitions,
    });

} catch (e) {
res.status(500).json({ error: 'Failed to end session', details: e.message });
}
});

studyRouter.get('/due-today', async (req, res) => {
try {
const cards = await db.cards.findAllForUser(req.user.id);
const now = new Date();
const due = cards.filter((c) => isCardDue(c, now));
res.json({ count: due.length, cards: due });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch due cards' });
}
});

studyRouter.get('/stats', async (req, res) => {
try {
const stats = await db.userStats.get(req.user.id);
if (!stats) return res.status(404).json({ error: 'Stats not found' });
const nextStage = computeDaysUntilNextStage(stats);
res.json({ ...stats, is_streak_frozen: !!(stats?.streak_shield_held), next_stage_requirements: nextStage });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch stats' });
}
});

studyRouter.get('/review-heatmap', async (req, res) => {
try {
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const logs = await db.reviewLogs.findByUser(req.user.id, thirtyDaysAgo);
const heatmap = {};
logs.forEach((l) => {
const d = new Date(l.reviewed_at).toISOString().split('T')[0];
heatmap[d] = (heatmap[d] || 0) + 1;
});
res.json(heatmap);
} catch (e) {
res.status(500).json({ error: 'Failed to generate heatmap' });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  EXAM ROUTES

// ════════════════════════════════════════════════════════════════════════════
const examRouter = express.Router();

examRouter.use(authenticate);

examRouter.use(reckoningLockout);
// POST /exams/generate — alias for POST /exams/ with camelCase body normalization

examRouter.post('/generate', async (req, res) => {
try {
// Normalize camelCase to snake_case
const body = req.body;
if (body.subjectId && !body.subject_id) body.subject_id = body.subjectId;
if (body.deckIds && !body.deck_ids) body.deck_ids = body.deckIds;
if (body.count && !body.question_count) body.question_count = body.count;
if (body.questionCount && !body.question_count) body.question_count = body.questionCount;
const {
subject_id,
deck_ids,
question_count = 25,
card_range = 'all',
time_limit_seconds = 1800,
} = body;
if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
const targetDeckIds =
deck_ids && deck_ids.length > 0
? deck_ids
: (await db.decks.findBySubject(req.user.id, subject_id)).map((d) => d.id);
if (targetDeckIds.length === 0)
return res.status(400).json({ error: 'No decks available for this subject' });
let allCards = [];
for (const deckId of targetDeckIds) {
const cards = await db.cards.findByDeck(req.user.id, deckId);
allCards.push(...cards);
}
// P3.7-B1b FIX: when is_reckoning, use the flagged card pool stored on the
// reckoning session — not the standard stage>=3 filter which excludes GHOST/STUCK.
// P3.5 FIX: support card_state_filter for all non-reckoning exams.
// P3-C3 FIX: FE sends card_state_filter as an array of active chip values
// (e.g. ['DANGEROUS', 'GHOST']) and chip values are UPPERCASE.  Normalise
// here so the switch statement below always receives a lowercase scalar.
const raw_csf = body.card_state_filter;
const card_state_filter = Array.isArray(raw_csf)
? (raw_csf.length === 0
? 'all'
: raw_csf.length === 1
? raw_csf[0].toLowerCase()
: 'mixed_priority')
: ((raw_csf || 'all').toLowerCase());
let selectedCards;
let sourceCards;

const isReckoningExam = !!(body.is_reckoning || body.reckoning_id);
if (isReckoningExam) {
// Reckoning: load flagged pool from session document
const activeReck = await db.reckoningSessions.findActiveByUser(req.user.id).catch(() => null);
const flaggedIds = activeReck?.flagged_card_ids || [];
if (flaggedIds.length > 0) {
const flaggedPool = (await Promise.all(
  flaggedIds.map((id) => db.cards.findById(req.user.id, id).catch(() => null))
)).filter(Boolean);
const reckoningCount = activeReck.question_count || question_count;
sourceCards = flaggedPool;

// PB.11: Weight Bubble cards 3× in the Reckoning selection pool [DESIGN: §15.2]
// After weighting, deduplicate so each card appears once in the final question set.
// Non-fatal: falls back to unweighted selection if Bubble query fails.
try {
  const activeBubbles = await db.masteryGoals.findActive(req.user.id).catch(() => []);
  const bubbleCardSet  = activeBubbles.length > 0
    ? new Set(activeBubbles.flatMap((g) => g.card_ids || []))
    : new Set();
  const weightedPool = [];
  for (const card of flaggedPool) {
    weightedPool.push(card);
    if (bubbleCardSet.has(card.id)) {
      weightedPool.push(card, card); // 3× total for Bubble cards
    }
  }
  const seenIds = new Set();
  selectedCards = weightedPool
    .sort(() => 0.5 - Math.random())
    .filter((c) => (seenIds.has(c.id) ? false : seenIds.add(c.id)))
    .slice(0, Math.min(reckoningCount, flaggedPool.length));
} catch (_e) {
  // Non-fatal fallback: standard unweighted selection
  selectedCards = flaggedPool
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.min(reckoningCount, flaggedPool.length));
}
}
}

if (!selectedCards) {
// Non-reckoning path: apply card_state_filter
const stateFilteredCards = [];
const flaggedStates = [CARD_STATES.DANGEROUS, CARD_STATES.GHOST, CARD_STATES.STUCK,
CARD_STATES.FRAGILE, CARD_STATES.AVOIDED];
for (const card of allCards) {
let stateDoc = await db.cardStates.get(req.user.id, card.id);
if (!stateDoc) stateDoc = await initializeCardState(req.user.id, card.id);
const st = stateDoc.state;
let include = false;
switch (card_state_filter) {
case 'dangerous': include = (st === CARD_STATES.DANGEROUS); break;
case 'ghost':     include = (st === CARD_STATES.GHOST); break;
case 'stuck':     include = (st === CARD_STATES.STUCK); break;
case 'fragile':   include = (st === CARD_STATES.FRAGILE); break;
case 'avoided':   include = (st === CARD_STATES.AVOIDED); break;
case 'mixed_priority':
if (flaggedStates.includes(st)) {
stateFilteredCards.push(card, card, card); // weight 3×
continue;
}
include = card.stage >= 3;
break;
case 'all':
default:
include = card.stage >= 3 && ![CARD_STATES.GHOST, CARD_STATES.STUCK].includes(st);
}
if (include) stateFilteredCards.push(card);
}
// Deduplicate mixed_priority weighted copies
const seenIds = new Set();
const dedupedCards = stateFilteredCards.filter(c => seenIds.has(c.id) ? false : seenIds.add(c.id));
sourceCards = dedupedCards.length > 0 ? dedupedCards : allCards;
if (sourceCards.length === 0)
return res.status(400).json({ error: 'No cards available for exam.' });
selectedCards = sourceCards
.sort(() => 0.5 - Math.random())
.slice(0, Math.min(question_count, sourceCards.length));
}
const count = selectedCards.length;
const examSession = await db.examSessions.create(req.user.id, {
subject_id,
deck_ids: targetDeckIds,
question_count: count,
card_range,
time_limit_seconds,
status: 'ready',
});
const notes = selectedCards
.map((c) => `Q: ${c.front_content}\nA: ${c.back_content}`)
.join('\n\n');
if (checkAIRateLimit(req.user.id, 'cbt_generation', 10)) {
const fallbackQuestions = generateFallbackExamQuestions(selectedCards, examSession.id, count);
await Promise.all(
fallbackQuestions.map((q) => db.examQuestions.create(req.user.id, examSession.id, q))
);
} else {
try {
const aiText = await generateCBTQuestions(notes, count);
if (!aiText) throw new Error('AI returned null');
const questions = parseCBTResponse(aiText, examSession.id, selectedCards);
await Promise.all(
questions.map((q) => db.examQuestions.create(req.user.id, examSession.id, q))
);
} catch (e) {
const fallbackQuestions = generateFallbackExamQuestions(
selectedCards,
examSession.id,
count
);
await Promise.all(
fallbackQuestions.map((q) => db.examQuestions.create(req.user.id, examSession.id, q))
);
}
}
const readyExam = await db.examSessions.findByIdWithQuestions(req.user.id, examSession.id);
// Bug 1+2 fix: Link reckoning session to exam if this is a reckoning exam
if (body.is_reckoning || body.reckoning_id) {
try {
const activeReckoning = await db.reckoningSessions.findActiveByUser(req.user.id);
if (activeReckoning) {
await startReckoningExam(activeReckoning.id, examSession.id);
}
} catch (e) {
/ non-fatal — reckoning link failure must not break exam delivery /
}
}
res.status(201).json(readyExam);
} catch (e) {
res.status(500).json({ error: 'Failed to generate exam', details: e.message });
}
});

examRouter.post('/', async (req, res) => {
try {
const {
subject_id,
deck_ids,
question_count = 25,
card_range = 'all',
time_limit_seconds = 1800,
} = req.body;
if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
const targetDeckIds =
deck_ids && deck_ids.length > 0
? deck_ids
: (await db.decks.findBySubject(req.user.id, subject_id)).map((d) => d.id);
if (targetDeckIds.length === 0)
return res.status(400).json({ error: 'No decks available for this subject' });
let allCards = [];
for (const deckId of targetDeckIds) {
const cards = await db.cards.findByDeck(req.user.id, deckId);
allCards.push(...cards);
}
// Phase 3: State-filtered selection — P3.5 FIX: support card_state_filter.
const { card_state_filter: stateFilter = 'all' } = req.body;
const flaggedStatesPool = [CARD_STATES.DANGEROUS, CARD_STATES.GHOST, CARD_STATES.STUCK,
CARD_STATES.FRAGILE, CARD_STATES.AVOIDED];
const stateFilteredPool = [];
for (const card of allCards) {
let stateDoc = await db.cardStates.get(req.user.id, card.id);
if (!stateDoc) stateDoc = await initializeCardState(req.user.id, card.id);
const st = stateDoc.state;
let include = false;
switch (stateFilter) {
case 'dangerous': include = (st === CARD_STATES.DANGEROUS); break;
case 'ghost':     include = (st === CARD_STATES.GHOST); break;
case 'stuck':     include = (st === CARD_STATES.STUCK); break;
case 'fragile':   include = (st === CARD_STATES.FRAGILE); break;
case 'avoided':   include = (st === CARD_STATES.AVOIDED); break;
case 'mixed_priority':
if (flaggedStatesPool.includes(st)) { stateFilteredPool.push(card, card, card); continue; }
include = card.stage >= 3;
break;
case 'all':
default:
include = card.stage >= 3 && ![CARD_STATES.GHOST, CARD_STATES.STUCK].includes(st);
}
if (include) stateFilteredPool.push(card);
}
const seenFilterIds = new Set();
const eligibleCards = stateFilteredPool.filter(c => seenFilterIds.has(c.id) ? false : seenFilterIds.add(c.id));
if (eligibleCards.length === 0)
return res.status(400).json({ error: 'No eligible cards for exam. Need Stage 3+ cards.' });
const selectedCards = eligibleCards
.sort(() => 0.5 - Math.random())
.slice(0, Math.min(question_count, eligibleCards.length));
const count = selectedCards.length;
const examSession = await db.examSessions.create(req.user.id, {
subject_id,
deck_ids: targetDeckIds,
question_count: count,
card_range,
time_limit_seconds,
status: 'ready',
});
const sourceCards = selectedCards;
const notesChunks = selectedCards.map((c) => `Q: ${c.front_content}\nA: ${c.back_content}`);
const notes = notesChunks.join('\n\n');
if (checkAIRateLimit(req.user.id, 'cbt_generation', 10)) {
// Bug 4 fix: rate-limited → fall back silently, never return 429 to user
const fallbackQuestions = generateFallbackExamQuestions(selectedCards, examSession.id, count);
await Promise.all(
fallbackQuestions.map((q) => db.examQuestions.create(req.user.id, examSession.id, q))
);
} else {
try {
const aiText = await generateCBTQuestions(notes, count);
const questions = parseCBTResponse(aiText, examSession.id, sourceCards);
await Promise.all(
questions.map((q) => db.examQuestions.create(req.user.id, examSession.id, q))
);
} catch (e) {
// B25 fallback: generate simple rule-based questions from cards
const fallbackQuestions = generateFallbackExamQuestions(
selectedCards,
examSession.id,
count
);
await Promise.all(
fallbackQuestions.map((q) => db.examQuestions.create(req.user.id, examSession.id, q))
);
}
}
const readyExam = await db.examSessions.findByIdWithQuestions(req.user.id, examSession.id);
res.status(201).json(readyExam);
} catch (e) {
res.status(500).json({ error: 'Failed to create exam', details: e.message });
}
});

examRouter.get('/', async (req, res) => {
try {
const { status, page = 1, limit = 20 } = req.query;
const exams = await db.examSessions.findMany(
req.user.id,
{ status },
{ limit: parseInt(limit), offset: (page - 1) * limit }
);
res.json(exams);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch exams' });
}
});

examRouter.get('/:id', async (req, res) => {
try {
const exam = await db.examSessions.findByIdWithQuestions(req.user.id, req.params.id);
if (!exam) return res.status(404).json({ error: 'Exam not found' });
// Normalize questions for frontend: add options[] array from option_a/b/c/d
if (exam.questions && Array.isArray(exam.questions)) {
exam.questions = exam.questions.map((q) => ({
...q,
id: q.id || q.question_number || Math.random().toString(36).slice(2),
options: [
{ id: 'A', text: q.option_a || '' },
{ id: 'B', text: q.option_b || '' },
{ id: 'C', text: q.option_c || '' },
{ id: 'D', text: q.option_d || '' },
].filter((opt) => opt.text),
correctAnswer: q.correct_answer || 'A',
}));
}
res.json(exam);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch exam' });
}
});

examRouter.post('/:id/start', async (req, res) => {
try {
const exam = await db.examSessions.update(req.user.id, req.params.id, {
status: 'active',
started_at: new Date(),
});
res.json(exam);
} catch (e) {
res.status(500).json({ error: 'Failed to start exam' });
}
});

examRouter.get('/:id/question/:number', async (req, res) => {
try {
const question = await db.examQuestions.findByNumber(
req.user.id,
req.params.id,
parseInt(req.params.number)
);
if (!question) return res.status(404).json({ error: 'Question not found' });
const { correct_answer, explanation, ...safeQuestion } = question;
res.json(safeQuestion);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch question' });
}
});

examRouter.post('/:id/submit', async (req, res) => {
try {
const { answers, ended_early = false } = req.body;
if (!answers || !Array.isArray(answers))
return res.status(400).json({ error: 'answers array required' });
// Validate answer shapes
for (const a of answers) {
const qn = a.question_number ?? a.questionId;
const so = a.selected_option ?? a.selectedOptionId;
if (qn === undefined || so === undefined) {
return res
.status(400)
.json({
error:
'Each answer must have question_number/questionId and selected_option/selectedOptionId',
});
}
if (typeof qn !== 'number' && typeof qn !== 'string') {
return res.status(400).json({ error: 'question_number must be a number' });
}
if (typeof so !== 'string' || !/^[A-D]/.test(so)) {
return res.status(400).json({ error: 'selected_option must be a single letter A-D' });
}
}
const exam = await db.examSessions.findByIdWithQuestions(req.user.id, req.params.id);
if (!exam) return res.status(404).json({ error: 'Exam not found' });
if (exam.status !== 'active') return res.status(400).json({ error: 'Exam not active' });
// Store pre-exam KS for delta calculation
const preKs = await computeKnowledgeScore(req.user.id, exam.subject_id).catch(() => ({
score: 0,
}));
const preKsScore = preKs.score || 0;
let correct = 0,
total = exam.questions.length;
const questionResults = [];
for (const q of exam.questions) {
const answer = answers.find((a) => (a.question_number ?? a.questionId) === q.question_number);
const selectedOption = answer ? (answer.selected_option ?? answer.selectedOptionId) : null;
const isCorrect = answer && selectedOption === q.correct_answer;
if (isCorrect) correct++;
questionResults.push({
question_number: q.question_number,
selected: selectedOption || null,
correct: isCorrect,
correct_answer: q.correct_answer,
});
if (answer) {
await db.examQuestions.update(req.user.id, q.id, {
selected_option: selectedOption,
is_correct: isCorrect,
time_spent_seconds: answer.time_spent_seconds || 0,
});
}
}
const scorePct = total > 0 ? parseFloat(((correct / total) * 100).toFixed(2)) : 0;
const now = new Date();
const durationSec = exam.started_at ? Math.floor((now - new Date(exam.started_at)) / 1000) : 0;
const completedExam = await db.examSessions.update(req.user.id, req.params.id, {
status: 'completed',
score_pct: scorePct,
correct_answers: correct,
total_questions: total,
ended_early,
completed_at: now,
duration_seconds: durationSec,
});
// Phase 2: Stage 5 verification
const verification = await processExamVerification(req.user.id, completedExam);
// Phase 3: SRS feedback loop
const reclassified = await applyExamSRSFeedback(req.user.id, completedExam);
// P3.10 FIX: L3 Reclassification Alert — fire D3 when exam score < 60%
// and subject has 15+ Stage 4-5 cards. Function and alert were entirely missing.
if (scorePct < 60 && reclassified.length > 0) {
const allSubjectCardsForAlert = [];
for (const deckId of exam.deck_ids || []) {
const deckCards = await db.cards.findByDeck(req.user.id, deckId).catch(() => []);
allSubjectCardsForAlert.push(...deckCards);
}
const highStageCardsForAlert = allSubjectCardsForAlert.filter(c => c.stage >= 4);
if (highStageCardsForAlert.length >= 15) {
const reclassifiedHighStage = reclassified.filter(r => r.old_stage >= 4);
await triggerReclassificationAlert(
req.user.id, exam.subject_id, scorePct, reclassifiedHighStage
).catch(() => {});
}
}
// Phase 3: Credential evaluation
const credential = await evaluateCredential(req.user.id, exam.subject_id);
const regression = await checkCredentialRegression(req.user.id, exam.subject_id);
// P3-03 FIX: fetch existing BEFORE the block that reads it
const existing = await db.subjectStats.get(req.user.id, exam.subject_id);
// P8.1d: Award +3 Seedlings per credential tier gained (spec P8.1)
{
const prevCredTier = existing?.credential_tier || 0;
if (credential && credential.tier > prevCredTier) {
const tiersGained = credential.tier - prevCredTier;
await awardSeedlings(
req.user.id,
tiersGained * 3,
'credential_tier_advance',
`Credential advanced to tier ${credential.tier} in subject ${exam.subject_id}`
).catch(() => {});
// Persist the new tier so future exams measure delta correctly
await db.subjectStats.upsert(req.user.id, exam.subject_id, {
credential_tier: credential.tier,
}).catch(() => {});
}
}
// Update user stats
await db.userStats.update(req.user.id, {
total_exams_completed: FieldValue.increment(1),
});
// Phase 8: Seedling earnings
if (scorePct >= 80)
await hookSeedlingEarnings(req.user.id, 'exam_pass', { score_pct: scorePct });
if (scorePct === 100)
await hookSeedlingEarnings(req.user.id, 'exam_perfect', { score_pct: scorePct });
// Subject stats (re-uses existing fetched above)
const currentAvg = existing?.average_exam_score || 0;
const totalExams = (existing?.total_exams || 0) + 1;
const newAvg = parseFloat(((currentAvg * (totalExams - 1) + scorePct) / totalExams).toFixed(2));
await db.subjectStats.upsert(req.user.id, exam.subject_id, {
average_exam_score: newAvg,
total_exams: totalExams,
last_exam_at: now,
});
// Recalculate health and pressure
await recalculateSubjectHealth(req.user.id, exam.subject_id);
const pressureAfterExam = await calculateSubjectPressure(req.user.id, exam.subject_id);
if (pressureAfterExam?.intervention_level === 'L4') {
triggerReckoning(req.user.id, exam.subject_id).catch(() => {});
}
await persistKnowledgeScore(req.user.id, exam.subject_id);
// Compute KS delta
const postKs = await computeKnowledgeScore(req.user.id, exam.subject_id).catch(() => ({
score: preKsScore,
}));
const ksDelta = parseFloat(((postKs.score || 0) - preKsScore).toFixed(2));
// Determine pass/fail (70% threshold)
const passed = scorePct >= 70;
// Credential earned check
const credentialEarned = !!(credential && credential.tier && credential.newlyEarned);
// Check achievements
const newAchievements = await checkAchievements(req.user.id, {
exam: completedExam,
subjectId: exam.subject_id,
});
await updateTaskProgress(req.user.id, null, completedExam);
// B13: Almanac unlock check after exam submission — P6.4 FIX: capture return value
const examAlmanacUnlocks = await checkAlmanacUnlocks(req.user.id).catch((e) => {
console.error('[KIWI] Almanac check failed:', e.message);
return [];
});

    // Auto-generate debrief
    let debriefText = '';
    try {
      const wrong = questionResults.filter((qr) => !qr.correct);
      if (wrong.length === 0) {
        debriefText =
          'Perfect score! Every card in this exam was correctly answered. Your mastery is verified.';
      } else {
        const weakCardFronts = [];
        const weakSubjects = new Map();
        for (const qr of wrong) {
          const q = exam.questions.find((eq) => eq.question_number === qr.question_number);
          if (q && q.card_id) {
            const card = await db.cards.findById(req.user.id, q.card_id).catch(() => null);
            if (card) {
              weakCardFronts.push(`"${(card.front_content || card.front || '').slice(0, 70)}"`);
              if (card.deck_id) {
                const deck = await db.decks.findById(req.user.id, card.deck_id).catch(() => null);
                if (deck?.subject_id)
                  weakSubjects.set(deck.subject_id, (weakSubjects.get(deck.subject_id) || 0) + 1);
              }
            }
          }
        }
        let weakAreas = [];
        for (const [subjectId, count] of weakSubjects) {
          const subject = await db.subjects.findById(subjectId).catch(() => null);
          if (subject)
            weakAreas.push({
              subject_id: subjectId,
              subject_name: subject.name,
              incorrect_count: count,
            });
        }
        try {
          const aiDebriefPrompt = `## ROLE

You are KIWI's Exam Debrief Analyst — a concise, analytical voice who helps students understand their exam performance.
EXAM DATA
// P3.8-B1 FIX: changed {var} to \${var} — template literal interpolation was broken.
Score: {scorePct}% ({correct}/{total} correct)
Incorrect questions ({wrong.length}): The student failed these specific concepts:
{weakCardFronts.slice(0, 8).join('\n')}
Weak subject areas: {weakAreas.map((a) => a.subject_name + ' (' + a.incorrect_count + ' wrong)').join(', ') || 'general'}
RULES
- Write exactly 3 paragraphs.
- Paragraph 1: Honest overall assessment of the score. Reference specific concepts that were missed.
- Paragraph 2: Identify the pattern — why are these cards difficult? (conceptual gaps, memory fragility, exam pressure?)
- Paragraph 3: Two precise, actionable next steps — which cards to review first and why.
- Tone: Direct, analytical, but supportive. No empty praise.
- Total length: 150-250 words.
OUTPUT
Return only the debrief text.`;
          const aiResult = await geminiModel.generateContent(aiDebriefPrompt);
          debriefText = aiResult.response.text().trim();
        } catch (_) {
          debriefText =
            `You scored ${scorePct}%, getting ${correct} of ${total} correct. ` +
            (wrong.length > 0
              ? `${wrong.length} card${wrong.length > 1 ? 's' : ''} were answered incorrectly.`
              : '') +
            (weakAreas.length > 0 ? ` The weakest area was ${weakAreas[0].subject_name}.` : '') +
            `\n\nThe missed concepts suggest gaps that require active review — not passive re-reading. Focus on the failing cards using spaced repetition.` +
            `\n\nRecommended next step: Review the ${Math.min(wrong.length, 5)} failed cards immediately, then schedule an exam in 3 days to re-test retention.`;
        }
      }
    } catch (debriefErr) {
      debriefText = `Exam complete. Score: ${scorePct}%. Review missed cards to strengthen retention.`;
    }
    // Notify via Telegram if configured
    await sendTelegramExamResult(req.user.id, exam.subject_id, scorePct, passed).catch(() => {});
    res.json({
      exam: completedExam,
      score_pct: scorePct,
      correct_answers: correct,
      total_questions: total,
      duration_seconds: durationSec,
      question_results: questionResults,
      verification,
      reclassified,
      credential,
      regression_warning: regression,
      // [Fix 3.3] Frontend reads reclassification_alert_text for the Brain alert panel.
      // Sourced from the AI-generated regression_warning message (P3.10 output).
      reclassification_alert_text: (regression && regression.message) || null,
      new_achievements: newAchievements,
      debrief: debriefText,
      ksDelta,
      passed,
      credentialEarned,
      // P6.4 FIX: Include almanac unlocks so frontend can show notification
      new_almanac_unlocks: examAlmanacUnlocks,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit exam', details: e.message });
  }
});
// B24: AI-powered exam debrief

examRouter.get('/:id/debrief', async (req, res) => {
try {
const exam = await db.examSessions.findByIdWithQuestions(req.user.id, req.params.id);
if (!exam || exam.status !== 'completed')
return res.status(400).json({ error: 'Exam not completed' });
const wrong = exam.questions.filter((q) => !q.is_correct);
const correct = exam.questions.filter((q) => q.is_correct);
const weakSubjects = new Map();
const wrongCardFronts = [];
for (const q of wrong) {
if (q.card_id) {
const card = await db.cards.findById(req.user.id, q.card_id).catch(() => null);
if (card) {
wrongCardFronts.push(`"${(card.front_content || '').slice(0, 70)}"`);
if (card.deck_id) {
const deck = await db.decks.findById(req.user.id, card.deck_id).catch(() => null);
if (deck?.subject_id)
weakSubjects.set(deck.subject_id, (weakSubjects.get(deck.subject_id) || 0) + 1);
}
}
}
}
let weakAreas = [];
for (const [subjectId, count] of weakSubjects) {
const subject = await db.subjects.findById(subjectId).catch(() => null);
if (subject)
weakAreas.push({
subject_id: subjectId,
subject_name: subject.name,
incorrect_count: count,
});
}
if (wrong.length === 0) {
return res.json({
debrief:
'Perfect score! Every card in this exam was correctly answered. Your mastery is verified.',
weak_areas: [],
recommended_cards: [],
});
}
// B24: Generate AI-powered debrief
let debriefText;
try {
const aiDebriefPrompt = `
ROLE
You are KIWI\'s Exam Debrief Analyst — a concise, analytical voice who helps students understand their exam performance.
EXAM DATA
Score: {exam.score_pct}% ({exam.correct_answers}/{exam.total_questions} correct)
Incorrect questions ({wrong.length}): The student failed these specific concepts:
{wrongCardFronts.slice(0, 8).join('\n')}
Weak subject areas: {weakAreas.map((a) => a.subject_name + ' (' + a.incorrect_count + ' wrong)').join(', ') || 'general'}
RULES
- Write exactly 3 paragraphs.
- Paragraph 1: Honest overall assessment of the score. Reference specific concepts that were missed.
- Paragraph 2: Identify the pattern — why are these cards difficult? (conceptual gaps, memory fragility, exam pressure?)
- Paragraph 3: Two precise, actionable next steps — which cards to review first and why.
- Tone: Direct, analytical, but supportive. No empty praise.
- Total length: 150-250 words.
OUTPUT
Return only the debrief text.
`;
      const aiResult = await geminiModel.generateContent(aiDebriefPrompt);
      debriefText = aiResult.response.text().trim();
    } catch (_) {
      // B25 fallback: structured non-AI debrief
      debriefText =
        `You scored ${exam.score_pct}%, getting ${exam.correct_answers} of ${exam.total_questions} correct. ` +
        (wrong.length > 0
          ? `${wrong.length} card${wrong.length > 1 ? 's' : ''} were answered incorrectly.`
          : '') +
        (weakAreas.length > 0 ? ` The weakest area was ${weakAreas[0].subject_name}.` : '') +
        `\n\nThe missed concepts suggest gaps that require active review — not passive re-reading. Focus on the failing cards using spaced repetition.` +
        `\n\nRecommended next step: Review the ${Math.min(wrong.length, 5)} failed cards immediately, then schedule an exam in 3 days to re-test retention.`;
    }
    res.json({
      score_pct: exam.score_pct,
      correct_answers: exam.correct_answers,
      total_questions: exam.total_questions,
      debrief: debriefText,
      weak_areas: weakAreas,
      recommended_cards: wrong.filter((q) => q.card_id).map((q) => q.card_id),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate debrief', details: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  TASK ROUTES

// ════════════════════════════════════════════════════════════════════════════
const taskRouter = express.Router();

taskRouter.use(authenticate);

taskRouter.use(reckoningLockout);

taskRouter.get('/', async (req, res) => {
try {
const tasks = await db.tasks.findMany(req.user.id, { status: 'active' });
res.json(tasks);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch tasks' });
}
});

taskRouter.get('/refresh', async (req, res) => {
try {
await generateTasksForUser(req.user.id);
const tasks = await db.tasks.findMany(req.user.id, { status: 'active' });
res.json(tasks);
} catch (e) {
res.status(500).json({ error: 'Failed to refresh tasks' });
}
});

taskRouter.get('/completed', async (req, res) => {
try {
const tasks = await db.tasks.findMany(req.user.id, { status: 'completed' });
res.json(tasks);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch completed tasks' });
}
});

taskRouter.get('/history', async (req, res) => {
try {
const tasks = await db.tasks.findMany(req.user.id, {});
res.json(tasks);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch task history' });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  COMMUNITY ROUTES

// ════════════════════════════════════════════════════════════════════════════
const communityRouter = express.Router();

communityRouter.use(authenticate);

communityRouter.use(reckoningLockout);

communityRouter.get('/decks', async (req, res) => {
try {
const { search, tags, page = 1, limit = 20 } = req.query;
const result = await db.communityDecks.findMany(
{ search, tags },
{ page: parseInt(page), limit: parseInt(limit) }
);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch community decks' });
}
});

communityRouter.get('/decks/:id', async (req, res) => {
try {
const deck = await db.communityDecks.findByIdWithOriginalCards(req.params.id);
if (!deck) return res.status(404).json({ error: 'Community deck not found' });
res.json(deck);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch community deck' });
}
});

communityRouter.post('/decks/:id/clone', async (req, res) => {
try {
const communityDeck = await db.communityDecks.findByIdWithOriginalCards(req.params.id);
if (!communityDeck) return res.status(404).json({ error: 'Community deck not found' });
const newDeck = await db.decks.create(req.user.id, {
name: `${communityDeck.title || 'Cloned'} (Clone)`,
description: communityDeck.description,
subject_id: req.body.subject_id || null,
card_count: (communityDeck.originalDeck?.cards || []).length,
is_public: false,
});
const originalCards = communityDeck.originalDeck?.cards || [];
if (originalCards.length > 0) {
const cardsData = originalCards.map((c) => ({
front_content: c.front_content,
back_content: c.back_content,
front_image_url: c.front_image_url,
back_image_url: c.back_image_url,
tags: c.tags || [],
}));
const created = await db.cards.createMany(req.user.id, newDeck.id, cardsData);
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
}
// FIX #4c: Recalculate KS after community clone
if (newDeck.subject_id) {
await persistKnowledgeScore(req.user.id, newDeck.subject_id).catch(() => {});
}
await db.communityDecks.update(req.params.id, { clone_count: FieldValue.increment(1) });
const clonedDeck = await db.decks.findByIdFull(req.user.id, newDeck.id);
res.status(201).json({ message: 'Deck cloned successfully', deck: clonedDeck });
} catch (e) {
res.status(500).json({ error: 'Failed to clone deck', details: e.message });
}
});
// POST /api/community/import — clone a community deck by deckId in body

communityRouter.post('/import', async (req, res) => {
try {
const { deckId, subject_id } = req.body;
if (!deckId) return res.status(400).json({ error: 'deckId required' });
const communityDeck = await db.communityDecks.findByIdWithOriginalCards(deckId);
if (!communityDeck) return res.status(404).json({ error: 'Community deck not found' });
const newDeck = await db.decks.create(req.user.id, {
name: `${communityDeck.title || 'Cloned'} (Clone)`,
description: communityDeck.description,
subject_id: subject_id || null,
card_count: (communityDeck.originalDeck?.cards || []).length,
is_public: false,
});
const originalCards = communityDeck.originalDeck?.cards || communityDeck.sample_cards || [];
if (originalCards.length > 0) {
const cardsData = originalCards.map((c) => ({
front_content: c.front_content || c.front || '',
back_content: c.back_content || c.back || '',
tags: c.tags || [],
}));
const created = await db.cards.createMany(req.user.id, newDeck.id, cardsData);
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
}
await db.communityDecks.update(deckId, { clone_count: FieldValue.increment(1) });
// FIX #4d: Recalculate KS after community import
if (newDeck.subject_id) {
await persistKnowledgeScore(req.user.id, newDeck.subject_id).catch(() => {});
}
const clonedDeck = await db.decks.findByIdFull(req.user.id, newDeck.id);
res.status(201).json({ message: 'Deck imported successfully', deck: clonedDeck });
} catch (e) {
res.status(500).json({ error: 'Failed to import deck', details: e.message });
}
});

communityRouter.post('/decks/:id/rate', async (req, res) => {
try {
const { rating } = req.body;
if (!rating || rating < 1 || rating > 5)
return res.status(400).json({ error: 'Rating must be 1-5' });
await db.communityRatings.upsert(req.params.id, req.user.id, rating);
const allRatings = await db.communityRatings.findByDeck(req.params.id);
const avg =
allRatings.length > 0
? parseFloat((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length).toFixed(2))
: 0;
await db.communityDecks.update(req.params.id, { average_rating: avg });
res.json({ average_rating: avg, total_ratings: allRatings.length });
} catch (e) {
res.status(500).json({ error: 'Failed to rate deck' });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES

// ════════════════════════════════════════════════════════════════════════════
const adminRouter = express.Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/users', async (req, res) => {
try {
const users = await db.users.findAll();
const statsPromises = users.map(async (u) => {
const stats = await db.userStats.get(u.id);
return { ...u, password_hash: undefined, stats };
});
res.json(await Promise.all(statsPromises));
} catch (e) {
res.status(500).json({ error: 'Failed to fetch users' });
}
});

adminRouter.delete('/users/:id', async (req, res) => {
try {
const targetUser = await db.users.findById(req.params.id);
if (!targetUser) return res.status(404).json({ error: 'User not found' });
await db.users.delete(req.params.id);
await db.refreshTokens.deleteByUserId(req.params.id);
res.json({ message: 'User deleted' });
} catch (e) {
res.status(500).json({ error: 'Failed to delete user' });
}
});

adminRouter.get('/stats', async (req, res) => {
try {
const users = await db.users.findAll();
const statsList = await db.userStats.findAll();
const totalCards = (await db.cards.findAllForUser(null)).length;
const totalSessions = (await db.sessions.findMany(null, {}, { limit: 99999 })).total;
res.json({
total_users: users.length,
total_cards,
total_sessions: totalSessions,
average_level:
statsList.length > 0
? statsList.reduce((s, st) => s + st.current_level, 0) / statsList.length
: 0,
});
} catch (e) {
res.status(500).json({ error: 'Failed to fetch stats' });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  NEW PHASE ROUTES

// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
//  BUBBLE ROUTER (PB.12)  [DESIGN: §14]
// ════════════════════════════════════════════════════════════════════════════
const bubbleRouter = express.Router();
bubbleRouter.use(authenticate);
bubbleRouter.use(reckoningLockout);

// ── GET /api/bubbles — list all bubbles for user ──────────────────────────
bubbleRouter.get('/', async (req, res) => {
  try {
    const all = await db.masteryGoals.findByUser(req.user.id);
    const enriched = await Promise.all(all.map(async (g) => {
      const subject = await db.subjects.findById(g.subject_id).catch(() => null);
      return { ...g, subject_name: subject?.name || 'Unknown' };
    }));
    res.json({ bubbles: enriched });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch bubbles', details: e.message });
  }
});

// ── POST /api/bubbles — create bubble [DESIGN: §14] ──────────────────────
bubbleRouter.post('/', async (req, res) => {
  try {
    const { subject_id, deck_ids, exam_date, test_date, card_ids, name } = req.body;
    if (!subject_id || !exam_date)
      return res.status(400).json({ error: 'subject_id and exam_date required' });
    // GAP-M4: deck_ids is optional when card_ids is provided directly [DESIGN: §14]
    // Either deck_ids (resolved to card_ids server-side) or card_ids must be present.
    const hasDecks = deck_ids && Array.isArray(deck_ids) && deck_ids.length > 0;
    const hasCards = card_ids && Array.isArray(card_ids) && card_ids.length > 0;
    if (!hasDecks && !hasCards)
      return res.status(400).json({ error: 'Either deck_ids or card_ids must be provided' });
    const existingGoals = await db.masteryGoals.findActive(req.user.id);
    let resolvedCardIds = card_ids || [];
    if (resolvedCardIds.length === 0) {
      for (const deckId of deck_ids) {
        const cards = await db.cards.findByDeck(req.user.id, deckId).catch(() => []);
        resolvedCardIds.push(...cards.map((c) => c.id));
      }
    }
    const overlapResult = await detectAndMarkCrossBubbleCards(
      req.user.id, resolvedCardIds, existingGoals
    ).catch(() => ({ overlapping_card_count: 0, should_prompt_user: false }));

    const goal = await createMasteryGoal(req.user.id, {
      subject_id, deck_ids, name: name || null,
      exam_date: new Date(exam_date),
      test_date: test_date ? new Date(test_date) : null,
      card_ids:  resolvedCardIds,
    });
    // Stamp bubble_id onto each card_state
    for (const cardId of resolvedCardIds) {
      const st = await db.cardStates.get(req.user.id, cardId).catch(() => null);
      if (st) {
        const ids = st.bubble_ids || [];
        if (!ids.includes(goal.id)) {
          await db.cardStates
            .update(req.user.id, cardId, { bubble_ids: [...ids, goal.id] })
            .catch(() => {});
        }
      }
    }
    res.status(201).json({ ...goal, overlap: overlapResult });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create bubble', details: e.message });
  }
});

// ── GET /api/bubbles/debt — all learning debt cards [DESIGN: §14] ─────────
// ⚠ NEW in v2.0 — endpoint was missing from v1.0 plan
// NOTE: Route declared BEFORE /:id to avoid Express treating 'debt' as a param
bubbleRouter.get('/debt', async (req, res) => {
  try {
    const allStates = await db.cardStates.findByUser(req.user.id);
    const debtStates = allStates.filter((s) => s.learning_debt === true);
    const enriched = await Promise.all(debtStates.map(async (s) => {
      const card    = await db.cards.findById(req.user.id, s.card_id).catch(() => null);
      const subject = card?.subject_id
        ? await db.subjects.findById(card.subject_id).catch(() => null)
        : null;
      return card ? {
        card_id:      s.card_id,
        front:        card.front_content || '',
        state:        s.state,
        subject_name: subject?.name || 'Unknown',
        subject_id:   card.subject_id || null,
      } : null;
    }));
    res.json({ debt_cards: enriched.filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch learning debt', details: e.message });
  }
});

// ── POST /api/bubbles/overlap-check [DESIGN: §14, §8.2] ──────────────────
// ⚠ NEW in v2.0 — endpoint was missing from v1.0 plan
// Call before creating a bubble to surface the user prompt about shared cards
bubbleRouter.post('/overlap-check', async (req, res) => {
  try {
    const { card_ids, deck_ids } = req.body;
    let resolvedCardIds = card_ids || [];
    if (resolvedCardIds.length === 0 && deck_ids) {
      for (const deckId of (deck_ids || [])) {
        const cards = await db.cards.findByDeck(req.user.id, deckId).catch(() => []);
        resolvedCardIds.push(...cards.map((c) => c.id));
      }
    }
    const result = await checkBubbleOverlap(req.user.id, resolvedCardIds);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Overlap check failed', details: e.message });
  }
});

// ── GET /api/bubbles/:id ──────────────────────────────────────────────────
bubbleRouter.get('/:id', async (req, res) => {
  try {
    const goal = await db.masteryGoals.findById(req.user.id, req.params.id);
    if (!goal) return res.status(404).json({ error: 'Bubble not found' });
    const subject        = await db.subjects.findById(goal.subject_id).catch(() => null);
    const clusters       = await db.masteryGoals.getClusters(req.params.id).catch(() => []);
    const enrichedClusters = await Promise.all(clusters.map(async (c) => {
      const ks = await computeClusterKS(req.user.id, c).catch(() => c.cluster_ks || 0);
      return { ...c, cluster_ks: ks };
    }));
    // Surface gate_fail_message if present [DESIGN: §2.3]
    res.json({
      ...goal,
      subject_name: subject?.name || 'Unknown',
      clusters:     enrichedClusters,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch bubble', details: e.message });
  }
});

// ── PATCH /api/bubbles/:id — update deadline or test_date [DESIGN: §14] ──
// ⚠ CORRECTED from v1.0: PATCH not PUT [DESIGN: §14]
bubbleRouter.patch('/:id', async (req, res) => {
  try {
    const { exam_date, test_date, name } = req.body;
    const updates = {};
    if (exam_date)              updates.exam_date  = new Date(exam_date);
    if (test_date !== undefined) updates.test_date = test_date ? new Date(test_date) : null;
    if (name)                   updates.name       = name;
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'exam_date, test_date, or name required' });
    // G2: Transition DORMANT → active when exam_date is set for the first time [DESIGN: §12.1]
    if (exam_date) {
      const existingGoal = await db.masteryGoals.findById(req.user.id, req.params.id).catch(() => null);
      if (existingGoal?.status === 'dormant') updates.status = 'active';
    }
    const goal = await db.masteryGoals.update(req.user.id, req.params.id, updates);
    await updateBubbleTrajectory(req.user.id, req.params.id).catch(() => {});
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update bubble', details: e.message });
  }
});

// ── DELETE /api/bubbles/:id — soft archive [DESIGN: §14] ─────────────────
// ⚠ CORRECTED from v1.0: DELETE not POST /archive [DESIGN: §14]
bubbleRouter.delete('/:id', async (req, res) => {
  try {
    const result = await closeMasteryGoal(req.user.id, req.params.id, 'archived');
    res.json(result || { status: 'archived' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to archive bubble', details: e.message });
  }
});

// ── GET /api/bubbles/:id/trajectory [DESIGN: §14, §3.3] ──────────────────
bubbleRouter.get('/:id/trajectory', async (req, res) => {
  try {
    const goal = await db.masteryGoals.findById(req.user.id, req.params.id);
    if (!goal) return res.status(404).json({ error: 'Bubble not found' });
    const now          = new Date();
    const examDate     = goal.exam_date ? new Date(goal.exam_date) : null;
    const daysRemaining = examDate ? Math.max(0, Math.ceil((examDate - now) / 86400000)) : 0;
    const currentKS    = goal.current_ks || 0;
    const velocity     = computeVelocityFromGoal(goal);
    const required     = goal.required_ks_per_day || 0;
    const targetKS     = goal.target_ks || 100;
    const projections  = computeProjections(goal, currentKS, velocity, now);
    res.json({
      days_remaining:         daysRemaining,
      current_ks:             currentKS,
      target_ks:              targetKS,
      velocity,
      required_ks_per_day:    required,
      trajectory_status:      goal.trajectory_status || 'ON_TRACK',
      trajectory_gap:         goal.trajectory_gap || 0,
      phase:                  goal.phase,
      // Three projection lines [DESIGN: §3.3]
      projections: {
        best_case:      projections.bestCase      ? projections.bestCase.toISOString()      : null,
        current_pace:   projections.currentPace   ? projections.currentPace.toISOString()   : null,
        minimum_viable: projections.minimumViable ? projections.minimumViable.toISOString() : null,
        min_viable_rate: projections.minViableRate || 0,
      },
      // ⚠ MISS-3 FIX: flat aliases so frontend can read trajectory.projected_* directly
      // Frontend reads these at openBubbleDetailPanel lines: trajectory.projected_best_case etc.
      projected_best_case:       projections.bestCase      ? projections.bestCase.toISOString()      : null,
      projected_completion_date: projections.currentPace   ? projections.currentPace.toISOString()   : null,
      projected_minimum_viable:  projections.minimumViable ? projections.minimumViable.toISOString() : null,
      velocity_samples:  goal.velocity_samples || [],
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch trajectory', details: e.message });
  }
});

// ── GET /api/bubbles/:id/contract [DESIGN: §14, §9] ──────────────────────
bubbleRouter.get('/:id/contract', async (req, res) => {
  try {
    const contract = await generateDailyContract(req.user.id, req.params.id);
    if (!contract) return res.status(404).json({ error: 'Bubble not found' });
    const enriched = await Promise.all((contract.cards || []).map(async (cardId) => {
      const card     = await db.cards.findById(req.user.id, cardId).catch(() => null);
      const stateDoc = await db.cardStates.get(req.user.id, cardId).catch(() => null);
      return card ? {
        id:    cardId,
        front: card.front_content || '',
        state: stateDoc?.state || 'SEEDLING',
      } : null;
    }));
    res.json({
      ...contract,
      cards:            enriched.filter(Boolean),
      breakdown:        contract.daily_contract_breakdown,
      estimated_minutes: contract.daily_contract_minutes,
      consequence:      contract.daily_contract_consequence,
      miss_consequence: contract.miss_consequence,
      // ⚠ MISS-4 FIX: priority_cards — STUCK/FRAGILE/AVOIDED/DANGEROUS cards with names
      // Frontend reads contract.priority_cards to build "Cards Blocking Progress" panel
      // in CRITICAL/RESCUE state. Without this, named card rows never render.
      priority_cards: enriched.filter(Boolean).filter(
        (c) => ['STUCK','FRAGILE','AVOIDED','DANGEROUS'].includes(c.state)
      ),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch contract', details: e.message });
  }
});

// ── GET /api/bubbles/:id/history [DESIGN: §14] ───────────────────────────
// ⚠ NEW in v2.0 — endpoint was missing from v1.0 plan
bubbleRouter.get('/:id/history', async (req, res) => {
  try {
    const goal = await db.masteryGoals.findById(req.user.id, req.params.id);
    if (!goal) return res.status(404).json({ error: 'Bubble not found' });
    const history = await db.masteryGoals.getHistory(req.params.id, 90);
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history', details: e.message });
  }
});

// ── GET /api/bubbles/:id/clusters [DESIGN: §14, §7] ──────────────────────
bubbleRouter.get('/:id/clusters', async (req, res) => {
  try {
    const clusters = await db.masteryGoals.getClusters(req.params.id).catch(() => []);
    const enriched = await Promise.all(clusters.map(async (c) => {
      const ks     = await computeClusterKS(req.user.id, c).catch(() => c.cluster_ks || 0);
      const status = ks >= 80 ? 'MASTERED' : ks >= 60 ? 'STRONG' : ks >= 30 ? 'DEVELOPING' : 'WEAK';
      return { ...c, cluster_ks: ks, cluster_status: status };
    }));
    res.json({ clusters: enriched });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch clusters', details: e.message });
  }
});

// ── GET /api/bubbles/:id/autopsy [DESIGN: §14, §11] ──────────────────────
bubbleRouter.get('/:id/autopsy', async (req, res) => {
  try {
    const goal = await db.masteryGoals.findById(req.user.id, req.params.id);
    if (!goal) return res.status(404).json({ error: 'Bubble not found' });
    if (goal.status === 'active')
      return res.status(400).json({ error: 'Autopsy only available after bubble closes' });
    // [DESIGN: §11.1] Autopsy generated 24–48h after close
    if (goal.completed_at) {
      const hoursSinceClose = (new Date() - new Date(goal.completed_at)) / 3600000;
      if (hoursSinceClose < 24)
        return res.status(425).json({ error: 'Autopsy available 24 hours after bubble closes', available_in_hours: Math.ceil(24 - hoursSinceClose) });
    }
    const autopsy = await generateBubbleAutopsy(req.user.id, goal);
    // Mark autopsy as generated [DESIGN: §12.1]
    if (!goal.autopsy_generated) {
      await db.masteryGoals.update(req.user.id, req.params.id, {
        autopsy_generated:    true,
        autopsy_generated_at: new Date(),
      }).catch(() => {});
    }
    res.json({ autopsy });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate autopsy', details: e.message });
  }
});

// ── POST /api/bubbles/:id/advisory — AI advisory, day-level cache [DESIGN: §14, §16.1] ──
bubbleRouter.post('/:id/advisory', async (req, res) => {
  try {
    const goal = await db.masteryGoals.findById(req.user.id, req.params.id);
    if (!goal) return res.status(404).json({ error: 'Bubble not found' });
    const todayStr = new Date().toISOString().split('T')[0];
    const cacheKey = `bubble_advisory_${req.params.id}`;
    const cached   = await db.dailyRitualCache
      .get(req.user.id, cacheKey, todayStr).catch(() => null);
    if (cached?.data) return res.json({ advisory: cached.data, cached: true });
    const subject  = await db.subjects.findById(goal.subject_id).catch(() => null);
    const advisory = await generateBubbleAdvisory(req.user.id, goal, subject?.name || 'this subject');
    await db.dailyRitualCache
      .set(req.user.id, cacheKey, todayStr, { data: advisory }).catch(() => {});
    res.json({ advisory, cached: false });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate advisory', details: e.message });
  }
});

// ── Biome Routes (Phase 5) ─────────────────────────────────────────────────
const biomeRouter = express.Router();

biomeRouter.use(authenticate);

biomeRouter.use(reckoningLockout);

biomeRouter.get(['/', ''], async (req, res) => {
try {
const biome = await buildBiomeData(req.user.id);
const treeStageLabels = [
'',
'SEEDLING',
'SPROUT',
'SAPLING',
'YOUNG TREE',
'THRIVING',
'BLOOMING',
'MATURE',
'ANCIENT',
];
// P5.2+P5.4+P5.5 FIX: populate globalTreeState with real leaves/fruits/milestones;
// populate droughtDays and stateClass from subject data computed in buildBiomeData
const totalFruits = (biome.subjects || []).reduce((sum, s) => sum + (s.fruit_count || 0), 0);
const globalKSScore = biome.global_knowledge_score || 0;
// leaves: scaled to KS (4 minimum, up to 54 at KS 100)
const leavesCount = Math.max(4, Math.round(globalKSScore * 0.5));
// Add frontend-compatible aliases
const enriched = {
...biome,
// Frontend-expected fields
globalKS: globalKSScore,
globalTreeState: {
stage: biome.tree_stage || 1,
health: biome.tree_health || 100,
leaves: leavesCount,
fruits: totalFruits,
rings: (biome.streak_milestones || []).length,
milestones: biome.streak_milestones || [],
stageLabel: treeStageLabels[biome.tree_stage || 1] || 'SEEDLING',
},
zones: (biome.subjects || []).map((s) => ({
id: s.subject_id,
name: s.subject_name,
knowledgeScore: s.knowledge_score,
pressure: s.pressure_score,
fruits: s.fruit_count || 0,
cardCount: s.card_count,
// P5.1 FIX: stateClass now comes directly from buildBiomeData (not remapped here)
stateClass: s.stateClass || 'zone-growing',
// P5.5 FIX: droughtDays from days_since_last_session (drought starts after 3+ days)
droughtDays: (s.days_since_last_session || 0) >= 3 ? s.days_since_last_session : 0,
last_session_date: s.last_studied_at || null,
days_since_last_session: s.days_since_last_session || 0,
credential: s.credential_name || null,
exam_date: s.exam_date || null,
zone: s.zone,
state_distribution: s.state_distribution || {},
zone_description: s.zone_description || null,
})),
};
res.json(enriched);
} catch (e) {
res.status(500).json({ error: 'Failed to build biome', details: e.message });
}
});

biomeRouter.get('/zone-description', async (req, res) => {
try {
const { subject_id } = req.query;
const description = await generateZoneDescription(req.user.id, subject_id || null);
res.json({ description });
} catch (e) {
res.status(500).json({ error: 'Failed to generate zone description', details: e.message });
}
});
// Also support /biome/zone/:subjectId/description (frontend calling pattern)

biomeRouter.get('/zone/:subjectId/description', async (req, res) => {
try {
const description = await generateZoneDescription(req.user.id, req.params.subjectId);
res.json({ description });
} catch (e) {
res.status(500).json({ error: 'Failed to generate zone description', details: e.message });
}
});
// ── Ritual Routes (Phase 7) ────────────────────────────────────────────────
const ritualRouter = express.Router();

ritualRouter.use(authenticate);

// C-4 FIX: reckoningLockout removed from router level.
// Spec P1.6 exempts all informational ritual routes. These endpoints are the
// primary source of context during a Reckoning (morning brief names it,
// pressure-explanation explains it). Locking them out removes context exactly
// when the user needs it most. Only POST /dismiss-invitation remains debatable;
// see individual route for intentional omission per audit finding C-4.

// P7.6 FIX: GET kept for back-compat; POST /morning-brief added per spec
ritualRouter.get('/morning-brief', async (req, res) => {
try {
if (checkAIRateLimit(req.user.id, 'morning_brief', 10))
return res.status(429).json({ error: 'Rate limit: max 10 Morning Brief requests per hour' });
const brief = await getMorningBrief(req.user.id);
res.json({ brief });
} catch (e) {
res.status(500).json({ error: 'Failed to generate morning brief', details: e.message });
}
});

ritualRouter.post('/morning-brief', async (req, res) => {
try {
if (checkAIRateLimit(req.user.id, 'morning_brief', 10))
return res.status(429).json({ error: 'Rate limit: max 10 Morning Brief requests per hour' });
const brief = await getMorningBrief(req.user.id);
res.json({ brief });
} catch (e) {
res.status(500).json({ error: 'Failed to generate morning brief', details: e.message });
}
});

// P7.6 FIX: GET /daily-invitations kept for back-compat; POST /invitations added per spec
ritualRouter.get('/daily-invitations', async (req, res) => {
try {
if (checkAIRateLimit(req.user.id, 'daily_invitations', 10))
return res
.status(429)
.json({ error: 'Rate limit: max 10 Daily Invitation requests per hour' });
const invitations = await getDailyInvitations(req.user.id);
res.json({ invitations });
} catch (e) {
res.status(500).json({ error: 'Failed to generate invitations', details: e.message });
}
});

ritualRouter.post('/invitations', async (req, res) => {
try {
if (checkAIRateLimit(req.user.id, 'daily_invitations', 10))
return res
.status(429)
.json({ error: 'Rate limit: max 10 Daily Invitation requests per hour' });
const invitations = await getDailyInvitations(req.user.id);
res.json({ invitations });
} catch (e) {
res.status(500).json({ error: 'Failed to generate invitations', details: e.message });
}
});

ritualRouter.post('/dismiss-invitation', async (req, res) => {
try {
const { index } = req.body;
if (index === undefined) return res.status(400).json({ error: 'index required' });
const result = await dismissInvitation(req.user.id, parseInt(index));
// L-5 FIX: Return spec-mandated acknowledgement string
res.json({ ...result, message: "Noted — The Brain will not offer this again today." });
} catch (e) {
res.status(500).json({ error: 'Failed to dismiss invitation', details: e.message });
}
});

ritualRouter.get('/return-greeting', async (req, res) => {
try {
const greeting = await getReturnGreeting(req.user.id);
res.json(greeting || { greeting: null });
} catch (e) {
res.status(500).json({ error: 'Failed to generate greeting', details: e.message });
}
});

ritualRouter.get('/pressure-explanation', async (req, res) => {
try {
const { subject_id } = req.query;
if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
// F5-1-P: getPressureExplanation now returns { explanation, sources } [DESIGN: §15.1]
const { explanation, sources } = await getPressureExplanation(req.user.id, subject_id);
res.json({ explanation, sources });
} catch (e) {
res.status(500).json({ error: 'Failed to explain pressure', details: e.message });
}
});

// P7.6 FIX: GET /api/ritual/weekly-anchor — spec places this on ritualRouter.
// Was only on narrativeRouter (/api/narrative/weekly-anchor). Adding correct route here.
ritualRouter.get('/weekly-anchor', async (req, res) => {
try {
const anchor = await getWeeklyAnchor(req.user.id);
res.json(anchor);
} catch (e) {
res.status(500).json({ error: 'Failed to get weekly anchor', details: e.message });
}
});
// ── Marketplace Routes (Phase 8) ───────────────────────────────────────────
const marketplaceRouter = express.Router();

marketplaceRouter.use(authenticate);

marketplaceRouter.use(reckoningLockout);

marketplaceRouter.get('/catalog', async (req, res) => {
try {
const catalog = await getMarketplaceCatalog(req.user.id);
res.json(catalog);
} catch (e) {
res.status(500).json({ error: 'Failed to load catalog', details: e.message });
}
});

marketplaceRouter.post('/purchase', async (req, res) => {
try {
// P8.4b: accept subject_id for Deep Audit auto-trigger and Rare Flora per-zone gate
const { item_code, subject_id } = req.body;
if (!item_code) return res.status(400).json({ error: 'item_code required' });
const result = await purchaseItem(req.user.id, item_code, subject_id || null);
if (result.error) return res.status(400).json(result);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Purchase failed', details: e.message });
}
});

marketplaceRouter.get('/inventory', async (req, res) => {
try {
const inventory = await db.userInventory.findByUser(req.user.id);
res.json(inventory);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch inventory' });
}
});

marketplaceRouter.get('/transactions', async (req, res) => {
try {
const transactions = await db.seedlingTransactions.findByUser(req.user.id);
res.json(transactions);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch transactions' });
}
});

// ── REMOVED ROUTES (BUG 1, 2, 3 FIX) ─────────────────────────────────────
// POST /marketplace/deep-audit       — REMOVED. Bypassed all gate + Seedling
//   deduction logic. Use POST /api/marketplace/purchase {item_code:'deep_audit',
//   subject_id} which routes through purchaseItem() with full gate enforcement.
//
// POST /marketplace/archive-expansion — REMOVED. Same problem: bypassed Gate 1
//   (KS=100 + 15 Fruiting sessions in subject), Gate 2 (60 Seedlings), inventory
//   write, and purchase_limit. Use POST /api/marketplace/purchase
//   {item_code:'archive_expansion', subject_id}.
//
// POST /marketplace/consume-reckoning-buffer — REMOVED. reckoningLockout fires
//   on every marketplaceRouter request during an active Reckoning, returning 403
//   before this handler could ever run — making it unreachable at the only moment
//   it matters. Buffer consumption is served exclusively by the brain router:
//   POST /api/brain/reckoning/use-buffer (not subject to reckoningLockout).
// ──────────────────────────────────────────────────────────────────────────
// ── Narrative Routes (Phase 6) ─────────────────────────────────────────────
const narrativeRouter = express.Router();

narrativeRouter.use(authenticate);

narrativeRouter.use(reckoningLockout);

narrativeRouter.get('/chronicle', async (req, res) => {
try {
const entries = await db.chronicleEntries.findByUser(req.user.id);
res.json(entries);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch chronicle' });
}
});

narrativeRouter.post('/chronicle/generate', async (req, res) => {
try {
// BUG-8 FIX: only award seedlings when a NEW entry is actually created
const existingBefore = await db.chronicleEntries.findLatest(req.user.id).catch(() => null);
const entry = await generateWeeklyChronicle(req.user.id);
const isNew = !existingBefore || existingBefore.id !== entry?.id;
if (isNew) await hookSeedlingEarnings(req.user.id, 'weekly_chronicle', {});
res.json(entry);
} catch (e) {
res.status(500).json({ error: 'Chronicle generation failed', details: e.message });
}
});

narrativeRouter.get('/almanac', async (req, res) => {
try {
await seedAlmanacForUser(req.user.id);
const entries = await db.almanacEntries.findByUser(req.user.id);
// [Fix 3.6] Frontend accesses rawAlmanacData.chapters — wrap array in object.
res.json({ chapters: entries });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch almanac' });
}
});

narrativeRouter.get('/persona', async (req, res) => {
try {
const persona = await generateWeeklyPersona(req.user.id);

    // P6.6 FIX: Reshape response to match frontend expectation:
    // Frontend renderPersona() destructures { currentPersona, weeklyUpdate, allPersonas }
    // Backend was returning a flat persona document — persona was always undefined.
    const ALL_PERSONAS = [
      {
        code: 'the_tide',
        label: 'The Tide',
        emoji: '🌊',
        description:
          'You ebb and flow. Intense stretches followed by quiet — your rhythm is tidal, not daily.',
      },
      {
        code: 'the_storm',
        label: 'The Storm',
        emoji: '⛈️',
        description:
          'You arrive suddenly and study hard. Sessions are intense, frequent, then gone — until the next front.',
      },
      {
        code: 'the_dawn',
        label: 'The Dawn',
        emoji: '🌄',
        description:
          'You study in the early hours before the world wakes. Your focus is deep and solitary.',
      },
      {
        code: 'the_night',
        label: 'The Night',
        emoji: '🌙',
        description: 'The night fuels your mind. You learn when the world sleeps.',
      },
      {
        code: 'the_specialist',
        label: 'The Specialist',
        emoji: '🔬',
        description: 'One subject, one obsession. You go deep rather than wide.',
      },
      {
        code: 'the_resilient',
        label: 'The Resilient',
        emoji: '🌱',
        description:
          'You stumble, but you never stop. Reckoning, gaps, hard weeks — you return every time.',
      },
      {
        code: 'the_honest_one',
        label: 'The Honest One',
        emoji: '🪞',
        description:
          'You press Again when you should. No inflated streaks, no easy ratings. Just truth.',
      },
      {
        code: 'the_avoider',
        label: 'The Avoider',
        emoji: '🌫️',
        description:
          'Certain cards keep getting pushed to the bottom. The pattern is known — the question is when you face it.',
      },
    ];

    res.json({
      currentPersona: persona
        ? {
            id: persona.persona_code,
            name: persona.persona_label,
            emoji: persona.persona_icon,
            description: persona.persona_description,
            detectedAt: persona.assigned_week_start,
          }
        : null,
      weeklyUpdate: null, // Reserved for future use
      allPersonas: ALL_PERSONAS.map((p) => ({
        id: p.code,
        name: p.label,
        emoji: p.emoji,
        description: p.description,
      })),
    });

} catch (e) {
res.status(500).json({ error: 'Failed to generate persona', details: e.message });
}
});

narrativeRouter.get('/weekly-anchor', async (req, res) => {
try {
const anchor = await getWeeklyAnchor(req.user.id);
res.json(anchor);
} catch (e) {
res.status(500).json({ error: 'Failed to get weekly anchor', details: e.message });
}
});
// ── Reckoning Routes (Phase 3) ────────────────────────────────────────────
const reckoningRouter = express.Router();

reckoningRouter.use(authenticate);

reckoningRouter.post('/trigger', async (req, res) => {
try {
const { subject_id } = req.body;
if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
const result = await triggerReckoning(req.user.id, subject_id);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to trigger reckoning', details: e.message });
}
});

reckoningRouter.post('/:id/defer', async (req, res) => {
try {
const result = await deferReckoning(req.params.id);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to defer reckoning', details: e.message });
}
});

reckoningRouter.post('/:id/complete', async (req, res) => {
try {
const { score_pct, debrief_text } = req.body;
const result = await completeReckoning(req.params.id, score_pct, debrief_text);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to complete reckoning', details: e.message });
}
});
const brainRouter = express.Router();

brainRouter.use(authenticate);

brainRouter.use(reckoningLockout);
// ── Brain-namespaced reckoning compat routes ──────────────────────────────
// These mirror the /reckoning/ routes under /brain/reckoning/ for frontend compat.
// Note: frontend accesses these via brainRouter which is mounted at /api/brain

brainRouter.post('/reckoning/defer', async (req, res) => {
try {
const active = await db.reckoningSessions.findActiveByUser(req.user.id);
if (!active) return res.status(404).json({ error: 'No active reckoning to defer' });
const result = await deferReckoning(active.id);
if (result?.error) return res.status(400).json(result);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to defer reckoning', details: e.message });
}
});

brainRouter.post('/reckoning/submit', async (req, res) => {
try {
const { examId, answers } = req.body;
if (!examId || !Array.isArray(answers))
return res.status(400).json({ error: 'examId and answers required' });
const exam = await db.examSessions.findByIdWithQuestions(req.user.id, examId);
if (!exam) return res.status(404).json({ error: 'Exam not found' });
// Delegate to exam submit logic
let correct = 0;
const total = exam.questions.length;
const questionResults = [];
for (const q of exam.questions) {
const answer = answers.find((a) => a.question_number === q.question_number);
const isCorrect = answer && answer.selected_option === q.correct_answer;
if (isCorrect) correct++;
questionResults.push({
question_number: q.question_number,
selected: answer?.selected_option || null,
correct: isCorrect,
correct_answer: q.correct_answer,
});
if (answer) {
await db.examQuestions.update(req.user.id, q.id, {
selected_option: answer.selected_option,
is_correct: isCorrect,
time_spent_seconds: answer.time_spent_seconds || 0,
});
}
}
const scorePct = total > 0 ? parseFloat(((correct / total) * 100).toFixed(2)) : 0;
const now = new Date();
const durationSec = exam.started_at ? Math.floor((now - new Date(exam.started_at)) / 1000) : 0;
await db.examSessions.update(req.user.id, examId, {
status: 'completed',
score_pct: scorePct,
correct_answers: correct,
total_questions: total,
completed_at: now,
duration_seconds: durationSec,
});
await db.userStats.update(req.user.id, { total_exams_completed: FieldValue.increment(1) });
if (scorePct >= 80)
await hookSeedlingEarnings(req.user.id, 'exam_pass', { score_pct: scorePct });
// Complete the reckoning
const active = await db.reckoningSessions.findActiveByUser(req.user.id);
let reckoningResult = null;
if (active) {
// Bug 5 fix: Generate Gemini debrief with reckoning-specific tone instead of static string
let reckoningDebriefText = '';
try {
const wrong = questionResults.filter((qr) => !qr.correct);
const survived = scorePct >= 70;
const reckoningDebriefPrompt = `## ROLE
You are KIWI's Reckoning Debrief Voice — unflinching, honest, but ultimately supportive. The student just survived (or failed) The Reckoning: a forced exam triggered because their academic pressure reached critical levels.
RECKONING DATA
Subject pressure had reached L4 (threshold: 20).
// P3.8-B1 FIX: changed {var} to \${var} — template literal interpolation was broken.
Score: {scorePct}% ({correct}/{total} correct)
Outcome: {survived ? 'SURVIVED — pressure reset' : 'FAILED — pressure remains elevated'}
Incorrect questions: {wrong.length}
RULES
- Write exactly 3 paragraphs.
- Paragraph 1: Honest assessment. Name the outcome directly — survived or not. Reference the pressure that caused this.
- Paragraph 2: What the score means for the ecosystem. If survived: what resets, what remains fragile. If failed: what the ongoing pressure means.
- Paragraph 3: One precise instruction — the single most important thing to do next.
- Tone: Unflinching but not punitive. The forest speaks plainly.
- Total length: 120-200 words.
OUTPUT
Return only the debrief text.`;
        const aiResult = await geminiModel.generateContent(reckoningDebriefPrompt);
        reckoningDebriefText = aiResult.response.text().trim();
      } catch (_) {
        // Fallback: structured static debrief
        const survived = scorePct >= 70;
        reckoningDebriefText =
          `The Reckoning is complete. You scored ${scorePct}% — ${survived ? 'enough to reset the pressure and return to the ecosystem' : 'not enough to clear the pressure. The forest remains under strain'}.` +
          `\n\n${survived ? 'The flagged cards have been reclassified based on your performance. Pressure resets to zero. The Biome breathes again.' : 'The pressure does not reset below L4 threshold. The flagged cards remain. Another Reckoning will come.'}` +
          `\n\n${survived ? 'Do not mistake survival for mastery. Return to the cards that cost you points and review them deliberately before the next session.' : 'Focus immediately on the cards that failed. Use targeted study sessions — not passive review — to drive the pressure down before the next Reckoning.'}`;
      }
      // P3.3-B2 FIX: apply SRS feedback — incorrect reckoning answers drop card stages.
      // P3.3-B3 FIX: apply FRAGILE → VERIFIED promotion for correctly answered stage-5 cards.
      // Both were present in the regular exam path but missing from the reckoning path.
      const completedReckoningExam = await db.examSessions.findByIdWithQuestions(
        req.user.id, examId
      ).catch(() => null);
      if (completedReckoningExam) {
        await processExamVerification(req.user.id, completedReckoningExam).catch(() => {});
        await applyExamSRSFeedback(req.user.id, completedReckoningExam).catch(() => {});
      }
      reckoningResult = await completeReckoning(active.id, scorePct, reckoningDebriefText);
      // Bug 6 fix: Send Telegram notification for reckoning outcome
      await sendTelegramExamResult(req.user.id, exam.subject_id, scorePct, scorePct >= 70).catch(
        () => {}
      );
    }
    res.json({
      score_pct: scorePct,
      correct_answers: correct,
      total_questions: total,
      duration_seconds: durationSec,
      question_results: questionResults,
      reckoning: reckoningResult,
      debrief: reckoningResult?.debrief_text || '',
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit reckoning', details: e.message });
  }
});

reckoningRouter.get('/active', async (req, res) => {
try {
const active = await db.reckoningSessions.findActiveByUser(req.user.id);
res.json(active || { status: 'none' });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch active reckoning' });
}
});
// ── Brain / Pressure Routes (Phase 3) ─────────────────────────────────────
// POST /brain/reckoning/use-buffer — spend seedling buffer to skip reckoning

// P3-02 FIX: delegate to consumeReckoningBuffer() which has correct signature,
// correct 24-hour duration, proper inventory handling, and correct status value.
brainRouter.post('/reckoning/use-buffer', async (req, res) => {
try {
const active = await db.reckoningSessions.findActiveByUser(req.user.id);
if (!active) {
return res.status(404).json({ error: 'No active reckoning to buffer' });
}
const result = await consumeReckoningBuffer(req.user.id, active.id);
if (result?.error) return res.status(400).json(result);
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to use buffer', details: e.message });
}
});

brainRouter.get('/pressure', async (req, res) => {
try {
const rawPressures = await db.brainPressure.findByUser(req.user.id);
// Enrich with subject names
const enriched = await Promise.all(
rawPressures.map(async (p) => {
const subject = await db.subjects.findById(p.subject_id).catch(() => null);
return {
...p,
subjectName: subject?.name || p.subject_id || 'Unknown',
pressure: p.pressure_score || 0,
level: p.intervention_level ? parseInt(p.intervention_level.replace('L', '')) : 0, // P3-M1 FIX: L0 is the calm baseline, not L1
description: // P3.2-B1 FIX: L0 is the correct calm default.
`${p.intervention_level || 'L0'} — ${p.pressure_score || 0} pressure points`,
};
})
);
const highestPressure =
enriched.length > 0 ? Math.max(...enriched.map((p) => p.pressure_score || 0)) : 0;
// P3.2-B1 FIX: filter for anything above L0, not L1 (L1 is never emitted).
const interventions = enriched.filter((p) => p.intervention_level !== 'L0');
const activeReckoning = await db.reckoningSessions
.findActiveByUser(req.user.id)
.catch(() => null);
// BUG #2 FIX: fetch userStats only when a reckoning exists — needed for shields field
const userStatsForBrain = activeReckoning
? await db.userStats.get(req.user.id).catch(() => null)
: null;
res.json({
pressures: enriched,
overallStatus:
interventions.length === 0 ? 'Calm' : interventions.length < 3 ? 'Elevated' : 'Critical',
totalInterventions: interventions.length,
highestPressure,
interventions,
pendingReckoning: activeReckoning
? {
id: activeReckoning.id,
subject_id: activeReckoning.subject_id,
// Provide both snake_case and camelCase to match lockout middleware shape
subject_name: activeReckoning.subject_name,
subjectName: activeReckoning.subject_name,
status: activeReckoning.status,
flagged_card_count: activeReckoning.flagged_card_count,
question_count: activeReckoning.question_count,
// Both field names needed: overlay reads deferral_expires_at; legacy reads deferred_until
deferred_until: activeReckoning.deferred_until || null,
deferral_expires_at: activeReckoning.deferred_until || null,
subjectId: activeReckoning.subject_id,
reason: `Pressure reached ${activeReckoning.pressure_score || 20} in ${activeReckoning.subject_name || 'this subject'}`,
pressure: activeReckoning.pressure_score || 0,
shields: userStatsForBrain?.streak_shields_held || 0,
canDefer: !activeReckoning.deferral_used,
can_defer: !activeReckoning.deferral_used,
deferHours: 4,
deferPenalty: 5,
}
: null,
});
} catch (e) {
res.status(500).json({ error: 'Failed to fetch pressures', details: e.message });
}
});

brainRouter.get('/pressure/:subjectId', async (req, res) => {
try {
const pressure = await calculateSubjectPressure(req.user.id, req.params.subjectId);
res.json(pressure);
} catch (e) {
res.status(500).json({ error: 'Failed to calculate pressure', details: e.message });
}
});
// GET /brain/pressure/:subjectId/explanation — alias for ritual/pressure-explanation

brainRouter.get('/pressure/:subjectId/explanation', async (req, res) => {
try {
// F5-1-P: getPressureExplanation now returns { explanation, sources } [DESIGN: §15.1]
const { explanation, sources } = await getPressureExplanation(req.user.id, req.params.subjectId);
res.json({ explanation, sources });
} catch (e) {
res.status(500).json({ error: 'Failed to get pressure explanation', details: e.message });
}
});

brainRouter.get('/credential/:subjectId', async (req, res) => {
try {
const credential = await evaluateCredential(req.user.id, req.params.subjectId);
res.json(credential);
} catch (e) {
res.status(500).json({ error: 'Failed to evaluate credential', details: e.message });
}
});
// ── Knowledge Score Routes (Phase 2) ───────────────────────────────────────
const ksRouter = express.Router();

ksRouter.use(authenticate);

ksRouter.use(reckoningLockout);

ksRouter.get('/global', async (req, res) => {
try {
const ks = await computeGlobalKnowledgeScore(req.user.id);
res.json(ks);
} catch (e) {
res.status(500).json({ error: 'Failed to compute global KS', details: e.message });
}
});

ksRouter.get('/subject/:subjectId', async (req, res) => {
try {
const ks = await computeKnowledgeScore(req.user.id, req.params.subjectId);
res.json(ks);
} catch (e) {
res.status(500).json({ error: 'Failed to compute subject KS', details: e.message });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  PROGRESS & SETTINGS ROUTES (B20)

// ════════════════════════════════════════════════════════════════════════════
const progressRouter = express.Router();

progressRouter.use(authenticate);

progressRouter.use(reckoningLockout);
// GET /api/achievements — all achievements with unlock status

progressRouter.get('/achievements', async (req, res) => {
try {
const [allAchievements, userAchievements] = await Promise.all([
db.achievements.findAll(),
db.userAchievements.findManyWithAchievement(req.user.id),
]);
const unlockedMap = new Map(userAchievements.map((ua) => [ua.achievement?.code, ua]));
const result = allAchievements.map((ach) => ({
...ach,
unlocked: unlockedMap.has(ach.code),
unlocked_at: unlockedMap.get(ach.code)?.unlocked_at || null,
}));
res.json(result);
} catch (e) {
res.status(500).json({ error: 'Failed to fetch achievements', details: e.message });
}
});
// GET /api/progress — aggregated progress overview

progressRouter.get('/progress', async (req, res) => {
try {
const [stats, subjects, globalKS, allStates, troubleStatesRaw] = await Promise.all([
db.userStats.get(req.user.id),
db.subjects.findManyWithDecks(req.user.id),
computeGlobalKnowledgeScore(req.user.id),
db.cardStates.findByUser(req.user.id),
db.cardStates.findByUser(req.user.id),
]);
// Build subject breakdown with per-subject KS
const subjectBreakdown = [];
for (const s of subjects) {
const ks = await computeKnowledgeScore(req.user.id, s.id).catch(() => ({ score: 0 }));
subjectBreakdown.push({
id: s.id,
name: s.name,
ks: ks.score,
cardCount: s.total_cards || 0,
});
}
// Trouble cards (STUCK, AVOIDED, GHOST, DANGEROUS, FRAGILE)
const TROUBLE_STATES = ['STUCK', 'AVOIDED', 'GHOST', 'DANGEROUS', 'FRAGILE'];
const troubleStatesList = allStates.filter((s) => TROUBLE_STATES.includes(s.state));
const troubleCards = [];
for (const st of troubleStatesList.slice(0, 30)) {
const card = await db.cards.findById(req.user.id, st.card_id).catch(() => null);
if (card) {
// Look up subject for this card
const deck = await db.decks.findById(req.user.id, card.deck_id).catch(() => null);
troubleCards.push({
id: st.card_id,
state: st.state,
front: card.front_content || '',
back: card.back_content || '',
subjectId: deck?.subject_id || null,
deck_id: card.deck_id,
});
}
}
// Accuracy trend (12 weeks)
const weeks = [];
const now = new Date();
for (let i = 11; i >= 0; i--) {
const weekStart = new Date(now);
weekStart.setDate(weekStart.getDate() - i * 7 - weekStart.getDay());
weekStart.setHours(0, 0, 0, 0);
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekEnd.getDate() + 7);
const logs = await db.reviewLogs.findByUser(req.user.id, weekStart).catch(() => []);
const weekLogs = logs.filter((l) => new Date(l.reviewed_at) < weekEnd);
const total = weekLogs.length;
const goodOrEasy = weekLogs.filter(
(l) => l.response === 'good' || l.response === 'easy'
).length;
weeks.push({
week_start: weekStart.toISOString().split('T')[0],
total_reviews: total,
accuracy_pct: total > 0 ? parseFloat(((goodOrEasy / total) * 100).toFixed(1)) : null,
});
}
const accuracyTrend = {
labels: weeks.map((w) => w.week_start.slice(5)),
data: weeks.map((w) => w.accuracy_pct),
};
res.json({
overallKS: globalKS.score,
subjectBreakdown,
troubleCards,
accuracyTrend,
sessionHistory: [], // Available via /study/stats
});
} catch (e) {
res.status(500).json({ error: 'Failed to load progress', details: e.message });
}
});
// GET /api/progress/trouble-cards — STUCK, AVOIDED, GHOST, DANGEROUS cards

progressRouter.get('/progress/trouble-cards', async (req, res) => {
try {
const TROUBLE_STATES = ['STUCK', 'AVOIDED', 'GHOST', 'DANGEROUS', 'FRAGILE'];
const allStates = await db.cardStates.findByUser(req.user.id);
const troubleStates = allStates.filter((s) => TROUBLE_STATES.includes(s.state));
const enriched = [];
for (const st of troubleStates.slice(0, 50)) {
const card = await db.cards.findById(req.user.id, st.card_id).catch(() => null);
if (card)
enriched.push({
...st,
card_front: card.front_content,
card_back: card.back_content,
deck_id: card.deck_id,
});
}
res.json({ trouble_cards: enriched, total: troubleStates.length });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch trouble cards', details: e.message });
}
});
// GET /api/progress/accuracy-trend — 12-week weekly accuracy trend

progressRouter.get('/progress/accuracy-trend', async (req, res) => {
try {
const weeks = [];
const now = new Date();
for (let i = 11; i >= 0; i--) {
const weekStart = new Date(now);
weekStart.setDate(weekStart.getDate() - i * 7 - weekStart.getDay());
weekStart.setHours(0, 0, 0, 0);
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekEnd.getDate() + 7);
const logs = await db.reviewLogs.findByUser(req.user.id, weekStart);
const weekLogs = logs.filter((l) => new Date(l.reviewed_at) < weekEnd);
const total = weekLogs.length;
const goodOrEasy = weekLogs.filter(
(l) => l.response === 'good' || l.response === 'easy'
).length;
weeks.push({
week_start: weekStart.toISOString().split('T')[0],
total_reviews: total,
accuracy_pct: total > 0 ? parseFloat(((goodOrEasy / total) * 100).toFixed(1)) : null,
});
}
res.json({ trend: weeks });
} catch (e) {
res.status(500).json({ error: 'Failed to compute accuracy trend', details: e.message });
}
});
// GET /api/settings — get user profile settings

progressRouter.get('/settings', async (req, res) => {
try {
const user = await db.users.findById(req.user.id);
if (!user) return res.status(404).json({ error: 'User not found' });
const stats = await db.userStats.get(req.user.id);
const { password_hash, ...safeUser } = user;
res.json({ ...safeUser, stats });
} catch (e) {
res.status(500).json({ error: 'Failed to fetch settings', details: e.message });
}
});
// PUT /api/settings — update user profile settings

progressRouter.put('/settings', async (req, res) => {
try {
const ALLOWED = [
'full_name',
'avatar_url',
'bio',
'theme',
'notification_preferences',
'exam_reminder_days',
];
const updates = {};
for (const key of ALLOWED) {
if (req.body[key] !== undefined) updates[key] = req.body[key];
}
const updated = await db.users.update(req.user.id, updates);
const { password_hash, ...safeUser } = updated;
res.json(safeUser);
} catch (e) {
res.status(500).json({ error: 'Failed to update settings', details: e.message });
}
});
// GET /api/library — subject + deck overview for the library view
// GET /api/dashboard — aggregated dashboard data

progressRouter.get('/dashboard', async (req, res) => {
try {
const [stats, subjects, globalKS, allStates] = await Promise.all([
db.userStats.get(req.user.id),
db.subjects.findManyWithDecks(req.user.id),
computeGlobalKnowledgeScore(req.user.id),
db.cardStates.findByUser(req.user.id),
]);
const now = new Date();
const allCards = await db.cards.findAllForUser(req.user.id);
const dueCount = allCards.filter((c) => isCardDue(c, now)).length;
const pressures = await db.brainPressure.findByUser(req.user.id);
const activeReckoning = await db.reckoningSessions.findActiveByUser(req.user.id);
const stateDist = {};
for (const s of allStates) stateDist[s.state] = (stateDist[s.state] || 0) + 1;
// Build subject breakdown with per-subject KS for frontend dashboard
const subjectBreakdown = await Promise.all(subjects.map(async (s) => {
const storedSubjectStat = await db.subjectStats.get(req.user.id, s.id).catch(() => null);
const [ks, subjectDecks] = await Promise.all([
(storedSubjectStat?.knowledge_score !== undefined ? Promise.resolve({ score: storedSubjectStat.knowledge_score }) : computeKnowledgeScore(req.user.id, s.id)).catch(() => ({ score: 0 })),
db.decks.findBySubject(req.user.id, s.id),
]);
const subjectDeckIds = subjectDecks.map((d) => d.id);
const subjectCards = allCards.filter((c) => subjectDeckIds.includes(c.deck_id));
const subjectDueCount = subjectCards.filter((c) => isCardDue(c)).length;
return { id: s.id, name: s.name, ks: ks.score, dueCount: subjectDueCount };
}));
// Persona
const persona = await db.userPersona.get(req.user.id).catch(() => null);
// Tree state
const treeStageLabels = [
'',
'SEEDLING',
'SPROUT',
'SAPLING',
'YOUNG TREE',
'THRIVING',
'BLOOMING',
'MATURE',
'ANCIENT',
];
// M1 FIX: streak milestones — permanent, survive streak breaks (same logic as buildBiomeData)
const dashStreak = stats?.current_streak || 0;
const dashEarnedMilestones = stats?.streak_milestones_earned || [];
const dashActiveMilestones = [...new Set([
...dashEarnedMilestones,
...[7, 30, 100, 365].filter(m => dashStreak >= m),
])].sort((a, b) => a - b);
// M1 FIX: fruits = sum of per-subject fruit_counts (fruiting sessions, not mastered cards)
const dashSubjectStats = await Promise.all(
subjects.map(s => db.subjectStats.get(req.user.id, s.id).catch(() => null))
);
const dashTotalFruits = dashSubjectStats.reduce((sum, ss) => sum + (ss?.fruit_count || 0), 0);
// M1 FIX: leaves from globalKS * 0.5 — matches biome formula
const dashGlobalKS = subjectBreakdown.length > 0
? subjectBreakdown.reduce((sum, s) => sum + s.ks, 0) / subjectBreakdown.length
: 0;
// Issue-2 FIX: single source of truth — delegate tree state to buildBiomeData
const biomeForTree = await buildBiomeData(req.user.id).catch(() => ({}));
const treeState = biomeForTree.treeState || {
stage: stats?.tree_stage || 1,
health: stats?.tree_health || 100,
leaves: Math.max(4, Math.round(dashGlobalKS * 0.5)),
fruits: dashTotalFruits,
rings: dashActiveMilestones.length,
stageLabel: treeStageLabels[stats?.tree_stage || 1] || 'SEEDLING',
milestones: dashActiveMilestones,
};
// Level info
const level = {
level: stats?.current_level || 1,
xp: stats?.xp_in_current_level || 0,
nextLevelXp: (() => {
const lv = stats?.current_level || 1;
if (lv < 10) return 500;
if (lv < 20) return 1000;
if (lv < 30) return 2000;
if (lv < 50) return 3000;
if (lv < 75) return 5000;
if (lv < 100) return 8000;
return 15000;
})(),
};
// Brain preview
const brainPreview = {
interventionCount: // P3.2-B1 FIX: L0 is the correct calm baseline.
pressures.filter((p) => p.intervention_level !== 'L0').length,
highestPressure:
pressures.length > 0 ? Math.max(...pressures.map((p) => p.pressure_score || 0)) : 0,
};
// Return greeting — C-1 FIX: wire into dashboard flow with daily cache
const returnStatus = await computeReturnStatus(req.user.id).catch(() => null);
let returnGreeting = null;
if (returnStatus && returnStatus.status !== 'active') {
const todayStrRG = new Date().toISOString().split('T')[0];
const cachedRG = await db.dailyRitualCache
.get(req.user.id, 'return_greeting', todayStrRG)
.catch(() => null);
if (cachedRG?.data?.greeting) {
returnGreeting = cachedRG.data.greeting;
} else {
const rg = await getReturnGreeting(req.user.id).catch(() => null);
returnGreeting = rg?.greeting || null;
}
}
// Morning brief — try cache first, skip AI call in dashboard for speed
const todayStr = new Date().toISOString().split('T')[0];
const morningCache = await db.dailyRitualCache
.get(req.user.id, 'morning_brief', todayStr)
.catch(() => null);
// C-3 FIX: Generate inline on cache miss — spec: "Triggered on first dashboard load per calendar day"
const morningBrief = morningCache
? morningCache.data
: await getMorningBrief(req.user.id).catch(() => null);
// Weekly anchor — read from cache using current week's Monday key
const weekStartStr = (() => {
const d = new Date();
// H-7 FIX: Monday-based key to match getWeeklyAnchor after Monday correction
d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
d.setHours(0, 0, 0, 0);
return d.toISOString().split('T')[0];
})();
const anchorCache = await db.dailyRitualCache
.get(req.user.id, 'weekly_anchor', weekStartStr)
.catch(() => null);
const weeklyAnchor = anchorCache
? anchorCache.anchor_text || anchorCache.message || null
: null;
// Invitations — try cache
const invitationsCache = await db.dailyRitualCache
.get(req.user.id, 'daily_invitations', todayStr)
.catch(() => null);
// C-3 FIX: Generate inline on cache miss
const invitations = invitationsCache
? invitationsCache.data
: await getDailyInvitations(req.user.id).catch(() => []);
res.json({
// Original fields
user_stats: stats,
global_ks: globalKS,
due_today: dueCount,
total_subjects: subjects.length,
state_distribution: stateDist,
pressures: pressures.map((p) => ({
subject_id: p.subject_id,
score: p.pressure_score,
level: p.intervention_level,
})),
active_reckoning: activeReckoning
? {
id: activeReckoning.id,
subject_name: activeReckoning.subject_name,
status: activeReckoning.status,
}
: null,
subjects: subjects.map((s) => ({
id: s.id,
name: s.name,
deck_count: s.deck_count,
total_cards: s.total_cards,
})),
// Frontend-compatible fields
user: req.user
? (() => {
const { password_hash, ...safe } = req.user;
return safe;
})()
: null,
overallKS: globalKS.score,
subjectBreakdown,
streak: { current: stats?.current_streak || 0, shields: stats?.streak_shields_held || 0 },
dailyXP: stats?.total_xp || 0,
invitations,
tasks: [],
brainPreview,
weeklyAnchor,
morningBrief,
returnGreeting,  // C-1 FIX: populated above from getReturnGreeting
treeState,
persona: persona
? {
name: persona.persona_label || persona.persona_code,
icon: persona.persona_icon || '🌿',
description: persona.persona_description,
}
: null,
level,
achievements: [],
});
} catch (e) {
res.status(500).json({ error: 'Failed to load dashboard', details: e.message });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  LIBRARY CONVENIENCE ROUTES (wrappers for frontend /library/ calls)

// ════════════════════════════════════════════════════════════════════════════
const libraryRouter = express.Router();

libraryRouter.use(authenticate);

libraryRouter.use(reckoningLockout);
// GET /api/library — subject overview (duplicate of progressRouter.get('/library'))

libraryRouter.get('/', async (req, res) => {
try {
const subjects = await db.subjects.findManyWithDecks(req.user.id);
const enriched = await Promise.all(
subjects.map(async (s) => {
const ks = await computeKnowledgeScore(req.user.id, s.id).catch(() => ({ score: 0 }));
// Fetch cards for this subject across all decks
// FIX #9: Use db.cards.findByDeck() instead of raw Firestore query
let allCards = [];
for (const d of s.decks || []) {
const deckCards = await db.cards.findByDeck(req.user.id, d.id);
allCards.push(...deckCards);
}
// stageDistribution
const stageDistribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
allCards.forEach((c) => {
stageDistribution[c.stage || 0] = (stageDistribution[c.stage || 0] || 0) + 1;
});
// dueCount
const todayStr = new Date().toISOString().slice(0, 10);
const dueCount = allCards.filter((c) => !c.due || c.due <= todayStr).length;
// recentCards (first 12)
const recentCards = allCards.slice(0, 12).map((c) => ({
id: c.id,
front: c.front || '',
stage: c.stage || 0,
isDue: !c.due || c.due <= todayStr,
reviewCount: c.reviewCount || 0,
}));
return {
id: s.id,
name: s.name,
color_hex: s.color_hex,
emoji: s.emoji,
exam_date: s.exam_date || null,
deck_count: s.deck_count || 0,
cardCount: s.total_cards || 0,
total_cards: s.total_cards || 0,
ks: ks.score,
recentCards,
stageDistribution,
dueCount,
decks: (s.decks || []).map((d) => ({
id: d.id,
name: d.name,
card_count: d.card_count || 0,
subject_id: d.subject_id,
})),
};
})
);
res.json({ subjects: enriched });
} catch (e) {
res.status(500).json({ error: 'Failed to load library', details: e.message });
}
});
// POST /api/library/subjects — create subject (maps to /subjects/)
// Accepts: {name, color, icon, exam_date}

libraryRouter.post('/subjects', async (req, res) => {
try {
const { name, color, icon, exam_date } = req.body;
if (!name) return res.status(400).json({ error: 'Name required' });
const subject = await db.subjects.create(req.user.id, {
name,
color_hex: color || '#4F46E5',
emoji: icon || '📚',
exam_date: exam_date || null,
});
// Auto-create a default deck for this subject
const deck = await db.decks.create(req.user.id, {
name: `${name} — Main Deck`,
description: `Default deck for ${name}`,
subject_id: subject.id,
card_count: 0,
is_public: false,
});
res.status(201).json({ ...subject, default_deck_id: deck.id });
} catch (e) {
res.status(500).json({ error: 'Failed to create subject', details: e.message });
}
});
// PUT /api/library/subjects/:id — update subject

libraryRouter.put('/subjects/:id', async (req, res) => {
try {
const { name, color, icon, exam_date, color_hex, emoji } = req.body;
const updates = {};
if (name) updates.name = name;
if (color) updates.color_hex = color;
if (color_hex) updates.color_hex = color_hex;
if (icon) updates.emoji = icon;
if (emoji) updates.emoji = emoji;
if (exam_date !== undefined) updates.exam_date = exam_date;
const subject = await db.subjects.update(req.user.id, req.params.id, updates);
res.json(subject);
} catch (e) {
res.status(500).json({ error: 'Failed to update subject', details: e.message });
}
});
// DELETE /api/library/subjects/:id — delete subject

libraryRouter.delete('/subjects/:id', async (req, res) => {
try {
await db.subjects.delete(req.user.id, req.params.id);
res.json({ message: 'Subject deleted' });
} catch (e) {
res.status(500).json({ error: 'Failed to delete subject', details: e.message });
}
});
// POST /api/library/cards — add a card to a subject\'s default deck
// Accepts: {subjectId, front, back} — auto-resolves deck_id

libraryRouter.post('/cards', async (req, res) => {
try {
const { subjectId, front, back, deck_id } = req.body;
if (!subjectId || !front || !back)
return res.status(400).json({ error: 'subjectId, front, and back required' });
// Resolve deck_id: use provided or find/create default deck
let targetDeckId = deck_id;
if (!targetDeckId) {
const decks = await db.decks.findBySubject(req.user.id, subjectId);
if (decks.length > 0) {
targetDeckId = decks[0].id;
} else {
// Create a default deck
const subject = await db.subjects.findById(subjectId);
const newDeck = await db.decks.create(req.user.id, {
name: `${subject?.name || 'Subject'} — Main Deck`,
description: 'Auto-created default deck',
subject_id: subjectId,
card_count: 0,
is_public: false,
});
targetDeckId = newDeck.id;
}
}
const ai_summary = await summarizeCard(front, back).catch(() => '');
const card = await db.cards.create(req.user.id, {
deck_id: targetDeckId,
front_content: front,
back_content: back,
tags: [],
ai_summary,
});
await db.decks.update(req.user.id, targetDeckId, { card_count: FieldValue.increment(1) });
await initializeCardState(req.user.id, card.id, CARD_STATES.SEEDLING);
res.status(201).json(card);
} catch (e) {
res.status(500).json({ error: 'Failed to add card', details: e.message });
}
});
// POST /api/library/import — bulk import cards to subject
// Accepts: {subjectId, cards: [{front, back}]}

libraryRouter.post('/import', async (req, res) => {
try {
const { subjectId, cards } = req.body;
if (!subjectId || !Array.isArray(cards) || cards.length === 0) {
return res.status(400).json({ error: 'subjectId and cards array required' });
}
// Resolve deck_id
const decks = await db.decks.findBySubject(req.user.id, subjectId);
let targetDeckId;
if (decks.length > 0) {
targetDeckId = decks[0].id;
} else {
const subject = await db.subjects.findById(subjectId);
const newDeck = await db.decks.create(req.user.id, {
name: `${subject?.name || 'Subject'} — Main Deck`,
description: 'Auto-created default deck',
subject_id: subjectId,
card_count: 0,
is_public: false,
});
targetDeckId = newDeck.id;
}
const cardsData = cards
.map((c) => ({
front_content: c.front || c.front_content || '',
back_content: c.back || c.back_content || '',
}))
.filter((c) => c.front_content && c.back_content);
if (cardsData.length === 0)
return res.status(422).json({ error: 'No valid cards in import data' });
const created = await db.cards.createMany(req.user.id, targetDeckId, cardsData);
await db.decks.update(req.user.id, targetDeckId, {
card_count: FieldValue.increment(created.length),
});
await batchInitializeSeedlingStates(
req.user.id,
created.map((c) => c.id)
);
// FIX #4e: Recalculate KS after library bulk import
const libDeck = await db.decks.findById(req.user.id, targetDeckId).catch(() => null);
if (libDeck?.subject_id) {
await persistKnowledgeScore(req.user.id, libDeck.subject_id).catch(() => {});
}
res.status(201).json({ cards: created, count: created.length, deck_id: targetDeckId });
} catch (e) {
res.status(500).json({ error: 'Import failed', details: e.message });
}
});

// ════════════════════════════════════════════════════════════════════════════
//  MOUNT ROUTES

// ════════════════════════════════════════════════════════════════════════════

app.use('/api/auth', authRouter);

app.use('/api/subjects', subjectRouter);

app.use('/api/library', libraryRouter);

app.use('/api/decks', deckRouter);

app.use('/api/cards', cardRouter);

app.use('/api/study', studyRouter);

app.use('/api/exams', examRouter);

app.use('/api/tasks', taskRouter);

app.use('/api/community', communityRouter);

app.use('/api/admin', adminRouter);

app.use('/api/biome', biomeRouter);

app.use('/api/ritual', ritualRouter);

app.use('/api/marketplace', marketplaceRouter);

app.use('/api/narrative', narrativeRouter);

// NOTE (Fix #6): reckoningRouter (/api/reckoning) is unreachable from any live client.
// All reckoning operations go through brainRouter (/api/brain/reckoning/).
// Its routes use a different contract (:id path param) vs brain router (user-derived ID).
// Kept in place for potential future internal tooling — do not remove without audit.
app.use('/api/reckoning', reckoningRouter);

app.use('/api/brain', brainRouter);
app.use('/api/bubbles', bubbleRouter);

app.use('/api/ks', ksRouter);
// Health check must be registered BEFORE progressRouter (which applies authenticate
// to all /api/* routes, which would block this public endpoint)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0-living-ecosystem',
  });
});

// Fixed: Use single mount point so sub-paths resolve correctly
// /api/achievements  → progressRouter.get('/achievements', ...)
// /api/progress/    → progressRouter.get('/trouble-cards', ...) etc.
// /api/settings      → progressRouter.put('/settings', ...)
// /api/dashboard     → progressRouter.get('/dashboard', ...)

app.use('/api', progressRouter);

// ════════════════════════════════════════════════════════════════════════════
//  CRON JOBS

// ════════════════════════════════════════════════════════════════════════════
// ── CRON JOBS ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
// ── Daily at 3:00 AM: Maintenance, penalties, pressure, morning brief cache ──

cron.schedule('0 3 * * *', async () => {
console.log('[KIWI CRON] Running daily maintenance...');
let allUsers = [];
try {
allUsers = await db.users.findAll();
} catch (e) {
console.error('[KIWI CRON] Failed to fetch users:', e.message);
return;
}
// 1. Apply daily health penalty to all users
try {
await applyDailyHealthPenalty();
console.log('[KIWI CRON] Health penalty applied');
} catch (e) {
console.error('[KIWI CRON] Health penalty failed:', e.message);
}
// 2. Recalculate brain pressure for every subject of every user
try {
for (const user of allUsers) {
try {
await calculateAllSubjectPressures(user.id);
} catch (e) {
console.error(`[KIWI CRON] Pressure recalc failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Pressure recalculated for ${allUsers.length} users`);
} catch (e) {
console.error('[KIWI CRON] Daily pressure cron failed:', e.message);
}
// 3. Pre-generate morning brief cache for all active users
try {
for (const user of allUsers) {
if (user.is_guest) continue; // skip guests
// H-6 FIX: Skip users inactive for 14+ days — conserves Gemini quota
if (user.last_login_at && daysSince(user.last_login_at) > 14) continue;
try {
await getMorningBrief(user.id);
} catch (e) {
console.error(`[KIWI CRON] Morning brief failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Morning briefs pre-generated for ${allUsers.length} users`);
} catch (e) {
console.error('[KIWI CRON] Morning brief cron failed:', e.message);
}
// 4. Pre-generate tasks for all active users
try {
for (const user of allUsers) {
if (user.is_guest) continue;
try {
await generateTasksForUser(user.id);
} catch (e) {
console.error(`[KIWI CRON] Task gen failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Tasks generated for ${allUsers.length} users`);
} catch (e) {
console.error('[KIWI CRON] Daily task gen cron failed:', e.message);
}
// 5. Almanac unlock check for all users
try {
for (const user of allUsers) {
try {
await checkAlmanacUnlocks(user.id);
} catch (e) {
console.error(`[KIWI CRON] Almanac check failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Almanac unlocks checked for ${allUsers.length} users`);
} catch (e) {
console.error('[KIWI CRON] Daily almanac cron failed:', e.message);
}
// 6. P3.9-B1b FIX: Daily streak miss check — consume shield or break streak.
// consumeShieldOnMiss was never called from the cron; shields were accumulating
// via evaluateStreakShield but were never consumed on missed days.
try {
const yesterday = getDateString(new Date(Date.now() - 86400000));
for (const user of allUsers) {
if (user.is_guest) continue;
try {
const stats = await db.userStats.get(user.id);
if (!stats) continue;
const lastStudy = stats.last_study_date ? getDateString(stats.last_study_date) : null;
// Only fire if the user was active at some point but missed yesterday
if (lastStudy && lastStudy !== yesterday) {
await consumeShieldOnMiss(user.id);
}
} catch (e) {
console.error(`[KIWI CRON] Streak miss check failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Streak miss check complete for ${allUsers.length} users`);
} catch (e) {
console.error('[KIWI CRON] Streak miss cron failed:', e.message);
}
});
// ── Daily at 8:00 AM: Send Telegram reminders to opted-in users ──────────────

cron.schedule('0 8 * * *', async () => {
console.log('[KIWI CRON] Sending Telegram daily reminders...');
try {
const allUsers = await db.users.findAll();
let sent = 0;
for (const user of allUsers) {
if (user.is_guest) continue;
try {
const prefs = user.notification_preferences || {};
if (prefs.telegram === false) continue;
if (!user.telegram_chat_id) continue;
await sendTelegramDailyReminder(user.id);
sent++;
} catch (e) {
console.error(`[KIWI CRON] Telegram reminder failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Telegram reminders sent to ${sent} users`);
} catch (e) {
console.error('[KIWI CRON] Telegram cron failed:', e.message);
}
});
// ── Weekly on Monday at 4:00 AM: Chronicles, personas, seedling awards ───────

cron.schedule('0 0 * * 1', async () => {
// P6.1 FIX: Changed from 4:00 AM to 00:00 UTC as per spec
console.log('[KIWI CRON] Running weekly generation...');
try {
const users = await db.users.findAll();
for (const user of users) {
if (user.is_guest) continue;
try {
await generateWeeklyChronicle(user.id);
await generateWeeklyPersona(user.id);
await getWeeklyAnchor(user.id); // P6.7 FIX: generate and cache anchor every Monday
// BUG-5b FIX: snapshot previous_week_ks so ks_gain/drop almanac entries can compare
const subjectsForKsSnapshot = await db.subjects.findManyWithDecks(user.id).catch(() => []);
for (const sub of subjectsForKsSnapshot) {
const ks = await computeKnowledgeScore(user.id, sub.id).catch(() => ({ score: 0 }));
await db.subjectStats.update(user.id, sub.id, {
previous_week_ks: ks.score,
previous_week_ks_recorded_at: new Date().toISOString(),
}).catch(() => {});
}
await hookSeedlingEarnings(user.id, 'weekly_chronicle', {});
} catch (e) {
console.error(`[KIWI CRON] Weekly gen failed for ${user.id}:`, e.message);
}
}
console.log(`[KIWI CRON] Weekly generation complete for ${users.length} users`);
} catch (e) {
console.error('[KIWI CRON] Weekly cron failed:', e.message);
}
});
}

// ════════════════════════════════════════════════════════════════════════════
//  ERROR HANDLING & HEALTH

// ════════════════════════════════════════════════════════════════════════════


app.use((req, res) => {
res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((err, req, res, next) => {
console.error('[KIWI ERROR]', err);
res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ════════════════════════════════════════════════════════════════════════════
//  SERVER STARTUP

// ════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 8080;
// B22: Seed sample community decks

async function seedCommunityDecks() {
try {
const existing = await db.communityDecks.findMany({}, { page: 1, limit: 1 });
if (existing.decks && existing.decks.length > 0) return; // already seeded
const sampleDecks = [
{
title: 'Introduction to Biology',
description: 'Core concepts: cell biology, genetics, and ecosystems.',
subject_hint: 'Biology',
tags: ['biology', 'science', 'cells'],
author_name: 'KIWI Team',
card_count: 15,
average_rating: 4.8,
clone_count: 0,
is_featured: true,
sample_cards: [
{
front: 'What is the powerhouse of the cell?',
back: 'The mitochondria — responsible for producing ATP through cellular respiration.',
},
{
front: 'Define osmosis.',
back: 'The movement of water molecules from a region of lower solute concentration to higher solute concentration across a semi-permeable membrane.',
},
],
},
{
title: 'Physics Fundamentals',
description: 'Kinematics, forces, energy, and waves — foundational physics.',
subject_hint: 'Physics',
tags: ['physics', 'science', 'mechanics'],
author_name: 'KIWI Team',
card_count: 12,
average_rating: 4.6,
clone_count: 0,
is_featured: true,
sample_cards: [
{
front: "State Newton's Second Law.",
back: 'F = ma — Force equals mass multiplied by acceleration.',
},
{
front: "What is Hooke's Law?",
back: 'F = -kx — The force exerted by a spring is proportional to its displacement from equilibrium.',
},
],
},
{
title: 'Mathematics: Calculus Basics',
description: 'Limits, derivatives, and integrals for beginners.',
subject_hint: 'Mathematics',
tags: ['math', 'calculus', 'derivatives'],
author_name: 'KIWI Team',
card_count: 10,
average_rating: 4.7,
clone_count: 0,
is_featured: true,
sample_cards: [
{
front: 'What is the derivative of x²?',
back: '2x — using the power rule: d/dx[xⁿ] = nxⁿ⁻¹',
},
{ front: 'What is the integral of 1/x?', back: 'ln|x| + C' },
],
},
{
title: 'KIWI Study Tips',
description: 'Master spaced repetition, active recall, and the KIWI system.',
subject_hint: 'Study Skills',
tags: ['study-tips', 'srs', 'kiwi'],
author_name: 'KIWI Team',
card_count: 8,
average_rating: 4.9,
clone_count: 0,
is_featured: true,
sample_cards: [
{
front: 'When should you press "Again"?',
back: 'When you could not recall the answer at all, or recalled it incorrectly.',
},
{
front: 'What is a Reckoning?',
back: 'A mandatory high-stakes exam triggered when your subject pressure score is too high.',
},
],
},
];
for (const deck of sampleDecks) {
const id = firestore.collection('community_decks').doc().id;
await firestore
.collection('community_decks')
.doc(id)
.set({
...deck,
original_deck_id: null,
created_at: new Date(),
updated_at: new Date(),
});
}
console.log(`[KIWI] ✅ ${sampleDecks.length} community decks seeded`);
} catch (e) {
console.error('[KIWI] Community deck seeding failed:', e.message);
}
}

async function startServer() {
try {
await seedAchievements();
await db.marketplaceItems.seed();
await seedCommunityDecks();
console.log(`[KIWI] ✅ Achievements, marketplace, and community decks seeded`);

    // ════════════════════════════════════════════════════════════════════════════
    //  BREVO (SENDINBLUE) EMAIL SERVICE — CEE-style with daily reset & auto-fallback

    // ════════════════════════════════════════════════════════════════════════════
    function buildBrevoPool() {
      const senderEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@kiwi-study.app';
      const accts = [];
      if (process.env.BREVO_API_KEY) {
        accts.push({ key: process.env.BREVO_API_KEY.trim(), from: senderEmail, sentToday: 0, lastResetDate: '' });
      }
      for (let i = 2; i <= 15; i++) {
        const k = process.env[`BREVO_API_KEY_${i}`];
        if (k && k.trim()) accts.push({ key: k.trim(), from: senderEmail, sentToday: 0, lastResetDate: '' });
      }
      return accts;
    }
    const _brevoAccounts = buildBrevoPool();

    function _brevoResetIfNewDay(acct) {
      const today = new Date().toISOString().split('T')[0];
      if (acct.lastResetDate !== today) { acct.sentToday = 0; acct.lastResetDate = today; }
    }

    function _pickBrevoAccount() {
      for (const acct of _brevoAccounts) {
        _brevoResetIfNewDay(acct);
        if (acct.sentToday < 295) return acct;
      }
      return null;
    }

    async function _sendViaBrevo(acct, toEmail, subject, htmlContent) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': acct.key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            sender: { name: 'KIWI Study', email: acct.from },
            to: [{ email: toEmail }],
            subject,
            htmlContent,
          }),
        });
        if (res.status === 201 || res.status === 200 || res.status === 202) {
          acct.sentToday++;
          return { success: true };
        }
        let errMsg = `Brevo HTTP ${res.status}`;
        try { const b = await res.json(); errMsg = b.message || b.error || errMsg; } catch (_) {}
        if (res.status === 429) acct.sentToday = 300;
        return { success: false, error: errMsg };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    async function sendBrevoEmail(toEmail, templateName, params = {}) {
      if (_brevoAccounts.length === 0) {
        console.warn('[KIWI] No Brevo API keys configured. Skipping email.');
        return false;
      }
      const templates = {
        welcome: {
          subject: 'Welcome to KIWI 🥝',
          htmlContent: `<html><body><h1>Welcome to KIWI</h1><p>Hi ${params.name || 'Learner'},</p><p>Your spaced-repetition journey begins now. Start by adding a subject and creating your first deck.</p></body></html>`,
        },
        exam_result: {
          subject: 'Your KIWI Exam Results',
          htmlContent: `<html><body><h1>Exam Complete</h1><p>Subject: ${params.subjectName || 'Study Session'}</p><p>Score: ${params.scorePct || 0}%</p><p>${params.passed ? 'You passed! 🎉' : 'Keep practicing — mastery takes time.'}</p></body></html>`,
        },
        streak_danger: {
          subject: '⚠️ KIWI Streak in Danger',
          htmlContent: `<html><body><h1>Streak Alert</h1><p>Your ${params.streak || 0}-day streak is about to break. Do today's review to keep it alive!</p></body></html>`,
        },
        streak_broken: {
          subject: 'KIWI Streak Broken',
          htmlContent: `<html><body><h1>Streak Reset</h1><p>Your ${params.streak || 0}-day streak has ended. Every ending is a new beginning — start again today.</p></body></html>`,
        },
        weekly_digest: {
          subject: 'Your Weekly KIWI Chronicle',
          htmlContent: `<html><body><h1>Weekly Digest</h1><p>Reviews: ${params.reviews || 0}</p><p>Exams: ${params.exams || 0}</p><p>KS change: ${params.ksDelta || 0}</p></body></html>`,
        },
      };
      const tpl = templates[templateName] || templates.welcome;
      const acct = _pickBrevoAccount();
      if (!acct) {
        console.error('[KIWI] All Brevo accounts exhausted for today.');
        return false;
      }
      const result = await _sendViaBrevo(acct, toEmail, tpl.subject, tpl.htmlContent);
      // Auto-fallback if first account hit daily limit
      if (!result.success && (result.error || '').toLowerCase().includes('limit')) {
        const fallback = _pickBrevoAccount();
        if (fallback && fallback !== acct) {
          console.warn(`[KIWI] Brevo account hit limit — retrying with fallback`);
          const r2 = await _sendViaBrevo(fallback, toEmail, tpl.subject, tpl.htmlContent);
          return r2.success;
        }
      }
      if (!result.success) console.error('[KIWI] Brevo send failed:', result.error);
      return result.success;
    }
    async function sendEmailNotification(userId, templateName, params = {}) {
      try {
        const userDoc = await firestore.collection('users').doc(userId).get();
        if (!userDoc.exists) return;
        const user = userDoc.data();
        const prefs = user.notification_preferences || {};
        if (prefs.email === false) return;
        if (!user.email) return;
        await sendBrevoEmail(user.email, templateName, params);
      } catch (e) {
        console.error('[KIWI] Email notification failed:', e.message);
      }
    }

    // ════════════════════════════════════════════════════════════════════════════
    //  TELEGRAM BOT INTEGRATION

    // ════════════════════════════════════════════════════════════════════════════
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    async function sendTelegramMessage(chatId, text) {
      if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
      try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
        });
        return res.ok;
      } catch (e) {
        console.error('[KIWI] Telegram send failed:', e.message);
        return false;
      }
    }
    async function sendTelegramExamResult(userId, subjectId, scorePct, passed) {
      try {
        const userDoc = await firestore.collection('users').doc(userId).get();
        if (!userDoc.exists) return;
        const user = userDoc.data();
        const prefs = user.notification_preferences || {};
        if (prefs.telegram === false) return;
        if (!user.telegram_chat_id) return;
        const subject = await db.subjects.findById(subjectId).catch(() => null);
        const subjName = subject?.name || 'Study Session';
        const status = passed ? '✅ PASSED' : '❌ Did not pass';
        await sendTelegramMessage(
          user.telegram_chat_id,
          `*Exam Result: ${subjName}*\nScore: *${scorePct}%*\nStatus: ${status}`
        );
      } catch (e) {
        console.error('[KIWI] Telegram exam notify failed:', e.message);
      }
    }
    async function sendTelegramDailyReminder(userId) {
      try {
        const userDoc = await firestore.collection('users').doc(userId).get();
        if (!userDoc.exists) return;
        const user = userDoc.data();
        const prefs = user.notification_preferences || {};
        if (prefs.telegram === false) return;
        if (!user.telegram_chat_id) return;
        await sendTelegramMessage(
          user.telegram_chat_id,
          `🥝 *KIWI Daily Reminder*\nYour cards are waiting. Keep the streak alive!`
        );
      } catch (e) {
        console.error('[KIWI] Telegram reminder failed:', e.message);
      }
    }
    // Telegram webhook handler
    async function handleTelegramWebhook(body) {
      const msg = body.message;
      if (!msg || !msg.text) return;
      const chatId = msg.chat.id;
      const text = msg.text.trim();
      const cmd = text.split(' ')[0].toLowerCase();
      // Link telegram to user on /start
      if (cmd === '/start') {
        // Check if user exists with this chat_id
        const usersSnap = await firestore
          .collection('users')
          .where('telegram_chat_id', '==', String(chatId))
          .limit(1)
          .get();
        if (!usersSnap.empty) {
          return sendTelegramMessage(
            chatId,
            'Welcome back to KIWI 🥝! Your account is already linked. Use /status, /streak, or /due.'
          );
        }
        // Try to match by start token if provided
        const token = text.split(' ')[1];
        if (token) {
          const byToken = await firestore
            .collection('users')
            .where('telegram_link_token', '==', token)
            .limit(1)
            .get();
          if (!byToken.empty) {
            const userId = byToken.docs[0].id;
            await firestore
              .collection('users')
              .doc(userId)
              .update({ telegram_chat_id: String(chatId) });
            return sendTelegramMessage(
              chatId,
              '✅ KIWI account linked successfully! Use /status, /streak, or /due.'
            );
          }
        }
        return sendTelegramMessage(
          chatId,
          'Welcome to KIWI 🥝!\nTo link your account, visit Settings in the app and copy your Telegram link token, then send:\n/start '
        );
      }
      // Find user by chat_id
      const userSnap = await firestore
        .collection('users')
        .where('telegram_chat_id', '==', String(chatId))
        .limit(1)
        .get();
      if (userSnap.empty) {
        return sendTelegramMessage(
          chatId,
          'Account not linked. Visit the app Settings → Notifications to connect Telegram.'
        );
      }
      const userId = userSnap.docs[0].id;
      const user = userSnap.docs[0].data();
      if (cmd === '/status') {
        const stats = await db.userStats.get(userId).catch(() => ({}));
        const streak = stats?.current_streak || 0;
        const seeds = stats?.seedlings_balance || 0; // BUG 5 FIX: correct field name
        return sendTelegramMessage(
          chatId,
          `🥝 *KIWI Status*\nStreak: *${streak}* days\nSeedlings: *${seeds}*`
        );
      }
      if (cmd === '/streak') {
        const stats = await db.userStats.get(userId).catch(() => ({}));
        const streak = stats?.current_streak || 0;
        const longest = stats?.longest_streak || 0;
        return sendTelegramMessage(
          chatId,
          `🔥 *Streak*\nCurrent: *${streak}* days\nLongest: *${longest}* days`
        );
      }
      if (cmd === '/due') {
        const subjSnap = await db.subjects.findManyWithDecks(userId);
        let totalDue = 0;
        for (const s of subjSnap) {
          for (const d of s.decks || []) {
            const snap = await firestore.collection('cards').where('deck_id', '==', d.id).get();
            snap.forEach((doc) => {
              const c = doc.data();
              const today = new Date().toISOString().slice(0, 10);
              if (!c.due || c.due <= today) totalDue++;
            });
          }
        }
        return sendTelegramMessage(chatId, `📚 *Due Cards*\nTotal due today: *${totalDue}*`);
      }
      if (cmd === '/help') {
        return sendTelegramMessage(
          chatId,
          `🥝 *KIWI Bot Commands*\n/status — Overview\n/streak — Streak info\n/due — Cards due today\n/help — This message`
        );
      }
      return sendTelegramMessage(chatId, 'Unknown command. Try /help');
    }

    // ════════════════════════════════════════════════════════════════════════════
    //  INPUT VALIDATION MIDDLEWARE

    // ════════════════════════════════════════════════════════════════════════════
    function validatePayload(schema) {
      return (req, res, next) => {
        const errors = [];
        for (const [key, rules] of Object.entries(schema)) {
          const val = req.body[key];
          if (rules.required && (val === undefined || val === null)) {
            errors.push(`${key} is required`);
            continue;
          }
          if (val !== undefined && val !== null) {
            if (rules.type === 'string' && typeof val !== 'string')
              errors.push(`${key} must be a string`);
            if (rules.type === 'number' && typeof val !== 'number')
              errors.push(`${key} must be a number`);
            if (rules.type === 'boolean' && typeof val !== 'boolean')
              errors.push(`${key} must be a boolean`);
            if (rules.type === 'array' && !Array.isArray(val))
              errors.push(`${key} must be an array`);
            if (rules.enum && !rules.enum.includes(val))
              errors.push(`${key} must be one of ${rules.enum.join(', ')}`);
            if (rules.minLength !== undefined && String(val).length < rules.minLength)
              errors.push(`${key} must be at least ${rules.minLength} characters`);
            if (rules.maxLength !== undefined && String(val).length > rules.maxLength)
              errors.push(`${key} must be at most ${rules.maxLength} characters`);
            if (rules.pattern && !rules.pattern.test(String(val)))
              errors.push(`${key} format is invalid`);
          }
        }
        if (errors.length > 0) {
          return res.status(400).json({ error: 'Validation failed', details: errors });
        }
        next();
      };
    }
    // Telegram webhook endpoint
    app.post('/telegramWebhook', async (req, res) => {
      try {
        await handleTelegramWebhook(req.body);
        res.sendStatus(200);
      } catch (e) {
        console.error('[KIWI] Telegram webhook error:', e.message);
        res.sendStatus(200); // Always return 200 to Telegram
      }
    });
    // Notification preferences endpoint
    app.post('/api/settings/notifications', authenticate, async (req, res) => {
      try {
        const { email, telegram } = req.body;
        const updates = {};
        if (typeof email === 'boolean') updates['notification_preferences.email'] = email;
        if (typeof telegram === 'boolean') updates['notification_preferences.telegram'] = telegram;
        await firestore.collection('users').doc(req.user.id).update(updates);
        res.json({ success: true, preferences: { email, telegram } });
      } catch (e) {
        res.status(500).json({ error: 'Failed to update preferences', details: e.message });
      }
    });
    app.listen(PORT, () => {
      console.log(`[KIWI] 🥝 Living Ecosystem backend running on port ${PORT}`);
      console.log(`[KIWI] Environment: ${process.env.NODE_ENV || 'development'}`);
    });

} catch (e) {
console.error('[KIWI] Failed to start server:', e);
process.exit(1);
}
}
startServer();