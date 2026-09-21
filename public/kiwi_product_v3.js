(function () {
  'use strict';

  const h = (value) => typeof escapeHTML === 'function'
    ? escapeHTML(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const list = (value) => Array.isArray(value) ? value : [];

  function removeRetiredNavigation() {
    ['almanac', 'achievements', 'persona'].forEach((route) => {
      document.querySelectorAll(`.nav-item[data-route="${route}"]`).forEach((item) => item.remove());
    });
    document.querySelectorAll('.nav-section-label').forEach((label) => {
      let next = label.nextElementSibling;
      if (!next || next.classList.contains('nav-section-label')) label.remove();
    });
    const chronicleLabel = document.querySelector('.nav-item[data-route="chronicle"] .nav-label');
    // MutationObserver safety: only write when the DOM actually needs changing.
    // Reassigning the same textContent still replaces the text node and can
    // recursively retrigger a childList observer.
    if (chronicleLabel && chronicleLabel.textContent !== 'Living Profile') {
      chronicleLabel.textContent = 'Living Profile';
    }
  }

  function renderAchievementCards(data) {
    const achievements = list(data?.achievements);
    if (!achievements.length) {
      return '<div class="card"><div style="color:var(--text-3);">Complete real study sessions and KIWI will begin observing milestones here.</div></div>';
    }
    return `<div class="achievement-list">${achievements.map((item) => {
      const current = Math.max(0, Number(item.current) || 0);
      const target = Math.max(1, Number(item.target) || 1);
      const progress = Math.max(0, Math.min(100, Number(item.progress_pct) || 0));
      return `<article class="living-achievement ${item.unlocked ? 'is-complete' : ''}">
        <div class="achievement-icon">${h(item.icon_emoji || '✦')}</div>
        <div>
          <div class="achievement-topline">
            <div class="achievement-name">${h(item.name || 'Achievement')}</div>
            <span class="achievement-kind">${h(item.is_personalized ? 'Personal this week' : item.category || 'Milestone')}</span>
          </div>
          <div class="achievement-desc">${h(item.description || '')}</div>
          <div class="achievement-evidence">${h(item.evidence || 'Waiting for evidence')}</div>
          <div class="achievement-progress">
            <div class="achievement-progress-track"><div class="achievement-progress-fill" style="width:${progress}%"></div></div>
            <div class="achievement-progress-text">${item.unlocked ? 'Complete' : `${current}/${target}`}</div>
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  async function appendLivingAchievements() {
    const page = document.querySelector('#mainContent .page-wrap');
    if (!page || page.querySelector('#livingAchievements')) return;
    const section = document.createElement('section');
    section.id = 'livingAchievements';
    section.className = 'living-section';
    section.innerHTML = `<div class="living-section-heading"><div><div class="section-title">Living Achievements</div><div class="section-sub">Milestones proven from current behavior, plus personal goals KIWI can measure.</div></div></div><div class="card"><div style="color:var(--text-3);">Reading your current study evidence…</div></div>`;
    page.appendChild(section);
    try {
      const data = await api.getAchievements();
      if (!document.getElementById('livingAchievements')) return;
      section.innerHTML = `<div class="living-section-heading"><div><div class="section-title">Living Achievements</div><div class="section-sub">${h(data.observer_summary || 'Milestones update from your current learning record.')}</div></div><span class="living-kicker">Observed weekly</span></div>${renderAchievementCards(data)}`;
    } catch (error) {
      section.innerHTML = `<div class="living-section-heading"><div><div class="section-title">Living Achievements</div><div class="section-sub">The rest of Progress is still available.</div></div></div><div class="card"><div style="color:var(--red-bright);">Achievements could not be refreshed right now.</div><button class="btn btn-secondary btn-sm" id="retryLivingAchievements" style="margin-top:12px;">Try again</button></div>`;
      section.querySelector('#retryLivingAchievements')?.addEventListener('click', () => {
        section.remove();
        appendLivingAchievements();
      });
    }
  }

  function evidencePanel(title, items, emptyText) {
    const entries = list(items);
    return `<section class="evidence-panel"><h3>${h(title)}</h3>${entries.length
      ? `<ul>${entries.map((item) => `<li>${h(item)}</li>`).join('')}</ul>`
      : `<div style="color:var(--text-4);font-size:var(--text-sm);">${h(emptyText)}</div>`}</section>`;
  }

  function chronicleEntry(entry) {
    const snapshot = entry?.stats_snapshot || {};
    const date = entry?.week_start || entry?.created_at || new Date().toISOString();
    const dateLabel = typeof formatDate === 'function' ? formatDate(date) : new Date(date).toLocaleDateString();
    return `<article class="chronicle-entry-v3">
      <div class="chronicle-header">
        <div class="chronicle-week">Week of ${h(dateLabel)}</div>
        <div class="chronicle-date">${Number(snapshot.meaningful_sessions ?? snapshot.sessions) || 0} meaningful sessions · ${Number(snapshot.cards_reviewed) || 0} reviews</div>
      </div>
      <div class="chronicle-body">${h(entry?.narrative || entry?.body || '').replace(/\n/g, '<br>')}</div>
      ${entry?.weekly_anchor ? `<div class="chronicle-anchor" style="margin-top:14px;">${h(entry.weekly_anchor)}</div>` : ''}
    </article>`;
  }

  async function renderLivingProfile() {
    const main = document.getElementById('mainContent');
    renderLoadingState(main, 'Reading your living learning profile…');
    try {
      const data = await apiRequest('/narrative/living-profile?timezone_offset_minutes=' + encodeURIComponent(new Date().getTimezoneOffset()));
      const persona = data?.persona || {};
      const entries = list(data?.chronicle);
      const ready = persona.ready !== false && persona.name;
      main.innerHTML = `<div class="page-wrap page-enter">
        <div class="section-header">
          <div><div class="section-title">Living Profile</div><div class="section-sub">Your current learning pattern and the evidence behind it. KIWI rewrites this as your behavior changes.</div></div>
          <button class="btn btn-primary btn-sm" id="createWeeklyReflection">${entries.length ? 'Refresh This Week' : 'Create First Reflection'}</button>
        </div>
        ${ready ? `<section class="persona-hero">
          <div class="persona-mark">${h(persona.emoji || '🌿')}</div>
          <div><div class="living-kicker">Current pattern · ${Math.round(Number(persona.confidence) || 0)}% confidence</div><div class="persona-name">${h(persona.name)}</div><div class="persona-essence">${h(persona.essence || '')}</div><div style="margin-top:10px;color:var(--text-4);font-size:var(--text-xs);">Based on ${Number(persona.observed_window?.meaningful_sessions ?? persona.observed_window?.sessions) || 0} meaningful sessions in the last 28 days—not a permanent label.</div></div>
        </section>
        <div class="persona-evidence-grid">
          ${evidencePanel('What KIWI can prove', persona.evidence, 'More study evidence is needed.')}
          ${evidencePanel('Strengths visible now', persona.strengths, 'Strengths are still forming.')}
          ${evidencePanel('Current friction', persona.friction, 'No stable friction signal yet.')}
          ${evidencePanel('Seven-day experiments', persona.experiments, 'Complete more sessions to unlock experiments.')}
        </div>
        ${persona.evolution ? `<div class="card" style="margin-top:12px;"><div class="living-kicker">What changes next</div><div style="margin-top:7px;color:var(--text-2);line-height:1.65;">${h(persona.evolution)}</div></div>` : ''}`
        : `<div class="empty-state"><div class="empty-icon">🌱</div><div class="empty-title">Your pattern is still forming</div><div class="empty-sub">${h(persona.message || `Complete ${persona.sessions_needed || 3} more sessions so KIWI can describe evidence instead of guessing.`)}</div></div>`}
        <section class="living-section">
          <div class="living-section-heading"><div><div class="section-title">Chronicle</div><div class="section-sub">Weekly interpretation of subject movement, exams, habits, strengths, and unresolved friction.</div></div></div>
          <div id="livingChronicleEntries">${entries.length ? entries.map(chronicleEntry).join('') : '<div class="empty-state"><div class="empty-title">No weekly reflection yet</div><div class="empty-sub">Create one after KIWI has enough real activity to interpret.</div></div>'}</div>
        </section>
      </div>`;
      document.getElementById('createWeeklyReflection')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Reading this week…';
        try {
          await api.generateChronicle(entries.length > 0);
          showToast('This week’s reflection is ready.', 'success');
          await renderLivingProfile();
        } catch (error) {
          showToast(error.message || 'Reflection could not be created.', 'error');
          button.disabled = false;
          button.textContent = entries.length ? 'Refresh This Week' : 'Create First Reflection';
        }
      });
    } catch (error) {
      renderErrorState(main, error.message || 'Living Profile could not be loaded', () => navigateTo('chronicle'));
    }
  }

  function decorateInvitations() {
    const invitations = list(AppState?.dashboard?.invitations);
    document.querySelectorAll('#invitations-card .invitation-item').forEach((item) => {
      if (item.dataset.livingDecorated === '1') return;
      const invitation = invitations[Number(item.dataset.inv)];
      if (!invitation) return;
      item.dataset.livingDecorated = '1';
      if (invitation.completed) {
        item.classList.add('is-complete');
        item.querySelector('.invitation-dismiss')?.remove();
        const action = item.querySelector('.invitation-action');
        if (action) action.textContent = 'Completed today ✓';
      }
      const context = item.querySelector('.invitation-context');
      if (!context) return;
      const meta = document.createElement('div');
      meta.className = 'invitation-meta';
      meta.innerHTML = `<span class="invitation-pill">${h(invitation.completed ? 'complete' : invitation.priority || 'steady')}</span>${invitation.subject_name ? `<span class="invitation-pill">${h(invitation.subject_name)}</span>` : ''}<span class="invitation-pill">about ${Math.max(1, Number(invitation.estimated_minutes) || 10)} min</span>`;
      context.insertAdjacentElement('afterend', meta);
      if (invitation.completion) {
        const completion = document.createElement('div');
        completion.className = 'invitation-completion';
        completion.innerHTML = `<strong>Done when:</strong> ${h(invitation.completion)}`;
        meta.insertAdjacentElement('afterend', completion);
      }
    });
  }

  async function renderMarketplaceV3() {
    if (!AppState.subjects?.length) {
      try {
        const library = await api.getLibrary();
        AppState.subjects = library.subjects || [];
      } catch (_) {}
    }
    await renderMarketplace();
    const page = document.querySelector('#mainContent .page-wrap');
    if (!page) return;
    const subtitle = page.querySelector('.section-header .section-sub');
    if (subtitle) subtitle.textContent = 'Useful interventions earned through real learning evidence.';
    const balance = page.querySelector('.section-header [style*="var(--gold)"]');
    if (balance) balance.textContent = balance.textContent.replace(/\s*SP\s*$/, ' seedlings');
    const grid = page.querySelector('.marketplace-grid');
    if (grid && !page.querySelector('.marketplace-intro-v3')) {
      const intro = document.createElement('section');
      intro.className = 'marketplace-intro-v3';
      intro.innerHTML = '<div><div class="living-kicker">Garden Workshop</div><div style="font-family:var(--font-display);font-size:var(--text-lg);font-weight:750;margin-top:5px;">Every item must change what KIWI can do for you.</div><div style="color:var(--text-3);font-size:var(--text-sm);line-height:1.55;margin-top:5px;">Access is earned from verified study behavior. Seedlings purchase analysis, recovery, or subject-specific ecosystem changes—never empty status.</div></div><button class="btn btn-secondary btn-sm" onclick="navigateTo(\'progress\')">See what unlocks next</button>';
      grid.insertAdjacentElement('beforebegin', intro);
    }
    page.querySelectorAll('.gate-label').forEach((label) => {
      label.textContent = label.textContent
        .replace(/^Gate 1:/, 'Earned access:')
        .replace(/^Gate 2: Seedlings/, 'Seedling cost');
    });
    page.querySelectorAll('.gate-text').forEach((text) => {
      if (text.textContent.includes('Complete Gate 1')) text.textContent = 'Complete the learning requirement above to make this available.';
    });
  }

  function restoreStudyIfNeeded() {
    if (!authToken || AppState.tempStudy) return false;
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('kiwi_active_study_v1') || 'null'); } catch (_) { return false; }
    if (!saved?.study?.sessionId) return false;
    if (Date.now() - Number(saved.savedAt || 0) > 4 * 60 * 60 * 1000) {
      sessionStorage.removeItem('kiwi_active_study_v1');
      return false;
    }
    AppState.tempStudy = saved.study;
    AppState.tempStudy._ending = false;
    const restoredIdleMs = (Number(saved.focus?.idleMs) || 0)
      + Math.max(0, Date.now() - Number(saved.savedAt || Date.now()));
    startFocusTracking();
    AppState.focusTracking.idleMs = restoredIdleMs;
    AppState.focusTracking.lastActive = Date.now();
    AppState.tempStudy.focusData = AppState.tempStudy.focusData || {};
    AppState.tempStudy.focusData.idleSeconds = Math.round(restoredIdleMs / 1000);
    navigateTo('study');
    showToast('Your active study session was restored. Time away counts as idle.', 'info', 6000);
    return true;
  }

  function installProductRoutes() {
    if (typeof ROUTES === 'undefined') return;
    const originalDashboard = ROUTES.dashboard.render;
    ROUTES.dashboard.render = async function () {
      await originalDashboard();
      if (authToken && !isDemoMode()) {
        try {
          const fresh = await api.getDailyInvitations();
          const invitations = list(fresh?.invitations || fresh);
          if (AppState.currentPage !== 'dashboard' || !AppState.dashboard) return;
          AppState.dashboard.invitations = invitations;
          _saveDashboardCache(AppState.dashboard);
          _paintDashboard(document.getElementById('mainContent'), AppState.dashboard, 'dashboard');
          decorateInvitations();
        } catch (_) {}
      }
    };
    const originalProgress = ROUTES.progress.render;
    ROUTES.progress.render = async function () {
      await originalProgress();
      if (AppState.currentPage === 'progress') await appendLivingAchievements();
    };
    ROUTES.chronicle.render = renderLivingProfile;
    ROUTES.chronicle.title = 'Living Profile';
    ROUTES.almanac.render = () => navigateTo('progress');
    ROUTES.achievements.render = () => navigateTo('progress');
    ROUTES.persona.render = () => navigateTo('chronicle');
    ROUTES.marketplace.render = renderMarketplaceV3;

    const originalFooter = updateUserFooter;
    updateUserFooter = async function () {
      if (authToken && !AppState.dashboard && !isDemoMode()) {
        try {
          AppState.dashboard = await api.getDashboard();
          _saveDashboardCache(AppState.dashboard);
        } catch (_) {}
      }
      return originalFooter();
    };
  }

  function refreshRetiredLandingCopy() {
    document.querySelectorAll('.feature-title').forEach((title) => {
      if (title.textContent.trim() === 'The Almanac') {
        title.textContent = 'Living Achievements';
        if (title.nextElementSibling) title.nextElementSibling.textContent = 'Milestones proven by your current study record, including personal weekly challenges.';
      }
      if (title.textContent.trim() === 'Study Persona') {
        title.textContent = 'Living Profile';
        if (title.nextElementSibling) title.nextElementSibling.textContent = 'An evolving, evidence-backed reading of your habits, strengths, friction, subjects, and exams.';
      }
    });
  }

  const PRODUCT_WATCH_SELECTOR =
    '.nav-item, .nav-section-label, .feature-title, #invitations-card, .invitation-item';

  function productMutationIsRelevant(mutations) {
    return mutations.some((mutation) =>
      Array.from(mutation.addedNodes || []).some((node) => {
        if (node.nodeType !== 1) return false;
        return node.matches?.(PRODUCT_WATCH_SELECTOR) ||
          !!node.querySelector?.(PRODUCT_WATCH_SELECTOR);
      }),
    );
  }


  const SIDEBAR_SECTION_STORAGE_KEY = 'kiwi_sidebar_sections_v2';

  function readSidebarSectionState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SIDEBAR_SECTION_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeSidebarSectionState(state) {
    try { localStorage.setItem(SIDEBAR_SECTION_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function sidebarSectionKey(label) {
    return (label || 'section')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  }

  function setSidebarSectionCollapsed(group, collapsed, persist = true) {
    if (!group) return;
    const label = group.querySelector(':scope > .nav-section-label');
    const key = group.dataset.sectionKey;
    group.classList.toggle('is-collapsed', !!collapsed);
    if (label) label.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

    if (persist && key) {
      const state = readSidebarSectionState();
      state[key] = !!collapsed;
      writeSidebarSectionState(state);
    }
  }

  function expandSidebarSectionForRoute(route) {
    if (!route) return;
    const item = document.querySelector(`.nav-item[data-route="${CSS.escape(String(route))}"]`);
    const group = item?.closest?.('.kiwi-nav-section');
    if (group) setSidebarSectionCollapsed(group, false, false);
  }

  function expandAllSidebarSections() {
    document.querySelectorAll('.kiwi-nav-section').forEach((group) => {
      setSidebarSectionCollapsed(group, false, false);
    });
  }

  function enhanceSidebarSections() {
    const nav = document.getElementById('sidebarNav');
    if (!nav || nav.dataset.accordionReady === 'true') return;
    nav.dataset.accordionReady = 'true';

    const savedState = readSidebarSectionState();
    const labels = Array.from(nav.children).filter((node) => node.classList?.contains('nav-section-label'));

    labels.forEach((label, index) => {
      const rawTitle = label.textContent.trim();
      const key = sidebarSectionKey(rawTitle);
      const members = [];
      let cursor = label.nextElementSibling;

      while (cursor && !cursor.classList.contains('nav-section-label')) {
        members.push(cursor);
        cursor = cursor.nextElementSibling;
      }

      const group = document.createElement('section');
      group.className = 'kiwi-nav-section';
      group.dataset.sectionKey = key;

      const items = document.createElement('div');
      items.className = 'kiwi-nav-section-items';
      items.id = `kiwiNavSection-${key}-${index}`;

      const inner = document.createElement('div');
      inner.className = 'kiwi-nav-section-items-inner';
      items.appendChild(inner);

      nav.insertBefore(group, label);
      group.appendChild(label);
      group.appendChild(items);
      members.forEach((member) => inner.appendChild(member));

      label.setAttribute('role', 'button');
      label.setAttribute('tabindex', '0');
      label.setAttribute('aria-controls', items.id);

      const title = document.createElement('span');
      title.className = 'kiwi-nav-section-title';
      title.textContent = rawTitle;

      const chevron = document.createElement('span');
      chevron.className = 'kiwi-nav-section-chevron';
      chevron.setAttribute('aria-hidden', 'true');

      label.replaceChildren(title, chevron);

      const defaultCollapsed = key !== 'learn';
      const initialCollapsed = Object.prototype.hasOwnProperty.call(savedState, key)
        ? !!savedState[key]
        : defaultCollapsed;

      setSidebarSectionCollapsed(group, initialCollapsed, false);

      const toggle = () => {
        const collapsed = !group.classList.contains('is-collapsed');
        setSidebarSectionCollapsed(group, collapsed, true);
      };

      label.addEventListener('click', toggle);
      label.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      });
    });

    expandSidebarSectionForRoute(AppState?.currentPage);

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const sidebarObserver = new MutationObserver((mutations) => {
        if (!mutations.some((mutation) => mutation.attributeName === 'class')) return;
        if (!sidebar.classList.contains('open')) return;

        if (typeof _tourActive !== 'undefined' && _tourActive) {
          expandAllSidebarSections();
        } else {
          expandSidebarSectionForRoute(AppState?.currentPage);
        }
      });

      sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function boot() {
    installProductRoutes();
    removeRetiredNavigation();
    enhanceSidebarSections();
    refreshRetiredLandingCopy();

    // Watch only the two application roots that can contain product UI.
    // Do not observe document.body: toasts, overlays, tour effects, and other
    // unrelated DOM churn must not trigger full-page product rescans.
    const observerRoots = [
      document.getElementById('app'),
      document.getElementById('authPage'),
    ].filter(Boolean);

    const observer = new MutationObserver((mutations) => {
      if (!productMutationIsRelevant(mutations)) return;

      // Disconnect while applying our own DOM normalization. This guarantees
      // observer callbacks cannot recursively feed on mutations they create.
      observer.disconnect();
      try {
        removeRetiredNavigation();
        decorateInvitations();
        refreshRetiredLandingCopy();
      } finally {
        observerRoots.forEach((root) =>
          observer.observe(root, { childList: true, subtree: true }),
        );
      }
    });

    observerRoots.forEach((root) =>
      observer.observe(root, { childList: true, subtree: true }),
    );

    let attempts = 0;
    const resumeTimer = setInterval(() => {
      attempts += 1;
      if (restoreStudyIfNeeded() || attempts >= 20) clearInterval(resumeTimer);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
