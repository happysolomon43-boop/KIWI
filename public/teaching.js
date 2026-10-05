const { kiwiApiRequest, hasKiwiSession } = window.KIWI_API_CLIENT || {};
const teachingDisplay = window.KIWITeachingDisplay || {};
const displayCourseName = teachingDisplay.displayName || ((value, fallback = 'Untitled course') => String(value || '').trim() || fallback);

if (typeof kiwiApiRequest !== 'function' || typeof hasKiwiSession !== 'function') {
  throw new Error('KIWI shared API client must load before Teaching.');
}

// KIWI Teaching standalone app entry.
// The normal KIWI dashboard owns only the mode-switch control; this module owns the Teaching shell.

const KIWI_PATH = '/';
const TEACHING_DOCK_LIMIT = 5;
const TEACHING_DOCK_DESTINATION_SLOTS = TEACHING_DOCK_LIMIT - 1;
const TEACHING_LOCATION_STORAGE_KEY = 'kiwi.teaching.location.v1';
const teachingNavigationItems = new Map();
const teachingCourseSections = new Map();
let activeTeachingView = 'overview';
let activeTeachingNavigationId = null;
let selectedTeachingCourseId = null;
let activeTeachingCourseSection = 'overview';
let teachingWorkspace = { subjects: [], courses: [] };

function readTeachingLocation() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(TEACHING_LOCATION_STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object') return null;
    return {
      view: typeof value.view === 'string' ? value.view : 'overview',
      navigationId: typeof value.navigationId === 'string' ? value.navigationId : null,
      courseId: typeof value.courseId === 'string' || typeof value.courseId === 'number'
        ? String(value.courseId)
        : null,
      sectionId: typeof value.sectionId === 'string' ? value.sectionId : 'overview',
    };
  } catch {
    return null;
  }
}

let pendingTeachingLocation = readTeachingLocation();

function persistTeachingLocation() {
  try {
    window.sessionStorage.setItem(TEACHING_LOCATION_STORAGE_KEY, JSON.stringify({
      view: activeTeachingView,
      navigationId: activeTeachingNavigationId,
      courseId: selectedTeachingCourseId == null ? null : String(selectedTeachingCourseId),
      sectionId: activeTeachingCourseSection,
    }));
  } catch {
    // Navigation remains functional when browser storage is unavailable.
  }
}

function restoreTeachingLocation() {
  const saved = pendingTeachingLocation;
  pendingTeachingLocation = null;
  if (!saved) return false;

  if (saved.view === 'navigation' && saved.navigationId) {
    const item = teachingNavigationItems.get(saved.navigationId);
    if (item) {
      selectTeachingNavigationItem(item, { scrollBehavior: 'auto' });
      return true;
    }
  }

  if (saved.view === 'course' && saved.courseId && getTeachingCourse(saved.courseId)) {
    const sectionId = saved.sectionId === 'overview' || teachingCourseSections.has(saved.sectionId)
      ? saved.sectionId
      : 'overview';
    navigateTeaching('course', {
      courseId: saved.courseId,
      sectionId,
      preserveScroll: true,
    });
    return true;
  }

  if (saved.view === 'intake') {
    navigateTeaching('intake', { preserveScroll: true });
    return true;
  }

  persistTeachingLocation();
  return false;
}

function isTeachingDocument() {
  return Boolean(document.getElementById('teachingApp'));
}

function syncOverlayState() {
  const menuOpen = document.getElementById('teachingMenuPanel')?.dataset?.open === 'true';
  const settingsOpen = document.getElementById('teachingSettingsPanel')?.dataset?.open === 'true';
  const overlay = document.getElementById('teachingOverlay');

  const anyOpen = Boolean(menuOpen || settingsOpen);
  document.body.dataset.overlayOpen = anyOpen ? 'true' : 'false';

  if (overlay) {
    overlay.dataset.open = anyOpen ? 'true' : 'false';
    overlay.setAttribute(
      'aria-label',
      settingsOpen ? 'Close Teaching settings' : 'Close Teaching menu'
    );
  }
}

function setMenuOpen(open, { restoreFocus = true } = {}) {
  const panel = document.getElementById('teachingMenuPanel');
  const trigger = document.getElementById('teachingMenuButton');

  if (!panel || !trigger) return;

  panel.dataset.open = open ? 'true' : 'false';
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');

  syncOverlayState();

  if (open) {
    document.getElementById('teachingMenuClose')?.focus();
  } else if (restoreFocus) {
    trigger.focus();
  }
}

function setSettingsOpen(open) {
  const panel = document.getElementById('teachingSettingsPanel');

  if (!panel) return;

  panel.dataset.open = open ? 'true' : 'false';
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');

  syncOverlayState();

  if (open) {
    document.getElementById('teachingSettingsClose')?.focus();
  }
}

function closeActiveOverlay() {
  const settingsOpen = document.getElementById('teachingSettingsPanel')?.dataset?.open === 'true';

  if (settingsOpen) {
    setSettingsOpen(false);
    return;
  }

  setMenuOpen(false);
}

function requestSwitchToKiwi() {
  const dialog = document.getElementById('teachingConfirmDialog');

  setMenuOpen(false, { restoreFocus: false });

  if (dialog && typeof dialog.showModal === 'function') {
    dialog.showModal();
    document.getElementById('teachingConfirmCancel')?.focus();
    return;
  }

  if (window.confirm('Switch to KIWI?\n\nYou are leaving KIWI Teaching and returning to the KIWI study app.')) {
    window.location.assign(KIWI_PATH);
  }
}

function installTeachingHistoryGuard() {
  const marker = { kiwiTeaching: true };

  // Teaching is an explicit application mode. Browser/phone Back must not
  // silently switch the student back to the normal KIWI app; that transition
  // is owned by the confirmed "Switch to KIWI" action.
  window.history.replaceState(marker, '', window.location.href);
  window.history.pushState(marker, '', window.location.href);

  window.addEventListener('popstate', () => {
    closeActiveOverlay();
    window.history.pushState(marker, '', window.location.href);
  });
}

function suppressVercelToolbar() {
  const removeToolbar = () => {
    document
      .querySelectorAll('vercel-live-feedback, [data-vercel-feedback]')
      .forEach((node) => node.remove());
  };

  removeToolbar();

  const observer = new MutationObserver(removeToolbar);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function renderTeachingNavigation() {
  const shell = document.getElementById('teachingDockShell');
  const dock = document.getElementById('teachingDock');
  const template = document.getElementById('teachingDockItemTemplate');

  if (!shell || !dock || !(template instanceof HTMLTemplateElement)) return;

  const destinations = [...teachingNavigationItems.values()]
    .slice(0, TEACHING_DOCK_DESTINATION_SLOTS);
  const dockReady = destinations.length === TEACHING_DOCK_DESTINATION_SLOTS;

  dock.replaceChildren();
  shell.hidden = !dockReady;
  document.body.dataset.teachingDockVisible = dockReady ? 'true' : 'false';

  // Do not show a partially populated bottom dock. KIWI Teaching exposes it
  // only when all four destination slots exist; Menu is always slot five.
  if (!dockReady) return;

  const appendDockItem = ({ id, label, icon, onSelect, isMenu = false }) => {
    const fragment = template.content.cloneNode(true);
    const control = fragment.querySelector('.teaching-dock__item');
    const iconNode = fragment.querySelector('.teaching-dock__icon');
    const labelNode = fragment.querySelector('.teaching-dock__label');

    if (!control || !iconNode || !labelNode) return;

    control.dataset.navId = id;
    control.dataset.menu = isMenu ? 'true' : 'false';
    control.setAttribute('aria-label', label);
    iconNode.textContent = icon || '';
    labelNode.textContent = label;
    control.addEventListener('click', onSelect);
    dock.appendChild(fragment);
  };

  for (const item of destinations) {
    appendDockItem({
      id: item.id,
      label: item.label,
      icon: item.icon,
      onSelect: () => selectTeachingNavigationItem(item),
    });
  }

  appendDockItem({
    id: 'menu',
    label: 'Menu',
    icon: '≡',
    isMenu: true,
    onSelect: () => setMenuOpen(true, { restoreFocus: false }),
  });
}

function registerTeachingNavigationItem(item) {
  if (!item || typeof item.id !== 'string' || !item.id.trim()) {
    throw new TypeError('Teaching navigation items require a stable string id.');
  }

  if (typeof item.label !== 'string' || !item.label.trim()) {
    throw new TypeError('Teaching navigation items require a visible label.');
  }

  teachingNavigationItems.set(item.id, {
    id: item.id,
    label: item.label,
    description: typeof item.description === 'string' ? item.description : '',
    icon: typeof item.icon === 'string' ? item.icon : '',
    menuIcon: typeof item.menuIcon === 'string' ? item.menuIcon : '',
    href: typeof item.href === 'string' ? item.href : null,
    onSelect: typeof item.onSelect === 'function' ? item.onSelect : null,
  });

  renderTeachingNavigation();
  renderSectionMenu();

  return () => unregisterTeachingNavigationItem(item.id);
}

function unregisterTeachingNavigationItem(id) {
  teachingNavigationItems.delete(id);
  if (activeTeachingNavigationId === id) {
    activeTeachingNavigationId = null;
    activeTeachingView = 'overview';
  }
  renderTeachingNavigation();
  renderSectionMenu();
}

function renderTeachingSessionProblem(message) {
  const main = document.getElementById('teachingApp');
  if (!main) return;

  const section = document.createElement('section');
  section.style.cssText = 'min-height:62vh;display:grid;place-items:center;padding:24px 0;';

  const card = document.createElement('div');
  card.style.cssText = 'width:min(520px,100%);text-align:center;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:800;letter-spacing:-0.02em;margin-bottom:10px;';
  title.textContent = 'KIWI sign-in required';

  const detail = document.createElement('div');
  detail.style.cssText = 'font-size:14px;line-height:1.65;color:var(--teaching-muted);margin-bottom:20px;';
  detail.textContent = message || 'Sign in to KIWI first, then open Teaching from the KIWI dashboard.';

  const back = document.createElement('button');
  back.id = 'teachingSessionBack';
  back.className = 'teaching-menu-action';
  back.type = 'button';
  back.style.cssText = 'width:auto;margin:0 auto;';
  back.textContent = 'Back to KIWI';
  back.addEventListener('click', () => {
    window.location.assign(KIWI_PATH);
  });

  card.append(title, detail, back);
  section.appendChild(card);
  main.replaceChildren(section);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function splitSignals(value) {
  return String(value || '')
    .split(',')
    .map((signal) => signal.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function showSetupMessage(container, message, kind = 'status') {
  container.replaceChildren();
  const box = el('div', 'teaching-message', message);
  box.dataset.kind = kind;
  container.append(box);
}

function menuIcon(kind) {
  const paths = kind === 'create'
    ? '<path d="M12 5v14M5 12h14"/><path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/>'
    : kind === 'calendar'
      ? '<path d="M6 3v3M18 3v3M4 8h16"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 12h3M13 12h3M8 16h3M13 16h3"/>'
      : '<path d="M4 11 12 4l8 7v9H4zM9 20v-6h6v6"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" aria-hidden="true">${paths}</svg>`;
}

function renderSectionMenu() {
  const nav = document.getElementById('teachingMenuFuture');
  if (!nav) return;

  const items = [
    { id: 'overview', title: 'Overview', description: 'Your courses and next steps', icon: 'overview' },
    { id: 'intake', title: 'Create Course', description: 'Start from a KIWI Subject', icon: 'create' },
    ...[...teachingNavigationItems.values()].map((item) => ({
      id: 'navigation:' + item.id,
      title: item.label,
      description: item.description || 'Open this Teaching workspace',
      icon: item.menuIcon || 'overview',
      navigationItem: item,
    })),
  ];

  nav.replaceChildren();
  for (const item of items) {
    const button = el('button', 'teaching-menu-link');
    button.type = 'button';
    button.dataset.view = item.id;
    button.dataset.active = item.navigationItem
      ? (activeTeachingNavigationId === item.navigationItem.id ? 'true' : 'false')
      : ((activeTeachingView === item.id || (item.id === 'overview' && activeTeachingView === 'course')) && !activeTeachingNavigationId ? 'true' : 'false');

    const icon = el('span', 'teaching-menu-link__icon');
    icon.innerHTML = menuIcon(item.icon);
    const copy = el('span', 'teaching-menu-link__copy');
    copy.append(
      el('span', 'teaching-menu-link__title', item.title),
      el('span', 'teaching-menu-link__description', item.description)
    );
    button.append(icon, copy, el('span', 'teaching-menu-link__arrow', '›'));
    button.addEventListener('click', () => item.navigationItem
      ? selectTeachingNavigationItem(item.navigationItem)
      : navigateTeaching(item.id));
    nav.append(button);
  }
}

function selectTeachingNavigationItem(item, { scrollBehavior = 'smooth' } = {}) {
  if (!item) return;
  activeTeachingNavigationId = item.id;
  activeTeachingView = 'navigation';
  selectedTeachingCourseId = null;
  activeTeachingCourseSection = 'overview';
  persistTeachingLocation();
  setMenuOpen(false, { restoreFocus: false });
  renderSectionMenu();

  if (typeof item.onSelect === 'function') {
    item.onSelect();
  } else if (item.href) {
    window.location.assign(item.href);
    return;
  }

  window.scrollTo({ top: 0, behavior: scrollBehavior });
}

function getTeachingCourse(courseId) {
  return teachingWorkspace.courses.find((course) => String(course.course_id) === String(courseId)) || null;
}

function sortedCourseSections() {
  return [...teachingCourseSections.values()].sort((a, b) => {
    const order = Number(a.order || 100) - Number(b.order || 100);
    return order || a.label.localeCompare(b.label);
  });
}

function navigateTeaching(view) {
  const options = arguments[1] || {};
  activeTeachingNavigationId = null;
  const next = ['overview', 'intake', 'course'].includes(view) ? view : 'overview';
  if (next === 'course') {
    const courseId = options.courseId || selectedTeachingCourseId;
    if (!courseId || !getTeachingCourse(courseId)) {
      activeTeachingView = 'overview';
      selectedTeachingCourseId = null;
      activeTeachingCourseSection = 'overview';
    } else {
      activeTeachingView = 'course';
      selectedTeachingCourseId = courseId;
      activeTeachingCourseSection = options.sectionId || activeTeachingCourseSection || 'overview';
    }
  } else {
    activeTeachingView = next;
    if (next !== 'course') activeTeachingCourseSection = 'overview';
  }

  persistTeachingLocation();

  setMenuOpen(false, { restoreFocus: false });
  renderSectionMenu();
  renderActiveTeachingView();
  window.scrollTo({ top: 0, behavior: options.preserveScroll ? 'auto' : 'smooth' });
}

function registerTeachingCourseSection(item) {
  if (!item || typeof item.id !== 'string' || !item.id.trim()) {
    throw new TypeError('Teaching course sections require a stable string id.');
  }
  if (typeof item.label !== 'string' || !item.label.trim() || typeof item.render !== 'function') {
    throw new TypeError('Teaching course sections require a label and render function.');
  }
  teachingCourseSections.set(item.id, Object.freeze({
    id: item.id,
    label: item.label,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : 100,
    render: item.render,
    renderSummary: typeof item.renderSummary === 'function' ? item.renderSummary : null,
  }));
  if (activeTeachingView === 'course' && selectedTeachingCourseId && teachingWorkspace.courses.length) {
    queueMicrotask(() => renderCourseWorkspace());
  }
  return () => {
    teachingCourseSections.delete(item.id);
    if (activeTeachingCourseSection === item.id) activeTeachingCourseSection = 'overview';
    if (activeTeachingView === 'course') queueMicrotask(() => renderCourseWorkspace());
  };
}

async function openTeachingCourse(courseId, sectionId = 'overview') {
  const course = getTeachingCourse(courseId);
  if (!course) return;
  if (sectionId === 'overview' && !course.information_overview) {
    try {
      course.information_overview = await kiwiApiRequest(`/teaching/information/courses/${encodeURIComponent(courseId)}/overview`);
    } catch {
      // The core Course remains available when optional consolidated information is unavailable.
    }
  }
  navigateTeaching('course', { courseId, sectionId });
}

function openTeachingCourseSection(sectionId) {
  if (!selectedTeachingCourseId) return;
  if (sectionId !== 'overview' && !teachingCourseSections.has(sectionId)) return;
  activeTeachingCourseSection = sectionId;
  persistTeachingLocation();
  renderCourseWorkspace();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCourseCards(container) {
  container.replaceChildren();
  if (!teachingWorkspace.courses.length) {
    container.append(el('div', 'teaching-empty', 'No courses yet. Create one from an existing KIWI Subject when you are ready to start learning.'));
    return;
  }

  for (const course of teachingWorkspace.courses) {
    const card = el('article', 'teaching-course-card');
    teachingDisplay.decorateCourse?.(card, course);
    const copy = el('div', 'teaching-course-card__copy');
    copy.append(
      el('span', 'teaching-course-card__state', course.lifecycle_state || 'Draft'),
      el('h3', '', displayCourseName(course.title)),
    );
    const details = el('p');
    if (course.current_topic) details.append(el('span', 'teaching-course-card__line', `Current · ${course.current_topic}`));
    if (course.teacher?.displayName) details.append(el('span', 'teaching-course-card__line', `Teacher · ${course.teacher.displayName}`));
    if (!details.childElementCount) details.append(el('span', 'teaching-course-card__line', 'Course details are ready inside the workspace.'));
    copy.append(details);
    const open = el('button', 'teaching-course-card__open', 'Open course →');
    open.type = 'button';
    open.setAttribute('aria-label', `Open ${displayCourseName(course.title, 'Teaching course')}`);
    open.addEventListener('click', async () => {
      open.disabled = true;
      await openTeachingCourse(course.course_id);
      if (open.isConnected) open.disabled = false;
    });
    const actions = el('div', 'teaching-course-card__actions');
    actions.append(open);
    if (course.teacher) {
      const teacher = el('button', 'teaching-course-card__teacher', 'Teacher');
      teacher.type = 'button';
      teacher.addEventListener('click', () => openTeachingCourse(course.course_id, 'teacher'));
      actions.append(teacher);
    }
    card.append(copy, actions);
    container.append(card);
  }
}

function renderCourseSectionNav(container, course) {
  const items = [{ id: 'overview', label: 'Overview' }, ...sortedCourseSections()];
  container.replaceChildren();
  for (const item of items) {
    const button = el('button', 'teaching-course-nav__item', item.label);
    button.type = 'button';
    button.dataset.active = activeTeachingCourseSection === item.id ? 'true' : 'false';
    button.setAttribute('aria-current', activeTeachingCourseSection === item.id ? 'page' : 'false');
    button.addEventListener('click', () => openTeachingCourseSection(item.id));
    container.append(button);
  }
  container.setAttribute('aria-label', `${displayCourseName(course.title, 'Course')} navigation`);
}

function renderCourseOverview(course, container) {
  const information = course.information_overview || {};
  if (information.currentTopic || information.nextClass || information.teacher) {
    const position = el('section', 'teaching-course-position');
    const values = [
      ['Current topic', information.currentTopic || 'Course plan'],
      ['Next class', information.nextClass?.title || 'No class scheduled'],
      ['Teacher', information.teacher?.displayName || course.teacher?.displayName || 'Teacher setup'],
    ];
    for (const [label, value] of values) {
      const fact = el('div', 'teaching-course-position__item');
      fact.append(el('small', '', label), el('strong', '', value));
      position.append(fact);
    }
    container.append(position);
  }
  const intro = el('section', 'teaching-course-overview-card');
  const head = el('div', 'teaching-course-overview-card__head');
  const title = el('div');
  title.append(
    el('div', 'teaching-kicker', 'Course overview'),
    el('h2', '', 'Your course workspace')
  );
  head.append(title, el('span', 'teaching-course-card__state', course.lifecycle_state || 'Draft'));
  intro.append(
    head,
    el('p', '', 'Everything for this course stays together here—its academic plan, teaching work, results, and future course tools.')
  );
  const facts = el('div', 'teaching-course-facts');
  facts.append(
    el('div', 'teaching-course-fact', `${course.source_item_count || 0} source items`),
    el('div', 'teaching-course-fact', 'Versioned academic plan'),
    el('div', 'teaching-course-fact', 'Evidence stays separate from self-report')
  );
  intro.append(facts);
  container.append(intro);

  const summaries = sortedCourseSections().filter((item) => item.renderSummary);
  if (!summaries.length) return;

  const section = el('section', 'teaching-course-feature-section');
  const heading = el('div', 'teaching-course-feature-section__head');
  heading.append(
    el('div', 'teaching-kicker', 'Course tools'),
    el('h2', '', 'Everything attached to this course')
  );
  section.append(heading);
  const grid = el('div', 'teaching-course-feature-grid');
  section.append(grid);
  container.append(section);

  for (const item of summaries) {
    const slot = el('div', 'teaching-course-feature-slot');
    grid.append(slot);
    Promise.resolve(item.renderSummary({
      course,
      container: slot,
      openSection: () => openTeachingCourseSection(item.id),
    })).catch((error) => {
      slot.replaceChildren(el('div', 'teaching-message', error?.message || `${item.label} could not be loaded.`));
      slot.firstElementChild.dataset.kind = 'error';
    });
  }
}

function renderCourseWorkspace() {
  const main = document.getElementById('teachingApp');
  if (!main) return;
  const course = getTeachingCourse(selectedTeachingCourseId);
  if (!course) {
    activeTeachingView = 'overview';
    selectedTeachingCourseId = null;
    activeTeachingCourseSection = 'overview';
    persistTeachingLocation();
    renderSectionMenu();
    renderTeachingOverview();
    return;
  }

  const page = el('section', 'teaching-view teaching-course-shell');
  const context = el('div', 'teaching-course-context');
  const back = el('button', 'teaching-course-back', '← All courses');
  back.type = 'button';
  back.addEventListener('click', () => navigateTeaching('overview'));
  const identity = el('div', 'teaching-course-context__identity');
  identity.append(
    el('div', 'teaching-kicker', 'Teaching course'),
    el('h1', '', displayCourseName(course.title)),
    el('p', '', `${course.source_item_count || 0} preserved source item${course.source_item_count === 1 ? '' : 's'} · ${String(course.lifecycle_state || 'Draft').replaceAll('_', ' ')}`)
  );
  context.append(back, identity);

  const courseNav = el('nav', 'teaching-course-nav');
  renderCourseSectionNav(courseNav, course);
  const content = el('div', 'teaching-course-content');
  page.append(context, courseNav, content);
  main.replaceChildren(page);

  if (activeTeachingCourseSection === 'overview') {
    renderCourseOverview(course, content);
    return;
  }

  const section = teachingCourseSections.get(activeTeachingCourseSection);
  if (!section) {
    activeTeachingCourseSection = 'overview';
    renderCourseSectionNav(courseNav, course);
    renderCourseOverview(course, content);
    return;
  }

  Promise.resolve(section.render({
    course,
    container: content,
    openOverview: () => openTeachingCourseSection('overview'),
  })).catch((error) => {
    content.replaceChildren();
    const failure = el('div', 'teaching-message', error?.message || `${section.label} could not be loaded.`);
    failure.dataset.kind = 'error';
    content.append(failure);
  });
}
function renderTeachingOverview() {
  const main = document.getElementById('teachingApp');
  if (!main) return;

  const page = el('section', 'teaching-view');
  const hero = el('div', 'teaching-hero');
  const heroContent = el('div', 'teaching-hero__content');
  heroContent.append(
    el('div', 'teaching-kicker', 'KIWI Teaching'),
    el('h1', 'teaching-title', 'Build a course around what you need to learn.'),
    el('p', 'teaching-lead', 'Start from a KIWI Subject, add useful context about how you learn, and keep the plan, evidence, and course history together.')
  );
  const actions = el('div', 'teaching-hero__actions');
  const start = el('button', 'teaching-button teaching-button--primary', 'Create Course');
  start.type = 'button';
  start.addEventListener('click', () => navigateTeaching('intake'));
  actions.append(start);
  heroContent.append(actions);

  const snapshot = el('aside', 'teaching-hero__aside');
  snapshot.append(el('div', 'teaching-hero__aside-label', 'Workspace'));
  const stats = el('div', 'teaching-hero__stats');
  const courseStat = el('div', 'teaching-hero__stat');
  courseStat.append(el('strong', '', String(teachingWorkspace.courses.length)), el('span', '', teachingWorkspace.courses.length === 1 ? 'course' : 'courses'));
  const subjectStat = el('div', 'teaching-hero__stat');
  subjectStat.append(el('strong', '', String(teachingWorkspace.subjects.length)), el('span', '', teachingWorkspace.subjects.length === 1 ? 'KIWI Subject' : 'KIWI Subjects'));
  stats.append(courseStat, subjectStat);
  snapshot.append(
    stats,
    el('p', 'teaching-hero__aside-note', 'Course plans and future teaching tools stay attached to the course they belong to.')
  );
  hero.append(heroContent, snapshot);
  page.append(hero);

  const section = el('section', 'teaching-section');
  const head = el('div', 'teaching-section__head');
  const heading = el('div');
  heading.append(el('div', 'teaching-kicker', 'Courses'), el('h2', '', 'Your courses'));
  head.append(heading);
  const grid = el('div', 'teaching-course-grid');
  renderCourseCards(grid);
  section.append(head, grid);
  page.append(section);
  main.replaceChildren(page);
}

function addField(container, { label, id, placeholder, textarea = false, help = '' }) {
  const field = el('div', 'teaching-field');
  const labelNode = el('label', '', label);
  labelNode.htmlFor = id;
  const input = el(textarea ? 'textarea' : 'input');
  input.id = id;
  input.placeholder = placeholder;
  if (textarea) input.maxLength = 16384;
  field.append(labelNode, input);
  if (help) field.append(el('small', '', help));
  container.append(field);
  return input;
}

function renderIntakeSuccess(course, extractionStatus, intakeSignals) {
  const main = document.getElementById('teachingApp');
  if (!main) return;
  const page = el('section', 'teaching-view teaching-success');
  page.append(
    el('div', 'teaching-success__mark', '✓'),
    el('div', 'teaching-kicker', 'Draft course created'),
    el('h2', '', displayCourseName(course.title, 'Your course is ready for its next step')),
    el('p', '', extractionStatus === 'ROUTE_HELD_UNTIL_D30'
      ? 'Your original Intake is preserved. AI interpretation remains safely held until Teaching routes complete qualification.'
      : 'Your Intake and its planning signals were saved without treating self-report as academic evidence.')
  );
  const openCourse = el('button', 'teaching-button teaching-button--primary', 'Open course');
  openCourse.type = 'button';
  openCourse.addEventListener('click', () => openTeachingCourse(course.course_id));
  const home = el('button', 'teaching-button', 'Back to overview');
  home.type = 'button';
  home.addEventListener('click', () => navigateTeaching('overview'));
  const readiness = el('button', 'teaching-button', 'Check the next course step');
  readiness.type = 'button';
  const message = el('div');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  readiness.addEventListener('click', async () => {
    readiness.disabled = true;
    try {
      const plan = await kiwiApiRequest(`/teaching/courses/${course.course_id}/diagnostic-plan`, {
        method: 'POST',
        body: {
          intakeSignals: {
            academic_self_report: {
              prior_exposure: intakeSignals.priorExperience,
              weaknesses: intakeSignals.difficultAreas,
            },
            diagnostic_targets: [],
          },
        },
      });
      showSetupMessage(message, plan.requirement_state === 'NOT_REQUIRED'
        ? 'No material uncertainty needs a placement Diagnostic.'
        : 'A focused, non-graded Diagnostic is the next course step.');
    } catch (error) {
      showSetupMessage(message, error.code === 'TEACHING_ROUTE_UNQUALIFIED'
        ? 'Course readiness is preserved, but Teaching AI execution remains held until D30 qualification.'
        : error.message, 'error');
    } finally {
      readiness.disabled = false;
    }
  });
  const actions = el('div', 'teaching-hero__actions');
  actions.style.justifyContent = 'center';
  actions.append(openCourse, home, readiness);
  page.append(actions, message);
  main.replaceChildren(page);
}

function renderCourseIntake() {
  const main = document.getElementById('teachingApp');
  if (!main) return;

  const page = el('section', 'teaching-view');
  const header = el('header', 'teaching-intake-header');
  header.append(
    el('div', 'teaching-kicker', 'Stage 1 · Course Intake'),
    el('h1', 'teaching-title', 'Create a course.'),
    el('p', 'teaching-lead', 'Choose the KIWI Subject you want to learn and add any context that can help Teaching adapt how it explains, practises, and supports you.')
  );
  page.append(header);

  const steps = el('ol', 'teaching-stepbar');
  for (const [number, label] of [['01', 'Choose subject'], ['02', 'Add context'], ['03', 'Create draft']]) {
    const step = el('li', 'teaching-step');
    step.dataset.active = number === '01' ? 'true' : 'false';
    step.append(el('span', 'teaching-step__number', number), el('span', '', label));
    steps.append(step);
  }
  page.append(steps);

  const layout = el('div', 'teaching-intake-layout');
  const aside = el('aside', 'teaching-intake-aside');
  aside.append(
    el('div', 'teaching-kicker', 'How this works'),
    el('h2', '', 'Tell KIWI how to teach you.'),
    el('p', '', 'Your context can change how Teaching explains and where it pays attention. It never counts as proof of mastery or lowers the academic standard.')
  );
  const assurance = el('div', 'teaching-assurance');
  for (const copy of ['Starts from one KIWI Subject', 'Keeps your own wording', 'Keeps self-report separate from evidence']) {
    const item = el('div', 'teaching-assurance__item');
    item.append(el('span', 'teaching-assurance__mark', '✓'), el('span', '', copy));
    assurance.append(item);
  }
  aside.append(assurance);

  const form = el('form', 'teaching-form');
  form.noValidate = true;
  const subjectSection = el('section', 'teaching-form__section');
  subjectSection.append(
    el('h2', '', 'Choose your KIWI Subject'),
    el('p', '', 'This becomes the academic source for the course.')
  );
  const subjectField = el('div', 'teaching-field');
  const subjectLabel = el('label', '', 'KIWI Subject');
  subjectLabel.htmlFor = 'teachingSubject';
  const select = el('select');
  select.id = 'teachingSubject';
  select.required = true;
  select.append(new Option(teachingWorkspace.subjects.length ? 'Select a Subject' : 'Create a KIWI Subject first', ''));
  for (const subject of teachingWorkspace.subjects) {
    select.append(new Option(`${displayCourseName(subject.name, 'Untitled subject')} · ${subject.total_cards || 0} cards`, subject.id));
  }
  subjectField.append(subjectLabel, select, el('small', '', 'Need a new Subject? Create it in the KIWI study app first.'));
  subjectSection.append(subjectField);

  const contextSection = el('section', 'teaching-form__section');
  contextSection.append(
    el('h2', '', 'Add context for your teacher'),
    el('p', '', 'Everything here is optional. Add only what would genuinely help Teaching support you.')
  );
  const textarea = addField(contextSection, {
    label: 'Anything your teacher should know before this course begins?',
    id: 'teachingIntakeText',
    placeholder: 'For example: I learn better from worked examples, graphs are difficult for me, or I have studied vectors before.',
    textarea: true,
    help: 'Your own words are preserved exactly as source context.',
  });
  const grid = el('div', 'teaching-grid');
  const fields = [
    ['Learning preferences', 'teachingPreferences', 'worked examples, slower explanations'],
    ['Difficult areas', 'teachingDifficult', 'graphs, trigonometry'],
    ['Prior experience', 'teachingPrior', 'vectors, algebra'],
    ['Known strengths', 'teachingStrengths', 'mental arithmetic'],
    ['Goals', 'teachingGoals', 'prepare for WAEC'],
    ['Important deadlines', 'teachingDeadlines', 'exam in November'],
  ];
  for (const [label, id, placeholder] of fields) addField(grid, { label, id, placeholder });
  contextSection.append(grid);

  const footer = el('footer', 'teaching-form__footer');
  const submit = el('button', 'teaching-submit', 'Create course draft');
  submit.type = 'submit';
  submit.disabled = !teachingWorkspace.subjects.length;
  const message = el('div');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  footer.append(submit, message);
  form.append(subjectSection, contextSection, footer);
  layout.append(aside, form);
  page.append(layout);
  main.replaceChildren(page);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!select.value) {
      showSetupMessage(message, 'Choose an existing KIWI Subject.', 'error');
      select.focus();
      return;
    }

    submit.disabled = true;
    showSetupMessage(message, 'Creating the draft and preserving its source inventory…');
    try {
      const course = await kiwiApiRequest('/teaching/courses', {
        method: 'POST',
        body: { subjectId: select.value },
      });
      const intakeSignals = {
        originalFreeFormText: textarea.value,
        learningPreferences: splitSignals(document.getElementById('teachingPreferences').value),
        difficultAreas: splitSignals(document.getElementById('teachingDifficult').value),
        priorExperience: splitSignals(document.getElementById('teachingPrior').value),
        knownStrengths: splitSignals(document.getElementById('teachingStrengths').value),
        goals: splitSignals(document.getElementById('teachingGoals').value),
        importantDeadlines: splitSignals(document.getElementById('teachingDeadlines').value),
      };
      const result = await kiwiApiRequest(`/teaching/courses/${course.course_id}/intake`, {
        method: 'POST',
        body: intakeSignals,
      });
      teachingWorkspace.courses.push(course);
      renderIntakeSuccess(course, result.extractionStatus, intakeSignals);
    } catch (error) {
      showSetupMessage(message, error.message, 'error');
      submit.disabled = false;
    }
  });
}

function renderActiveTeachingView() {
  if (activeTeachingView === 'intake') renderCourseIntake();
  else if (activeTeachingView === 'course') renderCourseWorkspace();
  else renderTeachingOverview();
}

async function loadTeachingWorkspace() {
  const [subjects, baseCourses, information] = await Promise.all([
    kiwiApiRequest('/teaching/subjects'),
    kiwiApiRequest('/teaching/courses'),
    kiwiApiRequest('/teaching/information/courses').catch(() => ({ courses: [] })),
  ]);
  const details = new Map((information.courses || []).map((course) => [String(course.courseId), course]));
  const courses = baseCourses.map((course) => {
    const detail = details.get(String(course.course_id));
    return detail ? {
      ...course,
      title: detail.title || course.title,
      lifecycle_state: detail.lifecycleState || course.lifecycle_state,
      current_topic: detail.currentTopic || null,
      next_event: detail.nextEvent || null,
      teacher: detail.teacher || null,
    } : course;
  });
  teachingWorkspace = { subjects, courses };
  const restoredCourse = pendingTeachingLocation?.view === 'course'
    ? getTeachingCourse(pendingTeachingLocation.courseId)
    : null;
  if (restoredCourse && pendingTeachingLocation.sectionId === 'overview') {
    restoredCourse.information_overview = await kiwiApiRequest(`/teaching/information/courses/${encodeURIComponent(restoredCourse.course_id)}/overview`).catch(() => null);
  }
}

async function refreshTeachingWorkspace({ preserveView = true } = {}) {
  const courseId = selectedTeachingCourseId;
  await loadTeachingWorkspace();
  if (courseId && !getTeachingCourse(courseId)) {
    selectedTeachingCourseId = null;
    activeTeachingCourseSection = 'overview';
    activeTeachingView = 'overview';
    persistTeachingLocation();
  }
  renderSectionMenu();
  renderActiveTeachingView();
  if (!preserveView) window.scrollTo({ top: 0, behavior: 'smooth' });
  return teachingWorkspace;
}

async function verifyTeachingSession() {
  if (!hasKiwiSession()) {
    renderTeachingSessionProblem();
    return false;
  }

  try {
    await kiwiApiRequest('/teaching/status');
    await loadTeachingWorkspace();
    if (restoreTeachingLocation()) return true;
    renderSectionMenu();
    renderActiveTeachingView();
    return true;
  } catch (error) {
    renderTeachingSessionProblem(
      error?.status === 401
        ? 'Your KIWI session has expired. Return to KIWI and sign in again.'
        : 'KIWI could not verify your session. Return to KIWI and try again.'
    );
    return false;
  }
}

function initTeachingDocument() {
  suppressVercelToolbar();
  renderTeachingNavigation();
  installTeachingHistoryGuard();

  const menuButton = document.getElementById('teachingMenuButton');
  const brand = document.querySelector('.teaching-brand');
  const menuClose = document.getElementById('teachingMenuClose');
  const overlay = document.getElementById('teachingOverlay');
  const settingsButton = document.getElementById('teachingSettingsButton');
  const settingsClose = document.getElementById('teachingSettingsClose');
  const switchButton = document.getElementById('teachingSwitchToKiwiButton');
  const confirmDialog = document.getElementById('teachingConfirmDialog');
  const confirmCancel = document.getElementById('teachingConfirmCancel');
  const confirmAccept = document.getElementById('teachingConfirmAccept');

  menuButton?.addEventListener('click', () => setMenuOpen(true));
  brand?.addEventListener('click', (event) => {
    event.preventDefault();
    navigateTeaching('overview');
  });
  menuClose?.addEventListener('click', () => setMenuOpen(false));
  overlay?.addEventListener('click', closeActiveOverlay);

  settingsButton?.addEventListener('click', () => {
    setMenuOpen(false, { restoreFocus: false });
    setSettingsOpen(true);
  });

  settingsClose?.addEventListener('click', () => {
    setSettingsOpen(false);
    document.getElementById('teachingMenuButton')?.focus();
  });

  switchButton?.addEventListener('click', requestSwitchToKiwi);

  confirmCancel?.addEventListener('click', () => {
    confirmDialog?.close();
    document.getElementById('teachingMenuButton')?.focus();
  });

  confirmAccept?.addEventListener('click', () => {
    confirmDialog?.close();
    window.location.assign(KIWI_PATH);
  });

  confirmDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    confirmDialog.close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !confirmDialog?.open) {
      closeActiveOverlay();
    }
  });

  verifyTeachingSession().catch(() => {});
}

window.KIWITeachingNavigation = Object.freeze({
  register: registerTeachingNavigationItem,
  unregister: unregisterTeachingNavigationItem,
  render: renderTeachingNavigation,
  ids: () => Array.from(teachingNavigationItems.keys()),
  open: (id) => { const item = teachingNavigationItems.get(id); if (item) selectTeachingNavigationItem(item); },
});

window.KIWITeachingCourses = Object.freeze({
  registerSection: registerTeachingCourseSection,
  openCourse: openTeachingCourse,
  openSection: openTeachingCourseSection,
  openOverview: () => navigateTeaching('overview'),
  currentCourseId: () => selectedTeachingCourseId,
  getCourse: (courseId) => getTeachingCourse(courseId),
  sectionIds: () => Array.from(teachingCourseSections.keys()),
  all: () => teachingWorkspace.courses.slice(),
  refresh: refreshTeachingWorkspace,
});

function init() {
  if (!isTeachingDocument()) return;
  initTeachingDocument();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
