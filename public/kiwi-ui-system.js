(function () {
  'use strict';

  const SYSTEM_VERSION = '1.0.1';
  const ENHANCED = 'kiwiSelectEnhanced';
  let active = null;
  let portal = null;
  let searchInput = null;
  let optionList = null;
  let panelTitle = null;
  let activeIndex = -1;

  function enforceViewportPolicy() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }

  function ensureStylesheet() {
    if (document.querySelector('link[data-kiwi-ui-system="true"]')) return;
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .some((link) => /\/kiwi-ui-system\.css(?:\?|$)/.test(link.getAttribute('href') || ''));
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/kiwi-ui-system.css';
    link.dataset.kiwiUiSystem = 'true';
    document.head.appendChild(link);
  }

  function isEligible(select) {
    if (!(select instanceof HTMLSelectElement)) return false;
    if (select.multiple || Number(select.size || 0) > 1) return false;
    if (select.dataset.kiwiNativeSelect === 'true') return false;
    if (select.closest('[data-kiwi-select-ignore="true"]')) return false;
    return true;
  }

  function directLabelText(select) {
    const label = select.labels?.[0] || select.closest('label');
    if (!label) return '';
    const preferred = label.querySelector(':scope > span, :scope > .form-label, :scope > .field-label, :scope > .label');
    if (preferred) return preferred.textContent.trim();
    const clone = label.cloneNode(true);
    clone.querySelectorAll('select, input, textarea, button, .kiwi-select').forEach((node) => node.remove());
    return clone.textContent.trim();
  }

  function labelFor(select) {
    return (
      select.getAttribute('aria-label') ||
      directLabelText(select) ||
      select.getAttribute('name') ||
      'Choose option'
    ).trim();
  }

  function selectedOption(select) {
    return select.options[select.selectedIndex] || select.options[0] || null;
  }

  function createTrigger(select) {
    const wrapper = document.createElement('div');
    wrapper.className = 'kiwi-select';

    const trigger = document.createElement('div');
    trigger.className = 'kiwi-select__trigger';
    trigger.tabIndex = select.disabled ? -1 : 0;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', labelFor(select));

    const value = document.createElement('span');
    value.className = 'kiwi-select__value';

    const chevron = document.createElement('span');
    chevron.className = 'kiwi-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '⌄';

    trigger.append(value, chevron);

    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger);
    select.classList.add('kiwi-select__native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    return { wrapper, trigger, value };
  }

  function syncState(state) {
    const { select, trigger, value } = state;
    const option = selectedOption(select);
    const text = option ? option.textContent.trim() : 'Choose option';
    value.textContent = text || 'Choose option';
    value.dataset.placeholder = (!option || option.value === '') ? 'true' : 'false';
    trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
    trigger.tabIndex = select.disabled ? -1 : 0;
    trigger.setAttribute('aria-label', labelFor(select));
    if (active?.select === select) {
      renderOptions();
      positionPanel();
    }
  }

  function enhance(select) {
    if (!isEligible(select) || select.dataset[ENHANCED] === 'true') return null;
    select.dataset[ENHANCED] = 'true';
    const ui = createTrigger(select);
    const state = { select, ...ui, observer: null };

    const open = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (select.disabled) return;
      openSelect(state);
    };

    ui.trigger.addEventListener('click', open);
    ui.trigger.addEventListener('keydown', (event) => {
      if (select.disabled) return;
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openSelect(state, { keyboard: true, direction: event.key === 'ArrowUp' ? -1 : 1 });
      }
    });

    const label = select.labels?.[0] || select.closest('label');
    if (label && !label.dataset.kiwiSelectLabelBound) {
      label.dataset.kiwiSelectLabelBound = 'true';
      label.addEventListener('click', (event) => {
        const targetSelect = label.querySelector('select[data-kiwi-select-enhanced="true"]');
        const trigger = targetSelect?.closest('.kiwi-select')?.querySelector('.kiwi-select__trigger');
        if (!targetSelect || !trigger || targetSelect.disabled) return;
        if (event.target.closest?.('.kiwi-select__trigger')) return;
        if (event.target === targetSelect) return;
        if (event.target.closest?.('input, textarea, button, a')) return;
        event.preventDefault();
        trigger.click();
      });
    }

    select.addEventListener('change', () => syncState(state));
    select.addEventListener('input', () => syncState(state));
    select.form?.addEventListener('reset', () => setTimeout(() => syncState(state), 0));

    state.observer = new MutationObserver(() => syncState(state));
    state.observer.observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'selected', 'label', 'value'],
    });

    syncState(state);
    return state;
  }

  function ensurePortal() {
    if (portal) return portal;

    portal = document.createElement('div');
    portal.className = 'kiwi-select-portal';
    portal.dataset.open = 'false';
    portal.innerHTML = [
      '<button class="kiwi-select-backdrop" type="button" tabindex="-1" aria-label="Close selector"></button>',
      '<section class="kiwi-select-panel" role="dialog" aria-modal="false">',
      '  <div class="kiwi-select-panel__head">',
      '    <div class="kiwi-select-panel__title"></div>',
      '    <button class="kiwi-select-panel__close" type="button" aria-label="Close selector">×</button>',
      '  </div>',
      '  <div class="kiwi-select-search-wrap" hidden>',
      '    <input class="kiwi-select-search" type="search" autocomplete="off" spellcheck="false" />',
      '  </div>',
      '  <div class="kiwi-select-options" role="listbox"></div>',
      '</section>',
    ].join('');

    document.body.appendChild(portal);
    searchInput = portal.querySelector('.kiwi-select-search');
    optionList = portal.querySelector('.kiwi-select-options');
    panelTitle = portal.querySelector('.kiwi-select-panel__title');

    portal.querySelector('.kiwi-select-backdrop').addEventListener('click', closeSelect);
    portal.querySelector('.kiwi-select-panel__close').addEventListener('click', closeSelect);

    searchInput.addEventListener('input', () => renderOptions(searchInput.value));
    searchInput.addEventListener('keydown', handlePanelKeydown);
    optionList.addEventListener('keydown', handlePanelKeydown);

    return portal;
  }

  function flattenedOptions(select) {
    const rows = [];
    for (const child of select.children) {
      if (child instanceof HTMLOptGroupElement) {
        rows.push({ kind: 'group', label: child.label });
        for (const option of child.children) rows.push({ kind: 'option', option });
      } else if (child instanceof HTMLOptionElement) {
        rows.push({ kind: 'option', option: child });
      }
    }
    return rows;
  }

  function selectableButtons() {
    if (!optionList) return [];
    return Array.from(optionList.querySelectorAll('.kiwi-select-option:not(:disabled)'));
  }

  function setActiveIndex(index, { focus = false } = {}) {
    const buttons = selectableButtons();
    if (!buttons.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons.forEach((button, i) => button.dataset.active = i === activeIndex ? 'true' : 'false');
    const button = buttons[activeIndex];
    button.scrollIntoView({ block: 'nearest' });
    if (focus) button.focus({ preventScroll: true });
  }

  function chooseOption(option) {
    if (!active || option.disabled) return;
    const select = active.select;
    if (select.value !== option.value || select.selectedIndex !== option.index) {
      select.selectedIndex = option.index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncState(active);
    closeSelect({ restoreFocus: true });
  }

  function renderOptions(filter = '') {
    if (!active || !optionList) return;
    const query = String(filter || '').trim().toLowerCase();
    const rows = flattenedOptions(active.select);
    const fragment = document.createDocumentFragment();
    let visibleOptions = 0;
    let selectedVisibleIndex = -1;
    let pendingGroup = null;

    for (const row of rows) {
      if (row.kind === 'group') {
        pendingGroup = row.label;
        continue;
      }

      const option = row.option;
      const label = option.textContent.trim();
      if (query && !label.toLowerCase().includes(query)) continue;

      if (pendingGroup) {
        const group = document.createElement('div');
        group.className = 'kiwi-select-group';
        group.textContent = pendingGroup;
        fragment.append(group);
        pendingGroup = null;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kiwi-select-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      button.disabled = option.disabled;
      button.dataset.optionIndex = String(option.index);

      const text = document.createElement('span');
      text.className = 'kiwi-select-option__label';
      text.textContent = label || '—';

      const check = document.createElement('span');
      check.className = 'kiwi-select-option__check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = option.selected ? '✓' : '';

      button.append(text, check);
      button.addEventListener('click', () => chooseOption(option));
      fragment.append(button);

      if (!option.disabled) {
        if (option.selected) selectedVisibleIndex = visibleOptions;
        visibleOptions += 1;
      }
    }

    optionList.replaceChildren(fragment);
    if (!visibleOptions) {
      const empty = document.createElement('div');
      empty.className = 'kiwi-select-empty';
      empty.textContent = query ? 'No matching options.' : 'No options available.';
      optionList.append(empty);
      activeIndex = -1;
      return;
    }

    setActiveIndex(selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0);
  }

  function panelModeFor(select) {
    return select?.dataset?.kiwiSelectMode === 'sheet' ? 'sheet' : 'anchored';
  }

  function visualViewportMetrics() {
    const visual = window.visualViewport;
    if (!visual) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    return {
      left: visual.offsetLeft,
      top: visual.offsetTop,
      width: visual.width,
      height: visual.height,
    };
  }

  function clearPanelPosition(panel) {
    for (const property of [
      '--kiwi-select-left',
      '--kiwi-select-top',
      '--kiwi-select-width',
      '--kiwi-select-max-height',
    ]) panel.style.removeProperty(property);
  }

  function positionPanel() {
    if (!active || !portal) return;
    const panel = portal.querySelector('.kiwi-select-panel');
    const mode = panelModeFor(active.select);
    portal.dataset.mode = mode;

    if (mode === 'sheet') {
      delete portal.dataset.placement;
      clearPanelPosition(panel);
      return;
    }

    const rect = active.trigger.getBoundingClientRect();
    const viewport = visualViewportMetrics();
    const viewportPadding = 10;
    const gap = 7;
    const viewportRight = viewport.left + viewport.width;
    const viewportBottom = viewport.top + viewport.height;
    const maxAllowedWidth = Math.max(180, viewport.width - (viewportPadding * 2));
    const desiredWidth = Math.min(
      maxAllowedWidth,
      Math.max(Math.min(rect.width, maxAllowedWidth), Math.min(220, maxAllowedWidth)),
    );
    const availableBelow = Math.max(0, viewportBottom - rect.bottom - viewportPadding - gap);
    const availableAbove = Math.max(0, rect.top - viewport.top - viewportPadding - gap);
    const preferredMinimum = Math.min(220, Math.max(140, viewport.height * 0.28));
    const placeAbove = availableBelow < preferredMinimum && availableAbove > availableBelow;
    const available = placeAbove ? availableAbove : availableBelow;
    const maxHeight = Math.max(120, Math.min(460, available));

    panel.style.setProperty('--kiwi-select-width', desiredWidth + 'px');
    panel.style.setProperty('--kiwi-select-max-height', maxHeight + 'px');

    const measuredHeight = Math.min(
      maxHeight,
      Math.max(0, panel.scrollHeight || panel.getBoundingClientRect().height || maxHeight),
    );
    const left = Math.max(
      viewport.left + viewportPadding,
      Math.min(rect.left, viewportRight - desiredWidth - viewportPadding),
    );
    const top = placeAbove
      ? Math.max(viewport.top + viewportPadding, rect.top - gap - measuredHeight)
      : Math.min(rect.bottom + gap, viewportBottom - viewportPadding - measuredHeight);

    portal.dataset.placement = placeAbove ? 'above' : 'below';
    panel.style.setProperty('--kiwi-select-left', left + 'px');
    panel.style.setProperty('--kiwi-select-top', top + 'px');
  }

  function openSelect(state, { keyboard = false, direction = 1 } = {}) {
    ensurePortal();
    if (active && active !== state) closeSelect({ restoreFocus: false });

    active = state;
    active.trigger.setAttribute('aria-expanded', 'true');
    portal.dataset.open = 'true';
    document.body.dataset.kiwiSelectOpen = 'true';

    const title = labelFor(active.select);
    panelTitle.textContent = title;
    const optionCount = active.select.options.length;
    const searchWrap = portal.querySelector('.kiwi-select-search-wrap');
    searchWrap.hidden = optionCount <= 8;
    searchInput.value = '';
    searchInput.placeholder = 'Search ' + title.toLowerCase();

    renderOptions();
    positionPanel();

    requestAnimationFrame(() => {
      positionPanel();
      if (!active) return;
      if (!searchWrap.hidden) {
        searchInput.focus({ preventScroll: true });
      } else if (keyboard) {
        setActiveIndex(activeIndex + (direction < 0 ? -1 : 0), { focus: true });
      }
    });
  }

  function closeSelect({ restoreFocus = true } = {}) {
    if (!active || !portal) return;
    const trigger = active.trigger;
    trigger.setAttribute('aria-expanded', 'false');
    portal.dataset.open = 'false';
    delete portal.dataset.placement;
    delete document.body.dataset.kiwiSelectOpen;
    active = null;
    activeIndex = -1;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function handlePanelKeydown(event) {
    if (!active) return;
    const buttons = selectableButtons();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelect();
      return;
    }
    if (!buttons.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(activeIndex + 1, buttons.length - 1), { focus: true });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(activeIndex - 1, 0), { focus: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0, { focus: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(buttons.length - 1, { focus: true });
    } else if (event.key === 'Enter' && document.activeElement?.classList?.contains('kiwi-select-option')) {
      event.preventDefault();
      document.activeElement.click();
    }
  }

  function scan(root = document) {
    if (root instanceof HTMLSelectElement) enhance(root);
    root.querySelectorAll?.('select').forEach(enhance);
  }

  function mutationContainsSelect(mutation) {
    if (mutation.type === 'attributes' && mutation.target instanceof HTMLSelectElement) return true;
    return Array.from(mutation.addedNodes || []).some((node) =>
      node instanceof HTMLSelectElement || node.querySelector?.('select'),
    );
  }

  function boot() {
    enforceViewportPolicy();
    ensureStylesheet();
    scan(document);

    const observer = new MutationObserver((mutations) => {
      if (!mutations.some(mutationContainsSelect)) return;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLSelectElement) {
          enhance(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });

    window.addEventListener('resize', positionPanel, { passive: true });
    window.addEventListener('scroll', positionPanel, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', positionPanel, { passive: true });
    window.visualViewport?.addEventListener('scroll', positionPanel, { passive: true });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && active) {
        event.preventDefault();
        closeSelect();
      }
    });

    window.KIWI_UI_SYSTEM = Object.freeze({
      version: SYSTEM_VERSION,
      enhanceSelect: enhance,
      refresh: scan,
      closeSelect,
      enforceViewportPolicy,
    });
  }

  enforceViewportPolicy();
  ensureStylesheet();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
