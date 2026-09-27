const { kiwiApiRequest, hasKiwiSession } = window.KIWI_API_CLIENT || {};

if (typeof kiwiApiRequest !== 'function' || typeof hasKiwiSession !== 'function') {
  throw new Error('KIWI shared API client must load before Teaching.');
}

// KIWI Teaching standalone app entry.
// The normal KIWI dashboard owns only the mode-switch control; this module owns the Teaching shell.

const KIWI_PATH = '/';
const teachingNavigationItems = new Map();

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

  dock.replaceChildren();

  for (const item of teachingNavigationItems.values()) {
    const fragment = template.content.cloneNode(true);
    const control = fragment.querySelector('.teaching-dock__item');
    const icon = fragment.querySelector('.teaching-dock__icon');
    const label = fragment.querySelector('.teaching-dock__label');

    if (!control || !icon || !label) continue;

    control.dataset.navId = item.id;
    control.setAttribute('aria-label', item.label);
    icon.textContent = item.icon || '';
    label.textContent = item.label;

    control.addEventListener('click', () => {
      if (typeof item.onSelect === 'function') {
        item.onSelect();
        return;
      }

      if (item.href) {
        window.location.assign(item.href);
      }
    });

    dock.appendChild(fragment);
  }

  shell.hidden = teachingNavigationItems.size === 0;
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
    icon: typeof item.icon === 'string' ? item.icon : '',
    href: typeof item.href === 'string' ? item.href : null,
    onSelect: typeof item.onSelect === 'function' ? item.onSelect : null,
  });

  renderTeachingNavigation();

  return () => unregisterTeachingNavigationItem(item.id);
}

function unregisterTeachingNavigationItem(id) {
  teachingNavigationItems.delete(id);
  renderTeachingNavigation();
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
function splitSignals(value) { return String(value || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 50); }
function showSetupMessage(container, message, kind = 'status') { container.replaceChildren(); const box = el('div', 'teaching-message', message); box.dataset.kind = kind; container.append(box); }
async function renderTeachingHome() {
  const main = document.getElementById('teachingApp'); if (!main) return;
  const page = el('section', 'teaching-setup');
  page.append(el('div', 'teaching-setup__eyebrow', 'Course setup'));
  page.append(el('h1', '', 'Build your first real course.'));
  page.append(el('p', 'teaching-setup__lead', 'Choose one of your existing KIWI Subjects, then tell your teacher what may help. Your comments guide planning and diagnostic attention; they never count as proof of knowledge.'));
  const progress = el('ol', 'teaching-progress');
  for (const [n,label] of [['1','Subject & intake'],['2','Curriculum audit'],['3','Targeted diagnostic']]) { const item=el('li','',`${n}. ${label}`); item.dataset.active=n==='1'?'true':'false'; progress.append(item); }
  page.append(progress);
  const existing = el('div','teaching-course-list'); page.append(existing);
  const card=el('form','teaching-card'); card.noValidate=true;
  card.append(el('h2','','Subject and Student Course Intake'));
  card.append(el('p','','Only the selected KIWI Subject is authoritative. Any added context remains separately sourced and reviewed.'));
  const subjectField=el('div','teaching-field'), subjectLabel=el('label','','KIWI Subject'); subjectLabel.htmlFor='teachingSubject';
  const select=el('select'); select.id='teachingSubject'; select.required=true; subjectField.append(subjectLabel,select); card.append(subjectField);
  const free=el('div','teaching-field'), freeLabel=el('label','','Anything your teacher should know before this Course begins?'); freeLabel.htmlFor='teachingIntakeText';
  const textarea=el('textarea'); textarea.id='teachingIntakeText'; textarea.maxLength=16384; textarea.placeholder='For example: I learn better from examples, graphs are difficult for me, or I have studied vectors before.'; free.append(freeLabel,textarea,el('small','', 'Optional. Self-report shapes planning; evidence verifies knowledge.')); card.append(free);
  const grid=el('div','teaching-grid');
  const controls=[['Preferences','teachingPreferences','example first, slower explanations'],['Difficult areas','teachingDifficult','graphs, trigonometry'],['Prior experience','teachingPrior','vectors, algebra'],['Known strengths','teachingStrengths','mental arithmetic'],['Goals','teachingGoals','prepare for WAEC'],['Important deadlines','teachingDeadlines','exam in November']];
  for(const [label,id,placeholder] of controls){const f=el('div','teaching-field'),l=el('label','',label);l.htmlFor=id;const input=el('input');input.id=id;input.placeholder=placeholder;f.append(l,input);grid.append(f);}card.append(grid);
  const submit=el('button','teaching-submit','Create Draft Course');submit.type='submit';card.append(submit);const message=el('div');message.setAttribute('role','status');message.setAttribute('aria-live','polite');card.append(message);page.append(card);main.replaceChildren(page);
  try {
    const [subjects,courses]=await Promise.all([kiwiApiRequest('/teaching/subjects'),kiwiApiRequest('/teaching/courses')]);
    select.append(new Option(subjects.length?'Select a Subject':'Create a KIWI Subject first',''));
    for(const subject of subjects)select.append(new Option(`${subject.name} · ${subject.total_cards||0} cards`,subject.id));
    if(courses.length){existing.append(el('div','teaching-setup__eyebrow','Draft and existing Courses'));for(const course of courses)existing.append(el('div','teaching-course-chip',`${course.title} · ${course.lifecycle_state} · ${course.source_item_count} source items`));}
    submit.disabled=!subjects.length;
  } catch(error){showSetupMessage(message,error.message,'error');submit.disabled=true;}
  card.addEventListener('submit',async event=>{event.preventDefault();if(!select.value)return showSetupMessage(message,'Choose an existing KIWI Subject.','error');submit.disabled=true;showSetupMessage(message,'Creating the Draft and preserving its source inventory…');try{const course=await kiwiApiRequest('/teaching/courses',{method:'POST',body:{subjectId:select.value}});const result=await kiwiApiRequest(`/teaching/courses/${course.course_id}/intake`,{method:'POST',body:{originalFreeFormText:textarea.value,learningPreferences:splitSignals(document.getElementById('teachingPreferences').value),difficultAreas:splitSignals(document.getElementById('teachingDifficult').value),priorExperience:splitSignals(document.getElementById('teachingPrior').value),knownStrengths:splitSignals(document.getElementById('teachingStrengths').value),goals:splitSignals(document.getElementById('teachingGoals').value),importantDeadlines:splitSignals(document.getElementById('teachingDeadlines').value)}});showSetupMessage(message,result.extractionStatus==='ROUTE_HELD_UNTIL_D30'?'Draft saved. Your original Intake is preserved. AI interpretation remains held until Teaching routes complete D30 qualification.':'Draft and Intake saved. Planning signals were validated.');existing.append(el('div','teaching-course-chip',`${course.title} · DRAFT`));
      const diagnosticCard=el('section','teaching-card');diagnosticCard.style.marginTop='18px';diagnosticCard.append(el('div','teaching-setup__eyebrow','Setup stage 3'),el('h2','','Targeted prerequisite diagnostic'),el('p','','KIWI checks only prior knowledge that materially affects this Course. This is non-graded and your Intake alone cannot validate knowledge.'));
      const check=el('button','teaching-submit','Check whether a Diagnostic is needed');check.type='button';const diagnosticMessage=el('div');diagnosticMessage.setAttribute('role','status');diagnosticMessage.setAttribute('aria-live','polite');diagnosticCard.append(check,diagnosticMessage);page.append(diagnosticCard);
      check.addEventListener('click',async()=>{check.disabled=true;try{const plan=await kiwiApiRequest(`/teaching/courses/${course.course_id}/diagnostic-plan`,{method:'POST',body:{intakeSignals:{academic_self_report:{prior_exposure:splitSignals(document.getElementById('teachingPrior').value),weaknesses:splitSignals(document.getElementById('teachingDifficult').value)},diagnostic_targets:[]}}});showSetupMessage(diagnosticMessage,plan.requirement_state==='NOT_REQUIRED'?'No material uncertainty needs a placement Diagnostic. You can continue without one.':'A focused, non-graded Diagnostic is ready.');}catch(error){showSetupMessage(diagnosticMessage,error.code==='TEACHING_ROUTE_UNQUALIFIED'?'A targeted Diagnostic is indicated, but Teaching AI execution remains held until D30 qualification.':error.message,'error');}finally{check.disabled=false;}});}catch(error){showSetupMessage(message,error.message,'error');}finally{submit.disabled=false;}});
}

async function verifyTeachingSession() {
  if (!hasKiwiSession()) {
    renderTeachingSessionProblem();
    return false;
  }

  try {
    await kiwiApiRequest('/teaching/status');
    await renderTeachingHome();
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
  const menuClose = document.getElementById('teachingMenuClose');
  const overlay = document.getElementById('teachingOverlay');
  const settingsButton = document.getElementById('teachingSettingsButton');
  const settingsClose = document.getElementById('teachingSettingsClose');
  const switchButton = document.getElementById('teachingSwitchToKiwiButton');
  const confirmDialog = document.getElementById('teachingConfirmDialog');
  const confirmCancel = document.getElementById('teachingConfirmCancel');
  const confirmAccept = document.getElementById('teachingConfirmAccept');

  menuButton?.addEventListener('click', () => setMenuOpen(true));
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
