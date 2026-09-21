(function () {
  'use strict';

  const BUBBLE_REQUIRED_SESSIONS = 5;

  const h = (value) => typeof escapeHTML === 'function'
    ? escapeHTML(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

  const list = (value) => Array.isArray(value) ? value : [];
  const asBubbles = (value) => list(value?.bubbles || value);
  const inDemoMode = () => typeof isDemoMode === 'function' && isDemoMode();
  const todayInputValue = () => {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  function demoBubbleData() {
    const exam = new Date();
    exam.setDate(exam.getDate() + 21);
    return {
      bubbles: [{
        id: 'demo-exam-goal',
        name: 'Demo: Study Skills Final',
        subject_name: 'Demo: Study Skills',
        status: 'active',
        phase: 'SEEDING',
        trajectory_status: 'ON_TRACK',
        current_ks: 42,
        exam_date: exam.toISOString(),
      }],
    };
  }

  async function getBubbleData() {
    return inDemoMode() ? demoBubbleData() : api.getBubbles();
  }

  function userKey() {
    const user = AppState?.user || AppState?.dashboard?.user || {};
    return user.id || user.email || 'current';
  }

  async function ensureBubbleDashboard() {
    if (AppState?.dashboard?.user_stats) return AppState.dashboard;
    const fresh = await api.getDashboard();
    AppState.dashboard = fresh;
    if (typeof _saveDashboardCache === 'function') {
      try { _saveDashboardCache(fresh); } catch (_) {}
    }
    return fresh;
  }

  async function getBubbleGateState() {
    if (inDemoMode()) {
      return { unlocked: true, current: BUBBLE_REQUIRED_SESSIONS, required: BUBBLE_REQUIRED_SESSIONS, remaining: 0, demo: true };
    }
    const dashboard = await ensureBubbleDashboard();
    const current = Math.max(0, Number(dashboard?.user_stats?.total_sessions_completed) || 0);
    return {
      unlocked: current >= BUBBLE_REQUIRED_SESSIONS,
      current,
      required: BUBBLE_REQUIRED_SESSIONS,
      remaining: Math.max(0, BUBBLE_REQUIRED_SESSIONS - current),
    };
  }

  function phaseLabel(bubble) {
    if (bubble?.rescue_active || bubble?.trajectory_status === 'RESCUE') return 'RESCUE';
    return bubble?.phase || 'SEEDING';
  }

  function trajectoryLabel(bubble) {
    return bubble?.trajectory_status || (bubble?.status === 'active' ? 'ON_TRACK' : String(bubble?.status || 'UNKNOWN').toUpperCase());
  }

  function daysToExam(bubble) {
    if (!bubble?.exam_date) return null;
    return Math.max(0, Math.ceil((new Date(bubble.exam_date) - new Date()) / 86400000));
  }

  function renderBubbleCard(bubble) {
    const days = daysToExam(bubble);
    const ks = Math.max(0, Math.min(100, Number(bubble.current_ks) || 0));
    const status = trajectoryLabel(bubble);
    const subject = bubble.subject_name || 'Subject';
    const exam = bubble.exam_date
      ? new Date(bubble.exam_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : 'No deadline';
    return `
      <button class="bubble-hub-card" type="button" data-bubble-id="${h(bubble.id || '')}">
        <div class="bubble-hub-card-top">
          <div>
            <div class="bubble-hub-kicker">${h(subject)}</div>
            <div class="bubble-hub-name">${h(bubble.name || subject + ' exam goal')}</div>
          </div>
          <span class="bubble-hub-status status-${h(status.toLowerCase())}">${h(status.replace(/_/g, ' '))}</span>
        </div>
        <div class="bubble-hub-metrics">
          <div><strong>${Math.round(ks)}</strong><span>Knowledge Score</span></div>
          <div><strong>${h(phaseLabel(bubble))}</strong><span>Phase</span></div>
          <div><strong>${days == null ? '—' : days}</strong><span>${days === 1 ? 'Day left' : 'Days left'}</span></div>
        </div>
        <div class="bubble-hub-progress"><span style="width:${ks}%"></span></div>
        <div class="bubble-hub-deadline">Exam: ${h(exam)}</div>
      </button>`;
  }

  async function renderBubbleHub() {
    const main = document.getElementById('mainContent');
    if (!main) return;
    if (typeof renderLoadingState === 'function') renderLoadingState(main, 'Loading your exam goals…');

    try {
      const [gate, bubbleData] = await Promise.all([
        getBubbleGateState(),
        getBubbleData(),
      ]);
      const bubbles = asBubbles(bubbleData);
      const active = bubbles.filter((b) => b.status === 'active' || b.status === 'dormant');
      const closed = bubbles.filter((b) => b.status !== 'active' && b.status !== 'dormant');
      const progress = Math.min(100, Math.round((gate.current / gate.required) * 100));

      main.innerHTML = `
        <div class="page-wrap page-enter bubble-hub-page">
          <div class="section-header bubble-hub-header">
            <div>
              <div class="living-kicker">Mastery Bubbles</div>
              <div class="section-title">Exam Goals</div>
              <div class="section-sub">Tell KIWI what you are preparing for. It will track whether your knowledge is moving fast enough and reshape study sessions around the deadline.</div>
            </div>
            <button class="btn btn-primary" id="bubbleHubCreateBtn">${gate.demo ? 'Create Account to Set a Goal' : gate.unlocked ? 'Create Exam Goal' : 'Locked · ' + gate.current + '/' + gate.required + ' sessions'}</button>
          </div>

          ${!gate.unlocked ? `
            <section class="bubble-unlock-card">
              <div class="bubble-unlock-icon">🌱</div>
              <div>
                <div class="bubble-unlock-title">Mastery Bubbles unlock after ${gate.required} completed sessions</div>
                <div class="bubble-unlock-copy">Complete ${gate.remaining} more session${gate.remaining === 1 ? '' : 's'} so KIWI has enough learning behavior to build a useful exam trajectory.</div>
                <div class="bubble-unlock-progress"><span style="width:${progress}%"></span></div>
                <div class="bubble-unlock-meta">${gate.current} of ${gate.required} sessions completed</div>
              </div>
              <button class="btn btn-secondary btn-sm" id="bubbleHubStudyBtn">Study now</button>
            </section>` : `
            <section class="bubble-unlock-card is-unlocked">
              <div class="bubble-unlock-icon">🌳</div>
              <div>
                <div class="bubble-unlock-title">${gate.demo ? 'This is a Mastery Bubble preview' : 'Mastery Bubbles are unlocked'}</div>
                <div class="bubble-unlock-copy">${gate.demo ? 'Create an account to build a goal from your own cards and let KIWI adapt study sessions around your exam date.' : 'Create an exam goal for any subject with cards. KIWI will handle trajectory, daily contracts, Rescue mode, and queue prioritisation automatically.'}</div>
              </div>
            </section>`}

          <section class="living-section">
            <div class="living-section-heading">
              <div>
                <div class="section-title">Active goals</div>
                <div class="section-sub">${active.length ? active.length + ' active exam goal' + (active.length === 1 ? '' : 's') : 'No active exam goal yet.'}</div>
              </div>
            </div>
            <div class="bubble-hub-grid">
              ${active.length ? active.map(renderBubbleCard).join('') : `
                <div class="empty-state bubble-hub-empty">
                  <div class="empty-icon">🎯</div>
                  <div class="empty-title">${gate.unlocked ? 'Set your first exam goal' : 'Your first exam goal is waiting'}</div>
                  <div class="empty-sub">${gate.unlocked ? 'Choose a subject, the decks included, and your exam date. KIWI will build the Mastery Bubble immediately.' : 'Once you complete five sessions, this becomes your place to plan exams and track readiness.'}</div>
                  <button class="btn ${gate.unlocked ? 'btn-primary' : 'btn-secondary'}" id="bubbleHubEmptyBtn">${gate.unlocked ? 'Create Exam Goal' : 'Continue studying'}</button>
                </div>`}
            </div>
          </section>

          ${closed.length ? `
            <section class="living-section">
              <div class="living-section-heading"><div><div class="section-title">Past goals</div><div class="section-sub">Completed, missed, partially completed, and archived Bubbles.</div></div></div>
              <div class="bubble-hub-grid bubble-hub-grid-closed">${closed.map(renderBubbleCard).join('')}</div>
            </section>` : ''}
        </div>`;

      const create = () => gate.demo
        ? openBubbleCreateModal()
        : gate.unlocked ? openBubbleCreateModal() : showBubbleGateModal(gate);
      document.getElementById('bubbleHubCreateBtn')?.addEventListener('click', create);
      document.getElementById('bubbleHubEmptyBtn')?.addEventListener('click', () => {
        if (gate.unlocked) openBubbleCreateModal();
        else if (typeof navigateTo === 'function') navigateTo('study');
      });
      document.getElementById('bubbleHubStudyBtn')?.addEventListener('click', () => navigateTo('study'));
      main.querySelectorAll('[data-bubble-id]').forEach((card) => {
        card.addEventListener('click', () => {
          const id = card.dataset.bubbleId;
          if (gate.demo) {
            if (typeof showToast === 'function') showToast('Create an account to inspect and manage a live exam goal.', 'info', 5000);
            return;
          }
          if (id && typeof openBubbleDetailPanel === 'function') openBubbleDetailPanel(id);
        });
      });
    } catch (error) {
      if (typeof renderErrorState === 'function') {
        renderErrorState(main, error.message || 'Exam Goals could not be loaded', renderBubbleHub);
      } else {
        main.innerHTML = '<div class="page-wrap"><div class="card">Exam Goals could not be loaded.</div></div>';
      }
    }
  }

  function closeBubbleCreateModal() {
    document.getElementById('bubbleCreateOverlay')?.remove();
  }

  function showBubbleGateModal(gate) {
    document.getElementById('bubbleCreateOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'bubbleCreateOverlay';
    overlay.className = 'bubble-create-overlay';
    overlay.innerHTML = `
      <div class="bubble-create-shell card">
        <button class="bubble-create-close" type="button" aria-label="Close">×</button>
        <div class="bubble-create-mark">🌱</div>
        <div class="bubble-create-title">Mastery Bubbles unlock after ${gate.required} sessions</div>
        <div class="bubble-create-copy">You have completed ${gate.current}. Complete ${gate.remaining} more session${gate.remaining === 1 ? '' : 's'} and KIWI will unlock deadline-aware exam planning.</div>
        <div class="bubble-unlock-progress"><span style="width:${Math.min(100, (gate.current / gate.required) * 100)}%"></span></div>
        <div class="bubble-create-actions">
          <button class="btn btn-primary" id="bubbleGateStudy">Start a study session</button>
          <button class="btn btn-ghost" id="bubbleGateLater">Not now</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.bubble-create-close')?.addEventListener('click', closeBubbleCreateModal);
    overlay.querySelector('#bubbleGateLater')?.addEventListener('click', closeBubbleCreateModal);
    overlay.querySelector('#bubbleGateStudy')?.addEventListener('click', () => {
      closeBubbleCreateModal();
      navigateTo('study');
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeBubbleCreateModal();
    });
  }

  async function openBubbleCreateModal(options = {}) {
    try {
      if (inDemoMode()) {
        if (typeof showToast === 'function') showToast('Create an account to save exam goals and adaptive trajectories.', 'info', 5000);
        if (typeof openAuth === 'function') openAuth('register');
        return;
      }
      const gate = await getBubbleGateState();
      if (!gate.unlocked) return showBubbleGateModal(gate);

      const library = await api.getLibrary();
      const subjects = list(library?.subjects).filter((subject) =>
        Number(subject.total_cards ?? subject.cardCount ?? 0) > 0 &&
        list(subject.decks).some((deck) => Number(deck.card_count || 0) > 0)
      );

      document.getElementById('bubbleCreateOverlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'bubbleCreateOverlay';
      overlay.className = 'bubble-create-overlay';
      overlay.innerHTML = `
        <div class="bubble-create-shell card">
          <button class="bubble-create-close" type="button" aria-label="Close">×</button>
          <div class="living-kicker">Mastery Bubble</div>
          <div class="bubble-create-title">Create an exam goal</div>
          <div class="bubble-create-copy">Choose what is in the exam and when it happens. KIWI will calculate the pace you need and adapt your study queue automatically.</div>
          ${subjects.length ? `
            <form id="bubbleCreateForm">
              <label class="bubble-field">
                <span>Subject</span>
                <select id="bubbleCreateSubject" required>
                  ${subjects.map((subject) => `<option value="${h(subject.id)}">${h(subject.name)}</option>`).join('')}
                </select>
              </label>
              <div class="bubble-field">
                <span>Decks included</span>
                <div id="bubbleCreateDecks" class="bubble-deck-picker"></div>
              </div>
              <div class="bubble-date-grid">
                <label class="bubble-field"><span>Exam date</span><input id="bubbleCreateExamDate" type="date" min="${todayInputValue()}" required></label>
                <label class="bubble-field"><span>Mock / test date <em>optional</em></span><input id="bubbleCreateTestDate" type="date" min="${todayInputValue()}"></label>
              </div>
              <label class="bubble-field"><span>Goal name <em>optional</em></span><input id="bubbleCreateName" type="text" maxlength="120" placeholder="e.g. November Economics Final"></label>
              <div id="bubbleCreateError" class="bubble-create-error" role="alert"></div>
              <div class="bubble-create-actions">
                <button class="btn btn-primary" id="bubbleCreateSubmit" type="submit">Create Mastery Bubble</button>
                <button class="btn btn-ghost" id="bubbleCreateCancel" type="button">Cancel</button>
              </div>
            </form>` : `
            <div class="bubble-no-subjects">
              <div class="empty-title">Add cards before creating an exam goal</div>
              <div class="empty-sub">A Mastery Bubble needs at least one deck with cards so KIWI has knowledge to track.</div>
              <button class="btn btn-primary" id="bubbleCreateGoLibrary">Open Library</button>
            </div>`}
        </div>`;
      document.body.appendChild(overlay);

      const close = () => closeBubbleCreateModal();
      overlay.querySelector('.bubble-create-close')?.addEventListener('click', close);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

      if (!subjects.length) {
        overlay.querySelector('#bubbleCreateGoLibrary')?.addEventListener('click', () => {
          close();
          navigateTo('library');
        });
        return;
      }

      const subjectSelect = overlay.querySelector('#bubbleCreateSubject');
      const deckPicker = overlay.querySelector('#bubbleCreateDecks');
      const preferredSubject = subjects.find((s) => s.id === options.subjectId);
      if (preferredSubject) subjectSelect.value = preferredSubject.id;

      function renderDecks() {
        const subject = subjects.find((s) => s.id === subjectSelect.value) || subjects[0];
        const decks = list(subject?.decks).filter((deck) => Number(deck.card_count || 0) > 0);
        deckPicker.innerHTML = decks.map((deck) => {
          const checked = options.deckId ? deck.id === options.deckId : true;
          return `<label class="bubble-deck-option">
            <input type="checkbox" name="bubbleDeck" value="${h(deck.id)}" ${checked ? 'checked' : ''}>
            <span><strong>${h(deck.name)}</strong><small>${Number(deck.card_count) || 0} cards</small></span>
          </label>`;
        }).join('');
      }
      renderDecks();
      subjectSelect.addEventListener('change', () => {
        options.deckId = null;
        renderDecks();
      });

      overlay.querySelector('#bubbleCreateCancel')?.addEventListener('click', close);
      overlay.querySelector('#bubbleCreateForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = overlay.querySelector('#bubbleCreateError');
        const submit = overlay.querySelector('#bubbleCreateSubmit');
        errorEl.textContent = '';

        const examDate = overlay.querySelector('#bubbleCreateExamDate').value;
        const testDate = overlay.querySelector('#bubbleCreateTestDate').value;
        const name = overlay.querySelector('#bubbleCreateName').value.trim();
        const deckIds = Array.from(overlay.querySelectorAll('input[name="bubbleDeck"]:checked')).map((input) => input.value);

        if (!examDate) {
          errorEl.textContent = 'Choose an exam date.';
          return;
        }
        const examEnd = new Date(examDate + 'T23:59:59');
        if (examEnd <= new Date()) {
          errorEl.textContent = 'Choose an exam date in the future.';
          return;
        }
        if (testDate && new Date(testDate + 'T23:59:59') > examEnd) {
          errorEl.textContent = 'The mock/test date cannot be after the exam date.';
          return;
        }
        if (!deckIds.length) {
          errorEl.textContent = 'Select at least one deck.';
          return;
        }

        const form = overlay.querySelector('#bubbleCreateForm');
        if (form.dataset.overlapConfirmed !== '1') {
          submit.disabled = true;
          submit.textContent = 'Checking overlap…';
          try {
            const preview = await api.checkBubbleOverlap({ deck_ids: deckIds });
            if (preview?.should_prompt_user) {
              submit.disabled = false;
              submit.textContent = 'Create Mastery Bubble';
              const overlap = Number(preview.overlap_pct) || 0;
              const count = Number(preview.overlapping_card_count) || 0;
              if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                  'Use cards shared with another goal?',
                  `${count} selected card${count === 1 ? '' : 's'} (${Math.round(overlap)}%) already belong to an active exam goal. Reviews will advance both goals, while KIWI balances their deadlines.`,
                  () => {
                    form.dataset.overlapConfirmed = '1';
                    form.requestSubmit();
                  }
                );
                return;
              }
            }
          } catch (_) {
            // Creation remains available if the non-mutating preview is unavailable.
          }
          submit.disabled = false;
          submit.textContent = 'Create Mastery Bubble';
        }

        submit.disabled = true;
        submit.textContent = 'Creating…';
        try {
          const created = await api.createBubble({
            subject_id: subjectSelect.value,
            deck_ids: deckIds,
            exam_date: examDate,
            test_date: testDate || null,
            name: name || null,
          });
          close();
          if (typeof showToast === 'function') {
            const overlapCount = Number(created?.overlap?.overlapping_card_count) || 0;
            showToast(overlapCount
              ? 'Exam goal created. ' + overlapCount + ' shared card' + (overlapCount === 1 ? '' : 's') + ' will count across Bubbles.'
              : 'Mastery Bubble created.', 'success', 6000);
          }
          if (AppState.currentPage === 'bubbles') await renderBubbleHub();
          if (created?.id && typeof openBubbleDetailPanel === 'function') openBubbleDetailPanel(created.id);
        } catch (error) {
          errorEl.textContent = error.message || 'Could not create the exam goal.';
          submit.disabled = false;
          submit.textContent = 'Create Mastery Bubble';
        }
      });
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message || 'Could not open Exam Goals.', 'error');
    }
  }

  function installBubbleNavigation() {
    const nav = document.getElementById('sidebarNav');
    if (!nav || nav.querySelector('[data-route="bubbles"]')) return;
    const examItem = nav.querySelector('.nav-item[data-route="exam-config"]');
    if (!examItem) return;

    const item = document.createElement('div');
    item.className = 'nav-item bubble-nav-item';
    item.dataset.route = 'bubbles';
    item.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M22 12h-2M12 22v-2M2 12h2"/></svg></span><span class="nav-label">Exam Goals</span>';
    item.addEventListener('click', () => navigateTo('bubbles'));
    examItem.insertAdjacentElement('afterend', item);
  }

  async function appendBubbleDashboardCard() {
    if (AppState?.currentPage !== 'dashboard') return;
    const page = document.querySelector('#mainContent .page-wrap');
    if (!page || page.querySelector('#bubbleDashboardEntry') || page.dataset.bubbleEntryLoading === '1') return;
    page.dataset.bubbleEntryLoading = '1';
    try {
      const [gate, bubbleData] = await Promise.all([getBubbleGateState(), getBubbleData()]);
      if (AppState?.currentPage !== 'dashboard') return;
      const currentPage = document.querySelector('#mainContent .page-wrap');
      if (!currentPage || currentPage.querySelector('#bubbleDashboardEntry')) return;
      const active = asBubbles(bubbleData).filter((b) => b.status === 'active' || b.status === 'dormant');
      const urgent = active.find((b) => ['RESCUE','CRITICAL'].includes(trajectoryLabel(b)));
      const card = document.createElement('section');
      card.id = 'bubbleDashboardEntry';
      card.className = 'bubble-dashboard-entry';
      card.innerHTML = `
        <div class="bubble-dashboard-icon">${urgent ? '🚨' : active.length ? '🎯' : gate.unlocked ? '🌳' : '🌱'}</div>
        <div class="bubble-dashboard-copy">
          <div class="living-kicker">Mastery Bubbles</div>
          <div class="bubble-dashboard-title">${urgent ? 'An exam goal needs attention' : active.length ? active.length + ' active exam goal' + (active.length === 1 ? '' : 's') : gate.unlocked ? 'Plan your next exam' : 'Exam Goals unlock at 5 sessions'}</div>
          <div class="bubble-dashboard-sub">${urgent ? 'Open Exam Goals to see the current Rescue/Critical trajectory.' : active.length ? 'Track readiness, daily contracts, and deadlines in one place.' : gate.unlocked ? 'Set a deadline and KIWI will turn your cards into a mastery trajectory.' : gate.current + '/' + gate.required + ' sessions completed — ' + gate.remaining + ' to go.'}</div>
        </div>
        <button class="btn ${gate.unlocked ? 'btn-primary' : 'btn-secondary'} btn-sm" type="button">${active.length ? 'Open Goals' : gate.unlocked ? 'Set Exam Goal' : 'View Unlock'}</button>`;
      const header = currentPage.querySelector('.section-header');
      if (header) header.insertAdjacentElement('afterend', card);
      else currentPage.prepend(card);
      card.addEventListener('click', () => navigateTo('bubbles'));
    } catch (_) {
      // Dashboard remains fully usable if Bubble data is unavailable.
    } finally {
      const currentPage = document.querySelector('#mainContent .page-wrap');
      if (currentPage) delete currentPage.dataset.bubbleEntryLoading;
    }
  }

  function wireDormantBubbleWidgets(root = document) {
    root.querySelectorAll?.('.bubble-mini-indicator').forEach((widget) => {
      if (widget.dataset.bubbleCreateWired === '1') return;
      const isCreateState = !widget.dataset.bubbleId &&
        (widget.title || '').toLowerCase().includes('no active exam goal');
      if (!isCreateState) return;
      widget.dataset.bubbleCreateWired = '1';
      widget.setAttribute('role', 'button');
      widget.setAttribute('tabindex', '0');
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const subjectId = widget.closest('.biome-zone[data-subject-id]')?.dataset.subjectId || null;
        openBubbleCreateModal({ subjectId });
      };
      widget.addEventListener('click', activate);
      widget.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
    });
  }

  function installAIBubbleShortcut() {
    if (typeof showBubbleOnboardingPrompt !== 'function' || showBubbleOnboardingPrompt.__kiwiBubbleDiscoveryWrapped) return;
    const original = showBubbleOnboardingPrompt;
    const wrapped = async function(subjectId, deckId) {
      try {
        const gate = await getBubbleGateState();
        if (!gate.unlocked) {
          const aiResult = document.getElementById('aiNotesResult');
          if (aiResult) {
            document.getElementById('bubbleOnboardingPrompt')?.remove();
            const hint = document.createElement('div');
            hint.id = 'bubbleOnboardingPrompt';
            hint.className = 'bubble-ai-locked-hint';
            hint.innerHTML = '<strong>🌱 Mastery Bubbles unlock after 5 sessions</strong><span>You are at ' + gate.current + '/' + gate.required + '. Your generated cards are ready now; complete ' + gate.remaining + ' more session' + (gate.remaining === 1 ? '' : 's') + ' to unlock exam planning.</span><button class="btn btn-secondary btn-sm" type="button">View Exam Goals</button>';
            hint.querySelector('button')?.addEventListener('click', () => navigateTo('bubbles'));
            aiResult.insertAdjacentElement('afterend', hint);
          } else {
            showBubbleGateModal(gate);
          }
          return;
        }
        if (document.getElementById('aiNotesResult')) return original(subjectId, deckId);
        return openBubbleCreateModal({ subjectId, deckId });
      } catch (_) {
        return openBubbleCreateModal({ subjectId, deckId });
      }
    };
    wrapped.__kiwiBubbleDiscoveryWrapped = true;
    window.showBubbleOnboardingPrompt = wrapped;
  }

  function showBubbleUnlockCelebration() {
    if (document.getElementById('bubbleUnlockOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'bubbleUnlockOverlay';
    overlay.className = 'bubble-create-overlay';
    overlay.innerHTML = `
      <div class="bubble-create-shell card bubble-unlock-celebration">
        <button class="bubble-create-close" type="button" aria-label="Close">×</button>
        <div class="bubble-create-mark">🌳</div>
        <div class="living-kicker">New planning tool unlocked</div>
        <div class="bubble-create-title">Mastery Bubbles unlocked</div>
        <div class="bubble-create-copy">Planning for an exam? KIWI can now track whether you are learning quickly enough to be ready by the deadline and reshape your study queue when you fall behind.</div>
        <div class="bubble-create-actions">
          <button class="btn btn-primary" id="bubbleUnlockCreate">Set Exam Goal</button>
          <button class="btn btn-ghost" id="bubbleUnlockLater">Later</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.bubble-create-close')?.addEventListener('click', close);
    overlay.querySelector('#bubbleUnlockLater')?.addEventListener('click', close);
    overlay.querySelector('#bubbleUnlockCreate')?.addEventListener('click', () => {
      close();
      openBubbleCreateModal();
    });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }

  async function maybeCelebrateBubbleUnlock() {
    const key = 'kiwi_bubble_unlock_seen_v1:' + userKey();
    try { if (localStorage.getItem(key) === '1') return; } catch (_) {}
    try {
      const fresh = await api.getDashboard();
      AppState.dashboard = fresh;
      const current = Number(fresh?.user_stats?.total_sessions_completed) || 0;
      if (current < BUBBLE_REQUIRED_SESSIONS) return;
      try { localStorage.setItem(key, '1'); } catch (_) {}
      showBubbleUnlockCelebration();
    } catch (_) {}
  }

  function wrapSessionCompletionForUnlock() {
    if (!api?.endStudySession || api.endStudySession.__kiwiBubbleUnlockWrapped) return;
    const original = api.endStudySession;
    const wrapped = async function() {
      const result = await original.apply(this, arguments);
      const key = 'kiwi_bubble_unlock_seen_v1:' + userKey();
      let seen = false;
      try { seen = localStorage.getItem(key) === '1'; } catch (_) {}
      if (!seen && result?.session_completed !== false) {
        setTimeout(() => { maybeCelebrateBubbleUnlock(); }, 0);
      }
      return result;
    };
    wrapped.__kiwiBubbleUnlockWrapped = true;
    api.endStudySession = wrapped;
  }

  function installDashboardRouteHook() {
    if (typeof ROUTES === 'undefined' || !ROUTES.dashboard || ROUTES.dashboard.__kiwiBubbleWrapped) return;
    const original = ROUTES.dashboard.render;
    ROUTES.dashboard.render = async function() {
      await original();
      if (AppState?.currentPage === 'dashboard') await appendBubbleDashboardCard();
    };
    ROUTES.dashboard.__kiwiBubbleWrapped = true;
  }

  function installBubbleRouteDefinition() {
    if (typeof ROUTES === 'undefined') return;
    ROUTES.bubbles = { render: renderBubbleHub, title: 'Exam Goals', auth: true };
  }

  function bootBubbleDiscovery() {
    installBubbleRouteDefinition();
    installDashboardRouteHook();
    installBubbleNavigation();
    installAIBubbleShortcut();
    wrapSessionCompletionForUnlock();
    wireDormantBubbleWidgets();
    appendBubbleDashboardCard();

    const observer = new MutationObserver((mutations) => {
      installBubbleNavigation();
      wireDormantBubbleWidgets();
      if (AppState?.currentPage === 'dashboard') appendBubbleDashboardCard();
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) wireDormantBubbleWidgets(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.openBubbleCreateModal = openBubbleCreateModal;
  window.renderBubbleHub = renderBubbleHub;

  // Register the route immediately, before DOMContentLoaded handlers restore the last page.
  installBubbleRouteDefinition();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBubbleDiscovery, { once: true });
  } else {
    bootBubbleDiscovery();
  }
})();
