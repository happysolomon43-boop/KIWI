// KIWI Teaching app entry + KIWI dashboard switch.
// The Teaching document is deliberately independent of KIWI's normal app shell.

const TEACHING_PATH = '/teaching.html';

function isTeachingDocument() {
  return document.documentElement?.dataset?.app === 'kiwi-teaching'
    || document.body?.dataset?.app === 'kiwi-teaching';
}

function setSettingsOpen(open) {
  const panel = document.getElementById('teachingSettingsPanel');
  const backdrop = document.getElementById('teachingSettingsBackdrop');
  const trigger = document.getElementById('teachingSettingsButton');

  if (!panel || !backdrop || !trigger) return;

  panel.dataset.open = open ? 'true' : 'false';
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  backdrop.dataset.open = open ? 'true' : 'false';
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (open) {
    document.getElementById('teachingSettingsClose')?.focus();
  } else {
    trigger.focus();
  }
}

function initTeachingDocument() {
  const settingsButton = document.getElementById('teachingSettingsButton');
  const settingsClose = document.getElementById('teachingSettingsClose');
  const settingsBackdrop = document.getElementById('teachingSettingsBackdrop');

  settingsButton?.addEventListener('click', () => setSettingsOpen(true));
  settingsClose?.addEventListener('click', () => setSettingsOpen(false));
  settingsBackdrop?.addEventListener('click', () => setSettingsOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setSettingsOpen(false);
  });
}

function switchToTeaching() {
  window.location.assign(TEACHING_PATH);
}

function requestTeachingSwitch() {
  const title = 'Switch to KIWI Teaching?';
  const message = 'You are leaving the KIWI study app and opening KIWI Teaching. Continue?';

  if (typeof window.showCustomConfirm === 'function') {
    window.showCustomConfirm(title, message, switchToTeaching);
    return;
  }

  if (window.confirm(`${title}\n\n${message}`)) {
    switchToTeaching();
  }
}

function createTeachingSwitch() {
  const wrap = document.createElement('section');
  wrap.id = 'kiwiTeachingSwitch';
  wrap.setAttribute('aria-label', 'KIWI Teaching');
  wrap.style.cssText = [
    'margin:24px 0 4px',
    'padding:0',
    'display:flex',
    'justify-content:stretch',
  ].join(';');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary';
  button.setAttribute('aria-label', 'Switch to KIWI Teaching');
  button.style.cssText = [
    'width:100%',
    'min-height:52px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:10px',
    'border-radius:16px',
    'font-weight:800',
    'letter-spacing:-0.01em',
  ].join(';');

  const label = document.createElement('span');
  label.textContent = 'Switch to KIWI Teaching';

  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  arrow.style.cssText = 'font-size:18px;line-height:1;';

  button.append(label, arrow);
  button.addEventListener('click', requestTeachingSwitch);
  wrap.appendChild(button);

  return wrap;
}

function ensureDashboardTeachingSwitch() {
  if (isTeachingDocument()) return;

  const main = document.getElementById('mainContent');
  if (!main) return;

  const dashboardGrid = main.querySelector('.dashboard-grid');
  const pageWrap = dashboardGrid?.closest('.page-wrap');

  if (!dashboardGrid || !pageWrap) return;

  const existing = pageWrap.querySelector('#kiwiTeachingSwitch');
  if (existing) {
    if (existing !== pageWrap.lastElementChild) {
      pageWrap.appendChild(existing);
    }
    return;
  }

  // Intentionally append after the Dashboard content: Teaching is a mode/app switch,
  // not a primary Dashboard action.
  pageWrap.appendChild(createTeachingSwitch());
}

function initKiwiDashboardBridge() {
  ensureDashboardTeachingSwitch();

  const main = document.getElementById('mainContent');
  if (!main) return;

  const observer = new MutationObserver(() => {
    ensureDashboardTeachingSwitch();
  });

  observer.observe(main, { childList: true, subtree: true });
}

function init() {
  if (isTeachingDocument()) {
    initTeachingDocument();
    return;
  }

  initKiwiDashboardBridge();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
