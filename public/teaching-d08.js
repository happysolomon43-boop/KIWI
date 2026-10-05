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
    .teaching-d08-setup-list{display:grid;gap:10px;margin-top:18px}
    .teaching-d08-setup-step{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px;border:1px solid var(--teaching-border);border-radius:15px;background:rgba(1,12,9,.34)}
    .teaching-d08-setup-step__mark{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-weight:900}
    .teaching-d08-setup-step strong,.teaching-d08-setup-step small{display:block}.teaching-d08-setup-step small{margin-top:4px;color:var(--teaching-muted);line-height:1.45}
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
  const needsSetup = !review.plan && review.generation?.ready === false;
  const status = el(needsSetup ? 'button' : 'span', 'teaching-d08-status', review.plan
    ? `Version ${review.plan.version} · ${safeStatus(review.plan.state)}`
    : review.generation?.ready === false ? 'Setup required' : 'Ready to create');
  if (needsSetup) {
    status.type = 'button';
    status.setAttribute('aria-label', 'Open course setup');
    status.addEventListener('click', () => courseSurface.openCourse(course.course_id, 'setup'));
  }
  head.append(copy, status);
  card.append(head);

  if (!review.plan) {
    card.append(el('p', '', 'Create a Course Plan to organize the topics and learning units for this course.'));
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
      const generate = el('button', 'teaching-button teaching-button--primary', 'Create Course Plan');
      generate.type = 'button';
      generate.addEventListener('click', async () => {
        generate.disabled = true;
        message.textContent = 'Creating your Course Plan…';
        message.className = 'teaching-message';
        delete message.dataset.kind;
        try {
          await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/course-plan`, { method: 'POST', body: {} });
          message.textContent = 'Course Plan created.';
          await refresh();
        } catch (error) {
          message.textContent = error.message || 'Could not create the Course Plan.';
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

  async function load() {
    refreshButton.disabled = true;
    status.textContent = 'Loading Course Plan…';
    status.className = 'teaching-message';
    try {
      const review = await fetchReview(course.course_id);
      const grid = el('div', 'teaching-d08-grid');
      const primary = el('div', 'teaching-d08-stack');
      const secondary = el('aside', 'teaching-d08-stack');
      primary.append(renderPlanCard(course, review, load), renderCoverageCard(review));
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

  async function load() {
    status.textContent = 'Checking course preparation…';
    status.className = 'teaching-message';
    try {
      const setup = await fetchSetup(course.course_id);
      const auditReady = setup.curriculumAudit?.status === 'VALIDATED_CANDIDATE'
        && String(setup.curriculumAudit?.subject_snapshot_ref || '') === String(setup.course?.subject_snapshot_ref || '');
      const sourcesReady = (setup.sources || []).length > 0 && (setup.sources || []).every((source) => Boolean(source.classification));
      const diagnosticRequired = setup.diagnosticPlan?.requirement_state === 'REQUIRED';
      const diagnosticResolved = !diagnosticRequired || (setup.diagnosticPlan?.target_refs || []).every((target) =>
        (setup.vpkDecisions || []).some((decision) => String(decision.target_ref) === String(target)));
      const readinessChecked = Boolean(setup.diagnosticPlan);
      const card = el('section', 'teaching-d08-card');
      card.append(el('div', 'teaching-kicker', 'What KIWI needs'), el('h3', '', 'A clear source foundation'));
      const list = el('div', 'teaching-d08-setup-list');
      const setupStep = (mark, title, description, state) => {
        const row = el('div', 'teaching-d08-setup-step');
        const text = el('div');
        text.append(el('strong', '', title), el('small', '', description));
        row.append(el('span', 'teaching-d08-setup-step__mark', mark), text, el('span', 'teaching-d08-status', state));
        return row;
      };
      list.append(
        setupStep((setup.sources || []).length ? '✓' : '•', 'Course materials', `${(setup.sources || []).length} saved source item${(setup.sources || []).length === 1 ? '' : 's'} will ground the plan.`, (setup.sources || []).length ? 'Ready' : 'Missing'),
        setupStep(auditReady && sourcesReady ? '✓' : '•', 'Material analysis', auditReady && sourcesReady ? 'The current materials have been analyzed and classified.' : 'KIWI needs to identify the topics, requirements, and relevant source content.', auditReady && sourcesReady ? 'Ready' : 'Needed'),
        setupStep(readinessChecked && diagnosticResolved ? '✓' : '•', 'Learning readiness', diagnosticRequired ? 'A focused, non-graded learning check is required before planning can continue.' : readinessChecked ? 'No additional learning check blocks the Course Plan.' : 'Check whether any prerequisite knowledge needs verification.', readinessChecked && diagnosticResolved ? 'Ready' : 'Action needed')
      );
      card.append(list);
      const actions = el('div', 'teaching-d08-actions');
      if (!auditReady || !sourcesReady) {
        const analyze = el('button', 'teaching-button teaching-button--primary', 'Analyze course materials');
        analyze.type = 'button';
        analyze.addEventListener('click', async () => {
          analyze.disabled = true;
          status.textContent = 'Analyzing the course materials…';
          status.className = 'teaching-message';
          delete status.dataset.kind;
          try {
            await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/curriculum-audit`, { method: 'POST', body: {} });
            await load();
          } catch (error) {
            status.textContent = error.message || 'The material analysis could not be completed.';
            status.className = 'teaching-message';
            status.dataset.kind = 'error';
            analyze.disabled = false;
          }
        });
        actions.append(analyze);
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
      card.append(actions);
      body.replaceChildren(card);
      status.textContent = '';
      status.className = '';
      delete status.dataset.kind;
    } catch (error) {
      body.replaceChildren();
      status.textContent = error.message || 'Course preparation could not be loaded.';
      status.className = 'teaching-message';
      status.dataset.kind = 'error';
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
