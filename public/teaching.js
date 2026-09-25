const { kiwiApiRequest, hasKiwiSession } = window.KIWI_API_CLIENT || {};

if (typeof kiwiApiRequest !== 'function' || typeof hasKiwiSession !== 'function') {
  throw new Error('KIWI shared API client must load before Teaching.');
}

// KIWI Teaching app entry + KIWI dashboard bridge.
// Teaching has its own shell while remaining connected to KIWI's shared backend/core.

const TEACHING_PATH = '/teaching.html';
const KIWI_PATH = '/';
const TEACHING_STATUS_TTL_MS = 15_000;

const teachingNavigationItems = new Map();
let teachingStatusCache = null;
let teachingStatusCacheAt = 0;
let teachingStatusPromise = null;

function isTeachingDocument() {
  return document.documentElement?.dataset?.app === 'kiwi-teaching'
    || document.body?.dataset?.app === 'kiwi-teaching';
}

async function getTeachingStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && teachingStatusCache && now - teachingStatusCacheAt < TEACHING_STATUS_TTL_MS) {
    return teachingStatusCache;
  }

  if (!force && teachingStatusPromise) return teachingStatusPromise;

  teachingStatusPromise = kiwiApiRequest('/teaching/status')
    .then((status) => {
      teachingStatusCache = status;
      teachingStatusCacheAt = Date.now();
      return status;
    })
    .finally(() => {
      teachingStatusPromise = null;
    });

  return teachingStatusPromise;
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

function renderTeachingUnavailable({ signedIn, message } = {}) {
  const main = document.getElementById('teachingApp');
  if (!main) return;

  main.innerHTML = `
    <section style="min-height:62vh;display:grid;place-items:center;padding:24px 0;">
      <div style="width:min(520px,100%);text-align:center;">
        <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;margin-bottom:10px;">
          KIWI Teaching is not available for this account yet
        </div>
        <div style="font-size:14px;line-height:1.65;color:var(--teaching-muted);margin-bottom:20px;">
          ${message || (signedIn
            ? 'Teaching is currently limited to approved development and test users.'
            : 'Sign in to KIWI first, then open Teaching from the KIWI dashboard.')}
        </div>
        <button id="teachingUnavailableBack" class="teaching-menu-action" type="button" style="width:auto;margin:0 auto;">
          <span>Back to KIWI</span>
        </button>
      </div>
    </section>
  `;

  document.getElementById('teachingUnavailableBack')?.addEventListener('click', () => {
    window.location.assign(KIWI_PATH);
  });
}

async function bootstrapTeachingAccess() {
  if (!hasKiwiSession()) {
    renderTeachingUnavailable({ signedIn: false });
    return false;
  }

  try {
    const status = await getTeachingStatus({ force: true });
    if (!status?.available) {
      renderTeachingUnavailable({ signedIn: true });
      return false;
    }
    return true;
  } catch (error) {
    renderTeachingUnavailable({
      signedIn: true,
      message: error?.status === 401
        ? 'Your KIWI session has expired. Return to KIWI and sign in again.'
        : 'KIWI could not verify Teaching access. Return to KIWI and try again.',
    });
    return false;
  }
}

function initTeachingDocument() {
  suppressVercelToolbar();
  renderTeachingNavigation();

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

  bootstrapTeachingAccess().catch(() => {});
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

async function ensureDashboardTeachingSwitch() {
  if (isTeachingDocument()) return;

  const main = document.getElementById('mainContent');
  if (!main) return;

  const dashboardGrid = main.querySelector('.dashboard-grid');
  const pageWrap = dashboardGrid?.closest('.page-wrap');

  if (!dashboardGrid || !pageWrap) return;

  let status;
  try {
    status = await getTeachingStatus();
  } catch (_) {
    pageWrap.querySelector('#kiwiTeachingSwitch')?.remove();
    return;
  }

  // The page may have changed while the network request was in flight.
  if (!main.querySelector('.dashboard-grid') || !pageWrap.isConnected) return;

  const existing = pageWrap.querySelector('#kiwiTeachingSwitch');
  if (!status?.available) {
    existing?.remove();
    return;
  }

  if (existing) {
    if (existing !== pageWrap.lastElementChild) pageWrap.appendChild(existing);
    return;
  }

  pageWrap.appendChild(createTeachingSwitch());
}

function initKiwiDashboardBridge() {
  ensureDashboardTeachingSwitch().catch(() => {});

  const main = document.getElementById('mainContent');
  if (!main) return;

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      ensureDashboardTeachingSwitch().catch(() => {});
    });
  });

  observer.observe(main, { childList: true, subtree: true });
}

window.KIWITeachingNavigation = Object.freeze({
  register: registerTeachingNavigationItem,
  unregister: unregisterTeachingNavigationItem,
  render: renderTeachingNavigation,
  ids: () => Array.from(teachingNavigationItems.keys()),
});

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
