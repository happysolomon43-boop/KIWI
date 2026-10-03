const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
const nav = window.KIWITeachingNavigation;
const courses = window.KIWITeachingCourses;

if (typeof kiwiApiRequest !== 'function' || !nav?.register || !courses?.registerSection || !courses?.openOverview) {
  throw new Error('Original Teaching shell must load before its information bridge.');
}

const bridgeState = {
  pendingStudyCourseId: null,
  activeOverviewRequest: 0,
  activeCoursesRequest: 0,
};

const $ = (tag, className = '', text = null) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
};
const add = (parent, ...children) => {
  children.filter(Boolean).forEach((child) => parent.append(child));
  return parent;
};

function human(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function dateTime(value) {
  if (!value) return 'Time not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not set';
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function safeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    for (const key of ['text', 'summary', 'message', 'description', 'title', 'answer']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key];
    }
  }
  return '';
}

function installStyles() {
  if (document.getElementById('teachingOriginalInformationStyles')) return;
  const style = $('style');
  style.id = 'teachingOriginalInformationStyles';
  style.textContent = `
    .ti-page{display:grid;gap:18px;min-width:0}
    .ti-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:22px;padding:clamp(22px,4vw,34px);border:1px solid rgba(223,245,235,.075);border-radius:22px;background:linear-gradient(145deg,rgba(15,31,25,.92),rgba(9,19,16,.94))}
    .ti-hero__copy{max-width:760px}.ti-hero h1,.ti-hero h2{margin:7px 0 9px;font-family:var(--font-display);font-size:clamp(28px,4.7vw,43px);font-weight:750;letter-spacing:-.045em;line-height:1.05}
    .ti-hero p{margin:0;color:#91a39a;font-size:13px;line-height:1.65}.ti-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .ti-button{min-height:40px;padding:0 13px;border:1px solid rgba(223,245,235,.085);border-radius:10px;background:rgba(255,255,255,.018);color:#d5e3dc;font:inherit;font-size:12px;font-weight:680;cursor:pointer}
    .ti-button:hover,.ti-button:focus-visible{outline:none;border-color:rgba(126,226,184,.25);background:rgba(126,226,184,.075)}
    .ti-button--primary{border-color:transparent;background:var(--teaching-accent);color:#07140f}.ti-button--primary:hover,.ti-button--primary:focus-visible{background:var(--teaching-accent-strong)}
    .ti-section{display:grid;gap:11px}.ti-section__head{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:2px}.ti-section__head h2,.ti-section__head h3{margin:4px 0 0;font-size:21px;letter-spacing:-.025em}
    .ti-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));gap:11px}.ti-card{min-width:0;padding:17px;border:1px solid rgba(223,245,235,.07);border-radius:16px;background:var(--teaching-surface-soft)}
    .ti-card h3,.ti-card h4{margin:5px 0 0;font-size:16px;letter-spacing:-.02em}.ti-card p{margin:8px 0 0;color:#83968d;font-size:11.5px;line-height:1.58}
    .ti-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.ti-chip{display:inline-flex;align-items:center;min-height:25px;padding:4px 8px;border:1px solid rgba(223,245,235,.065);border-radius:999px;background:rgba(255,255,255,.018);color:#879a91;font-size:9px;font-weight:700;letter-spacing:.025em}
    .ti-chip[data-tone="good"]{border-color:rgba(126,226,184,.16);background:rgba(126,226,184,.065);color:#96dfbf}.ti-chip[data-tone="warn"]{border-color:rgba(241,180,83,.18);background:rgba(241,180,83,.06);color:#e4c27f}
    .ti-empty{padding:28px;border:1px dashed rgba(223,245,235,.10);border-radius:17px;background:rgba(255,255,255,.01);color:#7c8e85;font-size:12px;line-height:1.65}
    .ti-error{padding:14px;border:1px solid rgba(238,108,108,.16);border-radius:13px;background:rgba(238,108,108,.05);color:#eab2b2;font-size:12px;line-height:1.55}

    .teaching-today{display:grid;gap:12px;margin-top:14px;padding:18px;border:1px solid rgba(223,245,235,.07);border-radius:18px;background:rgba(255,255,255,.012)}
    .teaching-today__head{display:flex;align-items:end;justify-content:space-between;gap:14px}.teaching-today__head h2{margin:4px 0 0;font-size:20px;letter-spacing:-.025em}.teaching-today__head p{margin:0;color:#71847b;font-size:10px}
    .teaching-today__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px}.teaching-today-card{min-width:0;display:grid;gap:5px;padding:13px;border:1px solid rgba(223,245,235,.065);border-radius:13px;background:rgba(255,255,255,.015);color:var(--teaching-text);text-align:left;cursor:pointer}
    .teaching-today-card:hover,.teaching-today-card:focus-visible{outline:none;border-color:rgba(126,226,184,.2);background:rgba(126,226,184,.045)}.teaching-today-card__label{color:#83d8b3;font-size:9px;font-weight:760;letter-spacing:.08em;text-transform:uppercase}.teaching-today-card strong{font-size:12px}.teaching-today-card small{color:#74877e;font-size:10px}
    .teaching-today__quiet{padding:15px;border-radius:12px;background:rgba(126,226,184,.028);color:#83968d;font-size:11px;line-height:1.55}

    .ti-course-card .teaching-course-card__copy p{display:grid;gap:5px;margin:0;padding-top:11px}.ti-course-line{display:block;color:#81948b;font-size:11px;line-height:1.45}.ti-course-line strong{color:#b6c7bf;font-weight:650}
    .ti-course-card__actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:16px}.ti-course-card__actions .teaching-course-card__open{width:auto;margin:0}
    .ti-archive-link{min-height:36px;padding:0 11px;border:1px solid rgba(223,245,235,.075);border-radius:10px;background:transparent;color:#91a49b;cursor:pointer;font-size:11px;font-weight:650}.ti-archive-link:hover,.ti-archive-link:focus-visible{outline:none;border-color:rgba(126,226,184,.2);background:rgba(126,226,184,.055);color:#dbe8e2}

    .ti-overview{display:grid;gap:12px;margin-bottom:16px}.ti-overview__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.ti-overview__cell{padding:15px;border:1px solid rgba(223,245,235,.065);border-radius:14px;background:rgba(255,255,255,.012)}
    .ti-overview__cell small{display:block;color:#71847b;font-size:9px;font-weight:700;letter-spacing:.075em;text-transform:uppercase}.ti-overview__cell strong{display:block;margin-top:6px;font-size:13px;line-height:1.35}.ti-overview__cell span{display:block;margin-top:5px;color:#82958c;font-size:10px;line-height:1.45}
    .ti-overview__work{display:grid;gap:7px}.ti-overview__work-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid rgba(223,245,235,.055);font-size:11px}.ti-overview__work-row:first-child{border-top:0}.ti-overview__work-row span{color:#7d9087}
    .ti-warning{padding:11px 12px;border:1px solid rgba(241,180,83,.16);border-radius:11px;background:rgba(241,180,83,.045);color:#d9bd84;font-size:11px;line-height:1.55}
    .ti-secondary-actions{display:flex;gap:8px;flex-wrap:wrap}

    .ti-teacher{display:grid;gap:13px}.ti-teacher-identity{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start;padding:22px;border:1px solid rgba(223,245,235,.075);border-radius:19px;background:linear-gradient(145deg,rgba(15,31,25,.9),rgba(9,20,16,.9))}
    .ti-teacher-identity h2{margin:6px 0 7px;font-family:var(--font-display);font-size:clamp(26px,4vw,38px);letter-spacing:-.04em}.ti-teacher-identity p{margin:0;color:#91a39a;font-size:12px;line-height:1.6}.ti-ai-badge{padding:6px 9px;border:1px solid rgba(126,226,184,.14);border-radius:999px;background:rgba(126,226,184,.06);color:#91dfbd;font-size:9px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
    .ti-teacher-layout{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(280px,.92fr);gap:11px}.ti-form{display:grid;gap:10px}.ti-field{display:grid;gap:6px}.ti-field label{color:#a9bbb2;font-size:10px;font-weight:700}.ti-field select,.ti-field textarea,.ti-field input{width:100%;box-sizing:border-box;border:1px solid rgba(223,245,235,.08);border-radius:10px;background:#09130f;color:#edf5f1;padding:10px 11px;font:inherit;font-size:12px}.ti-field textarea{min-height:92px;resize:vertical;line-height:1.5}.ti-field select:focus,.ti-field textarea:focus,.ti-field input:focus{outline:none;border-color:rgba(126,226,184,.4);box-shadow:0 0 0 3px rgba(126,226,184,.055)}
    .ti-status{min-height:18px;color:#83968d;font-size:10px;line-height:1.5}.ti-status[data-kind="success"]{color:#93d9b9}.ti-status[data-kind="error"]{color:#eab0b0}
    .ti-teacher-code{display:grid;gap:6px;margin-top:10px}.ti-teacher-code span{padding:8px 9px;border:1px solid rgba(223,245,235,.055);border-radius:9px;background:rgba(255,255,255,.012);color:#83968d;font-size:10px;line-height:1.45}

    .ti-study-group{display:grid;gap:9px}.ti-study-group__head{display:flex;justify-content:space-between;align-items:end;gap:12px}.ti-study-group__head h3{margin:3px 0 0;font-size:18px}.ti-pack{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:15px;border:1px solid rgba(223,245,235,.065);border-radius:14px;background:rgba(255,255,255,.012)}.ti-pack h4{margin:0;font-size:13px}.ti-pack p{margin:5px 0 0;color:#75887f;font-size:10px}.ti-pack__actions{display:flex;gap:7px}

    .ti-record-semester{display:grid;gap:11px;padding:18px;border:1px solid rgba(223,245,235,.07);border-radius:17px;background:var(--teaching-surface-soft)}.ti-record-semester__head{display:flex;align-items:center;justify-content:space-between;gap:12px}.ti-record-semester__head h2{margin:4px 0 0;font-size:20px}.ti-gpa{font-family:var(--font-display);font-size:18px;font-weight:750}.ti-record-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.ti-record-course{padding:13px;border:1px solid rgba(223,245,235,.06);border-radius:12px;background:rgba(255,255,255,.012)}.ti-record-course h3{margin:0;font-size:13px}.ti-record-course__outcome{margin-top:7px;color:#92d8ba;font-size:10px;font-weight:700}.ti-record-course__meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.ti-record-course__meta span{padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.018);color:#768980;font-size:9px}
    .ti-attendance{display:grid;gap:8px}.ti-attendance-course{padding:13px;border:1px solid rgba(223,245,235,.06);border-radius:12px;background:rgba(255,255,255,.01)}.ti-attendance-course__head{display:flex;justify-content:space-between;gap:12px}.ti-attendance-course strong{font-size:12px}.ti-attendance-course span{color:#74877e;font-size:10px}

    .ti-dialog{width:min(680px,calc(100vw - 28px));max-height:min(820px,88dvh);overflow:auto;padding:0;border:1px solid rgba(223,245,235,.11);border-radius:20px;background:#0d1814;color:var(--teaching-text);box-shadow:0 30px 90px rgba(0,0,0,.44)}.ti-dialog::backdrop{background:rgba(1,7,5,.72);backdrop-filter:blur(5px)}.ti-dialog__inner{display:grid;gap:14px;padding:20px}.ti-dialog__head{display:flex;align-items:flex-start;justify-content:space-between;gap:13px}.ti-dialog__head h2{margin:5px 0 0;font-size:23px;letter-spacing:-.03em}.ti-dialog__close{width:36px;height:36px;display:grid;place-items:center;border:1px solid rgba(223,245,235,.08);border-radius:10px;background:rgba(255,255,255,.018);color:#d8e5df;cursor:pointer}.ti-material-list{display:grid;gap:8px}.ti-material{padding:13px;border:1px solid rgba(223,245,235,.06);border-radius:12px;background:rgba(255,255,255,.012)}.ti-material strong{display:block;font-size:12px}.ti-material p{margin:6px 0 0;color:#81948b;font-size:10.5px;line-height:1.55}

    @media(max-width:820px){.ti-teacher-layout{grid-template-columns:1fr}.ti-overview__grid{grid-template-columns:1fr 1fr}.ti-hero{align-items:flex-start;flex-direction:column}.ti-pack{grid-template-columns:1fr}}
    @media(max-width:560px){.teaching-today__head,.ti-section__head,.ti-record-semester__head{align-items:flex-start;flex-direction:column}.teaching-today__grid,.ti-grid,.ti-record-grid{grid-template-columns:1fr}.ti-overview__grid{grid-template-columns:1fr}.ti-teacher-identity{grid-template-columns:1fr}.ti-pack__actions,.ti-secondary-actions,.ti-actions{display:grid;grid-template-columns:1fr;width:100%}.ti-pack__actions>* ,.ti-secondary-actions>* ,.ti-actions>*{width:100%}}
  `;
  document.head.append(style);
}

function pageHero(kicker, title, lead, actions = []) {
  const hero = $('section', 'ti-hero');
  const copy = $('div', 'ti-hero__copy');
  copy.append($('div', 'teaching-kicker', kicker), $('h1', '', title), $('p', '', lead));
  hero.append(copy);
  if (actions.length) hero.append(add($('div', 'ti-actions'), ...actions));
  return hero;
}

function button(label, handler, { primary = false, className = '' } = {}) {
  const node = $('button', `${primary ? 'ti-button ti-button--primary' : 'ti-button'}${className ? ` ${className}` : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function status(host, message, kind = '') {
  host.textContent = message || '';
  host.dataset.kind = kind;
}

function courseTitle(courseId) {
  return courses.getCourse?.(courseId)?.title || courses.getCourse?.(courseId)?.name || 'Course';
}

function openCourse(courseId, sectionId = 'overview') {
  if (courses.getCourse?.(courseId)) {
    courses.openCourse(courseId, sectionId);
    return true;
  }
  return false;
}

function openTodayItem(item) {
  const kind = String(item?.kind || '').toUpperCase();
  if (kind === 'WORK') return nav.open('work');
  if (kind === 'REQUEST') return nav.open('requests');
  if (kind === 'ASSESSMENT' || kind === 'CLASS') return nav.open('calendar');
}

function todayCard(label, item) {
  if (!item) return null;
  const node = $('button', 'teaching-today-card');
  node.type = 'button';
  const when = item.dueAt || item.startsAt || item.changedAt || null;
  node.append(
    $('span', 'teaching-today-card__label', label),
    $('strong', '', item.title || human(item.kind) || 'Teaching item'),
    $('small', '', when ? dateTime(when) : human(item.kind))
  );
  node.addEventListener('click', () => openTodayItem(item));
  return node;
}

async function enhanceOverviewWithToday() {
  const main = document.getElementById('teachingApp');
  const hero = main?.querySelector('.teaching-view > .teaching-hero');
  if (!hero || main.querySelector('[data-teaching-today="true"]')) return;

  const panel = $('section', 'teaching-today');
  panel.dataset.teachingToday = 'true';
  const head = $('div', 'teaching-today__head');
  const title = $('div');
  title.append($('div', 'teaching-kicker', 'Today'), $('h2', '', 'What matters now'));
  head.append(title, $('p', '', 'Only meaningful academic attention is surfaced here'));
  const body = $('div', 'teaching-today__quiet', 'Loading today…');
  panel.append(head, body);
  hero.insertAdjacentElement('afterend', panel);

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const data = await kiwiApiRequest('/teaching/information/today?currentTimeZone=' + encodeURIComponent(zone));
    if (!panel.isConnected) return;
    if (data.quiet) {
      body.textContent = 'Nothing needs your attention right now. Your Courses stay available below.';
      return;
    }
    const grid = $('div', 'teaching-today__grid');
    const cards = [
      todayCard('Now', data.now?.[0]),
      todayCard('Needs action', data.needsAction?.[0]),
      todayCard('Next', data.next?.[0]),
      todayCard('Later today', data.laterToday?.[0]),
      todayCard('Recently changed', data.recentlyChanged?.[0]),
    ].filter(Boolean);
    cards.forEach((card) => grid.append(card));
    body.replaceWith(cards.length ? grid : $('div', 'teaching-today__quiet', 'Your day is clear for now.'));
  } catch {
    if (panel.isConnected) body.textContent = 'Today is temporarily unavailable. Your Courses and Teaching tools still work normally.';
  }
}

function activeCourseCard(model) {
  const card = $('article', 'teaching-course-card ti-course-card');
  const copy = $('div', 'teaching-course-card__copy');
  copy.append($('span', 'teaching-course-card__state', human(model.lifecycleState || 'Active')), $('h3', '', model.title || 'Course'));
  const details = $('p');
  if (model.currentTopic) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Current · '), document.createTextNode(model.currentTopic)));
  if (model.teacher?.displayName) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Teacher · '), document.createTextNode(model.teacher.displayName)));
  if (model.nextEvent) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Next · '), document.createTextNode(`${model.nextEvent.title || human(model.nextEvent.kind)} · ${dateTime(model.nextEvent.startsAt)}`)));
  if (!details.childNodes.length) details.append($('span', 'ti-course-line', 'Course details are ready inside the workspace.'));
  copy.append(details);
  const actions = $('div', 'ti-course-card__actions');
  const open = $('button', 'teaching-course-card__open', 'Open Course →');
  open.type = 'button';
  open.addEventListener('click', () => openCourse(model.courseId));
  actions.append(open);
  if (model.teacher) actions.append(button('Teacher', () => openCourse(model.courseId, 'teacher')));
  card.append(copy, actions);
  return card;
}

async function enhanceActiveCourseList() {
  const main = document.getElementById('teachingApp');
  if (!main?.querySelector('.teaching-view > .teaching-hero') || main.querySelector('.teaching-course-shell')) return;
  const grid = main.querySelector('.teaching-course-grid');
  if (!grid || grid.dataset.d23ActiveCourses === 'true' || grid.dataset.d23ActiveCourses === 'loading') return;
  const request = ++bridgeState.activeCoursesRequest;
  grid.dataset.d23ActiveCourses = 'loading';
  try {
    const data = await kiwiApiRequest('/teaching/information/courses');
    if (!grid.isConnected || request !== bridgeState.activeCoursesRequest) return;
    const rows = Array.isArray(data.courses) ? data.courses : [];
    grid.replaceChildren();
    if (!rows.length) grid.append($('div', 'teaching-empty', 'No active Courses right now. Create a Course or open Archived Courses to review completed learning.'));
    else rows.forEach((model) => grid.append(activeCourseCard(model)));
    grid.dataset.d23ActiveCourses = 'true';

    const section = grid.closest('.teaching-section');
    const head = section?.querySelector('.teaching-section__head');
    if (head && !head.querySelector('[data-open-archive]')) {
      const archived = $('button', 'ti-archive-link', 'Archived Courses');
      archived.type = 'button';
      archived.dataset.openArchive = 'true';
      archived.addEventListener('click', () => nav.open('archive'));
      head.append(archived);
    }
  } catch {
    if (grid.isConnected) grid.dataset.d23ActiveCourses = 'fallback';
  }
}

function archivedCourseCard(model) {
  const card = $('article', 'teaching-course-card ti-course-card');
  const copy = $('div', 'teaching-course-card__copy');
  copy.append($('span', 'teaching-course-card__state', human(model.lifecycleState || 'Archived')), $('h3', '', model.title || 'Course'));
  const details = $('p');
  if (model.teacher?.displayName) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Teacher · '), document.createTextNode(model.teacher.displayName)));
  if (model.currentTopic) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Last plan position · '), document.createTextNode(model.currentTopic)));
  details.append($('span', 'ti-course-line', 'History stays available without crowding active Courses.'));
  copy.append(details);
  const open = $('button', 'teaching-course-card__open', 'Open Course →');
  open.type = 'button';
  open.addEventListener('click', () => {
    if (!openCourse(model.courseId)) nav.open('record');
  });
  card.append(copy, open);
  return card;
}

async function renderArchivedCourses() {
  installStyles();
  const main = document.getElementById('teachingApp');
  if (!main) return;
  const page = $('section', 'teaching-view ti-page');
  page.append(pageHero('Course history', 'Archived Courses', 'Completed and archived Courses remain available as academic history without crowding the active Courses workspace.', [button('Back to Courses', () => courses.openOverview())]));
  const body = $('div', 'ti-empty', 'Loading archived Courses…');
  page.append(body);
  main.replaceChildren(page);
  try {
    const data = await kiwiApiRequest('/teaching/information/archive');
    if (!page.isConnected) return;
    const rows = Array.isArray(data.courses) ? data.courses : [];
    if (!rows.length) {
      body.textContent = 'No Courses have moved into history yet.';
      return;
    }
    const section = $('section', 'ti-section');
    const head = $('div', 'ti-section__head');
    head.append(add($('div'), $('div', 'teaching-kicker', 'History'), $('h2', '', `${rows.length} archived ${rows.length === 1 ? 'Course' : 'Courses'}`)));
    const grid = $('div', 'teaching-course-grid');
    rows.forEach((model) => grid.append(archivedCourseCard(model)));
    section.append(head, grid);
    body.replaceWith(section);
  } catch (error) {
    body.className = 'ti-error';
    body.textContent = error?.message || 'Archived Courses are temporarily unavailable.';
  }
}

function ensureDialog(kicker, title) {
  const dialog = $('dialog', 'ti-dialog');
  const inner = $('div', 'ti-dialog__inner');
  const head = $('div', 'ti-dialog__head');
  const copy = $('div');
  copy.append($('div', 'teaching-kicker', kicker), $('h2', '', title));
  const close = $('button', 'ti-dialog__close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => dialog.close());
  head.append(copy, close);
  inner.append(head);
  dialog.append(inner);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  return { dialog, inner };
}

async function showMaterials(courseId) {
  installStyles();
  const { dialog, inner } = ensureDialog('Course materials', courseTitle(courseId));
  const body = $('div', 'ti-empty', 'Loading Course materials…');
  inner.append(body);
  dialog.showModal();
  try {
    const data = await kiwiApiRequest(`/teaching/information/courses/${encodeURIComponent(courseId)}/materials`);
    if (!dialog.isConnected) return;
    const materials = Array.isArray(data.materials) ? data.materials : [];
    if (!materials.length) {
      body.textContent = 'No Course materials are currently attached to this Course.';
      return;
    }
    const list = $('div', 'ti-material-list');
    materials.forEach((material, index) => {
      const card = $('article', 'ti-material');
      card.append($('strong', '', material.summary || `${human(material.kind || 'Course source')} ${index + 1}`));
      const role = [human(material.kind || 'source'), human(material.classification || 'unresolved')].filter(Boolean).join(' · ');
      card.append($('p', '', role || 'Course source material'));
      list.append(card);
    });
    body.replaceWith(list);
  } catch (error) {
    body.className = 'ti-error';
    body.textContent = error?.message || 'Course materials are temporarily unavailable.';
  }
}

async function showStudyPackDetail(pack, group) {
  installStyles();
  const { dialog, inner } = ensureDialog('Study Pack', pack.title || group.courseTitle || 'Class Study Pack');
  const body = $('div', 'ti-empty', 'Loading Class Study Pack…');
  inner.append(body);
  dialog.showModal();
  try {
    const event = await kiwiApiRequest(`/teaching/information/classes/${encodeURIComponent(pack.classId)}/event`);
    if (!dialog.isConnected) return;
    const content = $('div', 'ti-page');
    const facts = $('div', 'ti-grid');
    const objective = $('article', 'ti-card');
    objective.append($('div', 'teaching-kicker', 'Class'), $('h3', '', event.course?.title || group.courseTitle || 'Course'), $('p', '', event.objective || 'The Class objective is retained in the authoritative Class record.'));
    const stateCard = $('article', 'ti-card');
    stateCard.append($('div', 'teaching-kicker', 'Study state'), $('h3', '', human(event.studyPack?.state || pack.state || 'Preparing')), $('p', '', event.studyPack ? 'This Study Pack is attached to the completed Class. Note/card publication remains governed by the post-Class Study pipeline.' : 'No Study Pack has been published for this Class yet.'));
    facts.append(objective, stateCard);
    content.append(facts);
    const summary = safeText(event.summary);
    if (summary) {
      const summaryCard = $('article', 'ti-card');
      summaryCard.append($('div', 'teaching-kicker', 'Class summary'), $('p', '', summary));
      content.append(summaryCard);
    }
    const actions = $('div', 'ti-actions');
    actions.append(button('Open Course', () => { dialog.close(); openCourse(group.courseId); }));
    content.append(actions);
    body.replaceWith(content);
  } catch (error) {
    body.className = 'ti-error';
    body.textContent = error?.message || 'Study Pack detail is temporarily unavailable.';
  }
}

async function renderStudyPacks({ courseId = null } = {}) {
  installStyles();
  const main = document.getElementById('teachingApp');
  if (!main) return;
  const page = $('section', 'teaching-view ti-page');
  const actions = [];
  if (courseId) actions.push(button('All Study Packs', () => renderStudyPacks()));
  actions.push(button('Back to Courses', () => courses.openOverview()));
  page.append(pageHero('Post-Class Study', courseId ? `Study Packs · ${courseTitle(courseId)}` : 'Study Packs', 'Published post-Class Study Packs are organized by Course and Class. They stay a secondary learning collection rather than becoming one permanent deck or tab per Class.', actions));
  const body = $('div', 'ti-empty', 'Loading Study Packs…');
  page.append(body);
  main.replaceChildren(page);
  try {
    const query = courseId ? `?courseId=${encodeURIComponent(courseId)}` : '';
    const data = await kiwiApiRequest(`/teaching/information/study${query}`);
    if (!page.isConnected) return;
    const groups = Array.isArray(data.groups) ? data.groups : [];
    if (!groups.length) {
      body.textContent = 'No post-Class Study Packs are available yet. Packs appear only after the governed Class Study pipeline has produced them.';
      return;
    }
    const stack = $('div', 'ti-page');
    groups.forEach((group) => {
      const section = $('section', 'ti-study-group');
      const head = $('div', 'ti-study-group__head');
      head.append(add($('div'), $('div', 'teaching-kicker', 'Course'), $('h3', '', group.courseTitle || 'Course')));
      if (openCourse(group.courseId)) {
        // openCourse above would navigate; never call it while rendering.
      }
      const packs = $('div', 'ti-page');
      (group.packs || []).forEach((pack) => {
        const card = $('article', 'ti-pack');
        const copy = $('div');
        copy.append($('h4', '', pack.title || 'Class Study Pack'), $('p', '', `${pack.scheduledStartAt ? dateTime(pack.scheduledStartAt) : 'Class'} · ${human(pack.state || 'Available')}`));
        const packActions = $('div', 'ti-pack__actions');
        packActions.append(button('Open Pack', () => showStudyPackDetail(pack, group)));
        card.append(copy, packActions);
        packs.append(card);
      });
      section.append(head, packs);
      stack.append(section);
    });
    body.replaceWith(stack);
  } catch (error) {
    body.className = 'ti-error';
    body.textContent = error?.message || 'Study Packs are temporarily unavailable.';
  }
}

function teacherPreferenceField(label, key, value, options) {
  const wrap = $('div', 'ti-field');
  const id = `teacher-pref-${key}`;
  const labelNode = $('label', '', label);
  labelNode.htmlFor = id;
  const select = $('select');
  select.id = id;
  select.dataset.teacherPreference = key;
  options.forEach(([optionValue, optionLabel]) => select.append(new Option(optionLabel, optionValue, false, optionValue === value)));
  wrap.append(labelNode, select);
  return wrap;
}

function teacherCodeCard() {
  const card = $('section', 'ti-card');
  card.append($('div', 'teaching-kicker', 'Teacher boundaries'), $('h3', '', 'Style can adapt. Academic truth cannot.'));
  const list = $('div', 'ti-teacher-code');
  ['Your Teacher can change explanation style and interaction preferences.', 'Marks, standards, attendance, schedules and progression stay with their authoritative academic owners.', 'The Teacher must not humiliate, manipulate, invent shared memories, or provide prohibited assessment help.'].forEach((copy) => list.append($('span', '', copy)));
  card.append(list);
  return card;
}

async function renderTeacher({ course, container }) {
  installStyles();
  const page = $('div', 'ti-teacher');
  const loading = $('div', 'ti-empty', 'Loading your Course Teacher…');
  page.append(loading);
  container.replaceChildren(page);

  async function load() {
    try {
      const data = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher`);
      if (!page.isConnected) return;
      page.replaceChildren();
      if (data.setupRequired || !data.teacher) {
        const setup = $('section', 'ti-card');
        setup.append($('div', 'teaching-kicker', 'Course Teacher'), $('h3', '', 'Prepare your AI Teacher'), $('p', '', data.aiDisclosure || 'Your Course Teacher is an AI teacher in KIWI Teaching.'));
        const preference = $('select');
        [['surprise_me','Surprise me'],['more_direct','More direct'],['more_relaxed','More relaxed'],['more_formal','More formal'],['more_energetic','More energetic']].forEach(([value,label]) => preference.append(new Option(label,value)));
        const controls = $('div', 'ti-form');
        const field = $('div', 'ti-field'); field.append($('label', '', 'Broad style'), preference);
        const message = $('div', 'ti-status');
        const prepare = button('Prepare Teacher', async () => {
          prepare.disabled = true; status(message, 'Preparing Teacher…');
          try {
            await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/ensure`, { method:'POST', body:{ broadStylePreference: preference.value } });
            await load();
          } catch (error) { status(message, error.message || 'Teacher could not be prepared.', 'error'); }
          finally { prepare.disabled = false; }
        }, { primary:true });
        controls.append(field, prepare, message);
        setup.append(controls, teacherCodeCard());
        page.append(setup);
        return;
      }

      const identity = $('section', 'ti-teacher-identity');
      const copy = $('div');
      copy.append($('div', 'teaching-kicker', 'Your Course Teacher'), $('h2', '', data.teacher.displayName || 'KIWI Teacher'), $('p', '', data.teacher.styleDescription ? `${data.teacher.styleDescription}. ${data.teacher.aiDisclosure || 'This is an AI Teacher in KIWI Teaching.'}` : (data.teacher.aiDisclosure || 'This is an AI Teacher in KIWI Teaching.')));
      identity.append(copy, $('span', 'ti-ai-badge', 'AI Teacher'));
      page.append(identity);

      const layout = $('div', 'ti-teacher-layout');
      const preferences = $('section', 'ti-card');
      preferences.append($('div', 'teaching-kicker', 'Interaction preferences'), $('h3', '', 'How your Teacher communicates'), $('p', '', 'These preferences adjust presentation without changing the Teacher identity, pedagogy rules, marks or academic standard.'));
      const form = $('div', 'ti-form');
      const profile = data.interactionProfile || {};
      form.append(
        teacherPreferenceField('Explanation length', 'explanation_density', profile.explanation_density || 'standard', [['compact','Compact'],['standard','Standard'],['extended','Extended']]),
        teacherPreferenceField('Examples', 'examples', profile.examples || 'standard', [['fewer','Fewer'],['standard','Standard'],['more','More']]),
        teacherPreferenceField('Filler', 'filler_tolerance', profile.filler_tolerance || 'standard', [['minimal','Minimal'],['standard','Standard']]),
        teacherPreferenceField('Register', 'register', profile.register || 'standard', [['standard','Standard'],['more_formal','More formal'],['more_relaxed','More relaxed']]),
        teacherPreferenceField('Formatting', 'formatting', profile.formatting || 'standard', [['standard','Standard'],['stepwise','Stepwise'],['concise_blocks','Concise blocks']])
      );
      const prefStatus = $('div', 'ti-status');
      const save = button('Save preferences', async () => {
        save.disabled = true; status(prefStatus, 'Saving…');
        const body = {};
        form.querySelectorAll('[data-teacher-preference]').forEach((select) => { body[select.dataset.teacherPreference] = select.value; });
        try {
          await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/interaction-profile`, { method:'PUT', body });
          status(prefStatus, 'Interaction preferences saved.', 'success');
        } catch (error) { status(prefStatus, error.message || 'Preferences could not be saved.', 'error'); }
        finally { save.disabled = false; }
      }, { primary:true });
      form.append(save, prefStatus);
      preferences.append(form);

      const interaction = $('section', 'ti-card');
      interaction.append($('div', 'teaching-kicker', 'Outside Class'), $('h3', '', 'Ask your Teacher'), $('p', '', data.outsideClassQuestions?.available ? 'Ask a Course question outside a live Class.' : 'You can submit a Course question here. If the qualified answer route is unavailable, KIWI will say so rather than inventing an answer.'));
      const question = $('textarea'); question.placeholder = 'Ask about this Course…';
      const qField = $('div', 'ti-field'); qField.append($('label', '', 'Question'), question);
      const qStatus = $('div', 'ti-status');
      const ask = button('Ask Teacher', async () => {
        const text = question.value.trim();
        if (!text) { status(qStatus, 'Write a Course question first.', 'error'); return; }
        ask.disabled = true; status(qStatus, 'Sending question…');
        try {
          const result = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/questions`, { method:'POST', body:{ question:text, idempotencyKey:crypto.randomUUID() } });
          if (result.status === 'ANSWER_READY') status(qStatus, safeText(result.answer) || 'Your Teacher answered the question.', 'success');
          else if (result.status === 'ROUTE_HELD') status(qStatus, 'Your question was accepted, but the outside-Class answer route is not qualified yet. No answer was fabricated.');
          else status(qStatus, human(result.status || 'Question recorded'));
        } catch (error) { status(qStatus, error.message || 'Question could not be sent.', 'error'); }
        finally { ask.disabled = false; }
      }, { primary:true });
      interaction.append(qField, ask, qStatus);

      const teacherChange = $('section', 'ti-card');
      teacherChange.append($('div', 'teaching-kicker', 'Teacher options'), $('h3', '', 'Request a different Teacher'), $('p', '', 'A Teacher change is a formal Request. Course records, obligations, marks and history remain unchanged.'));
      const changeForm = $('div', 'ti-form');
      const styleSelect = $('select');
      [['surprise_me','Surprise me'],['more_direct','More direct'],['more_relaxed','More relaxed'],['more_formal','More formal'],['more_energetic','More energetic']].forEach(([value,label]) => styleSelect.append(new Option(label,value)));
      const styleField = $('div', 'ti-field'); styleField.append($('label', '', 'Replacement style'), styleSelect);
      const explanation = $('textarea'); explanation.placeholder = 'Optional reason for the Teacher change';
      const explanationField = $('div', 'ti-field'); explanationField.append($('label', '', 'Reason'), explanation);
      const changeStatus = $('div', 'ti-status');
      const request = button('Request Teacher change', async () => {
        request.disabled = true; status(changeStatus, 'Creating formal Request…');
        try {
          const result = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/change-request`, { method:'POST', body:{ broadStylePreference:styleSelect.value, explanation:explanation.value.trim() || undefined, idempotencyKey:crypto.randomUUID() } });
          status(changeStatus, result.replacementTeacher?.displayName ? `Request created. Proposed replacement: ${result.replacementTeacher.displayName}.` : 'Teacher Change Request created.', 'success');
        } catch (error) { status(changeStatus, error.message || 'Teacher Change Request could not be created.', 'error'); }
        finally { request.disabled = false; }
      });
      const openRequests = button('Open Requests', () => nav.open('requests'));
      changeForm.append(styleField, explanationField, add($('div', 'ti-actions'), request, openRequests), changeStatus);
      if ((data.pendingTeacherChanges || []).length) changeForm.prepend($('div', 'ti-chip', `${data.pendingTeacherChanges.length} Teacher Change ${data.pendingTeacherChanges.length === 1 ? 'Request' : 'Requests'} in progress`));
      teacherChange.append(changeForm);

      layout.append(preferences, interaction, teacherChange, teacherCodeCard());
      page.append(layout);
    } catch (error) {
      page.replaceChildren($('div', 'ti-error', error?.message || 'Course Teacher is temporarily unavailable.'));
    }
  }

  await load();
}

async function renderTeacherSummary({ course, container, openSection }) {
  installStyles();
  const card = $('article', 'teaching-course-feature-card');
  card.append($('div', 'teaching-kicker', 'Teacher'), $('h3', '', 'Course Teacher'), $('p', '', 'Loading Teacher identity…'));
  container.replaceChildren(card);
  try {
    const data = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher`);
    if (!card.isConnected) return;
    card.replaceChildren(
      $('div', 'teaching-kicker', 'Teacher'),
      $('h3', '', data.teacher?.displayName || 'Course Teacher'),
      $('p', '', data.teacher ? `${data.teacher.styleDescription || 'KIWI Teacher'} · ${data.teacher.aiDisclosure || 'AI Teacher in KIWI Teaching'}` : 'Teacher setup is ready inside this Course.')
    );
    const actions = $('div', 'teaching-course-feature-card__actions');
    const open = $('button', 'teaching-d08-link-button', 'Open Teacher'); open.type = 'button'; open.addEventListener('click', openSection);
    actions.append(open); card.append(actions);
  } catch (error) {
    card.replaceChildren($('div', 'teaching-kicker', 'Teacher'), $('h3', '', 'Course Teacher'), $('p', '', error?.message || 'Teacher summary is temporarily unavailable.'));
  }
}

function overviewCell(label, value, detail = '') {
  const cell = $('div', 'ti-overview__cell');
  cell.append($('small', '', label), $('strong', '', value || 'Not available'));
  if (detail) cell.append($('span', '', detail));
  return cell;
}

async function enhanceCourseOverview() {
  const main = document.getElementById('teachingApp');
  const shell = main?.querySelector('.teaching-course-shell');
  if (!shell) return;
  const active = shell.querySelector('.teaching-course-nav__item[data-active="true"]');
  if (!active || active.textContent.trim() !== 'Overview') return;
  const content = shell.querySelector('.teaching-course-content');
  if (!content || content.querySelector('[data-d23-course-overview="true"]')) return;
  const courseId = courses.currentCourseId?.();
  if (!courseId) return;
  const request = ++bridgeState.activeOverviewRequest;
  const section = $('section', 'ti-overview');
  section.dataset.d23CourseOverview = 'true';
  section.append($('div', 'ti-empty', 'Loading current Course position…'));
  content.prepend(section);
  try {
    const data = await kiwiApiRequest(`/teaching/information/courses/${encodeURIComponent(courseId)}/overview`);
    if (!section.isConnected || request !== bridgeState.activeOverviewRequest) return;
    section.replaceChildren();
    const grid = $('div', 'ti-overview__grid');
    grid.append(
      overviewCell('Current topic', data.currentTopic || 'Course Plan', data.phase ? `Phase · ${human(data.phase)}` : ''),
      overviewCell('Next Class', data.nextClass?.title || 'No Class scheduled', data.nextClass?.startsAt ? dateTime(data.nextClass.startsAt) : ''),
      overviewCell('Teacher', data.teacher?.displayName || 'Teacher setup', data.teacher ? 'Open the Teacher tab for style and interaction options.' : '')
    );
    section.append(grid);

    const next = $('div', 'ti-grid');
    const assessment = $('article', 'ti-card');
    assessment.append($('div', 'teaching-kicker', 'Next assessment'), $('h3', '', data.nextAssessment?.title || 'No announced assessment'), $('p', '', data.nextAssessment?.startsAt ? dateTime(data.nextAssessment.startsAt) : 'Only legitimately visible assessments appear here. Hidden surprise assessments are not previewed.'));
    const work = $('article', 'ti-card');
    work.append($('div', 'teaching-kicker', 'Important Work'), $('h3', '', data.importantWork?.length ? `${data.importantWork.length} active ${data.importantWork.length === 1 ? 'item' : 'items'}` : 'Nothing urgent'));
    const workRows = $('div', 'ti-overview__work');
    (data.importantWork || []).slice(0, 3).forEach((item) => workRows.append(add($('div', 'ti-overview__work-row'), $('strong', '', item.title || 'Course Work'), $('span', '', item.deadline?.dueAt ? dateTime(item.deadline.dueAt) : human(item.lifecycleState || 'Active')))));
    if (!workRows.childElementCount) workRows.append($('p', '', 'No active Work currently requires attention.'));
    work.append(workRows);
    next.append(assessment, work);
    section.append(next);

    (data.warnings || []).forEach((warning) => section.append($('div', 'ti-warning', warning.message || 'This Course needs attention.')));
    const secondary = $('div', 'ti-secondary-actions');
    secondary.append(
      button('Course Materials', () => showMaterials(courseId)),
      button('Study Packs', () => { bridgeState.pendingStudyCourseId = courseId; nav.open('study-packs'); }),
      button('Teacher', () => openCourse(courseId, 'teacher')),
      button('Requests', () => nav.open('requests'))
    );
    section.append(secondary);
  } catch (error) {
    section.replaceChildren($('div', 'ti-error', error?.message || 'Current Course position is temporarily unavailable.'));
  }
}

function enhanceCoursePlanMaterials() {
  const courseId = courses.currentCourseId?.();
  const page = document.querySelector('#teachingApp .teaching-d08-page');
  const head = page?.querySelector('.teaching-d08-page__head');
  if (!courseId || !head || head.querySelector('[data-course-materials]')) return;
  const action = button('Materials', () => showMaterials(courseId));
  action.dataset.courseMaterials = 'true';
  head.append(action);
}

function recordCourseCard(course) {
  const card = $('article', 'ti-record-course');
  card.append($('h3', '', course.title || 'Course'), $('div', 'ti-record-course__outcome', human(course.progression_outcome || 'Outcome pending')));
  const meta = $('div', 'ti-record-course__meta');
  if (course.score_percentage != null) meta.append($('span', '', `Official score ${course.score_percentage}%`));
  if (course.academic_credits != null) meta.append($('span', '', `${course.academic_credits} credits`));
  meta.append($('span', '', `Attempt ${course.attempt_no || 1}`));
  if (course.attempt_kind) meta.append($('span', '', human(course.attempt_kind)));
  card.append(meta);
  return card;
}

async function renderRecord() {
  installStyles();
  const main = document.getElementById('teachingApp');
  if (!main) return;
  const page = $('section', 'teaching-view ti-page');
  page.append(pageHero('Academic Record', 'Record', 'Semester results, Course outcomes and attendance history stay together here while remaining separate academic truths. Official marks, learning insight and attendance are not interchangeable.'));
  const body = $('div', 'ti-empty', 'Loading your academic Record…');
  page.append(body);
  main.replaceChildren(page);
  const [formal, attendance] = await Promise.allSettled([
    kiwiApiRequest('/teaching/information/record'),
    kiwiApiRequest('/teaching/record/attendance'),
  ]);
  if (!page.isConnected) return;
  const content = $('div', 'ti-page');
  if (formal.status === 'fulfilled') {
    const records = Array.isArray(formal.value.records) ? formal.value.records : [];
    const section = $('section', 'ti-section');
    section.append(add($('div', 'ti-section__head'), add($('div'), $('div', 'teaching-kicker', 'Official academic record'), $('h2', '', 'Semester results'))));
    if (!records.length) section.append($('div', 'ti-empty', 'No finalized Semester record is available yet.'));
    records.forEach((entry) => {
      const model = entry.record || {};
      const semester = $('section', 'ti-record-semester');
      const head = $('div', 'ti-record-semester__head');
      head.append(add($('div'), $('div', 'teaching-kicker', 'Semester'), $('h2', '', entry.name || 'Semester')));
      if (model.gpa?.gpa_value != null) head.append($('div', 'ti-gpa', `GPA ${model.gpa.gpa_value}`));
      semester.append(head);
      const grid = $('div', 'ti-record-grid');
      const rows = Array.isArray(model.courses) ? model.courses : [];
      rows.forEach((course) => grid.append(recordCourseCard(course)));
      if (!rows.length) grid.append($('div', 'ti-empty', 'No finalized Course results are recorded for this Semester yet.'));
      semester.append(grid);
      section.append(semester);
    });
    content.append(section);
  } else {
    content.append($('div', 'ti-error', formal.reason?.message || 'Formal Semester Record is temporarily unavailable.'));
  }

  const attendanceSection = $('section', 'ti-section');
  attendanceSection.append(add($('div', 'ti-section__head'), add($('div'), $('div', 'teaching-kicker', 'Attendance'), $('h2', '', 'Scheduled obligations'))));
  if (attendance.status === 'fulfilled') {
    const groups = Array.isArray(attendance.value.courses) ? attendance.value.courses : [];
    if (!groups.length) attendanceSection.append($('div', 'ti-empty', 'No attendance obligations are recorded yet.'));
    const list = $('div', 'ti-attendance');
    groups.forEach((group) => {
      const records = Array.isArray(group.records) ? group.records : [];
      const required = records.filter((row) => row.obligationState === 'REQUIRED' || row.obligation_state === 'REQUIRED');
      const late = required.filter((row) => row.outcome === 'LATE').length;
      const protectedCount = required.filter((row) => ['EXCUSED_ABSENCE','APPROVED_LEAVE','SYSTEM_PROTECTED'].includes(row.outcome)).length;
      const card = $('article', 'ti-attendance-course');
      const head = $('div', 'ti-attendance-course__head');
      head.append($('strong', '', courseTitle(group.courseId)), $('span', '', `${required.length} obligations · ${late} late · ${protectedCount} protected/excused`));
      card.append(head);
      list.append(card);
    });
    attendanceSection.append(list);
  } else {
    attendanceSection.append($('div', 'ti-error', attendance.reason?.message || 'Attendance history is temporarily unavailable.'));
  }
  content.append(attendanceSection);
  body.replaceWith(content);
}

function dockButton(id, label, icon, handler) {
  const node = $('button', 'teaching-dock__item');
  node.type = 'button';
  node.dataset.primaryId = id;
  node.setAttribute('aria-label', label);
  node.append($('span', 'teaching-dock__icon', icon), $('span', 'teaching-dock__label', label));
  node.addEventListener('click', handler);
  return node;
}

function syncPrimaryDock() {
  const dock = document.getElementById('teachingDock');
  if (!dock) return;
  const activeMenu = document.querySelector('.teaching-menu-link[data-active="true"]')?.dataset?.view || '';
  let active = null;
  if (activeMenu === 'navigation:calendar') active = 'calendar';
  else if (activeMenu === 'navigation:work') active = 'work';
  else if (activeMenu === 'navigation:record') active = 'record';
  else if (activeMenu === 'overview' || document.querySelector('#teachingApp .teaching-course-shell')) active = 'courses';
  dock.querySelectorAll('[data-primary-id]').forEach((node) => {
    node.dataset.active = node.dataset.primaryId === active ? 'true' : 'false';
    if (node.dataset.primaryId === active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
}

function buildPrimaryDock() {
  const shell = document.getElementById('teachingDockShell');
  const dock = document.getElementById('teachingDock');
  if (!shell || !dock) return;
  dock.replaceChildren(
    dockButton('courses', 'Courses', '▦', () => courses.openOverview()),
    dockButton('calendar', 'Calendar', '◷', () => nav.open('calendar')),
    dockButton('work', 'Work', '✓', () => nav.open('work')),
    dockButton('record', 'Record', '≣', () => nav.open('record')),
    dockButton('menu', 'Menu', '≡', () => document.getElementById('teachingMenuButton')?.click())
  );
  shell.hidden = false;
  document.body.dataset.teachingDockVisible = 'true';
  syncPrimaryDock();
}

function registerBridgeSurfaces() {
  if (!courses.sectionIds().includes('teacher')) {
    courses.registerSection({ id:'teacher', label:'Teacher', order:70, render:renderTeacher, renderSummary:renderTeacherSummary });
  }

  nav.register({
    id:'record',
    label:'Record',
    description:'Semester results and attendance history',
    icon:'≣',
    menuIcon:'overview',
    onSelect:renderRecord,
  });

  if (!nav.ids().includes('archive')) {
    nav.register({ id:'archive', label:'Archived Courses', description:'Completed and archived Course history', icon:'□', menuIcon:'overview', onSelect:renderArchivedCourses });
  }
  if (!nav.ids().includes('study-packs')) {
    nav.register({
      id:'study-packs',
      label:'Study Packs',
      description:'Post-Class notes organized by Course and Class',
      icon:'◇',
      menuIcon:'overview',
      onSelect:() => {
        const courseId = bridgeState.pendingStudyCourseId;
        bridgeState.pendingStudyCourseId = null;
        renderStudyPacks({ courseId });
      },
    });
  }
}

function maintainEnhancements() {
  syncPrimaryDock();
  enhanceOverviewWithToday().catch(() => {});
  enhanceActiveCourseList().catch(() => {});
  enhanceCourseOverview().catch(() => {});
  enhanceCoursePlanMaterials();
}

function start() {
  installStyles();
  registerBridgeSurfaces();
  buildPrimaryDock();
  maintainEnhancements();

  const app = document.getElementById('teachingApp');
  const menu = document.getElementById('teachingMenuFuture');
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      maintainEnhancements();
    });
  };
  const observer = new MutationObserver(schedule);
  if (app) observer.observe(app, { childList:true, subtree:true, attributes:true, attributeFilter:['data-active'] });
  if (menu) observer.observe(menu, { childList:true, subtree:true, attributes:true, attributeFilter:['data-active'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
else start();