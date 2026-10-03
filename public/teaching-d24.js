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
  document.querySelectorAll('.teaching-course-nav, .teaching-dock').forEach((nav) => nav.setAttribute('aria-orientation', 'horizontal'));
}

const observer = new MutationObserver(decorate);
observer.observe(app, { childList: true, subtree: true });
decorate();

document.addEventListener('click', (event) => {
  if (event.target.closest('.teaching-dock__item, .teaching-menu-link, .teaching-course-nav__item')) {
    window.setTimeout(focusWorkspace, 0);
  }
});

document.addEventListener('keydown', (event) => {
  const menu = document.getElementById('teachingMenuPanel');
  const settings = document.getElementById('teachingSettingsPanel');
  if (event.key === 'Escape') {
    if (settings?.dataset.open === 'true') document.getElementById('teachingSettingsClose')?.click();
    else if (menu?.dataset.open === 'true') document.getElementById('teachingMenuClose')?.click();
  }
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

window.KIWITeachingAccessibility = Object.freeze({ announce, focusWorkspace });
