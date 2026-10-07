const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};

if (typeof kiwiApiRequest !== 'function') {
  throw new Error('KIWI shared API client must load before Teaching D08.');
}

const courseSurface = window.KIWITeachingCourses;
if (!courseSurface || typeof courseSurface.registerSection !== 'function') {
  throw new Error('KIWI Teaching course surface must load before Teaching D08.');
}

const D08_STYLE_ID = 'teachingD08Styles';
const D08_PREVIEW_ID = 'teachingD08Preview';
const ANALYSIS_COUNTDOWN_MS = 5 * 60 * 1000;

function installStyles() {
  if (document.getElementById(D08_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = D08_STYLE_ID;
  style.textContent = `
    .teaching-course-feature-card{
      min-height:210px;display:flex;flex-direction:column;padding:22px;
      border:1px solid var(--teaching-border);border-radius:21px;
      background:linear-gradient(145deg,rgba(9,35,27,.78),rgba(4,21,16,.72));
      box-shadow:0 14px 42px rgba(0,0,0,.13)
    }
    .teaching-course-feature-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
    .teaching-course-feature-card h3{margin:8px 0 0;font-family:var(--font-display);font-size:22px;letter-spacing:-.035em}
    .teaching-course-feature-card p{margin:11px 0 0;color:var(--teaching-muted);font-size:13px;line-height:1.6}
    .teaching-course-feature-card__status{flex:0 0 auto;padding:6px 9px;border-radius:999px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-family:var(--font-mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase}
    .teaching-d08-mini-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:18px}
    .teaching-d08-mini-metric{padding:11px;border:1px solid var(--teaching-border);border-radius:13px;background:rgba(1,12,9,.4)}
    .teaching-d08-mini-metric strong{display:block;color:var(--teaching-text);font-size:18px}
    .teaching-d08-mini-metric span{display:block;margin-top:3px;color:var(--teaching-muted);font-size:10px;line-height:1.3}
    .teaching-course-feature-card__actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:auto;padding-top:18px}
    .teaching-d08-link-button{min-height:42px;padding:0 14px;border:1px solid var(--teaching-border);border-radius:12px;background:rgba(255,255,255,.02);color:#cce6db;cursor:pointer;font-weight:700}
    .teaching-d08-link-button:hover,.teaching-d08-link-button:focus-visible{outline:none;border-color:var(--teaching-border-strong);background:var(--teaching-accent-soft)}
    .teaching-d08-link-button--primary{border-color:transparent;background:var(--teaching-accent);color:#032116}
    .teaching-d08-setup-list{display:grid;gap:10px;margin-top:18px}
    .teaching-d08-setup-step{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px;border:1px solid var(--teaching-border);border-radius:15px;background:rgba(1,12,9,.34)}
    .teaching-d08-setup-step__mark{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-weight:900}
    .teaching-d08-setup-step strong,.teaching-d08-setup-step small{display:block}.teaching-d08-setup-step small{margin-top:4px;color:var(--teaching-muted);line-height:1.45}
    .teaching-d08-analysis-countdown{display:inline-flex;align-items:center;gap:8px;width:max-content;max-width:100%;margin-top:10px;padding:6px 9px;border:1px solid rgba(126,226,184,.14);border-radius:999px;background:rgba(126,226,184,.07);color:#bfe7d4;font-family:var(--font-mono);line-height:1}
    .teaching-d08-analysis-countdown__label{color:#789c8d;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .teaching-d08-analysis-countdown__value{min-width:7.5ch;color:#d9f5e8;font-size:11px;font-weight:800;letter-spacing:.04em}
    .teaching-d08-analysis-countdown[data-expired="true"]{border-color:rgba(223,245,235,.08);background:rgba(255,255,255,.018);color:var(--teaching-muted)}
    .teaching-d08-analysis-countdown[data-expired="true"] .teaching-d08-analysis-countdown__value{color:#96aaa0}
    .teaching-d08-page{display:grid;gap:18px}
    .teaching-d08-page__head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:4px 2px 8px}
    .teaching-d08-page__head h2{margin:7px 0 0;font-family:var(--font-display);font-size:clamp(28px,4vw,42px);letter-spacing:-.045em}
    .teaching-d08-page__head p{max-width:660px;margin:10px 0 0;color:var(--teaching-muted);line-height:1.6}
    .teaching-d08-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:14px;align-items:start}
    .teaching-d08-stack{display:grid;gap:14px}
    .teaching-d08-card{padding:22px;border:1px solid var(--teaching-border);border-radius:21px;background:rgba(7,29,22,.68)}
    .teaching-d08-card h3{margin:8px 0 0;font-family:var(--font-display);font-size:23px;letter-spacing:-.03em}
    .teaching-d08-card p{color:var(--teaching-muted);line-height:1.6}
    .teaching-d08-plan-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
    .teaching-d08-status{display:inline-flex;align-items:center;padding:6px 9px;border-radius:999px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-family:var(--font-mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase}
    .teaching-d08-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:16px}
    .teaching-d08-metric{padding:12px;border:1px solid var(--teaching-border);border-radius:13px;background:rgba(2,14,10,.5)}
    .teaching-d08-metric strong{display:block;font-size:20px;color:var(--teaching-text)}
    .teaching-d08-metric span{display:block;margin-top:3px;color:var(--teaching-muted);font-size:10px;line-height:1.3}
    .teaching-d08-topic{margin-top:10px;border:1px solid var(--teaching-border);border-radius:15px;overflow:hidden;background:rgba(1,12,9,.22)}
    .teaching-d08-topic summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 15px;cursor:pointer;font-weight:730;color:#d7ebe2}
    .teaching-d08-topic summary::marker{color:var(--teaching-accent)}
    .teaching-d08-topic__body{padding:0 15px 15px}
    .teaching-d08-subtopics{margin:0 0 12px;color:var(--teaching-muted);font-size:12px;line-height:1.5}
    .teaching-d08-unit{margin-top:9px;padding:12px;border-left:2px solid var(--teaching-border-strong);background:rgba(1,12,9,.36);border-radius:0 10px 10px 0}
    .teaching-d08-unit strong{display:block;font-size:13px}
    .teaching-d08-unit span{display:block;margin-top:5px;color:var(--teaching-muted);font-size:12px;line-height:1.5}
    .teaching-d08-list{display:grid;gap:9px;margin:14px 0 0;padding:0;list-style:none}
    .teaching-d08-list li{padding:11px 12px;border:1px solid var(--teaching-border);border-radius:12px;color:#b9d4c8;font-size:12px;line-height:1.5}
    .teaching-d08-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}
    .teaching-d08-revision-entry{border-color:rgba(83,190,143,.28);background:rgba(83,190,143,.055)}
    .teaching-d08-revision-panel{margin-top:18px;padding:20px;border:1px solid rgba(83,190,143,.22);border-radius:18px;background:linear-gradient(145deg,rgba(21,54,43,.72),rgba(5,25,19,.76));box-shadow:0 18px 48px rgba(0,0,0,.16)}
    .teaching-d08-revision-panel__head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
    .teaching-d08-revision-panel__head strong{display:block;margin-top:4px;font-family:var(--font-display);font-size:20px;letter-spacing:-.025em}
    .teaching-d08-revision-panel__head p{max-width:640px;margin:7px 0 0;color:var(--teaching-muted);font-size:12px;line-height:1.55}
    .teaching-d08-revision-panel__eyebrow{display:block;color:#7fd9b2;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
    .teaching-d08-revision-panel__close{flex:none;padding:7px 9px;border:0;background:transparent;color:var(--teaching-muted);font:inherit;font-size:11px;cursor:pointer}
    .teaching-d08-revision-panel__close:hover{color:var(--teaching-text)}
    .teaching-d08-revision-chooser{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0 0;padding:0;border:0}
    .teaching-d08-revision-chooser legend{grid-column:1/-1;margin-bottom:8px;padding:0;color:var(--teaching-text);font-size:12px;font-weight:750}
    .teaching-d08-revision-option{position:relative;display:flex;gap:11px;min-width:0;padding:14px;border:1px solid var(--teaching-border);border-radius:14px;background:rgba(1,12,9,.3);cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease}
    .teaching-d08-revision-option:hover{border-color:rgba(83,190,143,.42);transform:translateY(-1px)}
    .teaching-d08-revision-option[data-selected="true"]{border-color:#53be8f;background:rgba(83,190,143,.1);box-shadow:inset 0 0 0 1px rgba(83,190,143,.15)}
    .teaching-d08-revision-option input{flex:none;width:16px;height:16px;margin:2px 0 0;accent-color:#53be8f}
    .teaching-d08-revision-option__copy,.teaching-d08-revision-option__title{display:block;min-width:0}
    .teaching-d08-revision-option__title{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .teaching-d08-revision-option__title strong{font-size:13px}
    .teaching-d08-revision-option__copy small{display:block;margin-top:6px;color:var(--teaching-muted);font-size:11px;line-height:1.5}
    .teaching-d08-revision-option__badge{flex:none;padding:3px 6px;border-radius:999px;background:rgba(83,190,143,.1);color:#91dcbc;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
    .teaching-d08-revision-details{display:grid;grid-template-columns:1fr auto;gap:7px 12px;margin-top:14px;padding-top:16px;border-top:1px solid var(--teaching-border)}
    .teaching-d08-revision-details label{font-size:12px;font-weight:750;color:var(--teaching-text)}
    .teaching-d08-revision-details textarea{grid-column:1/-1;box-sizing:border-box;width:100%;min-height:104px;resize:vertical;padding:12px 13px;border:1px solid var(--teaching-border);border-radius:12px;background:rgba(1,12,9,.46);color:var(--teaching-text);font:inherit;line-height:1.5;outline:none}
    .teaching-d08-revision-details textarea:focus{border-color:#53be8f;box-shadow:0 0 0 3px rgba(83,190,143,.1)}
    .teaching-d08-revision-count{color:var(--teaching-muted);font-size:10px;text-align:right}
    .teaching-d08-revision-helper{grid-column:1/-1;margin:0;color:var(--teaching-muted);font-size:11px;line-height:1.5}
    .teaching-d08-revision-impact{grid-column:1/-1;margin:3px 0 0;padding:10px 11px;border-left:2px solid rgba(83,190,143,.52);border-radius:0 9px 9px 0;background:rgba(83,190,143,.055);color:#b9d4c8;font-size:11px;line-height:1.5}
    .teaching-d08-revision-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}
    .teaching-d08-revision-actions .teaching-button--primary:disabled{cursor:not-allowed;filter:saturate(.45);opacity:.48}
    .teaching-d08-note{margin-top:12px;color:var(--teaching-muted);font-size:12px;line-height:1.55}
    .teaching-d08-preview{width:min(520px,calc(100vw - 28px));max-height:min(720px,86dvh);overflow:auto;padding:0;border:1px solid var(--teaching-border-strong);border-radius:24px;background:rgba(6,26,20,.99);color:var(--teaching-text);box-shadow:var(--teaching-shadow)}
    .teaching-d08-preview::backdrop{background:rgba(0,0,0,.62);backdrop-filter:blur(4px)}
    .teaching-d08-preview__inner{padding:23px}
    .teaching-d08-preview__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .teaching-d08-preview h2{margin:8px 0 0;font-family:var(--font-display);font-size:27px;letter-spacing:-.04em}
    .teaching-d08-preview p{color:var(--teaching-muted);line-height:1.6}
    .teaching-d08-preview__close{width:38px;height:38px;border:1px solid var(--teaching-border);border-radius:12px;background:rgba(255,255,255,.025);color:var(--teaching-text);cursor:pointer}
    .teaching-d08-preview__actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:20px}
    @media(max-width:820px){
      .teaching-d08-grid{grid-template-columns:1fr}
      .teaching-d08-page__head{align-items:flex-start;flex-direction:column}
    }
    @media(max-width:560px){
      .teaching-d08-revision-panel{padding:16px}
      .teaching-d08-revision-chooser{grid-template-columns:1fr}
      .teaching-d08-revision-option__title{align-items:flex-start}
      .teaching-d08-revision-actions{display:grid;grid-template-columns:1fr}
      .teaching-d08-mini-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
      .teaching-d08-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
      .teaching-d08-preview__actions{grid-template-columns:1fr}
      .teaching-d08-setup-step{grid-template-columns:38px minmax(0,1fr)}
      .teaching-d08-setup-step>.teaching-d08-status{grid-column:2}
    }
    
    /* Teaching polish: keep D08 visually native to the course workspace. */
    .teaching-course-feature-card{min-height:206px;padding:20px;border-color:rgba(223,245,235,.075);border-radius:18px;background:var(--teaching-surface-soft);box-shadow:none}
    .teaching-course-feature-card h3{margin-top:7px;font-size:20px;font-weight:700;letter-spacing:-.03em}
    .teaching-course-feature-card p{margin-top:10px;color:#8ea097;font-size:12px;line-height:1.65}
    .teaching-course-feature-card__status,.teaching-d08-status{padding:5px 8px;border:1px solid rgba(126,226,184,.09);background:rgba(126,226,184,.07);color:#93dfbd;font-size:9px;font-weight:600;letter-spacing:.06em}
    .teaching-d08-mini-metrics{gap:7px;margin-top:16px}
    .teaching-d08-mini-metric,.teaching-d08-metric{border-color:rgba(223,245,235,.065);border-radius:11px;background:rgba(255,255,255,.016)}
    .teaching-d08-mini-metric{padding:10px}
    .teaching-d08-mini-metric strong,.teaching-d08-metric strong{font-family:var(--font-display);font-weight:700;letter-spacing:-.03em}
    .teaching-d08-mini-metric span,.teaching-d08-metric span{color:#74877e}
    .teaching-course-feature-card__actions{gap:8px;padding-top:16px}
    .teaching-d08-link-button{min-height:40px;padding:0 13px;border-color:rgba(223,245,235,.075);border-radius:10px;background:rgba(255,255,255,.016);color:#c7d5ce;font-size:12px;font-weight:650}
    .teaching-d08-link-button:hover,.teaching-d08-link-button:focus-visible{border-color:rgba(126,226,184,.20);background:rgba(126,226,184,.07)}
    .teaching-d08-link-button--primary{border-color:transparent;background:var(--teaching-accent);color:#07140f}
    .teaching-d08-link-button--primary:hover,.teaching-d08-link-button--primary:focus-visible{background:var(--teaching-accent-strong)}
    .teaching-d08-page{gap:16px}
    .teaching-d08-page__head{align-items:flex-start;padding:4px 1px 6px}
    .teaching-d08-page__head h2{margin-top:6px;font-size:clamp(28px,3.7vw,38px);font-weight:750;letter-spacing:-.04em}
    .teaching-d08-page__head p{max-width:620px;margin-top:9px;color:#92a49b;font-size:13px;line-height:1.65}
    .teaching-d08-grid{grid-template-columns:minmax(0,1.45fr) minmax(290px,.72fr);gap:12px}
    .teaching-d08-stack{gap:12px}
    .teaching-d08-card{padding:20px;border-color:rgba(223,245,235,.075);border-radius:18px;background:var(--teaching-surface-soft)}
    .teaching-d08-card h3{margin-top:7px;font-size:20px;font-weight:700;letter-spacing:-.03em}
    .teaching-d08-card p{color:#8b9e95;font-size:12px;line-height:1.65}
    .teaching-d08-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:14px}
    .teaching-d08-metric{padding:11px}
    .teaching-d08-topic{margin-top:8px;border-color:rgba(223,245,235,.07);border-radius:12px;background:rgba(255,255,255,.012)}
    .teaching-d08-topic summary{min-height:48px;padding:12px 13px;color:#d9e5df;font-size:12px;font-weight:650}
    .teaching-d08-topic__body{padding:0 13px 13px}
    .teaching-d08-subtopics{margin-bottom:10px;color:#71847b;font-size:11px}
    .teaching-d08-unit{margin-top:7px;padding:11px;border-left-color:rgba(126,226,184,.22);background:rgba(126,226,184,.025);border-radius:0 9px 9px 0}
    .teaching-d08-unit strong{font-size:12px}.teaching-d08-unit span{margin-top:4px;color:#82958c;font-size:11px}
    .teaching-d08-list{gap:7px;margin-top:12px}
    .teaching-d08-list li{padding:10px 11px;border-color:rgba(223,245,235,.06);border-radius:10px;background:rgba(255,255,255,.012);color:#94a69d;font-size:11px}
    .teaching-d08-actions{gap:8px;margin-top:14px}.teaching-d08-note{margin-top:10px;color:#70837a;font-size:11px}
    .teaching-d08-preview{width:min(500px,calc(100vw - 28px));border-color:rgba(223,245,235,.10);border-radius:20px;background:#0d1814;box-shadow:0 28px 86px rgba(0,0,0,.42)}
    .teaching-d08-preview::backdrop{background:rgba(1,7,5,.70);backdrop-filter:blur(5px)}
    .teaching-d08-preview__inner{padding:21px}
    .teaching-d08-preview h2{margin-top:6px;font-size:25px;font-weight:750;letter-spacing:-.04em}
    .teaching-d08-preview p{color:#8fa198;font-size:12px}
    .teaching-d08-preview__close{width:36px;height:36px;border-color:rgba(223,245,235,.075);border-radius:10px;background:rgba(255,255,255,.018)}
    .teaching-d08-preview__actions{gap:8px;margin-top:18px}
    @media(max-width:820px){.teaching-d08-grid{grid-template-columns:1fr}}

  `;
  document.head.append(style);
}

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function safeStatus(value) {
  return String(value || 'Not ready')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function topicCount(review) {
  return review.plan?.topics?.length || review.sourceAnalysis?.topics?.length || 0;
}

function learningUnitCount(review) {
  if (review.plan?.topics?.length) {
    return review.plan.topics.reduce((total, topic) => total + (topic.learningUnits?.length || 0), 0);
  }
  return review.sourceAnalysis?.learningUnitCount || 0;
}

function metric(value, label, compact = false) {
  const box = el('div', compact ? 'teaching-d08-mini-metric' : 'teaching-d08-metric');
  box.append(el('strong', '', String(value ?? 0)), el('span', '', label));
  return box;
}

async function fetchReview(courseId) {
  return kiwiApiRequest(`/teaching/courses/${encodeURIComponent(courseId)}/plan-review`);
}

async function fetchSetup(courseId) {
  return kiwiApiRequest(`/teaching/courses/${encodeURIComponent(courseId)}/setup`);
}

function formatAnalysisCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function backgroundAuditState(job) {
  const status = String(job?.status || '').toUpperCase();
  const attempts = Number(job?.attempt_count || 0);
  const exhausted = attempts >= 8;
  const operation = String(
    job?.payload?.operation
    || (job?.payload?.refine === true ? 'REFINE' : job?.payload?.regenerate === true ? 'REGENERATE' : 'GENERATE')
  ).toUpperCase();
  const refining = operation === 'REFINE';
  const regenerating = operation === 'REGENERATE';
  const actionName = refining ? 'refinement' : regenerating ? 'regeneration' : 'analysis';
  if (status === 'CANCELLED' || exhausted) {
    return {
      active: false,
      failed: true,
      operation,
      refining,
      regenerating,
      label: 'Needs attention',
      message: job?.last_error_code === 'TEACHING_ACADEMIC_INPUT_INVALID'
        ? 'KIWI could not prepare the material input for analysis. Your materials are safe. Try again when you are ready.'
        : job?.last_error_code === 'TEACHING_AI_OUTPUT_TRUNCATED'
          ? 'The AI response ended before the Course analysis operation was complete. No incomplete analysis was saved and the current Course remains intact.'
          : job?.last_error_code === 'TEACHING_D07_CURRICULUM_AUDIT_REJECTED'
            ? 'KIWI could not safely complete the final Course-structure validation. No incomplete analysis was saved. Try the analysis again; large source sets are resumed through bounded validation work.'
            : `The background ${actionName} did not complete${attempts > 1 ? ` after ${attempts} attempts` : ''}. ${operation === 'GENERATE' ? 'Your materials are safe and no incomplete Course analysis was saved.' : 'The current validated Course analysis and downstream setup remain intact.'}`,
      errorCode: job?.last_error_code || null,
    };
  }
  if (status === 'PENDING' || status === 'CLAIMED' || status === 'RETRY_WAIT') {
    const nextAttempt = job?.next_attempt_at ? new Date(job.next_attempt_at) : null;
    const retryTime = nextAttempt && Number.isFinite(nextAttempt.getTime())
      ? ` Next attempt ${nextAttempt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
      : '';
    return {
      active: true,
      failed: false,
      operation,
      refining,
      regenerating,
      label: status === 'RETRY_WAIT' ? 'Retry scheduled' : status === 'PENDING' ? 'Queued' : 'Running',
      message: status === 'RETRY_WAIT'
        ? `The last ${actionName} attempt did not complete. KIWI will retry safely in the background${attempts ? ` (attempt ${attempts})` : ''}.${retryTime}`
        : refining
          ? 'KIWI is applying your requested Course analysis changes in the background. You can safely leave this page.'
          : regenerating
            ? 'KIWI is regenerating the Course analysis in the background. You can safely leave this page.'
            : 'KIWI is analyzing the materials in the background. You can safely leave this page.',
    };
  }
  return { active: false, failed: false, operation, refining, regenerating, label: null, message: null };
}

function backgroundPlanState(job) {
  const status = String(job?.status || '').toUpperCase();
  const attempts = Number(job?.attemptCount || 0);
  if (status === 'CANCELLED') {
    return {
      active: false,
      failed: true,
      label: 'Needs attention',
      message: `Course Plan generation did not complete${attempts > 1 ? ` after ${attempts} attempts` : ''}. The validated curriculum is safe; you can retry.`,
      errorCode: job?.lastErrorCode || null,
    };
  }
  if (status === 'PENDING' || status === 'CLAIMED' || status === 'RETRY_WAIT') {
    const nextAttempt = job?.nextAttemptAt ? new Date(job.nextAttemptAt) : null;
    const retryTime = nextAttempt && Number.isFinite(nextAttempt.getTime())
      ? ` Next attempt ${nextAttempt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
      : '';
    return {
      active: true,
      failed: false,
      label: status === 'RETRY_WAIT' ? 'Retry scheduled' : status === 'PENDING' ? 'Queued' : 'Running',
      message: status === 'RETRY_WAIT'
        ? `The last Course Plan attempt did not complete. KIWI will retry safely in the background.${retryTime}`
        : 'KIWI is preparing and validating the Course Plan in the background. You can leave this page and return later.',
    };
  }
  return { active: false, failed: false, label: null, message: null };
}

function ensurePreview() {
  installStyles();
  let dialog = document.getElementById(D08_PREVIEW_ID);
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = D08_PREVIEW_ID;
  dialog.className = 'teaching-d08-preview';
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function openPreview(course, review, openSection) {
  const dialog = ensurePreview();
  const inner = el('div', 'teaching-d08-preview__inner');
  const head = el('div', 'teaching-d08-preview__head');
  const copy = el('div');
  copy.append(
    el('div', 'teaching-kicker', course.title || 'Course'),
    el('h2', '', 'Course Plan')
  );
  const close = el('button', 'teaching-d08-preview__close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Course Plan preview');
  close.addEventListener('click', () => dialog.close());
  head.append(copy, close);
  inner.append(head);

  const planStatus = review.plan
    ? `Version ${review.plan.version} · ${safeStatus(review.plan.state)}`
    : 'Plan not committed yet';
  inner.append(
    el('div', 'teaching-d08-status', planStatus),
    el('p', '', review.plan
      ? 'This preview shows the current course-scoped academic plan. Open the full plan for topic, Learning Unit, coverage, assumption, and scope-change detail.'
      : 'The validated curriculum analysis is preserved, but a Course Plan has not been committed yet.')
  );

  const metrics = el('div', 'teaching-d08-mini-metrics');
  metrics.append(
    metric(topicCount(review), 'topics', true),
    metric(learningUnitCount(review), 'learning units', true),
    metric(review.coverageReport?.summary?.mappedRequiredItems || 0, 'required mapped', true),
    metric(review.assumptions?.length || review.sourceAnalysis?.assumptions?.length || 0, 'assumptions', true)
  );
  inner.append(metrics);

  if (review.plan && !review.plan.currentForCourseScope) {
    const warning = el('div', 'teaching-message', 'This plan is historical for the current Course scope and requires reviewed re-planning before activation or completion.');
    warning.dataset.kind = 'error';
    inner.append(warning);
  }

  const actions = el('div', 'teaching-d08-preview__actions');
  const full = el('button', 'teaching-d08-link-button teaching-d08-link-button--primary', 'View full Course Plan');
  full.type = 'button';
  full.addEventListener('click', () => {
    dialog.close();
    openSection();
  });
  const done = el('button', 'teaching-d08-link-button', 'Close');
  done.type = 'button';
  done.addEventListener('click', () => dialog.close());
  actions.append(full, done);
  inner.append(actions);
  dialog.replaceChildren(inner);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else openSection();
}

function renderSummaryCard(course, review, container, openSection) {
  const card = el('article', 'teaching-course-feature-card');
  const top = el('div', 'teaching-course-feature-card__top');
  const copy = el('div');
  copy.append(el('div', 'teaching-kicker', 'Academic plan'), el('h3', '', 'Course Plan'));
  const status = el('span', 'teaching-course-feature-card__status', review.plan
    ? `v${review.plan.version} · ${safeStatus(review.plan.state)}`
    : 'Pending');
  top.append(copy, status);
  card.append(
    top,
    el('p', '', review.plan
      ? 'See what this course will teach, what is already validated, and whether every required part of the Subject is accounted for.'
      : 'The validated course scope is ready here while the first versioned Course Plan is still pending.')
  );
  const metrics = el('div', 'teaching-d08-mini-metrics');
  metrics.append(
    metric(topicCount(review), 'topics', true),
    metric(learningUnitCount(review), 'learning units', true),
    metric(review.coverageReport?.summary?.pendingInstructionItems || 0, 'pending instruction', true)
  );
  card.append(metrics);
  const actions = el('div', 'teaching-course-feature-card__actions');
  const preview = el('button', 'teaching-d08-link-button', 'Quick view');
  preview.type = 'button';
  preview.addEventListener('click', () => openPreview(course, review, openSection));
  const full = el('button', 'teaching-d08-link-button teaching-d08-link-button--primary', 'View full plan');
  full.type = 'button';
  full.addEventListener('click', openSection);
  actions.append(preview, full);
  card.append(actions);
  container.replaceChildren(card);
}

function renderPlanCard(course, review, refresh) {
  const card = el('section', 'teaching-d08-card');
  const head = el('div', 'teaching-d08-plan-head');
  const copy = el('div');
  copy.append(el('div', 'teaching-kicker', 'Course Plan'), el('h3', '', 'What this course will teach'));
  const background = backgroundPlanState(review.generation?.background);
  const needsSetup = !review.plan && review.generation?.ready === false;
  const status = el(needsSetup ? 'button' : 'span', 'teaching-d08-status', review.plan
    ? `Version ${review.plan.version} · ${safeStatus(review.plan.state)}`
    : needsSetup ? 'Setup required'
      : background.active ? background.label
        : background.failed ? 'Needs attention'
          : 'Ready to create');
  if (needsSetup) {
    status.type = 'button';
    status.setAttribute('aria-label', 'Open course setup');
    status.addEventListener('click', () => courseSurface.openCourse(course.course_id, 'setup'));
  }
  head.append(copy, status);
  card.append(head);

  if (!review.plan) {
    card.append(el('p', '', background.active
      ? 'The Course Plan is being prepared from the validated curriculum. This work is durable and continues if you leave the page.'
      : 'Create a Course Plan to organize the topics and learning units for this course.'));
    const actions = el('div', 'teaching-d08-actions');
    const message = el('div');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    if (review.generation?.ready === false) {
      const setup = el('button', 'teaching-button teaching-button--primary', 'Open course setup');
      setup.type = 'button';
      setup.addEventListener('click', () => courseSurface.openCourse(course.course_id, 'setup'));
      actions.append(setup);
      message.textContent = review.generation?.blockers?.includes('REQUIRED_DIAGNOSTIC_UNRESOLVED')
        ? 'Complete the required learning check before creating the Course Plan.'
        : 'Analyze the course materials first so KIWI can build the plan from the correct content.';
      message.className = 'teaching-message';
    } else {
      const generate = el('button', 'teaching-button teaching-button--primary',
        background.active ? 'Course Plan running in background'
          : background.failed ? 'Try Course Plan again'
            : 'Create Course Plan');
      generate.type = 'button';
      generate.disabled = background.active;
      if (background.active || background.failed) {
        message.textContent = background.message;
        message.className = 'teaching-message';
        if (background.failed) message.dataset.kind = 'error';
      }
      generate.addEventListener('click', async () => {
        generate.disabled = true;
        message.textContent = 'Course Plan generation queued. KIWI will continue in the background.';
        message.className = 'teaching-message';
        delete message.dataset.kind;
        try {
          await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/course-plan`, { method: 'POST', body: {} });
          await refresh({ silent: true });
        } catch (error) {
          message.textContent = error.message || 'Could not start Course Plan generation.';
          message.className = 'teaching-message';
          message.dataset.kind = 'error';
          generate.disabled = false;
        }
      });
      actions.append(generate);
    }
    card.append(actions, message);
    return card;
  }
  if (!review.plan.currentForCourseScope) {
    const warning = el('div', 'teaching-message', 'This Plan is historical for the current Course scope. A reviewed source change must be re-audited and replanned before activation or completion can proceed.');
    warning.dataset.kind = 'error';
    card.append(warning);
  }

  for (const topic of review.plan.topics || []) {
    const details = el('details', 'teaching-d08-topic');
    const summary = el('summary', '', topic.title);
    const body = el('div', 'teaching-d08-topic__body');
    if (topic.subtopics?.length) {
      body.append(el('p', 'teaching-d08-subtopics', `Subtopics: ${topic.subtopics.map((item) => item.title).join(', ')}`));
    }
    for (const unit of topic.learningUnits || []) {
      const unitNode = el('div', 'teaching-d08-unit');
      unitNode.append(
        el('strong', '', unit.title),
        el('span', '', unit.intendedCompetence || ''),
        el('span', '', `${safeStatus(unit.criticality)} · ${safeStatus(unit.instructionalTreatment)}`)
      );
      body.append(unitNode);
    }
    details.append(summary, body);
    card.append(details);
  }
  return card;
}

function renderCoverageCard(review) {
  const card = el('section', 'teaching-d08-card');
  card.append(el('div', 'teaching-kicker', 'Coverage'), el('h3', '', 'Required content stays accounted for'));
  const report = review.coverageReport;
  if (!report) {
    card.append(el('p', '', 'Coverage reconciliation begins when a validated Course Plan is committed. Until then, no source item is treated as covered.'));
    return card;
  }
  const metrics = el('div', 'teaching-d08-metrics');
  metrics.append(
    metric(report.summary?.requiredItems, 'required'),
    metric(report.summary?.mappedRequiredItems, 'mapped'),
    metric(report.summary?.instructionallyCompleteItems, 'complete by teaching/VPK'),
    metric(report.summary?.pendingInstructionItems, 'still pending')
  );
  card.append(metrics);
  const list = el('ul', 'teaching-d08-list');
  for (const line of report.messages || []) list.append(el('li', '', line));
  card.append(list);
  return card;
}

function renderAnalysisCard(review) {
  const card = el('section', 'teaching-d08-card');
  const analysis = review.sourceAnalysis || {};
  card.append(el('div', 'teaching-kicker', 'Validated source analysis'), el('h3', '', 'What the Subject requires'));
  const metrics = el('div', 'teaching-d08-metrics');
  metrics.append(
    metric(analysis.sourceCount, 'source items'),
    metric(analysis.meaningfulCount, 'required meaningful'),
    metric(analysis.excludedCount, 'explicitly excluded'),
    metric(analysis.learningUnitCount, 'learning units')
  );
  card.append(metrics);

  if (analysis.topics?.length) {
    const list = el('ul', 'teaching-d08-list');
    for (const topic of analysis.topics) {
      const names = (topic.subtopics || []).map((item) => item.title).filter(Boolean);
      list.append(el('li', '', names.length ? `${topic.title} — ${names.join(', ')}` : topic.title));
    }
    card.append(list);
  } else {
    card.append(el('p', '', analysis.auditStatus
      ? 'The validated audit has not exposed a student-safe topic outline yet.'
      : 'A validated Curriculum Audit is required before the final Course Plan can be produced.'));
  }

  if (analysis.exclusions?.length) {
    const list = el('ul', 'teaching-d08-list');
    for (const item of analysis.exclusions) {
      list.append(el('li', '', `${safeStatus(item.classification)}: ${item.reason}`));
    }
    card.append(el('p', '', 'Explicit exclusions'), list);
  }
  return card;
}

function renderAssumptionsCard(review) {
  const card = el('section', 'teaching-d08-card');
  card.append(el('div', 'teaching-kicker', 'Prerequisites'), el('h3', '', 'Starting assumptions'));
  const assumptions = review.assumptions?.length ? review.assumptions : review.sourceAnalysis?.assumptions || [];
  if (!assumptions.length) {
    card.append(el('p', '', 'No student-facing prerequisite assumptions are currently recorded.'));
    return card;
  }
  const list = el('ul', 'teaching-d08-list');
  for (const item of assumptions) {
    list.append(el('li', '', [
      item.label,
      item.description || item.disclosure,
      item.state ? safeStatus(item.state) : null,
    ].filter(Boolean).join(' — ')));
  }
  card.append(list);
  return card;
}

function renderScopeCard(course, review, refresh) {
  const card = el('section', 'teaching-d08-card');
  card.append(el('div', 'teaching-kicker', 'Scope control'), el('h3', '', 'Keep the plan current'));
  const state = review.scopeChange;
  if (state) card.append(el('p', '', `Latest review: ${safeStatus(state.kind)} · ${safeStatus(state.status)}`));
  else card.append(el('p', '', 'Check the KIWI Subject when you want to confirm that the Course is still based on the same authoritative scope.'));
  const actions = el('div', 'teaching-d08-actions');
  const check = el('button', 'teaching-button', 'Check KIWI Subject for changes');
  check.type = 'button';
  const message = el('div');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      const result = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/scope-review`, { method: 'POST', body: {} });
      message.textContent = result.message || 'Scope review recorded.';
      message.className = 'teaching-message';
      await refresh();
    } catch (error) {
      message.textContent = error.message || 'Scope review failed safely.';
      message.className = 'teaching-message';
      message.dataset.kind = 'error';
    } finally {
      check.disabled = false;
    }
  });
  actions.append(check);
  card.append(
    actions,
    message,
    el('p', 'teaching-d08-note', 'A detected Subject change does not silently rewrite this Course Plan. Material adoption requires reviewed version impact and a new validated Audit/Plan cycle.')
  );
  return card;
}

async function renderCoursePlan({ course, container }) {
  installStyles();
  const page = el('div', 'teaching-d08-page');
  const head = el('header', 'teaching-d08-page__head');
  const copy = el('div');
  copy.append(
    el('div', 'teaching-kicker', 'Academic plan'),
    el('h2', '', 'Course Plan'),
    el('p', '', 'Review what the course will teach, what is already accounted for, and the assumptions Teaching is carrying forward.')
  );
  const refreshButton = el('button', 'teaching-button', 'Refresh');
  refreshButton.type = 'button';
  head.append(copy, refreshButton);
  const status = el('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = el('div');
  page.append(head, status, body);
  container.replaceChildren(page);

  let pollTimer = null;
  const schedulePoll = () => {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => {
      if (container.isConnected) load({ silent: true });
    }, 5000);
  };

  async function load({ silent = false } = {}) {
    refreshButton.disabled = true;
    if (!silent) {
      status.textContent = 'Loading Course Plan…';
      status.className = 'teaching-message';
    }
    try {
      const review = await fetchReview(course.course_id);
      const grid = el('div', 'teaching-d08-grid');
      const primary = el('div', 'teaching-d08-stack');
      const secondary = el('aside', 'teaching-d08-stack');
      primary.append(renderPlanCard(course, review, load), renderCoverageCard(review));
      secondary.append(renderAnalysisCard(review), renderAssumptionsCard(review), renderScopeCard(course, review, load));
      grid.append(primary, secondary);
      body.replaceChildren(grid);
      const background = backgroundPlanState(review.generation?.background);
      if (background.active && !review.plan) schedulePoll();
      if (!silent || status.dataset.kind !== 'error') {
        status.textContent = '';
        status.className = '';
        delete status.dataset.kind;
      }
    } catch (error) {
      if (!silent) body.replaceChildren();
      status.textContent = error.message || 'Could not load Course Plan review.';
      status.className = 'teaching-message';
      status.dataset.kind = 'error';
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', () => load());
  await load();
}

async function renderCourseSetup({ course, container }) {
  installStyles();
  const page = el('div', 'teaching-d08-page');
  const head = el('header', 'teaching-d08-page__head');
  const copy = el('div');
  copy.append(
    el('div', 'teaching-kicker', 'Course preparation'),
    el('h2', '', 'Prepare your course'),
    el('p', '', 'KIWI checks the saved materials before creating the Course Plan. Your learning preferences remain context—not proof of mastery.')
  );
  head.append(copy);
  const status = el('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = el('div');
  page.append(head, status, body);
  container.replaceChildren(page);

  let pollTimer = null;
  let countdownTimer = null;
  let countdownDeadline = null;
  let countdownEventId = null;
  let lastRenderKey = null;
  let lastBackgroundAuditActive = false;

  const materialAnalysisRow = () => body.querySelector('[data-setup-step="material-analysis"]');
  const ensureAnalysisCountdown = () => {
    const row = materialAnalysisRow();
    const copyNode = row?.querySelector('[data-setup-step-copy]');
    if (!copyNode) return null;
    let timer = copyNode.querySelector('[data-analysis-countdown]');
    if (timer) return timer;
    timer = el('span', 'teaching-d08-analysis-countdown');
    timer.dataset.analysisCountdown = 'true';
    timer.dataset.expired = 'false';
    timer.setAttribute('role', 'timer');
    timer.setAttribute('aria-label', 'Material analysis countdown');
    const label = el('span', 'teaching-d08-analysis-countdown__label', '5 min');
    const value = el('span', 'teaching-d08-analysis-countdown__value', '05:00');
    value.dataset.analysisCountdownValue = 'true';
    timer.append(label, value);
    copyNode.append(timer);
    return timer;
  };
  const paintAnalysisCountdown = () => {
    if (!countdownDeadline) return;
    const timer = ensureAnalysisCountdown();
    if (!timer) return;
    const remainingMs = Math.max(0, countdownDeadline - Date.now());
    const value = timer.querySelector('[data-analysis-countdown-value]');
    if (value) value.textContent = `${formatAnalysisCountdown(remainingMs)} remaining`;
    timer.dataset.expired = remainingMs <= 0 ? 'true' : 'false';
  };
  const startAnalysisCountdown = ({ deadline = null, eventId = null } = {}) => {
    const parsedDeadline = Number(deadline);
    if (Number.isFinite(parsedDeadline) && parsedDeadline > 0) countdownDeadline = parsedDeadline;
    else if (!countdownDeadline) countdownDeadline = Date.now() + ANALYSIS_COUNTDOWN_MS;
    if (eventId != null) countdownEventId = String(eventId);
    paintAnalysisCountdown();
    if (countdownTimer != null) return;
    countdownTimer = window.setInterval(() => {
      if (!container.isConnected) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      paintAnalysisCountdown();
    }, 1000);
  };
  const stopAnalysisCountdown = () => {
    if (countdownTimer != null) window.clearInterval(countdownTimer);
    countdownTimer = null;
    countdownDeadline = null;
    countdownEventId = null;
    body.querySelector('[data-analysis-countdown]')?.remove();
  };
  const schedulePoll = () => {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => {
      if (container.isConnected) load({ silent: true });
    }, 5000);
  };

  async function load({ silent = false } = {}) {
    if (!silent) {
      status.textContent = 'Checking course preparation…';
      status.className = 'teaching-message';
    }
    try {
      const setup = await fetchSetup(course.course_id);
      const auditReady = setup.curriculumAudit?.status === 'VALIDATED_CANDIDATE'
        && String(setup.curriculumAudit?.subject_snapshot_ref || '') === String(setup.course?.subject_snapshot_ref || '');
      const sourcesReady = (setup.sources || []).length > 0 && (setup.sources || []).every((source) => Boolean(source.classification));
      const backgroundAudit = backgroundAuditState(setup.backgroundAnalysis);
      lastBackgroundAuditActive = backgroundAudit.active;
      const analysisRevisionInFlight = auditReady
        && backgroundAudit.active
        && (backgroundAudit.refining || backgroundAudit.regenerating);
      const analysisRevisionFailed = auditReady
        && backgroundAudit.failed
        && (backgroundAudit.refining || backgroundAudit.regenerating);
      const backgroundEventId = setup.backgroundAnalysis?.event_id == null
        ? null
        : String(setup.backgroundAnalysis.event_id);
      const backgroundCreatedAt = setup.backgroundAnalysis?.created_at
        ? new Date(setup.backgroundAnalysis.created_at).getTime()
        : NaN;
      if (backgroundAudit.active) {
        const replacedEvent = Boolean(backgroundEventId && countdownEventId && backgroundEventId !== countdownEventId);
        if (!countdownDeadline || replacedEvent) {
          countdownDeadline = Number.isFinite(backgroundCreatedAt)
            ? backgroundCreatedAt + ANALYSIS_COUNTDOWN_MS
            : Date.now() + ANALYSIS_COUNTDOWN_MS;
        }
        if (backgroundEventId) countdownEventId = backgroundEventId;
      } else {
        stopAnalysisCountdown();
      }
      const diagnosticRequired = setup.diagnosticPlan?.requirement_state === 'REQUIRED';
      const diagnosticResolved = !diagnosticRequired || (setup.diagnosticPlan?.target_refs || []).every((target) =>
        (setup.vpkDecisions || []).some((decision) => String(decision.target_ref) === String(target)));
      const readinessChecked = Boolean(setup.diagnosticPlan);
      const renderKey = JSON.stringify({
        auditReady,
        sourcesReady,
        sourceCount: (setup.sources || []).length,
        diagnosticRequired,
        diagnosticResolved,
        readinessChecked,
        auditId: setup.curriculumAudit?.curriculum_audit_id || null,
        auditVersion: setup.curriculumAudit?.audit_version || null,
        backgroundStatus: setup.backgroundAnalysis?.status || null,
        backgroundEventId,
        backgroundOperation: backgroundAudit.operation || null,
        backgroundRegeneration: setup.backgroundAnalysis?.payload?.regenerate === true,
        backgroundAttempts: setup.backgroundAnalysis?.attempt_count || 0,
        backgroundUpdatedAt: setup.backgroundAnalysis?.updated_at || null,
      });
      if (silent && renderKey === lastRenderKey) {
        if (backgroundAudit.active) schedulePoll();
        return;
      }
      lastRenderKey = renderKey;
      const card = el('section', 'teaching-d08-card');
      card.append(el('div', 'teaching-kicker', 'What KIWI needs'), el('h3', '', 'A clear source foundation'));
      const list = el('div', 'teaching-d08-setup-list');
      const setupStep = (mark, title, description, state, { key = null } = {}) => {
        const row = el('div', 'teaching-d08-setup-step');
        if (key) row.dataset.setupStep = key;
        const text = el('div');
        text.dataset.setupStepCopy = 'true';
        text.append(el('strong', '', title), el('small', '', description));
        row.append(el('span', 'teaching-d08-setup-step__mark', mark), text, el('span', 'teaching-d08-status', state));
        return row;
      };
      const materialAnalysisReady = auditReady && sourcesReady;
      const materialBackgroundRelevant = !materialAnalysisReady
        ? (backgroundAudit.active || backgroundAudit.failed)
        : (analysisRevisionInFlight || analysisRevisionFailed);
      list.append(
        setupStep((setup.sources || []).length ? '✓' : '•', 'Course materials', `${(setup.sources || []).length} saved source item${(setup.sources || []).length === 1 ? '' : 's'} will ground the plan.`, (setup.sources || []).length ? 'Ready' : 'Missing'),
        setupStep(
          materialBackgroundRelevant ? '•' : materialAnalysisReady ? '✓' : '•',
          'Material analysis',
          materialBackgroundRelevant
            ? backgroundAudit.message
            : materialAnalysisReady
              ? 'The current materials have been analyzed and classified.'
              : 'KIWI needs to identify the topics, requirements, and relevant source content.',
          materialBackgroundRelevant ? backgroundAudit.label || 'Running' : materialAnalysisReady ? 'Ready' : 'Needed',
          { key: 'material-analysis' }
        ),
        setupStep(readinessChecked && diagnosticResolved ? '✓' : '•', 'Learning readiness', diagnosticRequired ? 'A focused, non-graded learning check is required before planning can continue.' : readinessChecked ? 'No additional learning check blocks the Course Plan.' : 'Check whether any prerequisite knowledge needs verification.', readinessChecked && diagnosticResolved ? 'Ready' : 'Action needed')
      );
      card.append(list);
      const actions = el('div', 'teaching-d08-actions');
      if (analysisRevisionInFlight) {
        const pendingRevision = el(
          'div',
          'teaching-message',
          'Your current validated Course analysis remains authoritative while KIWI finishes this revision. Course Plan setup is paused until the revision finishes so KIWI never builds a new plan from the analysis version you are replacing.'
        );
        card.append(pendingRevision);
        schedulePoll();
      } else if (!auditReady || !sourcesReady) {
        const analyze = el('button', 'teaching-button teaching-button--primary', backgroundAudit.active ? 'Analysis running in background' : backgroundAudit.failed ? 'Try analysis again' : 'Analyze course materials');
        analyze.type = 'button';
        analyze.disabled = backgroundAudit.active;
        analyze.addEventListener('click', async () => {
          const materialRow = materialAnalysisRow();
          const materialState = materialRow?.querySelector('.teaching-d08-status');
          const materialDescription = materialRow?.querySelector('small');
          const previousState = materialState?.textContent || '';
          const previousDescription = materialDescription?.textContent || '';
          analyze.disabled = true;
          analyze.textContent = 'Analysis running in background';
          if (materialState) materialState.textContent = 'Running';
          if (materialDescription) materialDescription.textContent = 'KIWI is analyzing the materials in the background. You can safely leave this page.';
          startAnalysisCountdown({ deadline: Date.now() + ANALYSIS_COUNTDOWN_MS });
          schedulePoll();
          status.textContent = 'Analysis started in the background. You can keep using KIWI while it finishes.';
          status.className = 'teaching-message';
          delete status.dataset.kind;
          try {
            await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/curriculum-audit`, { method: 'POST', body: {} });
            await load();
          } catch (error) {
            stopAnalysisCountdown();
            if (materialState) materialState.textContent = previousState;
            if (materialDescription) materialDescription.textContent = previousDescription;
            analyze.textContent = backgroundAudit.failed ? 'Try analysis again' : 'Analyze course materials';
            status.textContent = error.message || 'The material analysis could not be started.';
            status.className = 'teaching-message';
            status.dataset.kind = 'error';
            analyze.disabled = false;
          }
        });
        actions.append(analyze);
        if (backgroundAudit.active) schedulePoll();
      } else if (!readinessChecked) {
        const check = el('button', 'teaching-button teaching-button--primary', 'Check learning readiness');
        check.type = 'button';
        check.addEventListener('click', async () => {
          check.disabled = true;
          status.textContent = 'Checking whether a learning check is needed…';
          status.className = 'teaching-message';
          delete status.dataset.kind;
          try {
            await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/diagnostic-plan`, { method: 'POST', body: {} });
            await load();
          } catch (error) {
            status.textContent = error.message || 'Learning readiness could not be checked.';
            status.dataset.kind = 'error';
            check.disabled = false;
          }
        });
        actions.append(check);
      } else if (!diagnosticResolved) {
        const blocked = el('div', 'teaching-message', 'Complete the required learning check before creating the Course Plan.');
        blocked.dataset.kind = 'error';
        card.append(blocked);
      } else {
        const continueButton = el('button', 'teaching-button teaching-button--primary', 'Continue to Course Plan');
        continueButton.type = 'button';
        continueButton.addEventListener('click', () => courseSurface.openCourse(course.course_id, 'course-plan'));
        actions.append(continueButton);
      }

      let analysisChangeBox = null;
      const analysisRevisionAllowed = ['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state || 'DRAFT').toUpperCase());
      if (auditReady && sourcesReady && !backgroundAudit.active && analysisRevisionAllowed) {
        const revise = el('button', 'teaching-button teaching-d08-revision-entry', 'Revise Course analysis');
        revise.type = 'button';
        revise.setAttribute('aria-expanded', 'false');

        analysisChangeBox = el('section', 'teaching-d08-revision-panel');
        analysisChangeBox.hidden = true;
        analysisChangeBox.setAttribute('aria-label', 'Revise Course analysis');

        const panelHead = el('div', 'teaching-d08-revision-panel__head');
        const panelTitle = el('div');
        panelTitle.append(
          el('span', 'teaching-d08-revision-panel__eyebrow', 'Course analysis'),
          el('strong', '', 'What would you like to improve?'),
          el('p', '', 'Choose one approach. Your current validated analysis stays in place until the new result passes every check.')
        );
        const close = el('button', 'teaching-d08-revision-panel__close', 'Close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close analysis revision');
        panelHead.append(panelTitle, close);

        const chooser = document.createElement('fieldset');
        chooser.className = 'teaching-d08-revision-chooser';
        const chooserLegend = document.createElement('legend');
        chooserLegend.textContent = 'Choose an approach';

        const option = ({ value, title, description, badge }) => {
          const label = el('label', 'teaching-d08-revision-option');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `analysis-revision-${course.course_id}`;
          radio.value = value;
          const copy = el('span', 'teaching-d08-revision-option__copy');
          const titleRow = el('span', 'teaching-d08-revision-option__title');
          titleRow.append(el('strong', '', title), el('span', 'teaching-d08-revision-option__badge', badge));
          copy.append(titleRow, el('small', '', description));
          label.append(radio, copy);
          return { label, radio };
        };

        const refineOption = option({
          value: 'REFINE',
          title: 'Request specific changes',
          badge: 'Focused',
          description: 'Tell KIWI what feels wrong. It will revise the analysis around that request and revalidate the complete result.',
        });
        const regenerateOption = option({
          value: 'REGENERATE',
          title: 'Regenerate from materials',
          badge: 'Full review',
          description: 'Ask KIWI to reassess all Course materials and produce a new analysis from the source evidence.',
        });
        chooser.append(chooserLegend, refineOption.label, regenerateOption.label);

        const details = el('div', 'teaching-d08-revision-details');
        details.hidden = true;
        const instructionLabel = el('label', '', '');
        const instruction = el('textarea');
        instruction.maxLength = 1500;
        const characterCount = el('span', 'teaching-d08-revision-count', '0 / 1500');
        const helper = el('p', 'teaching-d08-revision-helper', '');
        const impact = el('p', 'teaching-d08-revision-impact', '');
        details.append(instructionLabel, instruction, characterCount, helper, impact);

        const boxActions = el('div', 'teaching-d08-revision-actions');
        const confirm = el('button', 'teaching-button teaching-button--primary', 'Choose an approach');
        const cancel = el('button', 'teaching-button', 'Cancel');
        confirm.type = 'button';
        confirm.disabled = true;
        cancel.type = 'button';
        boxActions.append(confirm, cancel);
        analysisChangeBox.append(panelHead, chooser, details, boxActions);

        let mode = null;
        const refreshConfirm = () => {
          const hasRequiredRequest = mode !== 'REFINE' || instruction.value.trim().length > 0;
          confirm.disabled = !mode || !hasRequiredRequest;
        };
        const configure = (nextMode) => {
          mode = nextMode;
          details.hidden = false;
          refineOption.label.dataset.selected = String(nextMode === 'REFINE');
          regenerateOption.label.dataset.selected = String(nextMode === 'REGENERATE');
          if (nextMode === 'REFINE') {
            instructionLabel.textContent = 'Describe the change you need';
            instruction.placeholder = 'Example: Split the broad mechanics unit into smaller assessable skills, or merge the two units that cover the same concept.';
            helper.textContent = 'Be specific about the part that feels wrong. This request is required.';
            impact.textContent = 'If the revision validates, planning based on the previous analysis will update to the new analysis boundary.';
            confirm.textContent = 'Request these changes';
          } else {
            instructionLabel.textContent = 'Add context for the new analysis (optional)';
            instruction.placeholder = 'Example: Reconsider the overall unit structure and give each major competence enough depth.';
            helper.textContent = 'KIWI will review every Course material again. You can add context, or continue without it.';
            impact.textContent = 'A validated regeneration replaces the analysis boundary used by Course Plan, readiness, and timetable work.';
            confirm.textContent = 'Regenerate from materials';
          }
          refreshConfirm();
          instruction.focus();
        };
        const resetRevisionPanel = () => {
          mode = null;
          analysisChangeBox.hidden = true;
          revise.hidden = false;
          revise.disabled = false;
          revise.setAttribute('aria-expanded', 'false');
          instruction.value = '';
          characterCount.textContent = '0 / 1500';
          details.hidden = true;
          confirm.textContent = 'Choose an approach';
          confirm.disabled = true;
          refineOption.radio.checked = false;
          regenerateOption.radio.checked = false;
          delete refineOption.label.dataset.selected;
          delete regenerateOption.label.dataset.selected;
        };

        revise.addEventListener('click', () => {
          analysisChangeBox.hidden = false;
          revise.hidden = true;
          revise.setAttribute('aria-expanded', 'true');
          refineOption.radio.focus();
        });
        refineOption.radio.addEventListener('change', () => configure('REFINE'));
        regenerateOption.radio.addEventListener('change', () => configure('REGENERATE'));
        instruction.addEventListener('input', () => {
          characterCount.textContent = `${instruction.value.length} / 1500`;
          refreshConfirm();
        });
        close.addEventListener('click', resetRevisionPanel);
        cancel.addEventListener('click', resetRevisionPanel);
        confirm.addEventListener('click', async () => {
          if (!mode) return;
          const requested = instruction.value.trim();
          if (mode === 'REFINE' && !requested) {
            refreshConfirm();
            instruction.focus();
            return;
          }
          const materialRow = materialAnalysisRow();
          const materialState = materialRow?.querySelector('.teaching-d08-status');
          const materialDescription = materialRow?.querySelector('small');
          confirm.disabled = true;
          cancel.disabled = true;
          close.disabled = true;
          refineOption.radio.disabled = true;
          regenerateOption.radio.disabled = true;
          if (materialState) materialState.textContent = 'Running';
          if (materialDescription) materialDescription.textContent = mode === 'REFINE'
            ? 'KIWI is applying your requested analysis changes in the background. You can safely leave this page.'
            : 'KIWI is regenerating the Course analysis in the background. You can safely leave this page.';
          status.textContent = mode === 'REFINE'
            ? 'Course analysis refinement started. The current Course remains authoritative until the revised analysis validates.'
            : 'Course analysis regeneration started. The current Course remains authoritative until the new analysis validates.';
          status.className = 'teaching-message';
          delete status.dataset.kind;
          startAnalysisCountdown({ deadline: Date.now() + ANALYSIS_COUNTDOWN_MS });
          schedulePoll();
          try {
            await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/curriculum-audit`, {
              method: 'POST',
              body: mode === 'REFINE'
                ? { operation: 'REFINE', changeRequest: requested }
                : { operation: 'REGENERATE', reason: requested || null },
            });
            await load();
          } catch (error) {
            stopAnalysisCountdown();
            status.textContent = error.message || (mode === 'REFINE'
              ? 'Course analysis changes could not be started.'
              : 'Course analysis regeneration could not be started.');
            status.className = 'teaching-message';
            status.dataset.kind = 'error';
            cancel.disabled = false;
            close.disabled = false;
            refineOption.radio.disabled = false;
            regenerateOption.radio.disabled = false;
            refreshConfirm();
          }
        });
        actions.append(revise);
      }

      card.append(actions);
      if (analysisChangeBox) card.append(analysisChangeBox);
      if (auditReady && sourcesReady && !analysisRevisionAllowed) {
        card.append(el('p', 'teaching-d08-note', 'Course analysis changes are available before activation. Active Courses use governed academic-change workflows so teaching history is never silently rewritten.'));
      }
      body.replaceChildren(card);
      if (backgroundAudit.active) {
        startAnalysisCountdown({ deadline: countdownDeadline, eventId: backgroundEventId });
      }
      if (!silent || status.dataset.kind !== 'error') {
        status.textContent = '';
        status.className = '';
        delete status.dataset.kind;
      }
    } catch (error) {
      const failureMessage = String(error?.message || error || '');
      const networkFailure = /failed to fetch|networkerror|network request failed|load failed/i.test(failureMessage);
      const hasVerifiedSetup = body.childElementCount > 0;

      // Background polling must never erase the last authoritative Course Setup
      // just because one browser fetch was interrupted. Keep the verified view
      // mounted, retry the read, and replace it only after a successful server
      // response. This also prevents a reconnect from collapsing Setup into a
      // raw browser "Failed to fetch" state.
      if (!hasVerifiedSetup) body.replaceChildren();
      status.textContent = networkFailure
        ? hasVerifiedSetup
          ? 'Connection interrupted. Keeping the last verified Course Setup while KIWI reconnects.'
          : 'Connection interrupted. KIWI is retrying Course Setup from authoritative server state.'
        : failureMessage || 'Course preparation could not be loaded.';
      status.className = 'teaching-message';
      if (networkFailure && hasVerifiedSetup) delete status.dataset.kind;
      else status.dataset.kind = 'error';

      if (networkFailure || (silent && lastBackgroundAuditActive)) schedulePoll();
    }
  }
  await load();
}

async function renderCoursePlanSummary({ course, container, openSection }) {
  installStyles();
  const loading = el('article', 'teaching-course-feature-card');
  loading.append(el('div', 'teaching-kicker', 'Academic plan'), el('h3', '', 'Course Plan'), el('p', '', 'Loading plan status…'));
  container.replaceChildren(loading);
  const review = await fetchReview(course.course_id);
  renderSummaryCard(course, review, container, openSection);
}

courseSurface.registerSection({
  id: 'course-plan',
  label: 'Course Plan',
  order: 20,
  render: renderCoursePlan,
  renderSummary: renderCoursePlanSummary,
});

courseSurface.registerSection({
  id: 'setup',
  label: 'Setup',
  order: 15,
  render: renderCourseSetup,
});

window.KIWITeachingD08 = Object.freeze({
  openCoursePlan: (courseId) => courseSurface.openCourse(courseId, 'course-plan'),
});
