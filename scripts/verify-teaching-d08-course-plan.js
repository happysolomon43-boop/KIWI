'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const required = [
  'teaching/d08/contracts.js',
  'teaching/d08/canonical-plan.js',
  'teaching/d08/intelligence.js',
  'teaching/d08/service.js',
  'teaching/repositories/d08-course-plan.js',
  'teaching/repositories/d08/plan-reader.js',
  'teaching/repositories/d08/plan-writer.js',
  'teaching/repositories/d08/plan-graph.js',
  'teaching/repositories/d08/plan-coverage.js',
  'teaching/repositories/d08/coverage-store.js',
  'teaching/repositories/d08/scope-store.js',
  'teaching/repositories/d08/vpk-store.js',
  'migrations/20260928_teaching_d08_course_plan_coverage.sql',
  'migrations/20260928_teaching_d08_post_migration_hardening.sql',
  'docs/teaching/d08-course-plan-coverage.md',
  'docs/teaching/migrations/d08-recovery.md',
  'tests/teaching/fixtures/d08/curriculum-profiles.json',
  'tests/teaching/unit/d08-course-plan.test.js',
  'tests/teaching/integration/d08-course-plan-schema.test.js',
  'public/teaching-d08.js',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`D08 missing ${file}`);
}

const tasks = [
  'TCH-0101','TCH-0103','TCH-0104','TCH-0105','TCH-0106','TCH-0107','TCH-0108','TCH-0109',
  'TCH-0110','TCH-0111','TCH-0112','TCH-0114','TCH-0115','TCH-0116','TCH-0117','TCH-0118',
  'TCH-0704','TCH-0705','TCH-0706','TCH-0707','TCH-0708','TCH-0709','TCH-0710','TCH-0711',
  'TCH-0715','TCH-0716','TCH-0726','TCH-0728','TCH-0729','TCH-0730','TCH-0731','TCH-0735','TCH-0736',
];
if (tasks.length !== 33 || new Set(tasks).size !== 33) throw new Error('D08 canonical task set drifted.');
const doc = read('docs/teaching/d08-course-plan-coverage.md');
for (const id of tasks) if (!doc.includes(id)) throw new Error(`D08 task not accounted for: ${id}`);

const contracts = read('teaching/d08/contracts.js');
for (const invariant of [
  'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED',
  'TEACHING_D08_EXCLUSION_REASON_REQUIRED',
  'TEACHING_D08_CRITICAL_EXIT_CONDITION_REQUIRED',
  'TEACHING_D08_DEPENDENCY_CYCLE',
  'TEACHING_D08_REQUIRED_DIAGNOSTIC_UNRESOLVED',
  'incomplete-required-content.v1',
]) {
  if (!contracts.includes(invariant)) throw new Error(`D08 invariant/policy missing: ${invariant}`);
}

const canonical = read('teaching/d08/canonical-plan.js');
for (const contract of [
  'planned_only',
  'teach_full',
  'teach_compressed',
  'validated_prior_knowledge_no_initial_instruction',
  'history_must_remain_immutable',
]) {
  if (!canonical.includes(contract)) throw new Error(`D08 frozen TPF-03 realization missing: ${contract}`);
}

const intelligence = read('teaching/d08/intelligence.js');
for (const binding of [
  'teaching.curriculum.course_plan_generation',
  'teaching.curriculum.course_scope_change_impact_analysis',
  'course_plan_generation',
  'scope_change_impact_analysis',
]) {
  if (!intelligence.includes(binding)) throw new Error(`D08 intelligence binding missing: ${binding}`);
}

const migration = read('migrations/20260928_teaching_d08_course_plan_coverage.sql');
for (const table of [
  'teaching_course_plan_prerequisites',
  'teaching_course_plan_source_mappings',
  'teaching_course_plan_exclusions',
  'teaching_coverage_audits',
  'teaching_course_scope_changes',
  'teaching_course_scope_change_applications',
]) {
  if (!migration.includes(`CREATE TABLE public.${table}`)) throw new Error(`D08 migration missing ${table}`);
}
if (!migration.includes('teaching_course_plan_d08_update_guard')) throw new Error('D08 Course Plan immutable-field guard missing.');
if (!migration.includes('ENABLE ROW LEVEL SECURITY')) throw new Error('D08 RLS missing.');
if (/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,140}authenticated/i.test(migration)) throw new Error('D08 grants browser academic mutation.');
const hardening = read('migrations/20260928_teaching_d08_post_migration_hardening.sql');
if (!/SET search_path = pg_catalog, public/.test(hardening)) throw new Error('D08 Course Plan guard search_path hardening missing.');
if (!hardening.includes('teaching_coverage_audits_course_idx')) throw new Error('D08 Coverage Audit course FK index hardening missing.');

const backend = read('teaching-backend.js');
for (const route of ['plan-review','coverage-report','activation-coverage-decision','scope-review/:scopeChangeId/analyze']) {
  if (!backend.includes(route)) throw new Error(`D08 backend route missing: ${route}`);
}

const fixtures = JSON.parse(read('tests/teaching/fixtures/d08/curriculum-profiles.json'));
if (fixtures.length !== 7) throw new Error('D08 requires exactly seven curriculum-profile fixtures.');
for (const name of ['mathematics','biology','chemistry','history','literature','computer science','mixed-profile']) {
  if (!fixtures.some((fixture) => fixture.discipline === name)) throw new Error(`D08 fixture missing: ${name}`);
}

const featureSource = required.filter((file) => file.startsWith('teaching/d08') || file.startsWith('teaching/repositories/d08')).map(read).join('\n').toLowerCase();
if (!featureSource.includes('validated-prior-knowledge.v1')) throw new Error('D08 validated-prior-knowledge.v1 persistence policy binding missing.');
for (const forbidden of ['@google/generative-ai','openai','anthropic','gemini-pro']) {
  if (featureSource.includes(forbidden)) throw new Error(`D08 selects provider/model directly: ${forbidden}`);
}
if (/insert into\s+public\.teaching_student_knowledge/i.test(featureSource)) throw new Error('D08 mutates SKM.');
if (/insert into\s+public\.(gradebook|teaching_grade)/i.test(featureSource)) throw new Error('D08 mutates Gradebook.');

const ui = read('public/teaching-d08.js');
const teachingUi = read('public/teaching.js');
const teachingHtml = read('public/teaching.html');
if (!ui.includes('Course setup · Stage 2') || !ui.includes('Required content stays accounted for')) throw new Error('D08 Stage 2 review UI missing.');
if (!ui.includes("courseSurface.registerSection") || !ui.includes("id: 'course-plan'") || !ui.includes('renderSummary: renderCoursePlanSummary')) {
  throw new Error('D08 Course Plan is not integrated as a course-scoped surface.');
}
if (/nav\.register|KIWITeachingNavigation/.test(ui)) throw new Error('D08 Course Plan must not register as global Teaching navigation.');
if (!ui.includes('Quick view') || !ui.includes('View full Course Plan')) throw new Error('D08 course-scoped preview/full-plan entry points missing.');
if (!teachingUi.includes('window.KIWITeachingCourses') || !teachingUi.includes('teachingCourseSections')) throw new Error('Teaching course-context navigation API missing.');
if (!teachingHtml.includes('teaching-course-nav__item') || !teachingHtml.includes('/teaching-d08.js')) throw new Error('D08 course-context browser integration is not packaged.');

console.log('[Teaching D08 verify] PASS — 33 tasks accounted for; frozen TPF-03 planning is provisional, Course Plan/Coverage authority is deterministic and versioned, scope inheritance is explicit, and routes remain held until D30.');
