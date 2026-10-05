'use strict';

const { createTeachingAIAdapter, createTeachingOrchestrator, createOrchestratorPreflight, createAuthoritativeOwnerRouter } = require('../orchestrator');
const { buildSeparatedContextLanes, asUntrustedData } = require('../security/context-lanes');
const { centralTaskFor } = require('../d30/route-policy');

function fail(message, code = 'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createD31ReleaseOrchestrator({ runtimePlatform, query, randomUUID } = {}) {
  if (typeof query !== 'function' || typeof randomUUID !== 'function' ||
      !runtimePlatform?.orchestrationStore || !runtimePlatform?.promptControl || !runtimePlatform?.aiBoundary) {
    fail('D31 release requires the durable D05 runtime, prompt control, and an authenticated context reader.', 'TEACHING_D31_ORCHESTRATOR_REQUIRED');
  }

  async function courseFor(actorId, courseId) {
    if (!actorId || !courseId) fail('Authenticated Course context is required.');
    const result = await query('select * from public.teaching_courses where student_id=$1 and course_id=$2', [actorId, courseId]);
    const course = result.rows?.[0];
    if (!course) fail('Course context was not found.', 'TEACHING_COURSE_NOT_FOUND');
    return course;
  }

  async function stateReader(envelope) {
    if (envelope.state_reference?.aggregate_type !== 'teaching_course') fail('Only Course-scoped D31 release requests are supported.');
    const course = await courseFor(envelope.trigger.actor_id, envelope.state_reference.aggregate_id);
    const fields = { lifecycle_state: course.lifecycle_state, subject_snapshot_ref: course.subject_snapshot_ref || null };
    return {
      stateReference: { aggregate_type: 'teaching_course', aggregate_id: course.course_id, state_version: String(course.state_version) },
      preconditions: Object.fromEntries(Object.keys(envelope.preconditions).map((key) => [key, fields[key]])),
    };
  }

  async function contextAssembler({ contextSpec = {}, accessContext = {} } = {}) {
    const { actorId, courseId } = accessContext;
    const course = await courseFor(actorId, courseId);
    const trusted = {};
    const provenance = [];
    const untrusted = [];
    async function read(ref) {
      const value = String(ref?.ref || '');
      const separator = value.indexOf(':');
      const kind = value.slice(0, separator), id = value.slice(separator + 1);
      if (!id) fail('A Course context reference is missing its identity.');
      if (kind === 'course' && id === String(course.course_id)) return { kind, value: course };
      const sources = {
        source: ['public.teaching_source_content_items', 'source_content_item_id'],
        'curriculum-audit': ['public.teaching_curriculum_audits', 'curriculum_audit_id'],
        'diagnostic-plan': ['public.teaching_diagnostic_plans', 'diagnostic_plan_id'],
        vpk: ['public.teaching_validated_prior_knowledge_decisions', 'vpk_decision_id'],
        intake: ['public.teaching_student_course_intakes', 'intake_id'],
      };
      const target = sources[kind];
      if (!target) fail(`Unsupported Course context reference: ${kind}`);
      const result = await query(`select * from ${target[0]} where student_id=$1 and course_id=$2 and ${target[1]}=$3`, [actorId, courseId, id]);
      if (!result.rows?.[0]) fail(`Course context reference is unavailable: ${kind}`);
      return { kind, value: result.rows[0] };
    }
    for (const ref of contextSpec.authoritative_refs || []) {
      const item = await read(ref);
      if (item.kind === 'source' || item.kind === 'intake') fail('Student content cannot enter the authoritative context lane.');
      trusted[ref.ref] = item.value;
    }
    for (const ref of contextSpec.provenance_refs || []) {
      const item = await read(ref);
      if (item.kind === 'source' && ['PRIMARY_STUDY_NOTE', 'STUDENT_SUPPLEMENT'].includes(item.value.source_kind)) fail('Original notes and supplements must remain untrusted data.');
      provenance.push({ ref: ref.ref, data: item.value });
    }
    for (const ref of contextSpec.untrusted_refs || []) {
      const item = await read(ref);
      untrusted.push(asUntrustedData({ kind: item.kind === 'intake' ? 'student_response' : 'uploaded_material', data: item.value, provenance: { ref: ref.ref } }));
    }
    if ((contextSpec.permission_refs || []).length) fail('Permission context requires a dedicated authorized reader.');
    return buildSeparatedContextLanes({ trustedAuthoritativeState: trusted, permissionConstraints: {}, provenanceLinkedAcademicContent: provenance, untrustedContent: untrusted });
  }

  const aiAdapter = createTeachingAIAdapter({
    promptControl: runtimePlatform.promptControl,
    aiBoundary: runtimePlatform.aiBoundary,
    assertRouteExecutable: () => true, // The exact D31 owner mode authorizes execution; D30 qualification truth remains unchanged.
    // Production Teaching execution intentionally shares the exact MAIN_CBT
    // candidate order and provider fallback behaviour. Preparation posture is
    // qualification metadata; applying it here silently narrows MAIN_CBT to a
    // different model family than the working CBT route.
    resolveCentralTaskId: async (route) => centralTaskFor({
      capabilityId: route.capabilityId,
      familyId: route.familyId,
    }),
  });
  const orchestrator = createTeachingOrchestrator({
    promptControl: runtimePlatform.promptControl,
    aiAdapter,
    executionStore: runtimePlatform.orchestrationStore,
    stateReader,
    contextAssembler: { assemble: contextAssembler },
    preflight: createOrchestratorPreflight(),
    ownerRouter: createAuthoritativeOwnerRouter(),
    randomUUID,
  });
  return Object.freeze({
    execute(request) {
      return orchestrator.execute({
        ...request,
        accessContext: { actorId: request?.trigger?.actor_id, courseId: request?.stateReference?.aggregate_id },
      });
    },
  });
}

module.exports = { createD31ReleaseOrchestrator };
