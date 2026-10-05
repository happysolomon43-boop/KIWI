(function installStudyUnifiedUpload(global) {
  'use strict';

  const LEGACY_FORMAT_TABS = new Set(['image', 'pdf', 'docx', 'txt', 'md', 'pptx']);
  const MAX_FILE_BYTES = 7 * 1024 * 1024;
  const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.pptx,image/png,image/jpeg,image/webp,image/heic,image/heif';
  const FORMAT_CONFIG = Object.freeze({
    image: { label: 'IMAGE' }, pdf: { label: 'PDF' }, docx: { label: 'DOCX' },
    txt: { label: 'TXT' }, md: { label: 'MARKDOWN' }, pptx: { label: 'PPTX' },
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

  function selectedDeckId() {
    const select = document.getElementById('importSubject');
    const option = select?.options?.[select.selectedIndex];
    return option?.dataset?.deck || null;
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
            <p class="su-upload__lede">Drop supported sources together and KIWI will route every file through the correct Study importer automatically. No format hunting, no duplicate upload flows.</p>
          </div>
          <div class="su-upload__target" aria-live="polite">
            <span class="su-upload__target-label">Cards will go to</span>
            <span class="su-upload__target-value" data-su-target>Selected subject</span>
          </div>
        </div>

        <div class="su-upload__body">
          <div class="su-upload__drop" data-su-drop role="button" tabindex="0" aria-label="Choose a supported study source file">
            <input type="file" data-su-input hidden multiple accept="${ACCEPT}">
            <div class="su-upload__mark" aria-hidden="true">＋</div>
            <strong>Drop a source here</strong>
            <span class="su-upload__drop-copy">or choose several files from your device. KIWI detects each format and keeps one clear queue.</span>
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
            <div class="su-upload__limits">Multiple mixed sources · 7 MB per file. Images support PNG, JPG, WEBP, HEIC and HEIF.</div>
          </aside>
        </div>

        <div class="su-upload__selection" data-su-selection>
          <div class="su-upload__file-badge" data-su-badge>FILE</div>
          <div class="su-upload__file-copy">
            <div class="su-upload__file-name" data-su-name></div>
            <div class="su-upload__file-meta" data-su-meta></div>
          </div>
          <button class="su-upload__remove" type="button" data-su-remove>Clear all</button>
        </div>

        <div class="su-upload__footer">
          <div class="su-upload__status" data-su-status role="status" aria-live="polite">Choose a supported source to begin.</div>
          <button class="btn btn-primary su-upload__generate" type="button" data-su-generate disabled>Generate cards from files</button>
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
    let selectedFiles = [];

    function syncTarget() {
      if (target) target.textContent = selectedSubjectName();
    }

    function clearFile({ quiet = false } = {}) {
      selectedFiles = [];
      input.value = '';
      selection.dataset.visible = 'false';
      badge.textContent = 'FILE';
      name.textContent = '';
      meta.textContent = '';
      generate.disabled = true;
      if (!quiet) setStatus(root, 'Choose a supported source to begin.');
    }

    function selectFiles(files) {
      const incoming = Array.from(files || []);
      const error = incoming.map(validateFile).find(Boolean);
      if (error) {
        setStatus(root, error, 'error');
        return;
      }
      selectedFiles = [...selectedFiles, ...incoming];
      if (!selectedFiles.length) return clearFile();
      const file = selectedFiles[0],format = formatForFile(file);
      const config = FORMAT_CONFIG[format];
      selection.dataset.visible = 'true';
      badge.textContent = selectedFiles.length === 1 ? config.label : String(selectedFiles.length);
      name.textContent = selectedFiles.length === 1 ? file.name : `${selectedFiles.length} files ready`;
      meta.textContent = selectedFiles.map(item => `${FORMAT_CONFIG[formatForFile(item)].label} · ${item.name}`).join('  •  ');
      generate.disabled = false;
      setStatus(root, `${selectedFiles.length} source${selectedFiles.length===1?' is':'s are'} ready for ${selectedSubjectName()}.`, 'ready');
    }

    function chooseFile() {
      input.click();
    }

    filesButton.addEventListener('click', () => activateFiles(tabs, panel));
    subject.addEventListener('change', () => {
      syncTarget();
      if (selectedFiles.length) setStatus(root, `${selectedFiles.length} source${selectedFiles.length===1?' is':'s are'} ready for ${selectedSubjectName()}.`, 'ready');
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
      selectFiles(input.files);
      input.value = '';
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
      selectFiles(event.dataTransfer?.files || []);
    });

    remove.addEventListener('click', () => {
      const removedName = selectedFiles.length ? `${selectedFiles.length} selected files` : '';
      clearFile();
      if (removedName) announce(`${removedName} removed.`);
    });

    generate.addEventListener('click', async () => {
      const error = selectedFiles.map(validateFile).find(Boolean) || (!selectedFiles.length ? 'Choose at least one source file.' : null);
      if (error) {
        setStatus(root, error, 'error');
        return;
      }
      if (!selectedDeckId()) {
        setStatus(root, `No deck exists for ${selectedSubjectName()} yet. Use Create & Use above or add a card first.`, 'error');
        return;
      }

      generate.disabled = true;
      const queue=[...selectedFiles],deckId=selectedDeckId();let submitted=0;
      try{
        if(typeof global.KIWIStudySourceImport!=='function')throw new Error('Study importer is still loading. Try again in a moment.');
        for(const file of queue){setStatus(root,`Importing ${submitted+1} of ${queue.length}: ${file.name}…`,'ready');await global.KIWIStudySourceImport({deckId,file,format:formatForFile(file),subjectHint:hint.value.trim()});submitted++;}
        setStatus(root,`${submitted} source${submitted===1?'':'s'} submitted. KIWI is generating the cards.`,'ready');
        clearFile({quiet:true});
        global.setTimeout(()=>{ if(typeof global.navigateTo==='function')global.navigateTo('library'); },1200);
      }catch(importError){setStatus(root,`${submitted} of ${queue.length} submitted. ${importError.message||'Import failed.'}`,'error');generate.disabled=false;}
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
