// KIWI Teaching frontend baseline.
// Kept deliberately small: the Teaching surface will be filled in later.

let teachingActive = false;

function getMainContent() {
  return document.getElementById('mainContent');
}

function renderTeachingPage() {
  const main = getMainContent();
  if (!main) return;

  teachingActive = true;
  document.title = 'KIWI Teaching — KIWI';

  main.innerHTML = `
    <div id="kiwiTeachingPage" style="min-height:100%;padding:20px 24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px;">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--text);">
          KIWI Teaching
        </div>
        <button id="kiwiTeachingBackBtn" class="btn btn-secondary btn-sm" type="button">
          Back to KIWI
        </button>
      </div>
      <div id="kiwiTeachingRoot" aria-label="KIWI Teaching"></div>
    </div>
  `;

  document.getElementById('kiwiTeachingBackBtn')?.addEventListener('click', leaveTeaching);
}

function enterTeaching() {
  const open = () => {
    renderTeachingPage();

    // Non-blocking backend handshake. The page remains usable even if the
    // backend is temporarily waking up.
    if (typeof window.apiRequest === 'function') {
      window.apiRequest('/teaching/status').catch(() => {});
    }
  };

  if (typeof window.showCustomConfirm === 'function') {
    window.showCustomConfirm(
      'Switch to KIWI Teaching?',
      'Do you want to leave the dashboard and open KIWI Teaching?',
      open
    );
    return;
  }

  if (window.confirm('Do you want to switch to KIWI Teaching?')) open();
}

function leaveTeaching() {
  teachingActive = false;

  if (typeof window.navigateTo === 'function') {
    window.navigateTo('dashboard');
    return;
  }

  window.location.reload();
}

function ensureTeachingSwitch() {
  if (teachingActive) return;

  const main = getMainContent();
  if (!main) return;

  const dashboard = main.querySelector('.dashboard-grid');
  const pageWrap = dashboard?.closest('.page-wrap');
  if (!dashboard || !pageWrap || pageWrap.querySelector('#kiwiTeachingSwitch')) return;

  const switchWrap = document.createElement('div');
  switchWrap.id = 'kiwiTeachingSwitch';
  switchWrap.style.cssText =
    'display:flex;justify-content:flex-end;align-items:center;margin:0 0 14px;';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-sm';
  button.textContent = 'Switch to KIWI Teaching';
  button.addEventListener('click', enterTeaching);

  switchWrap.appendChild(button);
  pageWrap.prepend(switchWrap);
}

function initTeachingFrontend() {
  ensureTeachingSwitch();

  const main = getMainContent();
  if (!main) return;

  const observer = new MutationObserver(() => {
    ensureTeachingSwitch();
  });

  observer.observe(main, { childList: true, subtree: true });
}

window.KIWITeaching = Object.freeze({
  enter: enterTeaching,
  leave: leaveTeaching,
  render: renderTeachingPage,
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTeachingFrontend, { once: true });
} else {
  initTeachingFrontend();
}
