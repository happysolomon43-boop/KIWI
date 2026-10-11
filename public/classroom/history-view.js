import {node, action, renderEvent} from './renderers.js';

const availability = {
  CONFIRMED_FIRST_CLASS: 'This is your first Class. There are no earlier records to connect.',
  FEWER_THAN_THREE: 'All available recent Classes are shown.',
  RECORDS_UNAVAILABLE: 'Some earlier records are unavailable. Missing records do not establish what was taught or understood.',
  RECORDS_AVAILABLE: 'The three most recent Classes are shown. Older records are retained.',
};

// Historical records stay separate from the live feed and never produce
// rendering receipts, task commands or inferred mastery.
export function createHistoryView({client, signal}) {
  const root = node('section', null, 'cr-history');
  root.hidden = true;
  root.setAttribute('aria-label', 'Recent Class records');
  const status = node('p');
  status.setAttribute('role', 'status');
  const content = node('div');
  root.append(node('h2', 'Recent Class records'), status, content);
  let generation = 0, closed = false;
  const current = token => !closed && !signal.aborted && token === generation;
  function clear() {
    generation++;
    root.hidden = true;
    content.replaceChildren();
    status.textContent = '';
  }
  signal.addEventListener('abort', () => { closed = true; clear(); }, {once:true});
  async function show() {
    if (closed || signal.aborted) return;
    const token = ++generation;
    root.hidden = false;
    content.replaceChildren();
    status.textContent = 'Loading earlier records…';
    try {
      const data = await client().recentHistory();
      if (!current(token)) return;
      status.textContent = availability[data.state] || 'History availability could not be established.';
      for (const record of data.records) {
        const article = node('article', null, 'cr-history-record');
        const date = new Date(record.ended_at);
        article.append(node('h3', Number.isFinite(date.getTime()) ? 'Class ended ' + date.toLocaleString() : 'Earlier Class'));
        const facts = record.classroom;
        if (facts) {
          const confirmed = (facts.published || []).filter(p => p.render_confirmed).length;
          article.append(node('p', confirmed + ' teaching portions confirmed rendered. Rendering does not establish understanding.'));
          article.append(node('p', (facts.pending_questions || []).length + ' questions unresolved at closure; ' + (facts.pending_evaluations || []).length + ' accepted responses awaiting evaluation.'));
          if (facts.position?.resume_anchor) article.append(node('p', 'Return position: ' + facts.position.resume_anchor));
          if (facts.carry_forward?.question_refs?.length) article.append(node('p', facts.carry_forward.question_refs.length + ' questions still carried forward.'));
        } else article.append(node('p', 'An exact academic closure record is unavailable.'));
        if (record.closure_ref) article.append(node('small', 'Original closure: ' + record.closure_ref));
        if (record.record_ref) article.append(node('p', 'Latest reconciled record: ' + record.record_ref));
        const artifacts = record.artifacts;
        if (artifacts) {
          const summary = artifacts.summary;
          const summaryText = summary?.available
            ? 'Class Summary translation available, version ' + summary.version + '. Linked to this recorded Class; it does not prove understanding.'
            : summary?.state === 'STALE_RECONCILIATION'
              ? 'Class Summary is awaiting reconciliation with the latest evidence. Earlier claims are not silently reused.'
              : 'Class Summary: ' + (summary?.state === 'NOT_AVAILABLE' ? 'not yet available' : 'held for review or translation') + '.';
          article.append(node('p', summaryText));
          const study = artifacts.study_notes;
          const noteText = study?.state === 'PRIVATE_AWAITING_D27'
            ? 'Class-grounded Study Notes: privately validated, awaiting authorized Study Pack publication.'
            : 'Class-grounded Study Notes: ' + (study?.state === 'NOT_AVAILABLE' ? 'not yet available' : 'held or not publishable') + '.';
          article.append(node('p', noteText));
          if (summary?.source_refs?.length) article.append(node('small', 'Summary sources: ' + summary.source_refs.join('; ')));
        }
        const feed = node('div');
        feed.setAttribute('aria-label', 'Earlier released conversation');
        let cursor = 0, busy = false;
        const load = action('Read released conversation', async () => {
          if (busy || !current(token)) return;
          busy = true; load.disabled = true;
          try {
            const page = await client().historicalConversation(record.session_id, cursor);
            if (!current(token)) return;
            for (const event of page.events) feed.append(renderEvent(event, {}));
            cursor = page.cursor;
            load.hidden = !page.has_more;
            load.textContent = 'Read more of this conversation';
            if (!page.events.length && !cursor) feed.append(node('p', 'No released public conversation is available.'));
          } catch {
            if (current(token)) status.textContent = 'This conversation could not be loaded. You can retry.';
          } finally { busy = false; load.disabled = false; }
        });
        article.append(load, feed);
        content.append(article);
      }
      if (data.has_older) content.append(node('p', 'Older Classes remain available through Past Classes in the course.'));
    } catch {
      if (current(token)) status.textContent = 'Earlier records could not be loaded. Present teaching can continue without them.';
    }
  }
  return {root, show, clear};
}
