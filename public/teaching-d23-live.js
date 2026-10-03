const { kiwiApiRequest, hasKiwiSession } = window.KIWI_API_CLIENT || {};

if (typeof kiwiApiRequest !== 'function' || typeof hasKiwiSession !== 'function') {
  throw new Error('KIWI shared API client must load before the D23 visible workspace.');
}

const PRIMARY = Object.freeze([
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'courses', label: 'Courses', icon: 'layers' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'work', label: 'Work', icon: 'check' },
  { id: 'record', label: 'Record', icon: 'record' },
]);
const COURSE_TABS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'plan', label: 'Course Plan' },
  { id: 'work', label: 'Work' },
  { id: 'results', label: 'Results' },
  { id: 'teacher', label: 'Teacher' },
]);
const state = {
  view: 'today',
  secondary: null,
  courseId: null,
  courseTab: 'overview',
  requestSeq: 0,
  ownsSurface: false,
  lastRender: null,
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const attr = esc;
const words = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const byId = (id) => document.getElementById(id);
const host = () => byId('teachingApp');
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const api = (path, options) => kiwiApiRequest(path, options);
const coursePath = (courseId, tail) => `/teaching/information/courses/${encodeURIComponent(String(courseId))}/${tail}`;

function icon(name) {
  const paths = {
    sun: '<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.5 1.5m9.8 9.8 1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"/><circle cx="12" cy="12" r="4"/>',
    layers: '<path d="m4 8 8-4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
    calendar: '<path d="M5 4v3m14-3v3M4 9h16"/><rect x="4" y="6" width="16" height="14" rx="2"/>',
    check: '<path d="m5 12 4 4L19 6"/><rect x="4" y="4" width="16" height="16" rx="2"/>',
    record: '<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    spark: '<path d="m12 3 1.4 4.1L17 8.5l-3.6 2.4.9 4.3-2.3-2.2-2.3 2.2.9-4.3L7 8.5l3.6-1.4L12 3Z"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5c.1-.3.1-.7.1-1Z"/>',
    archive: '<path d="M4 7h16M6 7v13h12V7M9 11h6"/><path d="M5 4h14v3H5z"/>',
    message: '<path d="M5 5h14v10H9l-4 4V5Z"/>',
    book: '<path d="M4 5h6a2 2 0 0 1 2 2v12a3 3 0 0 0-3-3H4V5Zm16 0h-6a2 2 0 0 0-2 2v12a3 3 0 0 1 3-3h5V5Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    exit: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
    user: '<circle cx="12" cy="8" r="3"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

function fmt(value, options = {}) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat('en', {
      dateStyle: options.dateStyle || 'medium',
      timeStyle: options.noTime ? undefined : 'short',
      timeZone: options.timeZone || zone(),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function truthTone(status) {
  const value = String(status || '').toUpperCase();
  if (value.includes('PROVISIONAL')) return ['provisional', 'Provisional'];
  if (value.includes('INFER') || value.includes('LEARNING')) return ['inferred', 'Inferred'];
  if (value.includes('PLAN')) return ['planned', 'Planned'];
  if (value.includes('UNRESOLVED') || value.includes('CONFLICT') || value.includes('FAIL')) return ['unresolved', 'Unresolved'];
  return ['official', 'Official'];
}
function truth(status) {
  const [tone, label] = truthTone(status);
  return `<span class="d23-truth" data-tone="${tone}">${label}</span>`;
}
function issueStrip(issues = []) {
  if (!issues?.length) return '';
  return `<aside class="d23-issue" role="status">${icon('spark')}<span><strong>Some information is temporarily unavailable.</strong><br>${esc(issues.map((item) => item?.message || item?.code || 'Read unavailable').join(' · '))}</span></aside>`;
}
function empty(title, copy, action = '') {
  return `<section class="d23-empty"><div class="d23-empty__mark">${icon('spark')}</div><h2>${esc(title)}</h2><p>${esc(copy)}</p>${action}</section>`;
}
function loading() {
  const main = host();
  if (!main) return;
  main.innerHTML = '<section class="d23-loading" data-d23-page><div class="d23-loading__mark" aria-label="Loading Teaching"></div></section>';
}
function showError(error, retry) {
  const main = host();
  if (!main) return;
  main.innerHTML = `<section class="d23-error" data-d23-page><div class="d23-kicker">Teaching</div><h2>This workspace could not load.</h2><p>${esc(error?.message || 'The authoritative Teaching read is temporarily unavailable.')}</p><button class="d23-button d23-button--primary" id="d23Retry">Try again</button></section>`;
  byId('d23Retry')?.addEventListener('click', retry || renderCurrent);
}
function pageHead({ kicker, title, lead, actions = '' }) {
  return `<header class="d23-page-head"><div><div class="d23-kicker">${esc(kicker)}</div><h1>${esc(title)}</h1><p class="d23-lead">${esc(lead)}</p></div><div class="d23-head-actions">${actions}</div></header>`;
}
function setContext(eyebrow, title) {
  const e = byId('d23ContextEyebrow');
  const t = byId('d23ContextTitle');
  if (e) e.textContent = eyebrow;
  if (t) t.textContent = title;
}
function markActive() {
  document.querySelectorAll('[data-d23-primary]').forEach((node) => {
    node.dataset.active = node.dataset.d23Primary === state.view && !state.secondary && !state.courseId ? 'true' : 'false';
  });
}
function closeMenu() { byId('teachingMenuClose')?.click(); }

async function request(path, options) {
  const sequence = ++state.requestSeq;
  loading();
  try {
    const data = await api(path, options);
    if (sequence !== state.requestSeq) return null;
    return data;
  } catch (error) {
    if (sequence === state.requestSeq) showError(error);
    throw error;
  }
}

function eventItem(event) {
  const type = event.kind === 'ASSESSMENT' ? 'record' : 'calendar';
  const id = event.classId ? ` data-class-id="${attr(event.classId)}"` : '';
  return `<button class="d23-item" type="button"${id}><span class="d23-item__icon">${icon(type)}</span><span class="d23-item__copy"><h3>${esc(event.title || words(event.kind))}</h3><p>${esc(words(event.assessmentType || event.slotKind || event.kind))}</p></span><span class="d23-item__time">${esc(fmt(event.startsAt))}${event.endsAt ? `<small>until ${esc(fmt(event.endsAt))}</small>` : ''}</span></button>`;
}
function workCard(item) {
  const id = item.assignmentId || item.assignment_id || '';
  const due = item?.deadline?.dueAt || item.due_at || item.deadline_at;
  return `<article class="d23-panel d23-panel--soft d23-work-card" data-assignment-id="${attr(id)}"><div><div class="d23-kicker">${esc(words(item.purpose || 'Course Work'))}</div><h3 style="margin-top:10px">${esc(item.title || 'Assignment')}</h3><p>${esc(words(item.lifecycleState || item.lifecycle_state || 'Assigned'))}${item.graded ? ' · Graded' : ''}</p></div><div class="d23-work-card__due"><span>Due</span><strong>${esc(fmt(due))}</strong></div></article>`;
}

async function renderToday() {
  setContext('Attention, not noise', 'Today');
  const model = await request(`/teaching/information/today?currentTimeZone=${encodeURIComponent(zone())}`);
  if (!model) return;
  const current = model.now || [], needs = model.needsAction || [], next = model.next || [], later = model.laterToday || [], recent = model.recentlyChanged || [];
  const nowBlock = model.quiet
    ? `<article class="d23-panel d23-panel--focus"><div class="d23-quiet-mark">${icon('sun')}</div><div class="d23-kicker" style="margin-top:28px">Clear horizon</div><div class="d23-focus-title">Nothing is pulling at you.</div><p class="d23-focus-copy">No Class is active, no near-term Work needs action, and Teaching has no meaningful change to interrupt your day.</p></article>`
    : `<article class="d23-panel d23-panel--focus"><div class="d23-panel-head"><div><div class="d23-kicker">Now</div><h2>${current.length ? 'In progress' : 'Your day is ready'}</h2></div><span class="d23-count">${current.length}</span></div>${current.length ? `<div class="d23-list" style="margin-top:20px">${current.map(eventItem).join('')}</div>` : '<div class="d23-focus-title">No active Class right now.</div><p class="d23-focus-copy">Teaching stays quiet until something genuinely needs your attention.</p>'}</article>`;
  const actionBlock = `<article class="d23-panel"><div class="d23-panel-head"><div><div class="d23-kicker">Needs action</div><h2>Only what matters</h2></div><span class="d23-count">${needs.length}</span></div>${needs.length ? `<div class="d23-list" style="margin-top:20px">${needs.map((item) => `<button class="d23-item" type="button"><span class="d23-item__icon">${icon(item.kind === 'WORK' ? 'check' : 'spark')}</span><span class="d23-item__copy"><h3>${esc(item.title || words(item.kind))}</h3><p>${esc(words(item.kind))}</p></span><span class="d23-item__time">${item.dueAt ? esc(fmt(item.dueAt)) : 'Open →'}</span></button>`).join('')}</div>` : '<p>Nothing requires a decision or submission at the moment.</p>'}</article>`;
  const main = host();
  main.innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'KIWI Teaching',title:'Today',lead:'Teaching brings forward only what is academically relevant now. Surprise assessments stay hidden until they are legitimately exposed.'})}${issueStrip(model.issues)}<section class="d23-attention">${nowBlock}${actionBlock}</section>${next.length ? `<section class="d23-section"><div class="d23-section-head"><div><div class="d23-kicker">Next</div><h2>Coming up</h2></div></div><div class="d23-list">${next.map(eventItem).join('')}</div></section>` : ''}${later.length ? `<section class="d23-section"><div class="d23-section-head"><div><div class="d23-kicker">Later today</div><h2>Still ahead</h2></div></div><div class="d23-list">${later.map(eventItem).join('')}</div></section>` : ''}${recent.length ? `<section class="d23-section"><div class="d23-section-head"><div><div class="d23-kicker">Recently changed</div><h2>Academic updates</h2></div></div><div class="d23-grid d23-grid--2">${recent.map((item) => `<article class="d23-panel d23-panel--soft"><div class="d23-kicker">${esc(words(item.kind))}</div><h3 style="margin-top:10px">${esc(item.title || 'Academic update')}</h3><p>${esc(words(item.state))}</p></article>`).join('')}</div></section>` : ''}</section>`;
  bindClassEvents(main);
}

async function renderCourses() {
  setContext('Your academic programmes', 'Courses');
  const model = await request('/teaching/information/courses');
  if (!model) return;
  const courses = model.courses || [];
  const create = '<button class="d23-button d23-button--primary" data-secondary="create">Create Course</button>';
  const body = courses.length
    ? `<div class="d23-grid d23-grid--3">${courses.map((course) => `<button class="d23-panel d23-course-card" type="button" data-course-id="${attr(course.courseId)}"><div class="d23-course-card__state"><span>${esc(words(course.lifecycleState))}</span><span>${esc(course.teacher?.displayName || 'Teacher pending')}</span></div><h2>${esc(course.title)}</h2><p class="d23-course-card__topic">${course.currentTopic ? `Current · ${esc(course.currentTopic)}` : 'Course plan in progress'}</p><div class="d23-course-card__foot"><span>${course.nextEvent ? `Next · ${esc(fmt(course.nextEvent.startsAt))}` : 'No scheduled event'}</span><span class="d23-arrow">›</span></div></button>`).join('')}</div>`
    : empty('No Teaching Courses yet', 'Create a Course from an existing KIWI Subject to begin.', create);
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Courses',title:'Your courses',lead:'A restrained view of active Courses: where you are, who is teaching, and what matters next.',actions:create})}${body}</section>`;
  host().querySelectorAll('[data-course-id]').forEach((button) => button.addEventListener('click', () => openCourse(button.dataset.courseId, 'overview')));
  bindSecondary(host());
}

async function renderCalendar() {
  setContext('The sole Teaching timetable', 'Calendar');
  const model = await request(`/teaching/information/calendar?currentTimeZone=${encodeURIComponent(zone())}`);
  if (!model) return;
  const events = model.events || [];
  const now = new Date(model.serverNow || Date.now()).getTime();
  const timeline = events.length ? `<section class="d23-panel"><div class="d23-panel-head"><div><div class="d23-kicker">Authoritative timetable</div><h2>Classes and academic events</h2></div>${truth('AUTHORITATIVE_FINAL')}</div><div class="d23-timeline" style="margin-top:18px">${events.map((event) => { const start = new Date(event.startsAt).getTime(), end = event.endsAt ? new Date(event.endsAt).getTime() : start + 1; const current = start <= now && end > now; return `<button class="d23-timeline-row" data-current="${current ? 'true' : 'false'}" type="button"${event.classId ? ` data-class-id="${attr(event.classId)}"` : ''}><span class="d23-timeline-dot"></span><span class="d23-timeline-time">${esc(fmt(event.startsAt, {dateStyle:'short'}))}</span><span class="d23-timeline-copy"><strong>${esc(event.title || 'Academic event')}</strong><span>${esc(words(event.assessmentType || event.slotKind || event.kind))}</span></span>${truth(event.truthStatus)}</button>`; }).join('')}</div></section>` : empty('Your timetable is clear', 'Classes, announced Tests, Exams, recovery sessions, breaks and pauses will appear here when their authoritative owners schedule them.');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Calendar',title:'One timetable',lead:'Academic time comes from Scheduler/Calendar. Device time changes display, never the official schedule.'})}${issueStrip(model.issues)}${timeline}<section class="d23-section d23-grid d23-grid--2"><article class="d23-panel d23-panel--soft"><div class="d23-kicker">One calendar</div><h2>No second timetable</h2><p>Today, Courses and notifications point back to the same authoritative schedule.</p></article><article class="d23-panel d23-panel--soft"><div class="d23-kicker">Fair surprise</div><h2>Impromptu means impromptu</h2><p>Unannounced assessments stay absent until legitimate exposure.</p></article></section></section>`;
  bindClassEvents(host());
}

async function renderWork() {
  setContext('Across every Course', 'Work');
  const model = await request('/teaching/information/work');
  if (!model) return;
  renderWorkModel(model, {global:true});
}
function renderWorkModel(model, {global = false, courseId = null} = {}) {
  const items = model.assignments || [];
  const closed = new Set(['CLOSED','VERIFIED','REPLACED','INVALIDATED']);
  const active = items.filter((item) => !closed.has(String(item.lifecycleState || item.lifecycle_state || '').toUpperCase()));
  const completed = items.filter((item) => closed.has(String(item.lifecycleState || item.lifecycle_state || '').toUpperCase()));
  host().innerHTML = `<section class="d23-page" data-d23-page>${global ? pageHead({kicker:'Work',title:'Work in motion',lead:'One organized place for Teaching assignments. Course views reuse the same Work truth instead of keeping separate copies.'}) : ''}${items.length ? `<section><div class="d23-section-head"><div><div class="d23-kicker">Due & active</div><h2>What needs doing</h2></div><span class="d23-count">${active.length}</span></div><div class="d23-grid d23-grid--2">${active.map(workCard).join('')}</div></section>${completed.length ? `<section class="d23-section"><div class="d23-section-head"><div><div class="d23-kicker">Completed</div><h2>Recent Work</h2></div><span class="d23-count">${completed.length}</span></div><div class="d23-grid d23-grid--2">${completed.slice(0,12).map(workCard).join('')}</div></section>` : ''}` : empty('No Work is waiting', 'Assignments, purposeful reading and independent Work will gather here across Courses.')}</section>`;
  if (courseId) bindCourseTabs(courseId, 'work');
}

async function renderRecord() {
  setContext('Formal academic history', 'Record');
  const model = await request('/teaching/information/record');
  if (!model) return;
  const records = model.records || [];
  const body = records.length ? `<div class="d23-grid d23-grid--2">${records.map((entry) => { const record = entry.record || {}, gpa = record.gpa?.gpa ?? record.semesterGpa?.gpa ?? record.gpa ?? null, courses = record.courses || record.courseResults || []; return `<article class="d23-panel"><div class="d23-panel-head"><div><div class="d23-kicker">Semester</div><h2>${esc(entry.name || 'Semester')}</h2></div>${truth('AUTHORITATIVE_FINAL')}</div><div class="d23-record-score">${gpa == null ? '—' : esc(gpa)}</div><div class="d23-record-meta"><span>${courses.length} Course${courses.length === 1 ? '' : 's'}</span><span>Gradebook-backed</span><span>Progression kept separate</span></div>${courses.length ? `<div class="d23-list" style="margin-top:18px">${courses.slice(0,6).map((course) => `<button class="d23-item" data-course-id="${attr(course.course_id || course.courseId || '')}" type="button"><span class="d23-item__icon">${icon('record')}</span><span class="d23-item__copy"><h3>${esc(course.title || course.course_title || 'Course')}</h3><p>${esc(course.grade || course.official_grade || words(course.outcome || ''))}</p></span><span class="d23-item__time">${esc(course.percentage ?? course.score_percentage ?? '')}</span></button>`).join('')}</div>` : ''}</article>`; }).join('')}</div>` : empty('No formal Record yet', 'Official Semester, Course, Topic and Assessment results appear here when Gradebook and Progression have finalized them.');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Record',title:'Your record',lead:'Official academic results, separated from learning inference and from progression decisions.'})}${issueStrip(model.issues)}${body}<section class="d23-section d23-panel d23-panel--soft"><div class="d23-kicker">Truth separation</div><h2>Marks, learning insight and progression are related—not interchangeable.</h2><p>Record shows official academic results. Learning Analysis remains inference; Progression explains what happens next.</p></section></section>`;
  host().querySelectorAll('[data-course-id]').forEach((button) => button.addEventListener('click', () => button.dataset.courseId && openCourse(button.dataset.courseId, 'results')));
}

function courseTabs(courseId, active) {
  return `<nav class="d23-course-nav" aria-label="Course"><div class="d23-course-nav__inner">${COURSE_TABS.map((tab) => `<button class="d23-course-tab" data-course-tab="${tab.id}" data-active="${tab.id === active ? 'true' : 'false'}" type="button">${esc(tab.label)}</button>`).join('')}</div></nav>`;
}
function bindCourseTabs(courseId, active) {
  host().querySelectorAll('[data-course-tab]').forEach((button) => button.addEventListener('click', () => openCourse(courseId, button.dataset.courseTab)));
  const materials = host().querySelector('[data-course-materials]');
  if (materials) materials.addEventListener('click', () => renderCourseMaterials(courseId));
  if (active === 'work') return;
}
async function openCourse(courseId, tab = 'overview') {
  state.courseId = String(courseId);
  state.courseTab = tab;
  state.secondary = null;
  markActive();
  setContext('Course workspace', 'Loading…');
  await renderCourseTab();
}
async function renderCourseTab() {
  const { courseId, courseTab } = state;
  if (!courseId) return navigate('courses');
  if (courseTab === 'plan') return renderCoursePlan(courseId);
  if (courseTab === 'work') return renderCourseWork(courseId);
  if (courseTab === 'results') return renderCourseResults(courseId);
  if (courseTab === 'teacher') return renderCourseTeacher(courseId);
  return renderCourseOverview(courseId);
}
async function renderCourseOverview(courseId) {
  const model = await request(coursePath(courseId, 'overview'));
  if (!model) return;
  const course = model.course || {};
  setContext('Course · Overview', course.title || 'Course');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Course Overview',title:course.title || 'Course',lead:'The useful Course facts in one place—without exposing internal machinery or creating a second academic record.',actions:'<button class="d23-button d23-button--ghost" data-course-materials>Materials</button>'})}${courseTabs(courseId,'overview')}${issueStrip(model.issues)}${model.warnings?.length ? `<div class="d23-grid">${model.warnings.map((warning) => `<div class="d23-notice">${esc(warning.message)}</div>`).join('')}</div>` : ''}<section class="d23-grid d23-grid--3"><article class="d23-panel"><div class="d23-kicker">Current topic</div><h2>${esc(model.currentTopic || 'Plan in progress')}</h2><p>Where this Course is academically focused now.</p></article><article class="d23-panel"><div class="d23-kicker">Next Class</div><h2>${model.nextClass ? esc(fmt(model.nextClass.startsAt)) : 'Not scheduled'}</h2><p>${model.nextClass ? 'Open the Class event for details.' : 'Calendar owns the official timetable.'}</p></article><article class="d23-panel"><div class="d23-kicker">Course Teacher</div><h2>${esc(model.teacher?.displayName || 'Teacher pending')}</h2><p>${esc(words(model.phase || course.lifecycleState || 'Course state'))}</p></article></section>${model.importantWork?.length ? `<section class="d23-section"><div class="d23-section-head"><div><div class="d23-kicker">Important Work</div><h2>What needs doing</h2></div></div><div class="d23-grid d23-grid--2">${model.importantWork.map(workCard).join('')}</div></section>` : ''}${model.nextAssessment ? `<section class="d23-section d23-panel"><div class="d23-panel-head"><div><div class="d23-kicker">Next major assessment</div><h2>${esc(model.nextAssessment.title || 'Assessment')}</h2></div>${truth('PLANNED')}</div><p>${esc(fmt(model.nextAssessment.startsAt))}</p></section>` : ''}<section class="d23-section d23-panel d23-panel--soft"><div class="d23-panel-head"><div><div class="d23-kicker">Course state</div><h2>${esc(words(course.lifecycleState))}</h2></div>${truth('AUTHORITATIVE_FINAL')}</div><p>Teacher notes and internal engines are deliberately absent from this student surface.</p></section></section>`;
  bindCourseTabs(courseId,'overview');
}
async function renderCoursePlan(courseId) {
  const model = await request(coursePath(courseId, 'plan'));
  if (!model) return;
  const review = model.review || {}, plan = review.plan;
  setContext('Course · Course Plan', review.course?.title || 'Course Plan');
  const content = plan ? `<section class="d23-panel"><div class="d23-panel-head"><div><div class="d23-kicker">Active Course Plan · version ${esc(plan.version || '—')}</div><h2>${plan.currentForCourseScope ? 'Current for Course scope' : 'Plan review required'}</h2></div>${truth(plan.currentForCourseScope ? 'AUTHORITATIVE_FINAL' : 'AUTHORITATIVE_PROVISIONAL')}</div>${review.scopeChange ? `<div class="d23-notice" style="margin-top:16px">Course scope changed: ${esc(words(review.scopeChange.status))}.</div>` : ''}<div class="d23-list" style="margin-top:18px">${(plan.topics || []).map((topic) => `<details class="d23-panel d23-panel--soft" style="padding:16px"><summary style="cursor:pointer;font-weight:750">${esc(topic.title)} <span style="float:right;color:#6f7884">${(topic.learningUnits || []).length} units</span></summary><div style="margin-top:14px">${topic.subtopics?.length ? `<p>${esc(topic.subtopics.map((item) => item.title).join(' · '))}</p>` : ''}${(topic.learningUnits || []).map((unit) => `<div class="d23-notice" style="margin-top:8px;border-color:var(--d23-line);background:rgba(255,255,255,.018);color:#9aa3ad"><strong style="color:#d9dedf">${esc(unit.title)}</strong><br>${esc(unit.intendedCompetence || '')}</div>`).join('')}</div></details>`).join('')}</div></section>` : empty('Course Plan not created yet','Once validated curriculum and prerequisite checks are ready, the authoritative Course Plan appears here.');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Course Plan',title:review.course?.title || 'Course Plan',lead:'Versioned academic scope, readable without exposing raw internal identifiers.'})}${courseTabs(courseId,'plan')}${content}<section class="d23-section d23-panel d23-panel--soft"><div class="d23-kicker">Coverage is not mastery</div><h2>A complete plan does not claim you already know it.</h2><p>Course scope, assessment eligibility and learning inference remain separate truths.</p></section></section>`;
  bindCourseTabs(courseId,'plan');
}
async function renderCourseWork(courseId) {
  const model = await request(coursePath(courseId, 'work'));
  if (!model) return;
  setContext('Course · Work', 'Course Work');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Course Work',title:'Work for this course',lead:'The same authoritative Work record, filtered to this Course.'})}${courseTabs(courseId,'work')}<div id="d23CourseWorkHost"></div></section>`;
  const outer = host();
  const target = byId('d23CourseWorkHost');
  const items = model.assignments || [];
  if (target) target.innerHTML = items.length ? `<div class="d23-grid d23-grid--2">${items.map(workCard).join('')}</div>` : empty('No Course Work is waiting','Assignments for this Course will appear here when they exist.');
  bindCourseTabs(courseId,'work');
}
async function renderCourseResults(courseId) {
  const model = await request(coursePath(courseId, 'results'));
  if (!model) return;
  setContext('Course · Results', 'Results');
  const results = model.results || {};
  const assessments = results.assessments || results.results || results.items || [];
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Course Results',title:'Official results',lead:'Gradebook truth remains separate from learning inference and from progression.'})}${courseTabs(courseId,'results')}${issueStrip(model.issues)}<section class="d23-grid d23-grid--2"><article class="d23-panel"><div class="d23-kicker">Official marks</div><h2>Gradebook-backed</h2>${assessments.length ? `<div class="d23-list" style="margin-top:18px">${assessments.slice(0,12).map((item) => `<div class="d23-item"><span class="d23-item__icon">${icon('record')}</span><span class="d23-item__copy"><h3>${esc(item.title || item.assessment_title || words(item.assessmentType || 'Assessment'))}</h3><p>${esc(words(item.state || item.marking_state || 'Recorded'))}</p></span><span class="d23-item__time">${esc(item.percentage ?? item.raw_percentage ?? item.score ?? '')}</span></div>`).join('')}</div>` : '<p>No finalized Assessment result is available yet.</p>'}</article><article class="d23-panel"><div class="d23-kicker">Progression</div><h2>${esc(words(model.progression?.outcome || model.progression?.phase || 'Not finalized'))}</h2><p>Progression explains what happens next; it does not rewrite the Gradebook.</p></article></section><section class="d23-section d23-panel d23-panel--soft"><div class="d23-kicker">Truth separation</div><h2>Official marks ≠ learning inference.</h2><p>D20 owns Gradebook marks. D13 owns learning inference. D21 owns progression.</p></section></section>`;
  bindCourseTabs(courseId,'results');
}
async function renderCourseTeacher(courseId) {
  const model = await request(`/teaching/courses/${encodeURIComponent(String(courseId))}/teacher`);
  if (!model) return;
  const teacher = model.teacher || model.identity || model;
  setContext('Course · Teacher', teacher.displayName || 'Teacher');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Course Teacher',title:teacher.displayName || 'Your Teacher',lead:'Persistent Teacher identity and interaction style for this Course.'})}${courseTabs(courseId,'teacher')}<section class="d23-grid d23-grid--2"><article class="d23-panel d23-panel--focus"><div class="d23-quiet-mark">${icon('user')}</div><div class="d23-focus-title">${esc(teacher.displayName || 'Course Teacher')}</div><p class="d23-focus-copy">${esc(teacher.identityStatement || teacher.introduction || teacher.description || 'Your Course Teacher remains consistent across Teaching interactions.')}</p></article><article class="d23-panel"><div class="d23-kicker">Interaction</div><h2>${esc(words(model.interactionProfile?.register || model.register || 'Normal'))}</h2><p>Interaction preferences can shape presentation, but never change academic truth or standards.</p><div class="d23-notice" style="margin-top:18px;border-color:var(--d23-line);background:rgba(255,255,255,.018);color:#89929e">Internal Teacher Notes are not exposed here.</div></article></section></section>`;
  bindCourseTabs(courseId,'teacher');
}
async function renderCourseMaterials(courseId) {
  const model = await request(coursePath(courseId, 'materials'));
  if (!model) return;
  setContext('Course · Materials', 'Materials');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Course Materials',title:'Source materials',lead:'A secondary Course surface for the material inventory used to ground planning.'})}<button class="d23-button d23-button--ghost" id="d23BackCourse">← Back to Course</button><div class="d23-section">${model.materials?.length ? `<div class="d23-grid d23-grid--2">${model.materials.map((item) => `<article class="d23-panel"><div class="d23-kicker">${esc(words(item.kind))}</div><h2>${esc(item.ref || 'Course source')}</h2><p>${esc(item.summary || 'Source is registered in the Course inventory.')}</p>${truth(item.classification || 'UNRESOLVED')}</article>`).join('')}</div>` : empty('No Course Materials registered','Course source materials appear here when the authoritative intake inventory contains them.')}</div></section>`;
  byId('d23BackCourse')?.addEventListener('click', () => openCourse(courseId,'overview'));
}

async function renderRequests() {
  state.secondary = 'requests'; state.courseId = null; markActive(); closeMenu(); setContext('Secondary destination','Requests');
  const model = await request('/teaching/information/requests');
  if (!model) return;
  const rows = model.requests || [];
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Requests',title:'Formal changes',lead:'Reschedules, extensions, Teacher changes and other formal changes stay easy to find without becoming permanent primary navigation.'})}${rows.length ? `<div class="d23-grid d23-grid--2">${rows.map((row) => `<article class="d23-panel"><div class="d23-panel-head"><div><div class="d23-kicker">${esc(words(row.type || row.request_type || 'Request'))}</div><h2>${esc(row.student_title || row.title || 'Teaching Request')}</h2></div>${truth(String(row.lifecycle_state || row.state || '').includes('PROPOSED') ? 'AUTHORITATIVE_PROVISIONAL' : 'AUTHORITATIVE_FINAL')}</div><p>${esc(words(row.lifecycle_state || row.state || 'Draft'))}</p></article>`).join('')}</div>` : empty('No Requests in progress','Formal changes appear here only when you create them from the relevant context.')}</section>`;
}
async function renderArchive() {
  state.secondary = 'archive'; state.courseId = null; markActive(); closeMenu(); setContext('History without clutter','Archived Courses');
  const model = await request('/teaching/information/archive');
  if (!model) return;
  const courses = model.courses || [];
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Archived Courses',title:'Past courses',lead:'Completed and archived Courses remain reachable without crowding the active academic workspace.'})}${courses.length ? `<div class="d23-grid d23-grid--3">${courses.map((course) => `<button class="d23-panel d23-course-card" type="button" data-course-id="${attr(course.courseId)}"><div class="d23-course-card__state"><span>${esc(words(course.lifecycleState))}</span><span>${esc(course.teacher?.displayName || 'Teacher')}</span></div><h2>${esc(course.title)}</h2><p class="d23-course-card__topic">${esc(course.currentTopic || 'Course history')}</p><div class="d23-course-card__foot"><span>Open record</span><span class="d23-arrow">›</span></div></button>`).join('')}</div>` : empty('No archived Courses','Completed and archived Courses will remain available here later.')}</section>`;
  host().querySelectorAll('[data-course-id]').forEach((button) => button.addEventListener('click', () => openCourse(button.dataset.courseId,'overview')));
}
async function renderStudy() {
  state.secondary = 'study'; state.courseId = null; markActive(); closeMenu(); setContext('Teaching Study','Study Packs');
  const model = await request('/teaching/information/study');
  if (!model) return;
  const groups = model.groups || model.courses || [];
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Teaching Study',title:'Study Packs',lead:'Class-grounded Study Packs collected by Course and Class. Card selection and creation stay with KIWI Study.'})}${groups.length ? `<div class="d23-grid d23-grid--2">${groups.map((group) => `<article class="d23-panel"><div class="d23-kicker">Course</div><h2>${esc(group.courseTitle || group.title || 'Course')}</h2><p>${esc(`${(group.classes || group.studyPacks || []).length} Study Pack${(group.classes || group.studyPacks || []).length === 1 ? '' : 's'}`)}</p></article>`).join('')}</div>` : empty('No Study Packs yet','Class-grounded Study Packs appear here after eligible Classes produce them.')}</section>`;
}
async function renderCreate() {
  state.secondary = 'create'; state.courseId = null; markActive(); closeMenu(); setContext('Create Course','Start from KIWI Study');
  const sequence = ++state.requestSeq;
  loading();
  try {
    const subjects = await api('/teaching/subjects');
    if (sequence !== state.requestSeq) return;
    host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:'Create Course',title:'Turn a Subject into a course',lead:'Choose an existing KIWI Subject. Your own context can guide teaching style, but it never counts as evidence of mastery.'})}<section class="d23-grid d23-grid--2"><aside class="d23-panel d23-panel--focus"><div class="d23-kicker">How it works</div><div class="d23-focus-title">Ground first.<br>Adapt second.</div><p class="d23-focus-copy">The Subject remains the academic source. Your optional context helps the Teacher communicate effectively without lowering standards.</p></aside><form class="d23-panel" id="d23CreateForm"><div class="d23-kicker">Course intake</div><h2 style="margin-top:10px">Choose your Subject</h2><label style="display:grid;gap:7px;margin-top:20px;color:#a8afb8;font-size:11px">KIWI Subject<select id="d23Subject" required style="min-height:46px;padding:0 12px;border:1px solid var(--d23-line);border-radius:12px;background:#0c1118;color:#eef1ed"><option value="">${subjects.length ? 'Select a Subject' : 'Create a Subject in KIWI Study first'}</option>${subjects.map((subject) => `<option value="${attr(subject.id)}">${esc(subject.name)} · ${esc(subject.total_cards || 0)} cards</option>`).join('')}</select></label><label style="display:grid;gap:7px;margin-top:14px;color:#a8afb8;font-size:11px">Anything your Teacher should know?<textarea id="d23Intake" rows="5" placeholder="Worked examples help me, graphs are difficult, I have studied vectors before…" style="padding:12px;border:1px solid var(--d23-line);border-radius:12px;background:#0c1118;color:#eef1ed;resize:vertical"></textarea></label><div class="d23-grid d23-grid--2" style="margin-top:14px"><input id="d23Goals" placeholder="Goals, comma separated" style="min-height:44px;padding:0 12px;border:1px solid var(--d23-line);border-radius:12px;background:#0c1118;color:#eef1ed"><input id="d23Difficult" placeholder="Difficult areas" style="min-height:44px;padding:0 12px;border:1px solid var(--d23-line);border-radius:12px;background:#0c1118;color:#eef1ed"></div><div id="d23CreateStatus" style="min-height:20px;margin-top:14px;color:#8d96a1;font-size:11px"></div><button class="d23-button d23-button--primary" type="submit" style="margin-top:4px" ${subjects.length ? '' : 'disabled'}>Create Course draft</button></form></section></section>`;
    byId('d23CreateForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const subjectId = byId('d23Subject')?.value;
      if (!subjectId) return;
      const status = byId('d23CreateStatus');
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true; status.textContent = 'Creating the draft and preserving its source inventory…';
      try {
        const course = await api('/teaching/courses',{method:'POST',body:{subjectId}});
        const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0,50);
        await api(`/teaching/courses/${encodeURIComponent(course.course_id)}/intake`,{method:'POST',body:{originalFreeFormText:byId('d23Intake')?.value || '',learningPreferences:[],difficultAreas:split(byId('d23Difficult')?.value),priorExperience:[],knownStrengths:[],goals:split(byId('d23Goals')?.value),importantDeadlines:[]}});
        await window.KIWITeachingCourses?.refresh?.({preserveView:true}).catch?.(()=>{});
        state.ownsSurface = true;
        await navigate('courses');
      } catch (error) { status.textContent = error.message || 'Course draft could not be created.'; submit.disabled = false; }
    });
  } catch (error) { showError(error, renderCreate); }
}

async function renderClassEvent(classId) {
  const model = await request(`/teaching/information/classes/${encodeURIComponent(String(classId))}/event`);
  if (!model) return;
  state.secondary = 'class'; state.courseId = null; markActive(); setContext('Class Event', model.course?.title || 'Class');
  host().innerHTML = `<section class="d23-page" data-d23-page>${pageHead({kicker:words(model.state),title:model.course?.title || 'Class Event',lead:'One Class surface that evolves before, during and after the same authoritative Class.'})}<section class="d23-grid d23-grid--2"><article class="d23-panel d23-panel--focus"><div class="d23-kicker">Class state</div><div class="d23-focus-title">${esc(words(model.state))}</div><p class="d23-focus-copy">${esc(model.objective || 'Class details remain attached to this same event throughout its lifecycle.')}</p></article><article class="d23-panel"><div class="d23-kicker">Teacher</div><h2>${esc(model.teacher || 'Course Teacher')}</h2><p>${esc(model.time ? String(model.time) : '')}</p>${model.summary ? `<div class="d23-notice" style="margin-top:16px;border-color:var(--d23-line);background:rgba(255,255,255,.018);color:#929ba6">${esc(typeof model.summary === 'string' ? model.summary : model.summary.summary || 'Class summary available.')}</div>` : ''}</article></section>${model.studyPack ? `<section class="d23-section d23-panel"><div class="d23-kicker">Study Pack</div><h2>Class-grounded study is ready</h2><p>The private Study Pack remains connected to the Class that produced it.</p><button class="d23-button d23-button--primary" data-secondary="study">Open Study Packs</button></section>` : ''}</section>`;
  bindSecondary(host());
}
function bindClassEvents(root) {
  root.querySelectorAll('[data-class-id]').forEach((button) => button.addEventListener('click', () => renderClassEvent(button.dataset.classId)));
}

function bindSecondary(root = document) {
  root.querySelectorAll('[data-secondary]').forEach((button) => button.addEventListener('click', () => openSecondary(button.dataset.secondary)));
}
async function openSecondary(kind) {
  if (kind === 'requests') return renderRequests();
  if (kind === 'archive') return renderArchive();
  if (kind === 'create') return renderCreate();
  if (kind === 'study') return renderStudy();
}
async function navigate(view) {
  state.view = PRIMARY.some((item) => item.id === view) ? view : 'today';
  state.secondary = null; state.courseId = null; state.courseTab = 'overview';
  markActive(); closeMenu();
  if (state.view === 'courses') return renderCourses();
  if (state.view === 'calendar') return renderCalendar();
  if (state.view === 'work') return renderWork();
  if (state.view === 'record') return renderRecord();
  return renderToday();
}
async function renderCurrent() {
  if (!state.ownsSurface) return;
  if (state.courseId) return renderCourseTab();
  if (state.secondary) return openSecondary(state.secondary);
  return navigate(state.view);
}

function installNavigation() {
  document.querySelectorAll('[data-d23-primary]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.d23Primary)));
  document.querySelectorAll('[data-d23-secondary]').forEach((button) => button.addEventListener('click', () => openSecondary(button.dataset.d23Secondary)));
  byId('d23MobileMenuButton')?.addEventListener('click', () => byId('teachingMenuButton')?.click());
  byId('d23RailBrand')?.addEventListener('click', () => navigate('today'));
  markActive();
}
function installTakeoverGuard() {
  const main = host();
  if (!main) return;
  let queued = false;
  const observer = new MutationObserver(() => {
    if (!state.ownsSurface || queued) return;
    const first = main.firstElementChild;
    if (first?.hasAttribute('data-d23-page')) return;
    queued = true;
    queueMicrotask(async () => { queued = false; if (state.ownsSurface && !main.firstElementChild?.hasAttribute('data-d23-page')) await renderCurrent(); });
  });
  observer.observe(main,{childList:true});
}
async function bootstrap() {
  if (!host()) return;
  installNavigation();
  installTakeoverGuard();
  if (!hasKiwiSession()) return;
  try {
    await api('/teaching/status');
    if (window.KIWITeachingCourses?.refresh) {
      try { await window.KIWITeachingCourses.refresh({preserveView:true}); } catch {}
    }
    state.ownsSurface = true;
    await navigate('today');
  } catch (error) {
    state.ownsSurface = true;
    showError(error, () => navigate('today'));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, {once:true});
else bootstrap();

window.KIWITeachingD23Visible = Object.freeze({
  navigate,
  openCourse,
  openSecondary,
  current: () => Object.freeze({view:state.view,secondary:state.secondary,courseId:state.courseId,courseTab:state.courseTab}),
});
