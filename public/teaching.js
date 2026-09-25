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

async function verifyTeachingSession() {
  if (!hasKiwiSession()) {
    renderTeachingSessionProblem();
    return false;
  }

  try {
    await kiwiApiRequest('/teaching/status');
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
