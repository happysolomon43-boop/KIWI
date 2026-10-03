const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
const nav = window.KIWITeachingNavigation;
const courses = window.KIWITeachingCourses;

if (typeof kiwiApiRequest !== 'function' || !nav?.register || !courses?.openOverview) {
  throw new Error('Original Teaching shell must load before its information bridge.');
}

const $ = (tag, className = '', text = null) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = String(text);
  return node;
};

function words(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function timeLabel(value) {
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

function openTodayItem(item) {
  const kind = String(item?.kind || '').toUpperCase();
  if (kind === 'WORK') return nav.open('work');
  if (kind === 'REQUEST') return nav.open('requests');
  if (kind === 'ASSESSMENT' || kind === 'CLASS') return nav.open('calendar');
}

function todayCard(label, item) {
  if (!item) return null;
  const button = $('button', 'teaching-today-card');
  button.type = 'button';
  const due = item.dueAt || item.startsAt || null;
  button.append(
    $('span', 'teaching-today-card__label', label),
    $('strong', '', item.title || words(item.kind) || 'Teaching item'),
    $('small', '', due ? timeLabel(due) : words(item.kind))
  );
  button.addEventListener('click', () => openTodayItem(item));
  return button;
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
  head.append(title, $('p', '', 'A quick view from your existing Teaching workspace'));
  const body = $('div', 'teaching-today__quiet', 'Loading today…');
  panel.append(head, body);
  hero.insertAdjacentElement('afterend', panel);

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const data = await kiwiApiRequest('/teaching/information/today?currentTimeZone=' + encodeURIComponent(zone));
    if (!panel.isConnected) return;

    if (data.quiet) {
      body.className = 'teaching-today__quiet';
      body.textContent = 'Nothing needs your attention right now. Your courses stay available below.';
      return;
    }

    const grid = $('div', 'teaching-today__grid');
    const now = data.now?.[0] || null;
    const action = data.needsAction?.[0] || null;
    const next = data.next?.[0] || null;
    [todayCard('Now', now), todayCard('Needs action', action), todayCard('Next', next)]
      .filter(Boolean)
      .forEach((card) => grid.append(card));

    if (!grid.children.length) {
      body.className = 'teaching-today__quiet';
      body.textContent = 'Your day is clear for now.';
      return;
    }
    body.replaceWith(grid);
  } catch (error) {
    if (!panel.isConnected) return;
    body.className = 'teaching-today__quiet';
    body.textContent = 'Today is temporarily unavailable. Your courses and other Teaching tools still work normally.';
  }
}

function renderRecordCourse(course) {
  const card = $('article', 'teaching-record-card');
  card.append(
    $('h3', '', course.title || 'Course'),
    $('div', 'teaching-record-card__outcome', words(course.progression_outcome || 'Outcome pending'))
  );
  const meta = $('div', 'teaching-record-card__meta');
  if (course.score_percentage != null) meta.append($('span', '', `Official score ${course.score_percentage}%`));
  if (course.academic_credits != null) meta.append($('span', '', `${course.academic_credits} credits`));
  meta.append($('span', '', `Attempt ${course.attempt_no || 1}`));
  if (course.attempt_kind) meta.append($('span', '', words(course.attempt_kind)));
  card.append(meta);
  return card;
}

async function renderRecord() {
  const main = document.getElementById('teachingApp');
  if (!main) return;
  const page = $('section', 'teaching-view teaching-record');
  const hero = $('section', 'teaching-record__hero');
  hero.append(
    $('div', 'teaching-kicker', 'Academic record'),
    $('h1', '', 'Record'),
    $('p', '', 'Formal semester and course results live here. Learning insights remain separate from official marks and progression outcomes.')
  );
  const content = $('div', 'teaching-empty', 'Loading your academic record…');
  page.append(hero, content);
  main.replaceChildren(page);

  try {
    const data = await kiwiApiRequest('/teaching/information/record');
    if (!page.isConnected) return;
    const records = Array.isArray(data.records) ? data.records : [];
    if (!records.length) {
      content.className = 'teaching-empty';
      content.textContent = 'No formal semester record is available yet. Results appear here when their academic owners have finalized them.';
      return;
    }

    const list = $('div', 'teaching-record');
    for (const entry of records) {
      const model = entry.record || {};
      const semester = $('section', 'teaching-record-semester');
      const head = $('div', 'teaching-record-semester__head');
      const copy = $('div');
      copy.append($('div', 'teaching-kicker', 'Semester'), $('h2', '', entry.name || 'Semester'));
      head.append(copy);
      if (model.gpa?.gpa_value != null) head.append($('div', 'teaching-record-gpa', `GPA ${model.gpa.gpa_value}`));
      semester.append(head);
      const grid = $('div', 'teaching-record-grid');
      const courseRows = Array.isArray(model.courses) ? model.courses : [];
      courseRows.forEach((course) => grid.append(renderRecordCourse(course)));
      if (!courseRows.length) grid.append($('div', 'teaching-empty', 'No finalized Course results are recorded for this semester yet.'));
      semester.append(grid);
      list.append(semester);
    }
    content.replaceWith(list);
  } catch (error) {
    content.className = 'teaching-empty';
    content.textContent = error?.message || 'Record is temporarily unavailable.';
  }
}

function dockButton(id, label, icon, handler) {
  const button = $('button', 'teaching-dock__item');
  button.type = 'button';
  button.dataset.primaryId = id;
  button.setAttribute('aria-label', label);
  button.append($('span', 'teaching-dock__icon', icon), $('span', 'teaching-dock__label', label));
  button.addEventListener('click', handler);
  return button;
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
  dock.querySelectorAll('[data-primary-id]').forEach((button) => {
    button.dataset.active = button.dataset.primaryId === active ? 'true' : 'false';
    if (button.dataset.primaryId === active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
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

function start() {
  if (!nav.ids().includes('record')) {
    nav.register({
      id: 'record',
      label: 'Record',
      description: 'Formal semester and Course results',
      icon: '≣',
      menuIcon: 'overview',
      onSelect: renderRecord,
    });
  }

  buildPrimaryDock();
  enhanceOverviewWithToday().catch(() => {});

  const app = document.getElementById('teachingApp');
  const menu = document.getElementById('teachingMenuFuture');
  const observer = new MutationObserver(() => {
    syncPrimaryDock();
    enhanceOverviewWithToday().catch(() => {});
  });
  if (app) observer.observe(app, { childList: true, subtree: true });
  if (menu) observer.observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active'] });
}

if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });
