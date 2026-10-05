const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
const nav = window.KIWITeachingNavigation;
const courses = window.KIWITeachingCourses;
const teachingDisplay = window.KIWITeachingDisplay || {};
const displayCourseName = teachingDisplay.displayName || ((value, fallback = 'Course') => String(value || '').trim() || fallback);

if (typeof kiwiApiRequest !== 'function' || !nav?.register || !courses?.registerSection || !courses?.openOverview) {
  throw new Error('Original Teaching shell must load before its information bridge.');
}

const state = { studyCourseId: null, courseRequest: 0, overviewRequest: 0 };
const $ = (tag, className = '', text = null) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
};
const add = (parent, ...children) => { children.filter(Boolean).forEach((child) => parent.append(child)); return parent; };
const human = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

function dateTime(value) {
  if (!value) return 'Time not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not set';
  return date.toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function safeText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    for (const key of ['text','summary','message','description','title','answer']) {
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
    .ti-page{display:grid;gap:18px;min-width:0}.ti-kicker{color:#8bdcb8;font-size:10px;font-weight:750;letter-spacing:.13em;text-transform:uppercase}
    .ti-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:22px;padding:clamp(22px,4vw,34px);border:1px solid rgba(223,245,235,.075);border-radius:22px;background:linear-gradient(145deg,rgba(15,31,25,.92),rgba(9,19,16,.94))}
    .ti-hero__copy{max-width:760px}.ti-hero h1{margin:7px 0 9px;font-family:var(--font-display);font-size:clamp(30px,4.7vw,44px);font-weight:750;letter-spacing:-.045em;line-height:1.05}.ti-hero p{margin:0;color:#91a39a;font-size:13px;line-height:1.65}
    .ti-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ti-button{min-height:40px;padding:0 13px;border:1px solid rgba(223,245,235,.085);border-radius:10px;background:rgba(255,255,255,.018);color:#d5e3dc;font:inherit;font-size:12px;font-weight:680;cursor:pointer}.ti-button:hover,.ti-button:focus-visible{outline:none;border-color:rgba(126,226,184,.25);background:rgba(126,226,184,.075)}.ti-button--primary{border-color:transparent;background:var(--teaching-accent);color:#07140f}.ti-button--primary:hover,.ti-button--primary:focus-visible{background:var(--teaching-accent-strong)}
    .ti-section{display:grid;gap:11px}.ti-section__head{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:2px}.ti-section__head h2,.ti-section__head h3{margin:4px 0 0;font-size:21px;letter-spacing:-.025em}.ti-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}
    .ti-card{min-width:0;padding:17px;border:1px solid rgba(223,245,235,.07);border-radius:16px;background:var(--teaching-surface-soft)}.ti-card h3,.ti-card h4{margin:5px 0 0;font-size:16px;letter-spacing:-.02em}.ti-card p{margin:8px 0 0;color:#83968d;font-size:11.5px;line-height:1.58}.ti-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.ti-chip{display:inline-flex;align-items:center;min-height:25px;padding:4px 8px;border:1px solid rgba(223,245,235,.065);border-radius:999px;background:rgba(255,255,255,.018);color:#879a91;font-size:9px;font-weight:700}.ti-empty{padding:27px;border:1px dashed rgba(223,245,235,.10);border-radius:17px;background:rgba(255,255,255,.01);color:#7c8e85;font-size:12px;line-height:1.65}.ti-error{padding:14px;border:1px solid rgba(238,108,108,.16);border-radius:13px;background:rgba(238,108,108,.05);color:#eab2b2;font-size:12px;line-height:1.55}
    .teaching-today{display:grid;gap:12px;margin-top:14px;padding:18px;border:1px solid rgba(223,245,235,.07);border-radius:18px;background:rgba(255,255,255,.012)}.teaching-today__head{display:flex;align-items:end;justify-content:space-between;gap:14px}.teaching-today__head h2{margin:4px 0 0;font-size:20px;letter-spacing:-.025em}.teaching-today__head p{margin:0;color:#71847b;font-size:10px}.teaching-today__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px}.teaching-today-card{min-width:0;display:grid;gap:5px;padding:13px;border:1px solid rgba(223,245,235,.065);border-radius:13px;background:rgba(255,255,255,.015);color:var(--teaching-text);text-align:left;cursor:pointer}.teaching-today-card:hover,.teaching-today-card:focus-visible{outline:none;border-color:rgba(126,226,184,.2);background:rgba(126,226,184,.045)}.teaching-today-card__label{color:#83d8b3;font-size:9px;font-weight:760;letter-spacing:.08em;text-transform:uppercase}.teaching-today-card strong{font-size:12px}.teaching-today-card small{color:#74877e;font-size:10px}.teaching-today__quiet{padding:15px;border-radius:12px;background:rgba(126,226,184,.028);color:#83968d;font-size:11px;line-height:1.55}
    .ti-course-card .teaching-course-card__copy p{display:grid;gap:5px;margin:0;padding-top:11px}.ti-course-line{display:block;color:#81948b;font-size:11px;line-height:1.45}.ti-course-line strong{color:#b6c7bf;font-weight:650}.ti-course-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:16px}.ti-course-actions .teaching-course-card__open{width:auto;margin:0}.ti-secondary-link{min-height:36px;padding:0 11px;border:1px solid rgba(223,245,235,.075);border-radius:10px;background:transparent;color:#91a49b;cursor:pointer;font-size:11px;font-weight:650}.ti-secondary-link:hover,.ti-secondary-link:focus-visible{outline:none;border-color:rgba(126,226,184,.2);background:rgba(126,226,184,.055);color:#dbe8e2}
    .ti-overview{display:grid;gap:11px;margin-bottom:15px}.ti-overview__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.ti-overview__cell{padding:15px;border:1px solid rgba(223,245,235,.065);border-radius:14px;background:rgba(255,255,255,.012)}.ti-overview__cell small{display:block;color:#71847b;font-size:9px;font-weight:700;letter-spacing:.075em;text-transform:uppercase}.ti-overview__cell strong{display:block;margin-top:6px;font-size:13px;line-height:1.35}.ti-overview__cell span{display:block;margin-top:5px;color:#82958c;font-size:10px;line-height:1.45}.ti-work-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid rgba(223,245,235,.055);font-size:11px}.ti-work-row:first-child{border-top:0}.ti-work-row span{color:#7d9087}.ti-warning{padding:11px 12px;border:1px solid rgba(241,180,83,.16);border-radius:11px;background:rgba(241,180,83,.045);color:#d9bd84;font-size:11px;line-height:1.55}
    .ti-teacher{display:grid;gap:12px}.ti-teacher-identity{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start;padding:22px;border:1px solid rgba(223,245,235,.075);border-radius:19px;background:linear-gradient(145deg,rgba(15,31,25,.9),rgba(9,20,16,.9))}.ti-teacher-identity h2{margin:6px 0 7px;font-family:var(--font-display);font-size:clamp(26px,4vw,38px);letter-spacing:-.04em}.ti-teacher-identity p{margin:0;color:#91a39a;font-size:12px;line-height:1.6}.ti-ai-badge{padding:6px 9px;border:1px solid rgba(126,226,184,.14);border-radius:999px;background:rgba(126,226,184,.06);color:#91dfbd;font-size:9px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.ti-teacher-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ti-form{display:grid;gap:10px}.ti-field{display:grid;gap:6px}.ti-field label{color:#a9bbb2;font-size:10px;font-weight:700}.ti-field select,.ti-field textarea,.ti-field input{width:100%;box-sizing:border-box;border:1px solid rgba(223,245,235,.08);border-radius:10px;background:#09130f;color:#edf5f1;padding:10px 11px;font:inherit;font-size:12px}.ti-field textarea{min-height:92px;resize:vertical;line-height:1.5}.ti-field select:focus,.ti-field textarea:focus,.ti-field input:focus{outline:none;border-color:rgba(126,226,184,.4);box-shadow:0 0 0 3px rgba(126,226,184,.055)}.ti-status{min-height:18px;color:#83968d;font-size:10px;line-height:1.5}.ti-status[data-kind="success"]{color:#93d9b9}.ti-status[data-kind="error"]{color:#eab0b0}.ti-boundaries{display:grid;gap:6px;margin-top:10px}.ti-boundaries span{padding:8px 9px;border:1px solid rgba(223,245,235,.055);border-radius:9px;background:rgba(255,255,255,.012);color:#83968d;font-size:10px;line-height:1.45}
    .ti-study-group{display:grid;gap:9px}.ti-study-group__head{display:flex;justify-content:space-between;align-items:end;gap:12px}.ti-study-group__head h3{margin:3px 0 0;font-size:18px}.ti-pack{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:15px;border:1px solid rgba(223,245,235,.065);border-radius:14px;background:rgba(255,255,255,.012)}.ti-pack h4{margin:0;font-size:13px}.ti-pack p{margin:5px 0 0;color:#75887f;font-size:10px}
    .ti-record-semester{display:grid;gap:11px;padding:18px;border:1px solid rgba(223,245,235,.07);border-radius:17px;background:var(--teaching-surface-soft)}.ti-record-semester__head{display:flex;align-items:center;justify-content:space-between;gap:12px}.ti-record-semester__head h2{margin:4px 0 0;font-size:20px}.ti-gpa{font-family:var(--font-display);font-size:18px;font-weight:750}.ti-record-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:8px}.ti-record-course{padding:13px;border:1px solid rgba(223,245,235,.06);border-radius:12px;background:rgba(255,255,255,.012)}.ti-record-course h3{margin:0;font-size:13px}.ti-record-course__outcome{margin-top:7px;color:#92d8ba;font-size:10px;font-weight:700}.ti-record-course__meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.ti-record-course__meta span{padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.018);color:#768980;font-size:9px}.ti-attendance{display:grid;gap:8px}.ti-attendance-course{padding:13px;border:1px solid rgba(223,245,235,.06);border-radius:12px;background:rgba(255,255,255,.01)}.ti-attendance-course__head{display:flex;justify-content:space-between;gap:12px}.ti-attendance-course strong{font-size:12px}.ti-attendance-course span{color:#74877e;font-size:10px}
    .ti-dialog{width:min(880px,calc(100vw - 28px));max-height:min(860px,90dvh);overflow:auto;padding:0;border:1px solid rgba(223,245,235,.11);border-radius:20px;background:#0d1814;color:var(--teaching-text);box-shadow:0 30px 90px rgba(0,0,0,.44)}.ti-dialog::backdrop{background:rgba(1,7,5,.72);backdrop-filter:blur(5px)}.ti-dialog__inner{display:grid;gap:14px;padding:20px}.ti-dialog__head{position:sticky;z-index:2;top:0;display:flex;align-items:flex-start;justify-content:space-between;gap:13px;margin:-20px -20px 0;padding:20px;border-bottom:1px solid rgba(223,245,235,.065);background:rgba(13,24,20,.96);backdrop-filter:blur(12px)}.ti-dialog__head h2{margin:5px 0 0;font-size:23px;letter-spacing:-.03em}.ti-dialog__close{width:36px;height:36px;display:grid;place-items:center;border:1px solid rgba(223,245,235,.08);border-radius:10px;background:rgba(255,255,255,.018);color:#d8e5df;cursor:pointer}.ti-material-hierarchy{padding:15px;border:1px solid rgba(126,226,184,.10);border-radius:14px;background:rgba(126,226,184,.035)}.ti-material-hierarchy h3{margin:5px 0 0;font-size:15px}.ti-material-hierarchy p{margin:6px 0 0;color:#81948b;font-size:10.5px;line-height:1.55}.ti-material-search{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid rgba(223,245,235,.09);border-radius:11px;background:#09130f;color:#edf5f1;font:inherit;font-size:12px}.ti-material-search:focus{outline:none;border-color:rgba(126,226,184,.4);box-shadow:0 0 0 3px rgba(126,226,184,.055)}.ti-material-results{color:#788b82;font-size:10px}.ti-material-group{border:1px solid rgba(223,245,235,.065);border-radius:15px;background:rgba(255,255,255,.009);overflow:hidden}.ti-material-group[open]{padding-bottom:10px}.ti-material-group__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;cursor:pointer;list-style:none}.ti-material-group__head::-webkit-details-marker{display:none}.ti-material-group__head h3{margin:4px 0 0;font-size:15px}.ti-material-group__head p{margin:4px 0 0;color:#788b82;font-size:10px}.ti-material-group__aside{display:flex;align-items:center;gap:8px}.ti-material-chevron{color:#6f8279;font-size:13px;transition:transform .16s ease}.ti-material-group[open] .ti-material-chevron{transform:rotate(180deg)}.ti-material-count{padding:4px 7px;border-radius:999px;background:rgba(126,226,184,.07);color:#8bdcb8;font-size:9px;font-weight:700}.ti-material-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 10px}.ti-material{min-width:0;padding:13px;border:1px solid rgba(223,245,235,.06);border-radius:12px;background:rgba(255,255,255,.012)}.ti-material strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.ti-material p{margin:6px 0 0;color:#81948b;font-size:10.5px;line-height:1.55}
    @media(max-width:760px){.ti-hero{align-items:flex-start;flex-direction:column}.ti-overview__grid,.ti-teacher-layout{grid-template-columns:1fr}.ti-pack{grid-template-columns:1fr}.ti-teacher-identity{grid-template-columns:1fr}}
    @media(max-width:540px){.teaching-today__head,.ti-section__head,.ti-record-semester__head{align-items:flex-start;flex-direction:column}.teaching-today__grid,.ti-grid,.ti-record-grid,.ti-material-list{grid-template-columns:1fr}.ti-actions,.ti-course-actions{display:grid;grid-template-columns:1fr;width:100%}.ti-actions>* ,.ti-course-actions>*{width:100%}}
  `;
  document.head.append(style);
}

function action(label, onClick, { primary = false } = {}) {
  const node = $('button', primary ? 'ti-button ti-button--primary' : 'ti-button', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
function hero(kicker, title, lead, actions = []) {
  const node = $('section', 'ti-hero');
  node.append(add($('div', 'ti-hero__copy'), $('div', 'ti-kicker', kicker), $('h1', '', title), $('p', '', lead)));
  if (actions.length) node.append(add($('div', 'ti-actions'), ...actions));
  return node;
}
function setStatus(host, text, kind = '') { host.textContent = text || ''; host.dataset.kind = kind; }
function courseTitle(courseId) { const course = courses.getCourse?.(courseId); return displayCourseName(course?.title || course?.name, 'Course'); }
function openCourse(courseId, section = 'overview') { if (!courses.getCourse?.(courseId)) return false; courses.openCourse(courseId, section); return true; }
function overviewCell(label, value, detail = '') { const cell = $('div', 'ti-overview__cell'); cell.append($('small', '', label), $('strong', '', value || 'Not available')); if (detail) cell.append($('span', '', detail)); return cell; }

function todayCard(label, item) {
  if (!item) return null;
  const node = $('button', 'teaching-today-card'); node.type = 'button';
  const when = item.dueAt || item.startsAt || item.changedAt || null;
  node.append($('span', 'teaching-today-card__label', label), $('strong', '', item.title || human(item.kind) || 'Teaching item'), $('small', '', when ? dateTime(when) : human(item.kind)));
  node.addEventListener('click', () => {
    const kind = String(item.kind || '').toUpperCase();
    if (kind === 'WORK') nav.open('work');
    else if (kind === 'REQUEST') nav.open('requests');
    else nav.open('calendar');
  });
  return node;
}
async function enhanceToday() {
  const main = document.getElementById('teachingApp');
  const homeHero = main?.querySelector('.teaching-view > .teaching-hero');
  if (!homeHero || main.querySelector('[data-teaching-today="true"]')) return;
  const panel = $('section', 'teaching-today'); panel.dataset.teachingToday = 'true';
  panel.append(add($('div', 'teaching-today__head'), add($('div'), $('div', 'ti-kicker', 'Today'), $('h2', '', 'What matters now')), $('p', '', 'Only meaningful academic attention appears here')));
  const body = $('div', 'teaching-today__quiet', 'Loading today…'); panel.append(body); homeHero.insertAdjacentElement('afterend', panel);
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const data = await kiwiApiRequest('/teaching/information/today?currentTimeZone=' + encodeURIComponent(zone));
    if (!panel.isConnected) return;
    if (data.quiet) { body.textContent = 'Nothing needs your attention right now. Your Courses stay available below.'; return; }
    const grid = $('div', 'teaching-today__grid');
    [todayCard('Now', data.now?.[0]), todayCard('Needs action', data.needsAction?.[0]), todayCard('Next', data.next?.[0]), todayCard('Later today', data.laterToday?.[0]), todayCard('Recently changed', data.recentlyChanged?.[0])].filter(Boolean).forEach((card) => grid.append(card));
    body.replaceWith(grid.childElementCount ? grid : $('div', 'teaching-today__quiet', 'Your day is clear for now.'));
  } catch { if (panel.isConnected) body.textContent = 'Today is temporarily unavailable. Your Courses and Teaching tools still work normally.'; }
}

function courseCard(model, archived = false) {
  const card = $('article', 'teaching-course-card ti-course-card');
  const copy = $('div', 'teaching-course-card__copy');
  copy.append($('span', 'teaching-course-card__state', human(model.lifecycleState || (archived ? 'Archived' : 'Active'))), $('h3', '', displayCourseName(model.title, 'Course')));
  teachingDisplay.decorateCourse?.(card, model);
  const details = $('p');
  if (model.currentTopic) details.append(add($('span', 'ti-course-line'), $('strong', '', archived ? 'Last plan position · ' : 'Current · '), document.createTextNode(model.currentTopic)));
  if (model.teacher?.displayName) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Teacher · '), document.createTextNode(model.teacher.displayName)));
  if (!archived && model.nextEvent) details.append(add($('span', 'ti-course-line'), $('strong', '', 'Next · '), document.createTextNode(`${model.nextEvent.title || human(model.nextEvent.kind)} · ${dateTime(model.nextEvent.startsAt)}`)));
  if (!details.childElementCount) details.append($('span', 'ti-course-line', archived ? 'Course history remains available here.' : 'Course details are ready inside the workspace.'));
  copy.append(details);
  const actions = $('div', 'ti-course-actions');
  const open = $('button', 'teaching-course-card__open', 'Open Course →'); open.type = 'button'; open.addEventListener('click', () => { if (!openCourse(model.courseId)) nav.open('record'); }); actions.append(open);
  if (!archived && model.teacher) actions.append(action('Teacher', () => openCourse(model.courseId, 'teacher')));
  card.append(copy, actions); return card;
}
async function enhanceCourses() {
  const grid = document.querySelector('#teachingApp .teaching-course-grid');
  const head = grid?.closest('.teaching-section')?.querySelector('.teaching-section__head');
  if (head && !head.querySelector('[data-open-archive]')) {
    const button = $('button', 'ti-secondary-link', 'Archived Courses'); button.type = 'button'; button.dataset.openArchive = 'true'; button.addEventListener('click', () => nav.open('archive')); head.append(button);
  }
}
async function renderArchive() {
  installStyles(); const main = document.getElementById('teachingApp'); if (!main) return;
  const page = $('section', 'teaching-view ti-page'); page.append(hero('Course history', 'Archived Courses', 'Completed and archived Courses remain available as academic history without crowding the active Courses workspace.', [action('Back to Courses', () => courses.openOverview())]));
  const body = $('div', 'ti-empty', 'Loading archived Courses…'); page.append(body); main.replaceChildren(page);
  try {
    const data = await kiwiApiRequest('/teaching/information/archive'); if (!page.isConnected) return;
    const rows = Array.isArray(data.courses) ? data.courses : [];
    if (!rows.length) { body.textContent = 'No Courses have moved into history yet.'; return; }
    const grid = $('div', 'teaching-course-grid'); rows.forEach((row) => grid.append(courseCard(row, true))); body.replaceWith(grid);
  } catch (error) { body.className = 'ti-error'; body.textContent = error.message || 'Archived Courses are temporarily unavailable.'; }
}

function dialogShell(kicker, title) {
  const dialog = $('dialog', 'ti-dialog'); const inner = $('div', 'ti-dialog__inner');
  const close = $('button', 'ti-dialog__close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.addEventListener('click', () => dialog.close());
  inner.append(add($('div', 'ti-dialog__head'), add($('div'), $('div', 'ti-kicker', kicker), $('h2', '', title)), close)); dialog.append(inner); dialog.addEventListener('close', () => dialog.remove(), { once:true }); document.body.append(dialog); return { dialog, inner };
}
async function showMaterials(courseId) {
  installStyles(); const { dialog, inner } = dialogShell('Course materials', courseTitle(courseId)); const body = $('div', 'ti-empty', 'Loading Course materials…'); inner.append(body); dialog.showModal();
  try {
    const data = await kiwiApiRequest(`/teaching/information/courses/${encodeURIComponent(courseId)}/materials`); if (!dialog.isConnected) return;
    const materials = Array.isArray(data.materials) ? data.materials : [];
    if (!materials.length) { body.textContent = 'No Course materials are currently attached to this Course.'; return; }
    const content = $('div', 'ti-page');
    const hierarchy = $('section', 'ti-material-hierarchy'); hierarchy.append($('div', 'ti-kicker', 'Material hierarchy'), $('h3', '', 'Original source first. Practice around it.'), $('p', '', 'Original notes anchor the Course. KIWI Subject flashcards and additional uploads remain clearly identified as supporting material.')); content.append(hierarchy);
    const search = $('input', 'ti-material-search'); search.type = 'search'; search.placeholder = 'Search materials by name, type or description'; search.setAttribute('aria-label', 'Search Course materials');
    const results = $('div', 'ti-material-results', `${materials.length} material${materials.length === 1 ? '' : 's'}`); content.append(search, results);
    const groups = [
      { title:'Original notes', copy:'The primary material this Course is grounded in.', kinds:['PRIMARY_STUDY_NOTE'] },
      { title:'KIWI flashcards', copy:'Retrieval practice from the Subject; supplemental when an original note exists.', kinds:['KIWI_SUBJECT_FLASHCARDS','PRIMARY_KIWI_SUBJECT'] },
      { title:'Additional materials', copy:'Student-added examples, references and supporting sources.', kinds:['STUDENT_SUPPLEMENT','AUTHORITATIVE_SCHOOL_SCOPE','AI_SUPPLEMENTATION'] },
    ];
    const sections = [];
    groups.forEach((group, groupIndex) => {
      const items = materials.filter((material) => group.kinds.includes(material.kind)); if (!items.length) return;
      const section = $('details', 'ti-material-group'); section.open = groupIndex === 0 || items.length <= 6; const head = $('summary', 'ti-material-group__head'); const count = $('span', 'ti-material-count', items.length); head.append(add($('div'), $('div', 'ti-kicker', 'Source role'), $('h3', '', group.title), $('p', '', group.copy)), add($('span', 'ti-material-group__aside'), count, $('span', 'ti-material-chevron', '⌄'))); section.append(head);
      const list = $('div', 'ti-material-list'); const cards = items.map((material, index) => { const title = material.filename || material.summary || `${human(material.kind || 'Course source')} ${index + 1}`; const description = [material.summary && material.filename ? material.summary : null, human(material.kind || 'source'), human(material.classification || 'unresolved')].filter(Boolean).join(' · '); const card = $('article', 'ti-material'); card.dataset.searchText = `${title} ${description}`.toLowerCase(); card.append($('strong', '', title), $('p', '', description)); list.append(card); return card; }); section.append(list); content.append(section); sections.push({ section, cards, count });
    }); body.replaceWith(content);
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase(); let visible = 0;
      sections.forEach(({ section, cards, count }) => { let groupVisible = 0; cards.forEach((card) => { const matches = !query || card.dataset.searchText.includes(query); card.hidden = !matches; if (matches) groupVisible += 1; }); count.textContent = groupVisible; section.hidden = groupVisible === 0; if (query && groupVisible) section.open = true; visible += groupVisible; });
      results.textContent = query ? `${visible} of ${materials.length} materials shown` : `${materials.length} material${materials.length === 1 ? '' : 's'}`;
    });
  } catch (error) { body.className = 'ti-error'; body.textContent = error.message || 'Course materials are temporarily unavailable.'; }
}
async function showStudyPack(pack, group) {
  installStyles(); const { dialog, inner } = dialogShell('Study Pack', pack.title || group.courseTitle || 'Class Study Pack'); const body = $('div', 'ti-empty', 'Loading Class Study Pack…'); inner.append(body); dialog.showModal();
  try {
    const event = await kiwiApiRequest(`/teaching/information/classes/${encodeURIComponent(pack.classId)}/event`); if (!dialog.isConnected) return;
    const content = $('div', 'ti-page');
    const facts = $('div', 'ti-grid'); facts.append(add($('article', 'ti-card'), $('div', 'ti-kicker', 'Class'), $('h3', '', displayCourseName(event.course?.title || group.courseTitle, 'Course')), $('p', '', event.objective || 'The Class objective remains attached to its authoritative Class record.')), add($('article', 'ti-card'), $('div', 'ti-kicker', 'Study state'), $('h3', '', human(event.studyPack?.state || pack.state || 'Preparing')), $('p', '', event.studyPack ? 'This Study Pack is attached to the completed Class. Publication remains governed by the post-Class Study pipeline.' : 'No Study Pack has been published for this Class yet.'))); content.append(facts);
    const summary = safeText(event.summary); if (summary) content.append(add($('article', 'ti-card'), $('div', 'ti-kicker', 'Class summary'), $('p', '', summary)));
    content.append(add($('div', 'ti-actions'), action('Open Course', () => { dialog.close(); openCourse(group.courseId); }))); body.replaceWith(content);
  } catch (error) { body.className = 'ti-error'; body.textContent = error.message || 'Study Pack detail is temporarily unavailable.'; }
}
async function renderStudyPacks({ courseId = null } = {}) {
  installStyles(); const main = document.getElementById('teachingApp'); if (!main) return;
  const actions = []; if (courseId) actions.push(action('All Study Packs', () => renderStudyPacks())); actions.push(action('Back to Courses', () => courses.openOverview()));
  const page = $('section', 'teaching-view ti-page'); page.append(hero('Post-Class Study', courseId ? `Study Packs · ${courseTitle(courseId)}` : 'Study Packs', 'Post-Class Study Packs are organized by Course and Class. They remain a secondary learning collection rather than creating one permanent deck or tab for every Class.', actions));
  const body = $('div', 'ti-empty', 'Loading Study Packs…'); page.append(body); main.replaceChildren(page);
  try {
    const data = await kiwiApiRequest(`/teaching/information/study${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`); if (!page.isConnected) return;
    const groups = Array.isArray(data.groups) ? data.groups : []; if (!groups.length) { body.textContent = 'No post-Class Study Packs are available yet. Packs appear only after the governed Class Study pipeline has produced them.'; return; }
    const stack = $('div', 'ti-page');
    groups.forEach((group) => {
      const section = $('section', 'ti-study-group'); const head = $('div', 'ti-study-group__head'); head.append(add($('div'), $('div', 'ti-kicker', 'Course'), $('h3', '', displayCourseName(group.courseTitle, 'Course'))));
      const courseButton = action('Open Course', () => openCourse(group.courseId)); courseButton.classList.add('ti-secondary-link'); head.append(courseButton);
      const packs = $('div', 'ti-page'); (group.packs || []).forEach((pack) => { const card = $('article', 'ti-pack'); const copy = add($('div'), $('h4', '', pack.title || 'Class Study Pack'), $('p', '', `${pack.scheduledStartAt ? dateTime(pack.scheduledStartAt) : 'Class'} · ${human(pack.state || 'Available')}`)); card.append(copy, add($('div', 'ti-actions'), action('Open Pack', () => showStudyPack(pack, group)))); packs.append(card); });
      section.append(head, packs); stack.append(section);
    }); body.replaceWith(stack);
  } catch (error) { body.className = 'ti-error'; body.textContent = error.message || 'Study Packs are temporarily unavailable.'; }
}

function teacherPreference(label, key, value, choices) {
  const field = $('div', 'ti-field'); const labelNode = $('label', '', label); const select = $('select'); const id = `teacher-pref-${key}`; labelNode.htmlFor = id; select.id = id; select.dataset.teacherPreference = key; choices.forEach(([v,l]) => select.append(new Option(l, v, false, v === value))); field.append(labelNode, select); return field;
}
function teacherBoundaries() {
  const card = $('section', 'ti-card'); card.append($('div', 'ti-kicker', 'Teacher boundaries'), $('h3', '', 'Style can adapt. Academic truth cannot.'));
  const list = $('div', 'ti-boundaries'); ['Your Teacher can change explanation style and interaction preferences.', 'Marks, standards, attendance, schedules and progression remain with their authoritative academic owners.', 'The Teacher must not humiliate, manipulate, invent shared memories, or provide prohibited assessment help.'].forEach((copy) => list.append($('span', '', copy))); card.append(list); return card;
}
async function renderTeacher({ course, container }) {
  installStyles(); const page = $('div', 'ti-teacher'); page.append($('div', 'ti-empty', 'Loading your Course Teacher…')); container.replaceChildren(page);
  async function load() {
    try {
      const data = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher`); if (!page.isConnected) return; page.replaceChildren();
      if (data.setupRequired || !data.teacher) {
        const card = $('section', 'ti-card'); card.append($('div', 'ti-kicker', 'Course Teacher'), $('h3', '', 'Prepare your AI Teacher'), $('p', '', data.aiDisclosure || 'Your Course Teacher is an AI teacher in KIWI Teaching.'));
        const select = $('select'); [['surprise_me','Surprise me'],['more_direct','More direct'],['more_relaxed','More relaxed'],['more_formal','More formal'],['more_energetic','More energetic']].forEach(([v,l]) => select.append(new Option(l,v)));
        const field = $('div', 'ti-field'); field.append($('label', '', 'Broad style'), select); const note = $('div', 'ti-status');
        const prepare = action('Prepare Teacher', async () => { prepare.disabled = true; setStatus(note, 'Preparing Teacher…'); try { await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/ensure`, { method:'POST', body:{ broadStylePreference:select.value } }); await load(); } catch (error) { setStatus(note, error.message || 'Teacher could not be prepared.', 'error'); } finally { prepare.disabled = false; } }, { primary:true });
        card.append(add($('div', 'ti-form'), field, prepare, note)); page.append(card, teacherBoundaries()); return;
      }
      page.append(
        add(
          $('section', 'ti-teacher-identity'),
          add(
            $('div'),
            $('div', 'ti-kicker', 'Your Course Teacher'),
            $('h2', '', data.teacher.displayName || 'KIWI Teacher'),
            $('p', '', `${data.teacher.styleDescription || 'KIWI Teacher'}. ${data.teacher.aiDisclosure || 'This is an AI Teacher in KIWI Teaching.'}`),
          ),
          $('span', 'ti-ai-badge', 'AI Teacher'),
        ),
      );
      const layout = $('div', 'ti-teacher-layout');
      const preferences = $('section', 'ti-card'); preferences.append($('div', 'ti-kicker', 'Interaction preferences'), $('h3', '', 'How your Teacher communicates'), $('p', '', 'These preferences adjust presentation without changing Teacher identity, pedagogy rules, marks or academic standard.'));
      const form = $('div', 'ti-form'); const profile = data.interactionProfile || {};
      form.append(teacherPreference('Explanation length','explanation_density',profile.explanation_density || 'standard',[['compact','Compact'],['standard','Standard'],['extended','Extended']]), teacherPreference('Examples','examples',profile.examples || 'standard',[['fewer','Fewer'],['standard','Standard'],['more','More']]), teacherPreference('Filler','filler_tolerance',profile.filler_tolerance || 'standard',[['minimal','Minimal'],['standard','Standard']]), teacherPreference('Register','register',profile.register || 'standard',[['standard','Standard'],['more_formal','More formal'],['more_relaxed','More relaxed']]), teacherPreference('Formatting','formatting',profile.formatting || 'standard',[['standard','Standard'],['stepwise','Stepwise'],['concise_blocks','Concise blocks']]));
      const prefStatus = $('div', 'ti-status'); const save = action('Save preferences', async () => { save.disabled = true; setStatus(prefStatus, 'Saving…'); const body = {}; form.querySelectorAll('[data-teacher-preference]').forEach((select) => { body[select.dataset.teacherPreference] = select.value; }); try { await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/interaction-profile`, { method:'PUT', body }); setStatus(prefStatus, 'Interaction preferences saved.', 'success'); } catch (error) { setStatus(prefStatus, error.message || 'Preferences could not be saved.', 'error'); } finally { save.disabled = false; } }, { primary:true }); form.append(save, prefStatus); preferences.append(form);
      const askCard = $('section', 'ti-card'); askCard.append($('div', 'ti-kicker', 'Outside Class'), $('h3', '', 'Ask your Teacher'), $('p', '', 'Ask a Course question outside a live Class. If the answer route is not qualified, KIWI will say so rather than inventing an answer.'));
      const question = $('textarea'); question.placeholder = 'Ask about this Course…'; const qField = $('div', 'ti-field'); qField.append($('label', '', 'Question'), question); const qStatus = $('div', 'ti-status');
      const ask = action('Ask Teacher', async () => { const text = question.value.trim(); if (!text) { setStatus(qStatus, 'Write a Course question first.', 'error'); return; } ask.disabled = true; setStatus(qStatus, 'Sending question…'); try { const result = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/questions`, { method:'POST', body:{ question:text, idempotencyKey:crypto.randomUUID() } }); if (result.status === 'ANSWER_READY') setStatus(qStatus, safeText(result.answer) || 'Your Teacher answered the question.', 'success'); else if (result.status === 'ROUTE_HELD') setStatus(qStatus, 'Your question was accepted, but the outside-Class answer route is not qualified yet. No answer was fabricated.'); else setStatus(qStatus, human(result.status || 'Question recorded')); } catch (error) { setStatus(qStatus, error.message || 'Question could not be sent.', 'error'); } finally { ask.disabled = false; } }, { primary:true }); askCard.append(qField, ask, qStatus);
      const change = $('section', 'ti-card'); change.append($('div', 'ti-kicker', 'Teacher options'), $('h3', '', 'Request a different Teacher'), $('p', '', 'A Teacher change is a formal Request. Course records, obligations, marks and history remain unchanged.'));
      const styleSelect = $('select'); [['surprise_me','Surprise me'],['more_direct','More direct'],['more_relaxed','More relaxed'],['more_formal','More formal'],['more_energetic','More energetic']].forEach(([v,l]) => styleSelect.append(new Option(l,v))); const styleField = $('div', 'ti-field'); styleField.append($('label', '', 'Replacement style'), styleSelect); const explanation = $('textarea'); explanation.placeholder = 'Optional reason for the Teacher change'; const reasonField = $('div', 'ti-field'); reasonField.append($('label', '', 'Reason'), explanation); const changeStatus = $('div', 'ti-status');
      const request = action('Request Teacher change', async () => { request.disabled = true; setStatus(changeStatus, 'Creating formal Request…'); try { const result = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher/change-request`, { method:'POST', body:{ broadStylePreference:styleSelect.value, explanation:explanation.value.trim() || undefined, idempotencyKey:crypto.randomUUID() } }); setStatus(changeStatus, result.replacementTeacher?.displayName ? `Request created. Proposed replacement: ${result.replacementTeacher.displayName}.` : 'Teacher Change Request created.', 'success'); } catch (error) { setStatus(changeStatus, error.message || 'Teacher Change Request could not be created.', 'error'); } finally { request.disabled = false; } });
      const changeForm = $('div', 'ti-form'); if ((data.pendingTeacherChanges || []).length) changeForm.append($('div', 'ti-chip', `${data.pendingTeacherChanges.length} Teacher Change ${data.pendingTeacherChanges.length === 1 ? 'Request' : 'Requests'} in progress`)); changeForm.append(styleField, reasonField, add($('div', 'ti-actions'), request, action('Open Requests', () => nav.open('requests'))), changeStatus); change.append(changeForm);
      layout.append(preferences, askCard, change, teacherBoundaries()); page.append(layout);
    } catch (error) { page.replaceChildren($('div', 'ti-error', error.message || 'Course Teacher is temporarily unavailable.')); }
  }
  await load();
}
async function renderTeacherSummary({ course, container, openSection }) {
  installStyles(); const card = $('article', 'teaching-course-feature-card'); const known = course.teacher || course.information_overview?.teacher; card.append($('div', 'ti-kicker', 'Teacher'), $('h3', '', known?.displayName || 'Course Teacher'), $('p', '', known ? 'Open Teacher for style and interaction options.' : 'Teacher setup is ready inside this Course.')); const initialActions = $('div', 'teaching-course-feature-card__actions'); const initialOpen = $('button', 'teaching-d08-link-button', 'Open Teacher'); initialOpen.type = 'button'; initialOpen.addEventListener('click', openSection); initialActions.append(initialOpen); card.append(initialActions); container.replaceChildren(card);
  try { const data = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/teacher`); if (!card.isConnected) return; card.replaceChildren($('div', 'ti-kicker', 'Teacher'), $('h3', '', data.teacher?.displayName || 'Course Teacher'), $('p', '', data.teacher ? `${data.teacher.styleDescription || 'KIWI Teacher'} · ${data.teacher.aiDisclosure || 'AI Teacher in KIWI Teaching'}` : 'Teacher setup is ready inside this Course.')); const actions = $('div', 'teaching-course-feature-card__actions'); const open = $('button', 'teaching-d08-link-button', 'Open Teacher'); open.type = 'button'; open.addEventListener('click', openSection); actions.append(open); card.append(actions); } catch (error) { card.replaceChildren($('div', 'ti-kicker', 'Teacher'), $('h3', '', 'Course Teacher'), $('p', '', error.message || 'Teacher summary is temporarily unavailable.')); }
}

async function enhanceCourseOverview() {
  const shell = document.querySelector('#teachingApp .teaching-course-shell'); if (!shell) return;
  const active = shell.querySelector('.teaching-course-nav__item[data-active="true"]'); if (!active || active.textContent.trim() !== 'Overview') return;
  const content = shell.querySelector('.teaching-course-content'); if (!content || content.querySelector('[data-information-overview]')) return;
  const courseId = courses.currentCourseId?.(); if (!courseId) return;
  if (courses.getCourse?.(courseId)?.information_overview) return;
  const request = ++state.overviewRequest; const section = $('section', 'ti-overview'); section.dataset.informationOverview = 'true'; section.append($('div', 'ti-empty', 'Loading current Course position…')); content.prepend(section);
  try {
    const data = await kiwiApiRequest(`/teaching/information/courses/${encodeURIComponent(courseId)}/overview`); if (!section.isConnected || request !== state.overviewRequest) return; section.replaceChildren();
    const grid = $('div', 'ti-overview__grid'); grid.append(overviewCell('Current topic', data.currentTopic || 'Course Plan', data.phase ? `Phase · ${human(data.phase)}` : ''), overviewCell('Next Class', data.nextClass?.title || 'No Class scheduled', data.nextClass?.startsAt ? dateTime(data.nextClass.startsAt) : ''), overviewCell('Teacher', data.teacher?.displayName || 'Teacher setup', data.teacher ? 'Open Teacher for style and interaction options.' : '')); section.append(grid);
    const panels = $('div', 'ti-grid');
    const assessment = $('article', 'ti-card');
    assessment.append(
      $('div', 'ti-kicker', 'Next assessment'),
      $('h3', '', data.nextAssessment?.title || 'No announced assessment'),
      $('p', '', data.nextAssessment?.startsAt
        ? dateTime(data.nextAssessment.startsAt)
        : 'Only legitimately visible assessments appear here. Hidden surprise assessments are not previewed.'),
    );
    const work = $('article', 'ti-card');
    work.append(
      $('div', 'ti-kicker', 'Important Work'),
      $('h3', '', data.importantWork?.length
        ? `${data.importantWork.length} active ${data.importantWork.length === 1 ? 'item' : 'items'}`
        : 'Nothing urgent'),
    );
    const workRows = $('div');
    (data.importantWork || []).slice(0, 3).forEach((item) => {
      workRows.append(
        add(
          $('div', 'ti-work-row'),
          $('strong', '', item.title || 'Course Work'),
          $('span', '', item.deadline?.dueAt
            ? dateTime(item.deadline.dueAt)
            : human(item.lifecycleState || 'Active')),
        ),
      );
    });
    if (!workRows.childElementCount) {
      workRows.append($('p', '', 'No active Work currently requires attention.'));
    }
    work.append(workRows);
    panels.append(assessment, work);
    section.append(panels);
    (data.warnings || []).forEach((warning) => section.append($('div', 'ti-warning', warning.message || 'This Course needs attention.')));
    section.append(add($('div', 'ti-actions'), action('Course Materials', () => showMaterials(courseId)), action('Study Packs', () => { state.studyCourseId = courseId; nav.open('study-packs'); }), action('Teacher', () => openCourse(courseId, 'teacher')), action('Requests', () => nav.open('requests'))));
  } catch (error) { section.replaceChildren($('div', 'ti-error', error.message || 'Current Course position is temporarily unavailable.')); }
}
function enhanceCoursePlanMaterials() {
  const courseId = courses.currentCourseId?.(); const head = document.querySelector('#teachingApp .teaching-d08-page .teaching-d08-page__head'); if (!courseId || !head || head.querySelector('[data-course-materials]')) return;
  const button = action('Materials', () => showMaterials(courseId)); button.dataset.courseMaterials = 'true'; head.append(button);
}

function recordCourse(course) {
  const card = $('article', 'ti-record-course'); card.append($('h3', '', displayCourseName(course.title, 'Course')), $('div', 'ti-record-course__outcome', human(course.progression_outcome || 'Outcome pending'))); const meta = $('div', 'ti-record-course__meta'); if (course.score_percentage != null) meta.append($('span', '', `Official score ${course.score_percentage}%`)); if (course.academic_credits != null) meta.append($('span', '', `${course.academic_credits} credits`)); meta.append($('span', '', `Attempt ${course.attempt_no || 1}`)); if (course.attempt_kind) meta.append($('span', '', human(course.attempt_kind))); card.append(meta); return card;
}
async function renderRecord() {
  installStyles(); const main = document.getElementById('teachingApp'); if (!main) return; const page = $('section', 'teaching-view ti-page'); page.append(hero('Academic Record', 'Record', 'Semester results, Course outcomes and attendance history stay together here while remaining separate academic truths. Official marks, learning insight and attendance are not interchangeable.')); const body = $('div', 'ti-empty', 'Loading your academic Record…'); page.append(body); main.replaceChildren(page);
  const [formal, attendance] = await Promise.allSettled([kiwiApiRequest('/teaching/information/record'), kiwiApiRequest('/teaching/record/attendance')]); if (!page.isConnected) return; const content = $('div', 'ti-page');
  if (formal.status === 'fulfilled') {
    const section = $('section', 'ti-section'); section.append(add($('div', 'ti-section__head'), add($('div'), $('div', 'ti-kicker', 'Official academic record'), $('h2', '', 'Semester results')))); const records = Array.isArray(formal.value.records) ? formal.value.records : []; if (!records.length) section.append($('div', 'ti-empty', 'No finalized Semester record is available yet.'));
    records.forEach((entry) => { const model = entry.record || {}; const semester = $('section', 'ti-record-semester'); const head = $('div', 'ti-record-semester__head'); head.append(add($('div'), $('div', 'ti-kicker', 'Semester'), $('h2', '', entry.name || 'Semester'))); if (model.gpa?.gpa_value != null) head.append($('div', 'ti-gpa', `GPA ${model.gpa.gpa_value}`)); semester.append(head); const grid = $('div', 'ti-record-grid'); const rows = Array.isArray(model.courses) ? model.courses : []; rows.forEach((course) => grid.append(recordCourse(course))); if (!rows.length) grid.append($('div', 'ti-empty', 'No finalized Course results are recorded for this Semester yet.')); semester.append(grid); section.append(semester); }); content.append(section);
  } else content.append($('div', 'ti-error', formal.reason?.message || 'Formal Semester Record is temporarily unavailable.'));
  const attendanceSection = $('section', 'ti-section'); attendanceSection.append(add($('div', 'ti-section__head'), add($('div'), $('div', 'ti-kicker', 'Attendance'), $('h2', '', 'Scheduled obligations'))));
  if (attendance.status === 'fulfilled') {
    const groups = Array.isArray(attendance.value.courses) ? attendance.value.courses : []; if (!groups.length) attendanceSection.append($('div', 'ti-empty', 'No attendance obligations are recorded yet.')); const list = $('div', 'ti-attendance'); groups.forEach((group) => { const records = Array.isArray(group.records) ? group.records : []; const required = records.filter((row) => row.obligationState === 'REQUIRED' || row.obligation_state === 'REQUIRED'); const late = required.filter((row) => row.outcome === 'LATE').length; const protectedCount = required.filter((row) => ['EXCUSED_ABSENCE','APPROVED_LEAVE','SYSTEM_PROTECTED'].includes(row.outcome)).length; const card = $('article', 'ti-attendance-course'); card.append(add($('div', 'ti-attendance-course__head'), $('strong', '', courseTitle(group.courseId)), $('span', '', `${required.length} obligations · ${late} late · ${protectedCount} protected/excused`))); list.append(card); }); attendanceSection.append(list);
  } else attendanceSection.append($('div', 'ti-error', attendance.reason?.message || 'Attendance history is temporarily unavailable.'));
  content.append(attendanceSection); body.replaceWith(content);
}

function dockItem(id, label, icon, onClick) { const node = $('button', 'teaching-dock__item'); node.type = 'button'; node.dataset.primaryId = id; node.setAttribute('aria-label', label); node.append($('span', 'teaching-dock__icon', icon), $('span', 'teaching-dock__label', label)); node.addEventListener('click', onClick); return node; }
function buildPrimaryDock() {
  const shell = document.getElementById('teachingDockShell'); const dock = document.getElementById('teachingDock'); if (!shell || !dock) return;
  dock.replaceChildren(dockItem('courses','Courses','▦',() => courses.openOverview()), dockItem('calendar','Calendar','◷',() => nav.open('calendar')), dockItem('work','Work','✓',() => nav.open('work')), dockItem('record','Record','≣',() => nav.open('record')), dockItem('menu','Menu','≡',() => document.getElementById('teachingMenuButton')?.click())); shell.hidden = false; document.body.dataset.teachingDockVisible = 'true'; syncDock();
}
function syncDock() {
  const dock = document.getElementById('teachingDock'); if (!dock) return; const activeMenu = document.querySelector('.teaching-menu-link[data-active="true"]')?.dataset?.view || ''; let active = null; if (activeMenu === 'navigation:calendar') active = 'calendar'; else if (activeMenu === 'navigation:work') active = 'work'; else if (activeMenu === 'navigation:record') active = 'record'; else if (activeMenu === 'overview' || document.querySelector('#teachingApp .teaching-course-shell')) active = 'courses'; dock.querySelectorAll('[data-primary-id]').forEach((item) => { const current = item.dataset.primaryId === active; item.dataset.active = current ? 'true' : 'false'; if (current) item.setAttribute('aria-current','page'); else item.removeAttribute('aria-current'); });
}
function registerSurfaces() {
  if (!courses.sectionIds().includes('teacher')) courses.registerSection({ id:'teacher', label:'Teacher', order:70, render:renderTeacher, renderSummary:renderTeacherSummary });
  nav.register({ id:'record', label:'Record', description:'Semester results and attendance history', icon:'≣', menuIcon:'record', onSelect:renderRecord });
  if (!nav.ids().includes('archive')) nav.register({ id:'archive', label:'Archived Courses', description:'Completed and archived Course history', icon:'□', menuIcon:'archive', onSelect:renderArchive });
  if (!nav.ids().includes('study-packs')) nav.register({ id:'study-packs', label:'Study Packs', description:'Post-Class notes organized by Course and Class', icon:'◇', menuIcon:'study', onSelect:() => { const courseId = state.studyCourseId; state.studyCourseId = null; renderStudyPacks({ courseId }); } });
}
function maintain() { syncDock(); enhanceToday().catch(() => {}); enhanceCourses().catch(() => {}); enhanceCourseOverview().catch(() => {}); enhanceCoursePlanMaterials(); }
function start() {
  installStyles(); registerSurfaces(); buildPrimaryDock(); maintain();
  let queued = false; const schedule = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; maintain(); }); }; const observer = new MutationObserver(schedule); const app = document.getElementById('teachingApp'); const menu = document.getElementById('teachingMenuFuture'); if (app) observer.observe(app,{ childList:true, subtree:true, attributes:true, attributeFilter:['data-active'] }); if (menu) observer.observe(menu,{ childList:true, subtree:true, attributes:true, attributeFilter:['data-active'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
else start();
