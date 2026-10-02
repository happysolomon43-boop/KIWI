(function initKiwiAssessmentShellCore(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KIWI_ASSESSMENT_SHELL_CORE = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function assessmentShellCoreFactory() {
  'use strict';

  const TERMINAL_ATTEMPT_STATES = new Set(['SUBMITTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED']);
  const FORBIDDEN_BROWSER_KEYS = new Set([
    'protected_marking_payload', 'protected_payload', 'correct_answer', 'answer_key',
    'rubric', 'rubric_key', 'distractor_trace', 'hidden_validation_trace',
    'candidate_version_id', 'semantic_hash', 'model_control', 'system_prompt',
  ]);

  const text = (value) => value == null ? '' : String(value);
  const upper = (value) => text(value).trim().toUpperCase();
  const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const asArray = (value) => Array.isArray(value) ? value : [];

  function rendererKind(item) {
    const payload = asObject(item?.public_item_payload);
    const contract = asObject(payload.response_contract || payload.responseContract);
    const declared = upper(contract.response_type || contract.responseType || payload.response_type || payload.responseType || item?.response_family);
    if (['MCQ', 'OBJECTIVE', 'SELECTED_RESPONSE', 'SINGLE_SELECT', 'MULTI_SELECT'].includes(declared)) return 'mcq';
    if (['SHORT', 'SHORT_ANSWER', 'SHORT_CONSTRUCTED', 'CONSTRUCTED_SHORT'].includes(declared)) return 'short';
    if (['EXTENDED', 'EXTENDED_RESPONSE', 'LONG_FORM'].includes(declared)) return 'extended';
    if (['ESSAY'].includes(declared)) return 'essay';
    if (['MULTI_PART', 'MULTIPART', 'STRUCTURED'].includes(declared)) return 'multi_part';
    if (['MATH', 'MATHEMATICAL', 'MATH_WORKING', 'CALCULATION', 'QUANTITATIVE'].includes(declared)) return 'math_working';
    if (['NUMERIC', 'NUMERIC_UNIT', 'NUMBER_UNIT'].includes(declared)) return 'numeric_unit';
    if (['CODE', 'PROGRAMMING'].includes(declared)) return 'code';
    if (['VISUAL', 'DRAWING', 'DIAGRAM', 'GRAPH_CONSTRUCTION'].includes(declared)) return 'visual_reserved';
    return 'short';
  }

  function sourcePayload(item) {
    const payload = asObject(item?.public_item_payload);
    return payload.source ?? payload.stimulus ?? payload.passage ?? payload.dataset ?? payload.figure ?? null;
  }

  function responseContract(item) {
    const payload = asObject(item?.public_item_payload);
    return Object.freeze({ ...asObject(payload.response_contract || payload.responseContract) });
  }

  function optionRecords(item) {
    const payload = asObject(item?.public_item_payload);
    const contract = asObject(item?.choice_set_contract);
    const ids = asArray(contract.stable_option_ids).map(String);
    const source = asArray(payload.options || payload.choices);
    if (!source.length) return Object.freeze([]);
    if (ids.length !== source.length) {
      const error = new Error('Locked MCQ item is missing its deterministic stable option identifiers.');
      error.code = 'TEACHING_D18_MCQ_CHOICE_CONTRACT_INVALID';
      throw error;
    }
    return Object.freeze(source.map((entry, index) => {
      const value = entry && typeof entry === 'object' ? entry : { text: entry };
      return Object.freeze({ id: ids[index], text: text(value.text ?? value.label ?? value.value), ordinal: index + 1 });
    }));
  }

  function partRecords(item) {
    const payload = asObject(item?.public_item_payload);
    const raw = asArray(payload.parts);
    return Object.freeze(raw.map((part, index) => {
      const value = asObject(part);
      const partId = text(value.part_id || value.partId || value.id || `part-${index + 1}`);
      const pseudoItem = {
        response_family: value.response_family || value.responseFamily || value.response_type || value.responseType || 'SHORT_CONSTRUCTED',
        public_item_payload: value,
        choice_set_contract: value.choice_set_contract || value.choiceSetContract || {},
      };
      return Object.freeze({
        partId,
        label: text(value.label || value.part_label || value.partLabel || String.fromCharCode(97 + index)),
        prompt: text(value.prompt || value.question || value.stem),
        marks: Number(value.marks || value.intended_marks || 0),
        renderer: describeRenderer(pseudoItem, null, true),
      });
    }));
  }

  function describeRenderer(item, packageRow = null, nested = false) {
    const payload = asObject(item?.public_item_payload);
    const contract = responseContract(item);
    const kind = rendererKind(item);
    const choice = asObject(item?.choice_set_contract);
    const selectionMode = upper(contract.selection_mode || contract.selectionMode || choice.selection_mode || choice.selectionMode || (contract.multi_select ? 'MULTIPLE' : 'SINGLE'));
    const source = sourcePayload(item);
    const descriptor = {
      id: text(item?.package_item_id || payload.item_id || payload.id),
      kind,
      family: text(item?.response_family),
      marks: Number(item?.intended_marks || payload.marks || 0),
      prompt: text(payload.prompt || payload.question || payload.stem || payload.text),
      instructions: text(payload.instructions || contract.instructions),
      responseContract: contract,
      markBearingFields: Object.freeze(asArray(contract.mark_bearing_fields || contract.markBearingFields).map(String)),
      source: source == null ? null : source,
      sourceLayout: source == null ? 'none' : 'responsive-pinned',
      readOnlyWhenTerminal: true,
      itemState: text(item?.item_state || 'ACTIVE'),
      invalid: upper(item?.item_state) === 'INVALIDATED',
      retired: upper(item?.item_state) === 'RETIRED_AS_CLEAN_EVIDENCE' || item?.answer_exposed === true,
      visualExtensionReserved: kind === 'visual_reserved',
      selectionMode: kind === 'mcq' ? (selectionMode === 'MULTIPLE' || selectionMode === 'MULTI' ? 'multiple' : 'single') : null,
      options: kind === 'mcq' ? optionRecords(item) : Object.freeze([]),
      parts: kind === 'multi_part' ? partRecords(item) : Object.freeze([]),
      packageMode: nested ? null : text(packageRow?.response_form_architecture?.mode || ''),
    };
    return Object.freeze(descriptor);
  }

  function emptyDraft(descriptor) {
    switch (descriptor.kind) {
      case 'mcq': return { selected_option_ids: [] };
      case 'math_working': return { working: '', final_answer: '' };
      case 'numeric_unit': return { value: '', unit: '' };
      case 'multi_part': return { parts: Object.fromEntries(descriptor.parts.map((part) => [part.partId, emptyDraft(part.renderer)])) };
      case 'visual_reserved': return { unsupported_visual_response: true };
      default: return { text: '' };
    }
  }

  function restoreDraft(descriptor, payload) {
    const value = asObject(payload);
    switch (descriptor.kind) {
      case 'mcq': {
        const valid = new Set(descriptor.options.map((option) => option.id));
        const selected = asArray(value.selected_option_ids || value.selectedOptionIds || value.selected_options).map(String).filter((id) => valid.has(id));
        return { selected_option_ids: descriptor.selectionMode === 'single' ? selected.slice(0, 1) : selected };
      }
      case 'math_working': return { working: text(value.working), final_answer: text(value.final_answer ?? value.finalAnswer) };
      case 'numeric_unit': return { value: text(value.value), unit: text(value.unit) };
      case 'multi_part': {
        const inputParts = asObject(value.parts);
        return { parts: Object.fromEntries(descriptor.parts.map((part) => [part.partId, restoreDraft(part.renderer, inputParts[part.partId])])) };
      }
      case 'visual_reserved': return { unsupported_visual_response: true };
      default: return { text: text(value.text ?? value.response ?? value.answer) };
    }
  }

  function canonicalPayload(descriptor, draft) {
    const value = asObject(draft);
    switch (descriptor.kind) {
      case 'mcq': return restoreDraft(descriptor, value);
      case 'math_working': return { working: text(value.working), final_answer: text(value.final_answer) };
      case 'numeric_unit': return { value: text(value.value), unit: text(value.unit) };
      case 'multi_part': return { parts: Object.fromEntries(descriptor.parts.map((part) => [part.partId, canonicalPayload(part.renderer, asObject(value.parts)[part.partId])])) };
      case 'visual_reserved': return { unsupported_visual_response: true };
      default: return { text: text(value.text) };
    }
  }

  function completion(descriptor, draft) {
    const value = restoreDraft(descriptor, draft);
    switch (descriptor.kind) {
      case 'mcq': return value.selected_option_ids.length ? 'ANSWERED' : 'UNANSWERED';
      case 'math_working': {
        const working = value.working.length > 0, finalAnswer = value.final_answer.length > 0;
        if (working && finalAnswer) return 'ANSWERED';
        if (working || finalAnswer) return 'PARTIAL';
        return 'UNANSWERED';
      }
      case 'numeric_unit': {
        const hasValue = value.value.length > 0, hasUnit = value.unit.length > 0;
        const unitRequired = descriptor.responseContract.unit_required !== false && descriptor.responseContract.unitRequired !== false;
        if (hasValue && (!unitRequired || hasUnit)) return 'ANSWERED';
        if (hasValue || hasUnit) return 'PARTIAL';
        return 'UNANSWERED';
      }
      case 'multi_part': {
        if (!descriptor.parts.length) return 'UNANSWERED';
        const states = descriptor.parts.map((part) => completion(part.renderer, value.parts[part.partId]));
        if (states.every((state) => state === 'ANSWERED')) return 'ANSWERED';
        if (states.some((state) => state !== 'UNANSWERED')) return 'PARTIAL';
        return 'UNANSWERED';
      }
      case 'visual_reserved': return 'UNANSWERED';
      default: return value.text.length > 0 ? 'ANSWERED' : 'UNANSWERED';
    }
  }

  function questionState({ viewed = false, flagged = false, descriptor, draft } = {}) {
    const state = completion(descriptor, draft);
    return Object.freeze({ viewed:Boolean(viewed), flagged:Boolean(flagged), completion:state, label: flagged ? 'FLAGGED' : state === 'UNANSWERED' ? (viewed ? 'VIEWED' : 'UNSEEN') : state });
  }

  function navigationPolicy(packageRow) {
    const architecture = asObject(packageRow?.response_form_architecture);
    const raw = architecture.navigation || architecture.navigation_mode || architecture.navigationMode;
    const sequential = architecture.free_navigation === false || architecture.freeNavigation === false || upper(raw) === 'SEQUENTIAL_LOCKED';
    return Object.freeze({ mode: sequential ? 'linear' : 'nonlinear', freeNavigation: !sequential });
  }

  function allowedTools(packageRow) {
    const policy = asObject(packageRow?.resource_policy);
    const entries = [];
    for (const [key, raw] of Object.entries(policy)) {
      if (raw === true) entries.push({ id:key, label:key.replace(/_/g, ' ') });
      else if (raw && typeof raw === 'object' && raw.allowed === true) entries.push({ id:key, label:text(raw.label || key.replace(/_/g, ' ')) });
    }
    return Object.freeze(entries.map(Object.freeze));
  }

  function isTerminalAttempt(state) { return TERMINAL_ATTEMPT_STATES.has(upper(state)); }

  function assertBrowserSafe(value, path = '$') {
    if (Array.isArray(value)) { value.forEach((entry, index) => assertBrowserSafe(entry, `${path}[${index}]`)); return true; }
    if (!value || typeof value !== 'object') return true;
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_BROWSER_KEYS.has(key)) {
        const error = new Error(`Protected Assessment field cannot enter browser projection: ${path}.${key}`);
        error.code = 'TEACHING_D18_PROTECTED_FIELD_LEAK';
        throw error;
      }
      assertBrowserSafe(entry, `${path}.${key}`);
    }
    return true;
  }

  return Object.freeze({
    TERMINAL_ATTEMPT_STATES,
    rendererKind,
    describeRenderer,
    emptyDraft,
    restoreDraft,
    canonicalPayload,
    completion,
    questionState,
    navigationPolicy,
    allowedTools,
    isTerminalAttempt,
    assertBrowserSafe,
  });
});
