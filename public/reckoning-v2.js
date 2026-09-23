(function () {
  'use strict';

  var runtime = {
    timerId: null,
    questionShownAt: 0,
    state: null,
    options: null,
    selected: null,
    submitting: false,
    flagging: false,
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function roleLabel(role) {
    var labels = {
      DIAGNOSTIC: 'Diagnostic',
      CONTROL: 'Control',
      CHALLENGE: 'Challenge',
      CONFIRMATION: 'Confirmation',
    };
    return labels[String(role || '').toUpperCase()] || 'Review';
  }

  function statusCounts(state) {
    var evidence = Array.isArray(state && state.evidence) ? state.evidence : [];
    var recovered = 0;
    var unresolved = 0;
    var provisional = 0;
    evidence.forEach(function (item) {
      if (item.status === 'RECOVERED') recovered += 1;
      else if (item.status === 'UNRESOLVED') unresolved += 1;
      else if (
        item.status === 'PROVISIONAL' ||
        item.status === 'CHALLENGE_REQUIRED' ||
        item.status === 'CONFIRMATION_REQUIRED'
      ) provisional += 1;
    });
    return { recovered: recovered, unresolved: unresolved, provisional: provisional };
  }

  function clearTimer() {
    if (runtime.timerId) clearInterval(runtime.timerId);
    runtime.timerId = null;
  }

  function updateElapsed() {
    var el = document.getElementById('reckoningV2Elapsed');
    if (!el || !runtime.state) return;
    var start = runtime.state.reviewStartedAt
      ? new Date(runtime.state.reviewStartedAt).getTime()
      : Date.now();
    if (!Number.isFinite(start)) start = Date.now();
    var sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
    var min = Math.floor(sec / 60);
    var rem = sec % 60;
    el.textContent = min + ':' + String(rem).padStart(2, '0');
  }

  function beginElapsedTimer() {
    clearTimer();
    updateElapsed();
    runtime.timerId = setInterval(updateElapsed, 1000);
  }

  function host() {
    return document.getElementById(
      (runtime.options && runtime.options.hostId) || 'reckoningContainer'
    );
  }

  function frame(inner) {
    return (
      '<div id="reckoningV2Surface" style="' +
        'position:fixed;inset:0;z-index:10020;background:rgba(4,12,9,.965);' +
        'overflow:auto;padding:20px;display:flex;align-items:flex-start;justify-content:center;">' +
        '<div style="width:min(760px,100%);margin:auto;background:var(--card-bg,#102118);' +
          'border:1px solid rgba(82,183,136,.28);border-radius:18px;padding:24px;' +
          'box-shadow:0 30px 80px rgba(0,0,0,.45);">' +
          inner +
        '</div>' +
      '</div>'
    );
  }

  function summaryHeader(state) {
    var counts = statusCounts(state);
    var ordinal = Math.max(1, Number(state.questionsUsed || 0) + 1);
    var role = roleLabel(state.reviewRole || (state.currentQuestion && state.currentQuestion.role));
    return (
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:20px;">' +
        '<div>' +
          '<div style="font-family:var(--font-display);font-size:24px;font-weight:750;color:var(--text,#eef8f0);">' +
            'The Reckoning' +
          '</div>' +
          '<div style="font-family:var(--font-mono);font-size:12px;color:var(--red-bright,#e57373);margin-top:5px;">' +
            'Question ' + ordinal + ' · ' + esc(role) +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:12px;color:var(--text-2,#a8b5ac);">' +
            counts.recovered + ' concepts recovered · ' +
            (counts.unresolved + counts.provisional) + ' unresolved' +
          '</div>' +
          '<div style="font-family:var(--font-mono);font-size:12px;color:var(--teal,#2dd4bf);margin-top:5px;">' +
            'Elapsed <span id="reckoningV2Elapsed">0:00</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderQuestion(state) {
    runtime.state = state;
    runtime.selected = null;
    runtime.submitting = false;
    runtime.flagging = false;
    runtime.questionShownAt = Date.now();

    var container = host();
    if (!container) return;
    var question = state.currentQuestion;
    if (!question) {
      renderPreparingFinalization(state);
      return;
    }

    var options = (question.options || []).map(function (option) {
      return (
        '<button type="button" class="reckoning-v2-option" data-option="' + esc(option.id) + '" style="' +
          'width:100%;display:flex;gap:12px;align-items:flex-start;text-align:left;' +
          'padding:14px 16px;border-radius:12px;border:1px solid var(--border,#2b4434);' +
          'background:var(--bg-3,#0b1911);color:var(--text,#eef8f0);cursor:pointer;">' +
          '<span style="font-family:var(--font-mono);font-weight:700;color:var(--green-bright,#52b788);">' +
            esc(option.id) +
          '</span>' +
          '<span style="line-height:1.55;">' + esc(option.text) + '</span>' +
        '</button>'
      );
    }).join('');

    container.innerHTML = frame(
      summaryHeader(state) +
      '<div style="margin-bottom:8px;font-size:12px;color:var(--text-3,#839289);text-transform:uppercase;letter-spacing:.08em;">' +
        esc(state.subjectName || 'Subject') +
      '</div>' +
      '<div style="font-size:19px;line-height:1.55;color:var(--text,#eef8f0);font-weight:650;margin-bottom:18px;">' +
        esc(question.stem) +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' + options + '</div>' +
      '<div id="reckoningV2AuditNotice" style="margin-top:14px;font-size:12px;line-height:1.5;color:var(--text-3,#839289);"></div>' +
      '<div style="margin-top:18px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
        '<button type="button" id="reckoningV2Flag" class="btn btn-secondary">' +
          'Review question integrity' +
        '</button>' +
        '<button type="button" id="reckoningV2Submit" class="btn btn-primary" disabled>' +
          'Submit answer' +
        '</button>' +
      '</div>' +
      '<div style="margin-top:14px;font-size:11px;line-height:1.5;color:var(--text-4,#738077);text-align:center;">' +
        'Answers are final. KIWI saves each response immediately; there is no back navigation.' +
      '</div>'
    );

    Array.prototype.forEach.call(
      container.querySelectorAll('.reckoning-v2-option'),
      function (button) {
        button.addEventListener('click', function () {
          if (runtime.submitting) return;
          runtime.selected = button.getAttribute('data-option');
          Array.prototype.forEach.call(
            container.querySelectorAll('.reckoning-v2-option'),
            function (item) {
              item.style.borderColor = 'var(--border,#2b4434)';
              item.style.background = 'var(--bg-3,#0b1911)';
            }
          );
          button.style.borderColor = 'var(--green-bright,#52b788)';
          button.style.background = 'rgba(82,183,136,.10)';
          var submit = document.getElementById('reckoningV2Submit');
          if (submit) submit.disabled = false;
        });
      }
    );

    var submit = document.getElementById('reckoningV2Submit');
    if (submit) submit.addEventListener('click', submitCurrentAnswer);
    var flag = document.getElementById('reckoningV2Flag');
    if (flag) flag.addEventListener('click', flagCurrentQuestion);
    beginElapsedTimer();
  }

  async function flagCurrentQuestion() {
    if (runtime.flagging || runtime.submitting || !runtime.state) return;
    var question = runtime.state.currentQuestion;
    if (!question || !runtime.options.api || typeof runtime.options.api.flag !== 'function') return;

    runtime.flagging = true;
    var flag = document.getElementById('reckoningV2Flag');
    var submit = document.getElementById('reckoningV2Submit');
    var notice = document.getElementById('reckoningV2AuditNotice');
    if (flag) {
      flag.disabled = true;
      flag.textContent = 'Reviewing integrity…';
    }
    if (submit) submit.disabled = true;

    try {
      var result = await runtime.options.api.flag(
        runtime.state.examSessionId,
        question.questionNumber
      );
      if (notice) {
        notice.style.color = result && result.bonus_awarded
          ? 'var(--gold,#d4a017)'
          : 'var(--text-3,#839289)';
        notice.textContent = result && result.bonus_awarded
          ? 'KIWI found an integrity issue. This item will not count against your evidence, while your raw answer is still preserved.'
          : 'KIWI reviewed the item and found no integrity issue.';
      }
      if (flag) {
        flag.textContent = 'Integrity reviewed';
        flag.disabled = true;
      }
      runtime.flagging = false;
      if (submit) submit.disabled = !runtime.selected;
    } catch (error) {
      runtime.flagging = false;
      if (flag) {
        flag.disabled = false;
        flag.textContent = 'Retry integrity review';
      }
      if (submit) submit.disabled = !runtime.selected;
      notify(error && error.message ? error.message : 'Question review could not complete yet.', 'error');
    }
  }

  async function submitCurrentAnswer() {
    if (runtime.submitting || runtime.flagging || !runtime.selected || !runtime.state) return;
    var question = runtime.state.currentQuestion;
    if (!question) return;
    runtime.submitting = true;

    var submit = document.getElementById('reckoningV2Submit');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Saving…';
    }

    try {
      var responseMs = Math.max(0, Date.now() - runtime.questionShownAt);
      var nextState = await runtime.options.api.answer(
        runtime.state.examSessionId,
        question.id,
        runtime.selected,
        responseMs
      );

      if (nextState && nextState.feedback && nextState.feedback.isCorrect === false) {
        renderRemediation(nextState);
        return;
      }

      await advance(nextState);
    } catch (error) {
      runtime.submitting = false;
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Submit answer';
      }
      notify(error && error.message ? error.message : 'Answer could not be saved.', 'error');
    }
  }

  function renderRemediation(state) {
    runtime.state = state;
    runtime.submitting = false;
    var container = host();
    if (!container) return;
    var feedback = state.feedback || {};

    container.innerHTML = frame(
      summaryHeader(state) +
      '<div style="padding:18px;border:1px solid rgba(229,115,115,.28);border-radius:14px;background:rgba(229,115,115,.07);">' +
        '<div style="font-size:13px;font-weight:800;color:var(--red-bright,#e57373);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">' +
          'Corrective review' +
        '</div>' +
        '<div style="font-size:14px;color:var(--text-2,#a8b5ac);line-height:1.6;margin-bottom:10px;">' +
          'Best answer: <strong style="color:var(--text,#eef8f0);">' + esc(feedback.correctAnswer || '') + '</strong>' +
        '</div>' +
        '<div style="font-size:15px;color:var(--text,#eef8f0);line-height:1.65;">' +
          esc(feedback.explanation || 'Review the underlying concept before continuing.') +
        '</div>' +
      '</div>' +
      '<div style="margin-top:18px;display:flex;justify-content:flex-end;">' +
        '<button class="btn btn-primary" id="reckoningV2Continue">Continue</button>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:11px;color:var(--text-4,#738077);text-align:center;">' +
        'KIWI will revisit this knowledge later using a different question when enough spacing has passed.' +
      '</div>'
    );

    document.getElementById('reckoningV2Continue').addEventListener('click', function () {
      advance(state);
    });
    beginElapsedTimer();
  }

  function renderCheckpoint(state) {
    runtime.state = state;
    var checkpoint = state.checkpoint || {};
    var misses = Array.isArray(checkpoint.recentMisses) ? checkpoint.recentMisses : [];
    var missHtml = misses.length
      ? misses.map(function (item) {
          return (
            '<div style="padding:10px 12px;border-radius:10px;background:var(--bg-3,#0b1911);margin-top:8px;">' +
              '<div style="font-size:11px;color:var(--gold,#d4a017);font-family:var(--font-mono);">' +
                esc(roleLabel(item.role)) +
              '</div>' +
              '<div style="font-size:13px;color:var(--text-2,#a8b5ac);line-height:1.5;margin-top:4px;">' +
                esc(item.explanation || item.stem || '') +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div style="font-size:13px;color:var(--text-3,#839289);">No recent misses in this block.</div>';

    var container = host();
    if (!container) return;
    container.innerHTML = frame(
      summaryHeader(state) +
      '<div style="font-size:13px;font-weight:800;color:var(--teal,#2dd4bf);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">' +
        'Recovery checkpoint' +
      '</div>' +
      '<div style="font-size:17px;font-weight:700;color:var(--text,#eef8f0);margin-bottom:14px;">' +
        esc(checkpoint.recovered || 0) + ' recovered · ' +
        esc(checkpoint.criticalRemaining || 0) + ' critical still unresolved' +
      '</div>' +
      '<div style="font-size:13px;color:var(--text-2,#a8b5ac);line-height:1.6;margin-bottom:12px;">' +
        'This is a knowledge checkpoint, not a score screen. KIWI is deciding what still needs independent evidence.' +
      '</div>' +
      missHtml +
      '<div style="margin-top:18px;display:flex;justify-content:flex-end;">' +
        '<button class="btn btn-primary" id="reckoningV2CheckpointContinue">Continue review</button>' +
      '</div>'
    );
    document.getElementById('reckoningV2CheckpointContinue').addEventListener('click', function () {
      renderQuestion(state);
    });
    beginElapsedTimer();
  }

  async function advance(state) {
    if (!state) return;
    runtime.state = state;

    if (
      state.enginePhase === 'FINALIZING' ||
      (state.final === true && !state.currentQuestion)
    ) {
      await finalize(state);
      return;
    }

    if (state.enginePhase === 'COMPLETE') {
      renderReport(state.report || {}, state);
      return;
    }

    if (state.checkpointDue && state.checkpoint) {
      renderCheckpoint(state);
      return;
    }

    renderQuestion(state);
  }

  function renderPreparingFinalization(state) {
    var container = host();
    if (!container) return;
    container.innerHTML = frame(
      summaryHeader(state) +
      '<div style="text-align:center;padding:32px 10px;">' +
        '<div style="font-size:22px;font-weight:750;color:var(--text,#eef8f0);">Evaluating recovery evidence…</div>' +
        '<div style="font-size:13px;color:var(--text-2,#a8b5ac);margin-top:8px;">' +
          'KIWI is applying the final evidence result once and updating the learning system.' +
        '</div>' +
      '</div>'
    );
    beginElapsedTimer();
  }

  async function finalize(state) {
    renderPreparingFinalization(state);
    try {
      var result = await runtime.options.api.finalize(state.examSessionId);
      var report = result && result.report
        ? result.report
        : (result && result.recovery
          ? {
              subjectName: state.subjectName || 'Subject',
              survived: result.recovery.survived,
              rawAccuracy: result.recovery.rawAccuracy,
              recoveryScore: result.recovery.recoveryScore,
              criticalRemaining: result.recovery.unresolvedCriticalCount,
              recovered: [],
              unresolved: [],
              controlDiscoveries: [],
              learningChanges: [],
              nextStep: result.recovery.survived
                ? 'Recovered material remains in spaced review.'
                : 'Return to the unresolved concepts before the next attempt.',
            }
          : {});
      renderReport(report, result || state);
    } catch (error) {
      var container = host();
      if (!container) return;
      container.innerHTML = frame(
        '<div style="text-align:center;padding:28px 8px;">' +
          '<div style="font-size:21px;font-weight:750;color:var(--red-bright,#e57373);">Finalization needs a retry</div>' +
          '<div style="font-size:13px;color:var(--text-2,#a8b5ac);line-height:1.6;margin-top:10px;">' +
            'Your answers are already saved. Retrying will not duplicate card, Pressure, or KS consequences.' +
          '</div>' +
          '<button class="btn btn-primary" id="reckoningV2RetryFinalize" style="margin-top:18px;">Retry finalization</button>' +
        '</div>'
      );
      document.getElementById('reckoningV2RetryFinalize').addEventListener('click', function () {
        finalize(state);
      });
      notify(error && error.message ? error.message : 'Finalization could not complete.', 'error');
    }
  }

  function listRows(items, formatter, empty) {
    if (!Array.isArray(items) || !items.length) {
      return '<div style="font-size:13px;color:var(--text-3,#839289);">' + esc(empty) + '</div>';
    }
    return items.map(formatter).join('');
  }

  function renderReport(report, fullResult) {
    clearTimer();
    var survived = report && report.survived === true;
    var container = host();
    if (!container) return;

    var recoveredHtml = listRows(
      report.recovered,
      function (item) {
        return (
          '<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;">' +
            '<span style="color:var(--green-bright,#52b788);">Recovered</span> · ' +
            esc(item.label) +
            (item.recoveredAfterRemediation ? ' <span style="color:var(--gold,#d4a017);">(after remediation)</span>' : '') +
          '</div>'
        );
      },
      'No recovered concepts were recorded.'
    );
    var unresolvedHtml = listRows(
      report.unresolved,
      function (item) {
        return (
          '<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;">' +
            '<span style="color:var(--red-bright,#e57373);">Unresolved</span> · ' + esc(item.label) +
          '</div>'
        );
      },
      'No unresolved concepts remain.'
    );
    var controlHtml = listRows(
      report.controlDiscoveries,
      function (item) {
        return (
          '<div style="padding:7px 0;font-size:13px;color:var(--text-2,#a8b5ac);">' +
            'Control check exposed: ' + esc(item.label) +
          '</div>'
        );
      },
      'No hidden weakness was discovered by control questions.'
    );
    var changesHtml = listRows(
      report.learningChanges,
      function (item) {
        var stage = item.stageBefore != null && item.stageAfter != null
          ? ' · Stage ' + esc(item.stageBefore) + ' → ' + esc(item.stageAfter)
          : '';
        return (
          '<div style="padding:7px 0;font-size:13px;color:var(--text-2,#a8b5ac);">' +
            esc(String(item.type || '').replace(/_/g, ' ')) + stage +
          '</div>'
        );
      },
      'No additional card-stage change was required.'
    );

    container.innerHTML = frame(
      '<div style="text-align:center;margin-bottom:22px;">' +
        '<div style="font-size:12px;font-family:var(--font-mono);color:' +
          (survived ? 'var(--green-bright,#52b788)' : 'var(--red-bright,#e57373)') +
          ';text-transform:uppercase;letter-spacing:.12em;">' +
          (survived ? 'Reckoning survived' : 'Reckoning unresolved') +
        '</div>' +
        '<div style="font-size:25px;font-weight:800;color:var(--text,#eef8f0);margin-top:7px;">' +
          esc(report.subjectName || 'Diagnostic report') +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:18px;">' +
        '<div style="padding:14px;border-radius:12px;background:var(--bg-3,#0b1911);">' +
          '<div style="font-size:11px;color:var(--text-3,#839289);">Recovery score</div>' +
          '<div style="font-size:22px;font-weight:800;color:var(--teal,#2dd4bf);">' + esc(report.recoveryScore || 0) + '%</div>' +
        '</div>' +
        '<div style="padding:14px;border-radius:12px;background:var(--bg-3,#0b1911);">' +
          '<div style="font-size:11px;color:var(--text-3,#839289);">Raw accuracy</div>' +
          '<div style="font-size:22px;font-weight:800;color:var(--text,#eef8f0);">' + esc(report.rawAccuracy || 0) + '%</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
        '<div><div style="font-weight:750;color:var(--green-bright,#52b788);margin-bottom:6px;">Recovered</div>' + recoveredHtml + '</div>' +
        '<div><div style="font-weight:750;color:var(--red-bright,#e57373);margin-bottom:6px;">Still unresolved</div>' + unresolvedHtml + '</div>' +
      '</div>' +
      '<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border,#2b4434);">' +
        '<div style="font-weight:750;color:var(--text,#eef8f0);margin-bottom:6px;">Control discoveries</div>' +
        controlHtml +
      '</div>' +
      '<div style="margin-top:16px;">' +
        '<div style="font-weight:750;color:var(--text,#eef8f0);margin-bottom:6px;">Learning system changes</div>' +
        changesHtml +
      '</div>' +
      '<div style="margin-top:18px;padding:14px;border-radius:12px;background:rgba(45,212,191,.07);border:1px solid rgba(45,212,191,.18);font-size:13px;line-height:1.6;color:var(--text-2,#a8b5ac);">' +
        esc(report.nextStep || '') +
      '</div>' +
      '<div style="margin-top:20px;display:flex;justify-content:flex-end;">' +
        '<button class="btn btn-primary" id="reckoningV2Done">' +
          (survived ? 'Return to Brain' : 'Prepare next attempt') +
        '</button>' +
      '</div>'
    );

    document.getElementById('reckoningV2Done').addEventListener('click', function () {
      clearTimer();
      if (runtime.options && typeof runtime.options.onDone === 'function') {
        runtime.options.onDone(fullResult, report);
      }
    });
  }

  function notify(message, type) {
    if (runtime.options && typeof runtime.options.notify === 'function') {
      runtime.options.notify(message, type || 'info');
    }
  }

  async function open(options) {
    runtime.options = options || {};
    runtime.state = options.initialState || null;
    if (!runtime.state && options.api && typeof options.api.state === 'function') {
      runtime.state = await options.api.state(options.examSessionId);
    }
    if (!runtime.state) throw new Error('Adaptive Reckoning state is unavailable.');
    if (typeof options.onLock === 'function') options.onLock();
    await advance(runtime.state);
  }

  window.KiwiReckoningV2 = Object.freeze({
    open: open,
    renderReport: renderReport,
    _roleLabel: roleLabel,
    _statusCounts: statusCounts,
  });
})();