const app = document.getElementById('teachingApp');
if (!app) throw new Error('D24 accessibility layer requires the accepted Teaching shell.');

document.body.classList.add('teaching-d24');

const live = document.createElement('div');
live.id = 'teachingA11yStatus';
live.className = 'teaching-visually-hidden';
live.setAttribute('role', 'status');
live.setAttribute('aria-live', 'polite');
live.setAttribute('aria-atomic', 'true');
document.body.append(live);

function announce(message) {
  live.textContent = '';
  window.setTimeout(() => { live.textContent = String(message || ''); }, 20);
}

function focusWorkspace() {
  const heading = app.querySelector('h1, h2');
  const target = heading || app;
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  announce(heading?.textContent || 'Teaching workspace updated');
}

function decorate() {
  app.setAttribute('role', 'main');
  app.querySelectorAll('.teaching-kicker, .ti-eyebrow').forEach((node) => node.setAttribute('aria-hidden', 'true'));
  app.querySelectorAll('[data-state], [data-status], [data-kind]').forEach((node) => {
    const state = node.dataset.state || node.dataset.status || node.dataset.kind;
    if (state && !node.getAttribute('aria-label') && !node.textContent.trim()) node.setAttribute('aria-label', String(state).replaceAll('_', ' '));
  });
  // These containers remain navigation landmarks. Horizontal arrow-key behavior is implemented below without aria-orientation, which is not supported on the navigation role.
}

const observer = new MutationObserver(decorate);
observer.observe(app, { childList: true, subtree: true });
decorate();

const menuPanel = document.getElementById('teachingMenuPanel');
const settingsPanel = document.getElementById('teachingSettingsPanel');
const menuTrigger = document.getElementById('teachingMenuButton');
const drawerEntries = [
  { panel: menuPanel, fallback: menuTrigger, returnFocus: menuTrigger },
  { panel: settingsPanel, fallback: menuTrigger, returnFocus: menuTrigger },
].filter((entry) => entry.panel);

function drawerOpen(panel) {
  return panel?.dataset?.open === 'true' && panel.getAttribute('aria-hidden') !== 'true';
}

function syncDrawer(entry) {
  const { panel } = entry;
  const open = drawerOpen(panel);
  panel.setAttribute('role', 'dialog');
  if (open) {
    panel.removeAttribute('inert');
    panel.setAttribute('aria-modal', 'true');
    return;
  }
  panel.removeAttribute('aria-modal');
  if (panel.contains(document.activeElement)) {
    const target = entry.returnFocus?.isConnected ? entry.returnFocus : entry.fallback;
    target?.focus?.({ preventScroll: true });
  }
  panel.setAttribute('inert', '');
}

for (const entry of drawerEntries) syncDrawer(entry);

const drawerObserver = new MutationObserver((records) => {
  const changed = new Set(records.map((record) => record.target));
  for (const entry of drawerEntries) if (changed.has(entry.panel)) syncDrawer(entry);
});
for (const entry of drawerEntries) {
  drawerObserver.observe(entry.panel, { attributes: true, attributeFilter: ['data-open', 'aria-hidden'] });
}

function focusableWithin(panel) {
  return [...panel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hasAttribute('inert') && node.getClientRects().length > 0);
}

function trapDrawerFocus(event, panel) {
  if (event.key !== 'Tab') return false;
  const items = focusableWithin(panel);
  if (!items.length) {
    event.preventDefault();
    panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!panel.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function handleClassroomTabs(event) {
  const tab = event.target.closest('.tc-mobile-tabs [role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  const tablist = tab.closest('[role="tablist"]');
  const tabs = [...(tablist?.querySelectorAll('[role="tab"]') || [])].filter((item) => !item.disabled);
  if (!tabs.length) return false;
  const current = Math.max(0, tabs.indexOf(tab));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
    (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].click();
  return true;
}

// Remove inert in the capture phase so the original shell can move focus into a
// drawer synchronously when its own click handler opens it. MutationObserver
// then keeps the state aligned for every subsequent open/close transition.
document.addEventListener('click', (event) => {
  const menuOpener = event.target.closest('#teachingMenuButton, .teaching-dock__item[data-menu="true"]');
  if (menuOpener && menuPanel) {
    const entry = drawerEntries.find((candidate) => candidate.panel === menuPanel);
    if (entry) entry.returnFocus = menuOpener;
    menuPanel.removeAttribute('inert');
  }
  if (event.target.closest('#teachingSettingsButton') && settingsPanel) {
    const entry = drawerEntries.find((candidate) => candidate.panel === settingsPanel);
    if (entry) entry.returnFocus = menuTrigger;
    settingsPanel.removeAttribute('inert');
  }
}, true);

document.addEventListener('click', (event) => {
  const control = event.target.closest('.teaching-dock__item, .teaching-menu-link, .teaching-course-nav__item');
  if (control && control.dataset.menu !== 'true') window.setTimeout(focusWorkspace, 0);
});

document.addEventListener('keydown', (event) => {
  const menu = document.getElementById('teachingMenuPanel');
  const settings = document.getElementById('teachingSettingsPanel');
  const openDrawer = drawerOpen(settings) ? settings : drawerOpen(menu) ? menu : null;
  if (openDrawer && trapDrawerFocus(event, openDrawer)) return;
  if (event.key === 'Escape') {
    if (drawerOpen(settings)) document.getElementById('teachingSettingsClose')?.click();
    else if (drawerOpen(menu)) document.getElementById('teachingMenuClose')?.click();
  }
  if (handleClassroomTabs(event)) return;
  const nav = event.target.closest('.teaching-course-nav, .teaching-dock');
  if (!nav || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const items = [...nav.querySelectorAll('button:not(:disabled), a[href]')];
  if (!items.length) return;
  const current = Math.max(0, items.indexOf(event.target.closest('button, a')));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
    (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  items[next].focus();
});

window.KIWITeachingAccessibility = Object.freeze({ announce, focusWorkspace, syncDrawer: () => drawerEntries.forEach(syncDrawer) });

// D25 is deliberately layered after the accepted D24 accessibility system so
// degraded/recovery states inherit the same focus, live-region and responsive
// behavior without making D24 or browser state an academic owner.
if (!document.querySelector('link[data-teaching-d25]')) {
  const reliabilityStyles = document.createElement('link');
  reliabilityStyles.rel = 'stylesheet';
  reliabilityStyles.href = '/teaching-d25.css?v=20261003-d25-1';
  reliabilityStyles.dataset.teachingD25 = 'true';
  document.head.append(reliabilityStyles);
}
if (!document.querySelector('script[data-teaching-d25]')) {
  const reliabilityScript = document.createElement('script');
  reliabilityScript.src = '/teaching-d25-reliability.js?v=20261003-d25-1';
  reliabilityScript.dataset.teachingD25 = 'true';
  reliabilityScript.defer = true;
  document.body.append(reliabilityScript);
}
