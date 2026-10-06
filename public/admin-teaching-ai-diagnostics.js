(function initTeachingAdminDiagnostics(global) {
  'use strict';

  const JOB_KEY = 'kiwi.admin.teaching-ai-diagnostic.job';
  let pollTimer = null;

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const adminHeaders = () => {
    try {
      return sessionStorage.getItem('kiwi_admin_unlocked') === '1' ? {'x-admin-token':'kiwi-admin-1969'} : {};
    } catch (_) { return {}; }
  };
  const request = async (path, options = {}) => {
    if (typeof global.apiRequest !== 'function') throw new Error('KIWI API client is not ready.');
    return global.apiRequest(path, {...options, headers:{...adminHeaders(), ...(options.headers || {})}});
  };

  function rememberJob(id) {
    try { if (id) localStorage.setItem(JOB_KEY, String(id)); else localStorage.removeItem(JOB_KEY); } catch (_) {}
  }
  function rememberedJob() {
    try { return localStorage.getItem(JOB_KEY); } catch (_) { return null; }
  }

  function statusTone(status) {
    if (status === 'PASSED') return 'var(--green-bright)';
    if (status === 'FAILED') return 'var(--red-bright)';
    return 'var(--amber, #e7b765)';
  }

  function renderJob(root, job) {
    if (!root || !job) return;
    const progress = job.live || {};
    const total = Number(progress.totalFamilies) || 20;
    const done = Number(progress.completedFamilies) || 0;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const status = String(job.status || 'QUEUED');
    const resultHost = root.querySelector('[data-ai-diag-results]');
    const statusEl = root.querySelector('[data-ai-diag-status]');
    const bar = root.querySelector('[data-ai-diag-bar]');
    const runBtn = root.querySelector('[data-ai-diag-run]');
    if (statusEl) statusEl.innerHTML = `<strong style="color:${statusTone(status)}">${escape(status)}</strong> · ${done}/${total} prompt families${progress.currentFamily ? ` · testing ${escape(progress.currentFamily)}` : ''}`;
    if (bar) bar.style.width = `${percent}%`;
    if (runBtn) {
      const running = ['QUEUED','RUNNING'].includes(status);
      runBtn.disabled = running;
      runBtn.textContent = running ? `Running in background… ${percent}%` : 'Run Teaching AI diagnostic';
    }
    const structural = job.structural;
    const rows = (progress.results || []).slice().reverse().map((item) => `
      <div style="display:grid;grid-template-columns:minmax(70px,.65fr) minmax(0,1.6fr) auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <strong style="font-family:var(--font-mono);font-size:11px;color:${item.passed ? 'var(--green-bright)' : 'var(--red-bright)'};">${escape(item.familyId)}</strong>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-3);">${escape(item.modelId || item.rejectionReason || item.capabilityId || 'Completed')}</span>
        <span style="font-size:12px;font-weight:700;">${item.passed ? 'PASS' : 'FAIL'}</span>
      </div>`).join('');
    if (resultHost) resultHost.innerHTML = `
      ${structural ? `<div style="padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);margin-bottom:10px;font-size:12px;line-height:1.55;color:var(--text-3);">
        <strong style="color:var(--text);">Structural census passed</strong><br>
        ${Number(structural.capabilityCount) || 0} capabilities · ${Number(structural.modelBackedCapabilityCount) || 0} model-backed · ${Number(structural.promptFamilyCount) || 0} frozen prompt families
      </div>` : ''}
      ${rows || '<div style="font-size:12px;color:var(--text-4);padding:8px 0;">Live family results will appear here while you use the rest of KIWI.</div>'}
      ${job.error ? `<div style="color:var(--red-bright);font-size:12px;margin-top:10px;">${escape(job.error.message || job.error.code)}</div>` : ''}`;
    if (['PASSED','FAILED'].includes(status)) {
      rememberJob(null);
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  }

  async function loadJob(root, id) {
    if (!id) return null;
    try {
      const job = await request(`/teaching/admin/ai-diagnostics/${encodeURIComponent(id)}`, {headers:adminHeaders()});
      renderJob(root, job);
      return job;
    } catch (_) { return null; }
  }

  function poll(root, id) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!document.body.contains(root)) return;
      loadJob(root, id).catch(() => {});
    }, 3000);
  }

  async function start(root) {
    const button = root.querySelector('[data-ai-diag-run]');
    if (button) { button.disabled = true; button.textContent = 'Starting background diagnostic…'; }
    try {
      const job = await request('/teaching/admin/ai-diagnostics', {method:'POST',headers:adminHeaders()});
      rememberJob(job.jobId);
      renderJob(root, job);
      poll(root, job.jobId);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Run Teaching AI diagnostic'; }
      const status = root.querySelector('[data-ai-diag-status]');
      if (status) status.textContent = error?.message || 'Could not start Teaching AI diagnostic.';
    }
  }

  async function mount() {
    const page = document.querySelector('#mainContent .page-wrap');
    if (!page || page.querySelector('[data-teaching-ai-admin-card]')) return;
    const title = page.querySelector('.section-title');
    if (!title || !/admin panel/i.test(title.textContent || '')) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.teachingAiAdminCard = 'true';
    card.style.marginTop = '16px';
    card.innerHTML = `
      <div class="settings-section-title">Teaching AI Diagnostics</div>
      <div style="font-size:var(--text-sm);color:var(--text-3);line-height:1.6;margin-bottom:14px;">
        Verify every Teaching capability/prompt binding, then run one live production-route smoke test for each frozen Teaching prompt family. The server continues after you leave this page.
      </div>
      <div style="height:7px;border-radius:99px;background:var(--surface-2);overflow:hidden;margin-bottom:10px;"><div data-ai-diag-bar style="height:100%;width:0;background:var(--green-bright);transition:width .25s ease;"></div></div>
      <div data-ai-diag-status style="font-size:12px;color:var(--text-3);margin-bottom:12px;">No diagnostic is running.</div>
      <button class="btn btn-primary btn-sm" data-ai-diag-run>Run Teaching AI diagnostic</button>
      <div data-ai-diag-results style="margin-top:14px;max-height:360px;overflow:auto;"></div>`;
    page.appendChild(card);
    card.querySelector('[data-ai-diag-run]')?.addEventListener('click', () => start(card));
    const saved = rememberedJob();
    if (saved) {
      const job = await loadJob(card, saved);
      if (job && ['QUEUED','RUNNING'].includes(job.status)) poll(card, saved);
    } else {
      try {
        const listing = await request('/teaching/admin/ai-diagnostics', {headers:adminHeaders()});
        const latest = listing?.jobs?.[0];
        if (latest) renderJob(card, latest);
      } catch (_) {}
    }
  }

  const observer = new MutationObserver(() => mount().catch(() => {}));
  if (document.documentElement) observer.observe(document.documentElement, {childList:true,subtree:true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount().catch(() => {}), {once:true});
  else mount().catch(() => {});
})(window);
