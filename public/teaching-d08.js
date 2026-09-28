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
      .teaching-d08-mini-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
      .teaching-d08-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
      .teaching-d08-preview__actions{grid-template-columns:1fr}
    }
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
      ? 'Review what this course intends to teach, what is already validated, and whether every required source item is accounted for.'
      : 'The course keeps its validated source analysis here until a versioned Course Plan can be committed.')
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

function renderPlanCard(review) {
  const card = el('section', 'teaching-d08-card');
  const head = el('div', 'teaching-d08-plan-head');
  const copy = el('div');
  copy.append(el('div', 'teaching-kicker', 'Course Plan'), el('h3', '', 'Planned academic structure'));
  const status = el('span', 'teaching-d08-status', review.plan
    ? `Version ${review.plan.version} · ${safeStatus(review.plan.state)}`
    : review.routeQualification === 'UNQUALIFIED_UNTIL_D30' ? 'Generation held until D30' : 'Plan pending');
  head.append(copy, status);
  card.append(head);

  if (!review.plan) {
    card.append(el('p', '', 'No Course Plan has been committed yet. The validated source analysis remains authoritative for what must eventually be accounted for.'));
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
  card.append(el('div', 'teaching-kicker', 'Coverage'), el('h3', '', 'Nothing required may disappear'));
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
  card.append(el('div', 'teaching-kicker', 'Validated source analysis'), el('h3', '', 'What this course is responsible for'));
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
  card.append(el('div', 'teaching-kicker', 'Prerequisites'), el('h3', '', 'Assumptions stay visible'));
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
  card.append(el('div', 'teaching-kicker', 'Scope control'), el('h3', '', 'Versioned change review'));
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
    el('div', 'teaching-kicker', 'Course setup · Stage 2'),
    el('h2', '', 'Course Plan'),
    el('p', '', 'Review the academic structure, coverage, assumptions, and scope lineage for this course. This is course context, not a global Teaching destination.')
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

  async function load() {
    refreshButton.disabled = true;
    status.textContent = 'Loading Course Plan…';
    status.className = 'teaching-message';
    try {
      const review = await fetchReview(course.course_id);
      const grid = el('div', 'teaching-d08-grid');
      const primary = el('div', 'teaching-d08-stack');
      const secondary = el('aside', 'teaching-d08-stack');
      primary.append(renderPlanCard(review), renderCoverageCard(review));
      secondary.append(renderAnalysisCard(review), renderAssumptionsCard(review), renderScopeCard(course, review, load));
      grid.append(primary, secondary);
      body.replaceChildren(grid);
      status.textContent = '';
      status.className = '';
    } catch (error) {
      body.replaceChildren();
      status.textContent = error.message || 'Could not load Course Plan review.';
      status.className = 'teaching-message';
      status.dataset.kind = 'error';
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', load);
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

window.KIWITeachingD08 = Object.freeze({
  openCoursePlan: (courseId) => courseSurface.openCourse(courseId, 'course-plan'),
});
