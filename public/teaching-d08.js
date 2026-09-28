const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};

if (typeof kiwiApiRequest !== 'function') {
  throw new Error('KIWI shared API client must load before Teaching D08.');
}

const nav = window.KIWITeachingNavigation;
if (!nav || typeof nav.register !== 'function') {
  throw new Error('KIWI Teaching navigation must load before Teaching D08.');
}

const D08_STYLE_ID = 'teachingD08Styles';

function installStyles() {
  if (document.getElementById(D08_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = D08_STYLE_ID;
  style.textContent = `
    .teaching-d08-header{max-width:820px}
    .teaching-d08-header .teaching-title{font-size:clamp(34px,5vw,58px)}
    .teaching-d08-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:26px 0 18px}
    .teaching-d08-toolbar label{display:grid;gap:7px;min-width:min(420px,100%);color:#d8ece3;font-size:13px;font-weight:650}
    .teaching-d08-toolbar select{min-height:48px;border:1px solid var(--teaching-border);border-radius:13px;background:rgba(2,14,10,.7);color:var(--teaching-text);padding:0 14px;font:inherit}
    .teaching-d08-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px}
    .teaching-d08-card{padding:22px;border:1px solid var(--teaching-border);border-radius:20px;background:rgba(7,29,22,.7)}
    .teaching-d08-card--wide{grid-column:1/-1}
    .teaching-d08-card h2,.teaching-d08-card h3{margin:0;font-family:var(--font-display);letter-spacing:-.025em}
    .teaching-d08-card p{color:var(--teaching-muted);line-height:1.6}
    .teaching-d08-metrics{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}
    .teaching-d08-metric{min-width:112px;padding:12px;border:1px solid var(--teaching-border);border-radius:14px;background:rgba(2,14,10,.55)}
    .teaching-d08-metric strong{display:block;font-size:20px;color:var(--teaching-text)}
    .teaching-d08-metric span{display:block;margin-top:3px;color:var(--teaching-muted);font-size:11px}
    .teaching-d08-status{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border-radius:999px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
    .teaching-d08-list{display:grid;gap:10px;margin:14px 0 0;padding:0;list-style:none}
    .teaching-d08-list li{padding:12px 13px;border:1px solid var(--teaching-border);border-radius:13px;color:#b9d4c8;line-height:1.5;font-size:13px}
    .teaching-d08-topic{margin-top:10px;border:1px solid var(--teaching-border);border-radius:15px;overflow:hidden}
    .teaching-d08-topic summary{padding:14px 15px;cursor:pointer;font-weight:730;color:#d7ebe2}
    .teaching-d08-topic__body{padding:0 15px 15px}
    .teaching-d08-unit{margin-top:10px;padding:12px;border-left:2px solid var(--teaching-border-strong);background:rgba(1,12,9,.35);border-radius:0 10px 10px 0}
    .teaching-d08-unit strong{display:block}
    .teaching-d08-unit span{display:block;margin-top:5px;color:var(--teaching-muted);font-size:12px;line-height:1.5}
    .teaching-d08-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
    .teaching-d08-note{margin-top:12px;color:var(--teaching-muted);font-size:12px;line-height:1.55}
    @media(max-width:720px){.teaching-d08-grid{grid-template-columns:1fr}.teaching-d08-card--wide{grid-column:auto}}
  `;
  document.head.append(style);
}

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function metric(value, label) {
  const box = el('div', 'teaching-d08-metric');
  box.append(el('strong', '', String(value ?? 0)), el('span', '', label));
  return box;
}

function safeStatus(value) {
  return String(value || 'Not ready').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function message(target, text, kind = 'info') {
  target.textContent = text || '';
  target.className = 'teaching-message';
  target.dataset.kind = kind === 'error' ? 'error' : 'info';
}

function renderAnalysis(review) {
  const card = el('section', 'teaching-d08-card');
  card.append(el('div', 'teaching-kicker', 'Deep source analysis'), el('h2', '', 'What the validated curriculum contains'));
  const analysis = review.sourceAnalysis || {};
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
      : 'A validated Curriculum Audit is required before a final Course Plan can be produced.'));
  }

  if (analysis.exclusions?.length) {
    const title = el('h3', '', 'Explicit exclusions');
    title.style.marginTop = '18px';
    card.append(title);
    const list = el('ul', 'teaching-d08-list');
    for (const item of analysis.exclusions) {
      list.append(el('li', '', `${safeStatus(item.classification)}: ${item.reason}`));
    }
    card.append(list);
  }
  return card;
}

function renderCoverage(review) {
  const card = el('section', 'teaching-d08-card');
  card.append(el('div', 'teaching-kicker', 'Course coverage'), el('h2', '', 'Nothing required may disappear'));
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

function renderPlan(review) {
  const card = el('section', 'teaching-d08-card teaching-d08-card--wide');
  card.append(el('div', 'teaching-kicker', 'Course Plan'), el('h2', '', 'Planned academic structure'));
  if (!review.plan) {
    card.append(
      el('p', '', 'No Course Plan has been committed yet. The validated source analysis remains the authority for what must eventually be accounted for.'),
      el('div', 'teaching-d08-status', review.routeQualification === 'UNQUALIFIED_UNTIL_D30' ? 'AI route held until D30' : 'Plan pending')
    );
    return card;
  }

  const status = el('div', 'teaching-d08-status', `Version ${review.plan.version} · ${safeStatus(review.plan.state)}`);
  card.append(status);
  if (!review.plan.currentForCourseScope) {
    card.append(el('p', 'teaching-message', 'This Plan is historical for the current Course scope. A reviewed source change must be re-audited and replanned before activation or completion can proceed.'));
  }
  for (const topic of review.plan.topics || []) {
    const details = el('details', 'teaching-d08-topic');
    const summary = el('summary', '', topic.title);
    const body = el('div', 'teaching-d08-topic__body');
    if (topic.subtopics?.length) body.append(el('p', '', `Subtopics: ${topic.subtopics.map((item) => item.title).join(', ')}`));
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

function renderAssumptions(review) {
  const card = el('section', 'teaching-d08-card');
  card.append(el('div', 'teaching-kicker', 'Assumptions'), el('h2', '', 'Prerequisites that remain visible'));
  const assumptions = review.assumptions?.length ? review.assumptions : review.sourceAnalysis?.assumptions || [];
  if (!assumptions.length) {
    card.append(el('p', '', 'No student-facing prerequisite assumptions are currently recorded.'));
    return card;
  }
  const list = el('ul', 'teaching-d08-list');
  for (const item of assumptions) {
    list.append(el('li', '', [item.label, item.description || item.disclosure, item.state ? safeStatus(item.state) : null].filter(Boolean).join(' — ')));
  }
  card.append(list);
  return card;
}

async function renderStage2() {
  installStyles();
  const main = document.getElementById('teachingApp');
  if (!main) return;

  const page = el('section', 'teaching-view');
  const header = el('header', 'teaching-d08-header');
  header.append(
    el('div', 'teaching-kicker', 'Course setup · Stage 2'),
    el('h1', 'teaching-title', 'Review the scope before Teaching plans around it.'),
    el('p', 'teaching-lead', 'See validated source analysis, explicit exclusions, Course Plan structure, and coverage state without turning self-report into evidence or hiding required content.')
  );
  page.append(header);

  const toolbar = el('div', 'teaching-d08-toolbar');
  const field = el('label', '', 'Course');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Choose a Teaching Course');
  field.append(select);
  const refresh = el('button', 'teaching-button', 'Refresh review');
  refresh.type = 'button';
  toolbar.append(field, refresh);
  page.append(toolbar);

  const status = el('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  page.append(status);

  const body = el('div', 'teaching-d08-grid');
  page.append(body);
  main.replaceChildren(page);

  let courses;
  try {
    courses = await kiwiApiRequest('/teaching/courses');
  } catch (error) {
    message(status, error.message || 'Could not load Teaching Courses.', 'error');
    return;
  }
  select.replaceChildren();
  if (!courses.length) {
    select.append(new Option('No Teaching courses yet', ''));
    select.disabled = true;
    body.append(el('div', 'teaching-empty', 'Create a Draft Course in Course Intake first.'));
    return;
  }
  for (const course of courses) select.append(new Option(course.title || 'Untitled course', course.course_id));

  async function loadReview() {
    if (!select.value) return;
    refresh.disabled = true;
    message(status, 'Loading validated Course scope and coverage…');
    try {
      const review = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(select.value)}/plan-review`);
      body.replaceChildren(
        renderAnalysis(review),
        renderCoverage(review),
        renderPlan(review),
        renderAssumptions(review)
      );
      const actions = el('section', 'teaching-d08-card teaching-d08-card--wide');
      actions.append(el('div', 'teaching-kicker', 'Scope control'), el('h2', '', 'Versioned change review'));
      const actionRow = el('div', 'teaching-d08-actions');
      const check = el('button', 'teaching-button', 'Check KIWI Subject for changes');
      check.type = 'button';
      check.addEventListener('click', async () => {
        check.disabled = true;
        try {
          const result = await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(select.value)}/scope-review`, { method: 'POST', body: {} });
          message(status, result.message || 'Scope review recorded.');
          await loadReview();
        } catch (error) {
          message(status, error.message || 'Scope review failed safely.', 'error');
        } finally {
          check.disabled = false;
        }
      });
      actionRow.append(check);
      actions.append(actionRow, el('p', 'teaching-d08-note', 'A detected Subject change does not silently rewrite the current Course Plan. Material adoption requires reviewed version impact and a new validated Audit/Plan cycle.'));
      body.append(actions);
      message(status, 'Stage 2 review is current.');
    } catch (error) {
      body.replaceChildren();
      message(status, error.message || 'Could not load Course Plan review.', 'error');
    } finally {
      refresh.disabled = false;
    }
  }

  select.addEventListener('change', loadReview);
  refresh.addEventListener('click', loadReview);
  await loadReview();
}

nav.register({
  id: 'course-plan-review',
  label: 'Course Plan',
  icon: '◫',
  onSelect: () => { renderStage2().catch(() => {}); },
});

window.KIWITeachingD08 = Object.freeze({ renderStage2 });
