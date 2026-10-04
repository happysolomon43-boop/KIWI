(function installStudyUnifiedUpload(global) {
  'use strict';

  const LEGACY_FORMAT_TABS = new Set(['image', 'pdf', 'docx', 'txt', 'md', 'pptx']);
  const MAX_FILE_BYTES = 7 * 1024 * 1024;
  const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.pptx,image/png,image/jpeg,image/webp,image/heic,image/heif';
  const FORMAT_CONFIG = Object.freeze({
    image: {
      label: 'IMAGE',
      inputId: 'imageFileInput',
      importButtonId: 'imageImportBtn',
      confirmButtonId: 'imageConfirmBtn',
      hintInputId: null,
    },
    pdf: {
      label: 'PDF',
      inputId: 'pdfFileInput',
      importButtonId: 'pdfImportBtn',
      confirmButtonId: 'pdfConfirmBtn',
      hintInputId: 'pdfSubjectHint',
    },
    docx: {
      label: 'DOCX',
      inputId: 'docxFileInput',
      importButtonId: 'docxImportBtn',
      confirmButtonId: 'docxConfirmBtn',
      hintInputId: 'docxSubjectHint',
    },
    txt: {
      label: 'TXT',
      inputId: 'txtFileInput',
      importButtonId: 'txtImportBtn',
      confirmButtonId: 'txtConfirmBtn',
      hintInputId: 'txtSubjectHint',
    },
    md: {
      label: 'MARKDOWN',
      inputId: 'mdFileInput',
      importButtonId: 'mdImportBtn',
      confirmButtonId: 'mdConfirmBtn',
      hintInputId: 'mdSubjectHint',
    },
    pptx: {
      label: 'PPTX',
      inputId: 'pptxFileInput',
      importButtonId: 'pptxImportBtn',
      confirmButtonId: 'pptxConfirmBtn',
      hintInputId: 'pptxSubjectHint',
    },
  });

  let scheduled = false;

  function extension(name) {
    const value = String(name || '');
    const index = value.lastIndexOf('.');
    return index < 0 ? '' : value.slice(index + 1).toLowerCase();
  }

  function prettyBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
    return `${Math.round(value / 104857.6) / 10} MB`;
  }

  function formatForFile(file) {
    const ext = extension(file?.name);
    const mime = String(file?.type || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'].includes(ext)) return 'image';
    if (mime.startsWith('image/') && ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mime)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx') return 'docx';
    if (ext === 'txt') return 'txt';
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (ext === 'pptx') return 'pptx';
    return null;
  }

  function validateFile(file) {
    if (!file) return 'Choose a file to generate cards from.';
    if (!formatForFile(file)) return 'That file type is not supported here. Use PDF, DOCX, TXT, Markdown, PPTX, PNG, JPG, WEBP, HEIC, or HEIF.';
    if (!file.size) return `${file.name || 'This file'} is empty.`;
    if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than the current 7 MB Study generation limit.`;
    return null;
  }

  function selectedSubjectName() {
    const select = document.getElementById('importSubject');
    const option = select?.options?.[select.selectedIndex];
    return option?.textContent?.trim() || 'Selected subject';
  }

  function announce(message) {
    const text = String(message || '').trim();
    if (!text) return;
    global.KIWI_UI_SYSTEM?.announce?.(text);
  }

  function setStatus(root, message, kind = '') {
    const status = root.querySelector('[data-su-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
    announce(message);
  }

  function assignFileToLegacyInput(input, file) {
    if (!input || !file) return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return Boolean(input.files && input.files[0]);
    } catch (_) {
      return false;
    }
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'import-tab-panel su-panel';
    panel.id = 'tab-files';
    panel.style.display = 'none';
    panel.innerHTML = `
      <section class="su-upload" data-su-root>
        <div class="su-upload__hero">
          <div>
            <div class="su-upload__eyebrow">Unified source intake</div>
            <h2 class="su-upload__title">Turn a file into study cards</h2>
            <p class="su-upload__lede">Drop one supported source and KIWI will route it through the correct Study importer automatically. No format hunting, no duplicate upload flows.</p>
          </div>
          <div class="su-upload__target" aria-live="polite">
            <span class="su-upload__target-label">Cards will go to</span>
            <span class="su-upload__target-value" data-su-target>Selected subject</span>
          </div>
        </div>

        <div class="su-upload__body">
          <div class="su-upload__drop" data-su-drop role="button" tabindex="0" aria-label="Choose a supported study source file">
            <input type="file" data-su-input hidden accept="${ACCEPT}">
            <div class="su-upload__mark" aria-hidden="true">＋</div>
            <strong>Drop a source here</strong>
            <span class="su-upload__drop-copy">or choose a file from your device. KIWI detects the format and keeps the existing generation pipeline behind the scenes.</span>
            <span class="su-upload__browse">BROWSE FILES</span>
          </div>

          <aside class="su-upload__side" aria-label="Supported file types and options">
            <div class="su-upload__formats" aria-label="Supported formats">
              <span class="su-upload__format">PDF</span>
              <span class="su-upload__format">DOCX</span>
              <span class="su-upload__format">PPTX</span>
              <span class="su-upload__format">TXT</span>
              <span class="su-upload__format">MD</span>
              <span class="su-upload__format">IMAGE</span>
            </div>
            <div class="su-upload__hint-wrap">
              <label for="studyUnifiedSubjectHint">Subject hint · optional</label>
              <input class="input su-upload__hint" id="studyUnifiedSubjectHint" data-su-hint placeholder="e.g. Organic Chemistry" autocomplete="off">
            </div>
            <div class="su-upload__limits">One source at a time · 7 MB max. Images support PNG, JPG, WEBP, HEIC and HEIF.</div>
          </aside>
        </div>

        <div class="su-upload__selection" data-su-selection>
          <div class="su-upload__file-badge" data-su-badge>FILE</div>
          <div class="su-upload__file-copy">
            <div class="su-upload__file-name" data-su-name></div>
            <div class="su-upload__file-meta" data-su-meta></div>
          </div>
          <button class="su-upload__remove" type="button" data-su-remove>Remove</button>
        </div>

        <div class="su-upload__footer">
          <div class="su-upload__status" data-su-status role="status" aria-live="polite">Choose a supported source to begin.</div>
          <button class="btn btn-primary su-upload__generate" type="button" data-su-generate disabled>Generate cards</button>
        </div>
        <div class="su-upload__caption">Image Occlusion remains separate because it is an interactive mask editor, not a standard source-to-cards import.</div>
      </section>`;
    return panel;
  }

  function activateFiles(tabs, panel) {
    tabs.querySelectorAll('.import-tab-btn').forEach((button) => {
      button.classList.remove('btn-primary');
      button.classList.add('btn-secondary');
    });
    document.querySelectorAll('.import-tab-panel').forEach((candidate) => {
      candidate.style.display = 'none';
    });
    const filesButton = tabs.querySelector('[data-study-files-tab]');
    filesButton?.classList.add('btn-primary');
    filesButton?.classList.remove('btn-secondary');
    panel.style.display = 'block';
    try { localStorage.setItem('kiwi_last_import_tab', 'files'); } catch (_) {}
  }

  function decorateImport() {
    const tabs = document.querySelector('.import-tabs');
    const subject = document.getElementById('importSubject');
    if (!tabs || !subject || !document.getElementById('tab-manual')) return;
    if (tabs.dataset.studyUnifiedUpload === 'true') return;

    tabs.dataset.studyUnifiedUpload = 'true';

    const sectionSub = tabs.closest('.page-wrap')?.querySelector('.section-sub');
    if (sectionSub) sectionSub.textContent = 'Add cards manually, from notes, or from a source file without choosing a format-specific upload flow';

    let activeLegacyFormat = null;
    tabs.querySelectorAll('.import-tab-btn').forEach((button) => {
      const tab = button.dataset.tab;
      if (!LEGACY_FORMAT_TABS.has(tab)) return;
      const wasActive = button.classList.contains('btn-primary');
      button.dataset.studyFormatLegacy = 'true';
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;
      if (wasActive) activeLegacyFormat = tab;
      const legacyPanel = document.getElementById(`tab-${tab}`);
      if (legacyPanel) legacyPanel.dataset.studyFormatLegacy = 'true';
    });

    const filesButton = document.createElement('button');
    filesButton.type = 'button';
    filesButton.className = 'btn btn-secondary btn-sm import-tab-btn study-files-tab';
    filesButton.dataset.tab = 'files';
    filesButton.dataset.studyFilesTab = 'true';
    filesButton.textContent = 'Files';

    const quizletButton = tabs.querySelector('[data-tab="quizlet"]');
    if (quizletButton) tabs.insertBefore(filesButton, quizletButton);
    else tabs.appendChild(filesButton);

    const panel = buildPanel();
    const quizletPanel = document.getElementById('tab-quizlet');
    if (quizletPanel) quizletPanel.insertAdjacentElement('beforebegin', panel);
    else tabs.insertAdjacentElement('afterend', panel);

    const root = panel.querySelector('[data-su-root]');
    const input = root.querySelector('[data-su-input]');
    const drop = root.querySelector('[data-su-drop]');
    const selection = root.querySelector('[data-su-selection]');
    const badge = root.querySelector('[data-su-badge]');
    const name = root.querySelector('[data-su-name]');
    const meta = root.querySelector('[data-su-meta]');
    const remove = root.querySelector('[data-su-remove]');
    const generate = root.querySelector('[data-su-generate]');
    const hint = root.querySelector('[data-su-hint]');
    const target = root.querySelector('[data-su-target]');
    let selectedFile = null;

    function syncTarget() {
      if (target) target.textContent = selectedSubjectName();
    }

    function clearFile({ quiet = false } = {}) {
      selectedFile = null;
      input.value = '';
      selection.dataset.visible = 'false';
      badge.textContent = 'FILE';
      name.textContent = '';
      meta.textContent = '';
      generate.disabled = true;
      if (!quiet) setStatus(root, 'Choose a supported source to begin.');
    }

    function selectFile(file) {
      const error = validateFile(file);
      if (error) {
        clearFile({ quiet: true });
        setStatus(root, error, 'error');
        return;
      }
      selectedFile = file;
      const format = formatForFile(file);
      const config = FORMAT_CONFIG[format];
      selection.dataset.visible = 'true';
      badge.textContent = config.label;
      name.textContent = file.name;
      meta.textContent = `${config.label} · ${prettyBytes(file.size)}`;
      generate.disabled = false;
      setStatus(root, `${file.name} is ready. Generate cards into ${selectedSubjectName()}.`, 'ready');
    }

    function chooseFile() {
      input.click();
    }

    filesButton.addEventListener('click', () => activateFiles(tabs, panel));
    subject.addEventListener('change', () => {
      syncTarget();
      if (selectedFile) setStatus(root, `${selectedFile.name} is ready. Generate cards into ${selectedSubjectName()}.`, 'ready');
    });

    drop.addEventListener('click', (event) => {
      if (event.target !== input) chooseFile();
    });
    drop.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseFile();
      }
    });
    input.addEventListener('change', () => {
      selectFile(input.files?.[0] || null);
    });

    for (const eventName of ['dragenter', 'dragover']) {
      drop.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        drop.dataset.drag = 'true';
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      drop.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        drop.dataset.drag = 'false';
      });
    }
    drop.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 1) {
        setStatus(root, 'Study generates from one source at a time. Choose the first file you want to use.', 'error');
        return;
      }
      selectFile(files[0] || null);
    });

    remove.addEventListener('click', () => {
      const removedName = selectedFile?.name;
      clearFile();
      if (removedName) announce(`${removedName} removed.`);
    });

    generate.addEventListener('click', () => {
      const error = validateFile(selectedFile);
      if (error) {
        setStatus(root, error, 'error');
        return;
      }

      const format = formatForFile(selectedFile);
      const config = FORMAT_CONFIG[format];
      const legacyInput = document.getElementById(config.inputId);
      const importButton = document.getElementById(config.importButtonId);
      const confirmButton = document.getElementById(config.confirmButtonId);
      const legacyHint = config.hintInputId ? document.getElementById(config.hintInputId) : null;

      if (!legacyInput || !importButton || !confirmButton) {
        setStatus(root, 'This importer is unavailable right now. Refresh the page and try again.', 'error');
        return;
      }
      if (!assignFileToLegacyInput(legacyInput, selectedFile)) {
        setStatus(root, 'Your browser could not hand this file to the Study importer. Choose the file again after refreshing.', 'error');
        return;
      }
      if (legacyHint) legacyHint.value = hint.value.trim();

      generate.disabled = true;
      setStatus(root, `Starting ${config.label} generation for ${selectedSubjectName()}…`, 'ready');

      // Preserve the proven Study contracts: the legacy first-step click validates
      // deck ownership and captures image state; the confirm click then performs
      // the existing navigate-first generation, polling and failure handling.
      importButton.click();
      global.setTimeout(() => {
        if (!document.documentElement.contains(confirmButton)) return;
        confirmButton.click();
      }, 0);
    });

    syncTarget();
    clearFile({ quiet: true });

    let lastTab = '';
    try { lastTab = localStorage.getItem('kiwi_last_import_tab') || ''; } catch (_) {}
    if (lastTab === 'files' || LEGACY_FORMAT_TABS.has(lastTab) || activeLegacyFormat) {
      activateFiles(tabs, panel);
    }
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    global.requestAnimationFrame(() => {
      scheduled = false;
      decorateImport();
    });
  }

  function boot() {
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleDecorate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
