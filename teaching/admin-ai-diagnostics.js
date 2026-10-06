'use strict';

const crypto = require('node:crypto');
const { createTeachingPromptControlPlane } = require('./prompt-runtime');
const { composeTeachingModelContent } = require('./prompt-runtime/prompt-composer');
const { listCapabilities, getCapability, assertRegistryIntegrity } = require('./capability-registry');
const { FULL_DISTINCT_CORPUS } = require('./d30/corpus');
const { routePostureFor, centralTaskFor } = require('./d30/route-policy');
const { getActiveTeachingAIBoundary } = require('./ai/runtime-bridge');

const JOB_LIMIT = 12;
const jobs = new Map();
const promptControl = createTeachingPromptControlPlane();

function publicJob(job) {
  if (!job) return null;
  return Object.freeze({
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    structural: job.structural,
    live: Object.freeze({
      totalFamilies: job.live.totalFamilies,
      completedFamilies: job.live.completedFamilies,
      passedFamilies: job.live.passedFamilies,
      failedFamilies: job.live.failedFamilies,
      currentFamily: job.live.currentFamily,
      results: Object.freeze(job.live.results.map((item) => Object.freeze({ ...item }))),
    }),
    error: job.error,
  });
}

function trimJobs() {
  if (jobs.size <= JOB_LIMIT) return;
  const ordered = [...jobs.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const job of ordered.slice(0, Math.max(0, jobs.size - JOB_LIMIT))) jobs.delete(job.jobId);
}

function representativeCases() {
  const modelCapabilities = listCapabilities().filter((item) => item.authority_ceiling !== 'T0' && item.prompt_family_id);
  const families = [...new Set(modelCapabilities.map((item) => item.prompt_family_id))].sort();
  return Object.freeze(families.map((familyId) => {
    const familyCapabilities = modelCapabilities.filter((item) => item.prompt_family_id === familyId);
    let caseSpec = null;
    for (const capability of familyCapabilities) {
      caseSpec = FULL_DISTINCT_CORPUS.find((item) => item.familyId === familyId && item.capabilityId === capability.id && item.caseClass === 'golden')
        || FULL_DISTINCT_CORPUS.find((item) => item.familyId === familyId && item.capabilityId === capability.id);
      if (caseSpec) break;
    }
    if (!caseSpec) throw new Error(`No D30 diagnostic fixture is available for ${familyId}.`);
    return caseSpec;
  }));
}

function structuralSnapshot() {
  const integrity = assertRegistryIntegrity();
  promptControl.assertReady();
  const capabilities = listCapabilities();
  const modelBacked = capabilities.filter((item) => item.authority_ceiling !== 'T0' && item.prompt_family_id);
  const families = new Set(modelBacked.map((item) => item.prompt_family_id));
  for (const capability of modelBacked) {
    const contract = promptControl.getCapabilityContract(capability.id);
    if (contract.promptFamily?.id !== capability.prompt_family_id) {
      throw new Error(`Prompt binding drift for ${capability.id}.`);
    }
    centralTaskFor({ capabilityId: capability.id, familyId: capability.prompt_family_id });
  }
  return Object.freeze({
    passed: true,
    capabilityCount: capabilities.length,
    modelBackedCapabilityCount: modelBacked.length,
    deterministicCapabilityCount: capabilities.length - modelBacked.length,
    promptFamilyCount: families.size,
    registryCounts: integrity,
  });
}

const SUBJECT_FIXTURES = Object.freeze({
  mathematics:{topic:'linear equations',facts:['Solve 2x + 3 = 11.','The valid solution is x = 4.'],evidence:'Substitution of x=4 gives 11.'},
  biology:{topic:'cellular respiration',facts:['Aerobic respiration in eukaryotic cells uses mitochondria.','ATP is an energy-transfer molecule.'],evidence:'Do not claim mitochondria are present in bacteria.'},
  chemistry:{topic:'chemical equations',facts:['2H2 + O2 → 2H2O is balanced.','Atom counts must be conserved.'],evidence:'The unbalanced form does not conserve oxygen atoms.'},
  physics:{topic:'Newtonian mechanics',facts:['F = ma.','For m=2 kg and a=3 m/s², F=6 N.'],evidence:'Units and sign conventions matter.'},
  history:{topic:'historical evidence',facts:['Primary sources can conflict.','A conflict must be represented rather than silently erased.'],evidence:'Source A dates an event one day earlier than Source B.'},
  language:{topic:'language analysis',facts:['Meaning can depend on syntax and context.','Alternative interpretations require textual evidence.'],evidence:'The sentence contains an ambiguous modifier.'},
  computer_science:{topic:'algorithms',facts:['Binary search requires an ordered search space.','Its comparison complexity is O(log n).'],evidence:'Applying binary search to unsorted input is invalid without ordering.'},
  accounting:{topic:'accounting equation',facts:['Assets = Liabilities + Equity.','A balanced transaction preserves the accounting equation.'],evidence:'A one-sided entry is incomplete.'},
  interpretive_open_answer:{topic:'open-answer interpretation',facts:['More than one answer may be valid when evidence supports it.'],evidence:'Do not force a single interpretation from ambiguous evidence.'},
  mixed_learning_unit:{topic:'mixed learning unit',facts:['Each disciplinary claim keeps its own evidence and owner.'],evidence:'Do not collapse one academic owner into another.'},
});

function academicFixture(caseSpec) {
  const base = SUBJECT_FIXTURES[caseSpec.subject] || SUBJECT_FIXTURES.mixed_learning_unit;
  return Object.freeze({
    admin_diagnostic_case_id: caseSpec.id,
    family_focus: caseSpec.focus,
    subject_profile: caseSpec.subject,
    topic: base.topic,
    authoritative_facts: base.facts,
    evidence: base.evidence,
    evidence_state: caseSpec.inputFixture?.evidenceState || 'BOUNDED',
    diagnostic_only: true,
    authoritative_mutation_forbidden: true,
  });
}

function outputSchema(caseSpec) {
  return Object.freeze({
    id: `admin.${caseSpec.familyId.toLowerCase()}.smoke.v1`,
    version: '1',
    uncertainty_states: ['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],
    review_needed_field: 'review_required',
    state_bearing_fields: Object.freeze([]),
    student_facing_field: null,
    declared_fields: Object.freeze([]),
    validate(value) { return { ok: Boolean(value && typeof value === 'object' && !Array.isArray(value)), value }; },
  });
}

function preparation(caseSpec) {
  if (caseSpec.familyId !== 'TPF-20') return null;
  const stage = caseSpec.stage || 'PRECLASS';
  return Object.freeze({
    workspace_ref: `admin-diagnostic:${caseSpec.id}`,
    workspace_version: '1',
    stage: stage === 'PRECLASS' ? 'Active' : 'Finalization Due',
    maturity: stage === 'PRECLASS' ? 'Structured' : 'Candidate',
    previous_artifact: null,
    authoritative_input_bundle: { fixture_ref: caseSpec.id, version: '1' },
    material_delta: { diagnostic: true },
    finding_refs: [],
    review_purpose: caseSpec.focus,
    maturity_target: stage === 'PRECLASS' ? 'Candidate' : 'Pre-Lock Ready',
    protection_class: 'ORDINARY_TEACHING',
    route_posture: routePostureFor({ familyId:'TPF-20', stage }),
    idempotency_key: `admin-diagnostic:${caseSpec.id}`,
    correlation_id: `admin-diagnostic:${caseSpec.id}`,
  });
}

function invocationFor(caseSpec, jobId) {
  const capability = getCapability(caseSpec.capabilityId);
  const contextLanes = {
    trustedAuthoritativeState: { diagnostic_case_id:caseSpec.id, fixture_state_version:'1' },
    permissionConstraints: { evaluation_only:true, authoritative_commit:false },
  };
  const contextAllowlist = capability.authority_ceiling === 'T4' ? {
    trustedAuthoritativeState:['diagnostic_case_id','fixture_state_version'],
    permissionConstraints:['evaluation_only','authoritative_commit'],
    provenanceLinkedAcademicContent:[],
    untrustedContent:[],
  } : null;
  return promptControl.createInvocation({
    capabilityId: capability.id,
    taskMode: 'admin_live_smoke',
    directive: {
      bounded_actions:['Apply the frozen family contract to this bounded diagnostic fixture.'],
      allowed_operations:['Return a provisional structured diagnostic result only.','Represent uncertainty when the fixture does not support certainty.'],
      prohibited_operations:['mutate authoritative academic state','change an authoritative owner','invent evidence','reveal protected assessment content'],
      evidence_purpose:'KIWI Admin Teaching AI live smoke diagnostic',
      downstream_handoff:{type:'diagnostic_only',validator_ids:['schema','authority'],commit_owner_boundary:capability.authoritative_owner_boundary},
    },
    contextLanes,
    contextAllowlist,
    stateReference:{aggregate_type:'admin_teaching_ai_diagnostic',aggregate_id:jobId,state_version:'1'},
    outputSchema:outputSchema(caseSpec),
    capabilityCriticalityOverride:caseSpec.criticality,
    preparation:preparation(caseSpec),
    audit:{correlation_id:`admin:${jobId}:${caseSpec.familyId}`,causation_id:null},
  });
}

async function executeFamily(job, caseSpec) {
  const boundary = getActiveTeachingAIBoundary();
  if (!boundary) throw Object.assign(new Error('Teaching AI runtime boundary is not active.'), { code:'TEACHING_ADMIN_AI_RUNTIME_UNAVAILABLE' });
  const capability = getCapability(caseSpec.capabilityId);
  const invocation = invocationFor(caseSpec, job.jobId);
  const content = composeTeachingModelContent({ invocation, academicInput:academicFixture(caseSpec) });
  const validate = async (value) => ({ ok:Boolean(value && typeof value === 'object' && !Array.isArray(value)), value, reason:'TEACHING_ADMIN_AI_SMOKE_NON_OBJECT' });
  const started = Date.now();
  const result = await boundary.execute({
    taskId: centralTaskFor({capabilityId:capability.id,familyId:caseSpec.familyId}),
    request:{content,generation:{maxOutputTokens:1600,structuredOutput:{mimeType:'application/json'}}},
    responsibilityKey:capability.id,
    capabilityId:capability.id,
    intelligenceClass:capability.execution_class,
    authorityLevel:capability.authority_ceiling,
    authoritativeOwner:capability.authoritative_owner_boundary,
    correlationId:`admin:${job.jobId}`,
    promptFamilyId:caseSpec.familyId,
    promptFamilyVersion:caseSpec.familyVersion,
    constitutionVersion:invocation.constitution.version,
    outputSchemaId:invocation.output_schema.id,
    outputSchemaVersion:invocation.output_schema.version,
    schemaValidator:validate,
    domainValidator:validate,
    validationContext:{adminDiagnostic:true,familyId:caseSpec.familyId},
  });
  return Object.freeze({
    familyId:caseSpec.familyId,
    capabilityId:capability.id,
    caseId:caseSpec.id,
    passed:result.accepted === true,
    latencyMs:Date.now()-started,
    executionId:result.executionId || null,
    provider:result.modelMetadata?.provider || null,
    modelId:result.modelMetadata?.modelId || null,
    routeKey:result.modelMetadata?.routeKey || null,
    rejectionReason:result.rejectionReason || null,
  });
}

async function runJob(job) {
  job.status='RUNNING';
  job.startedAt=new Date().toISOString();
  try {
    job.structural=structuralSnapshot();
    const cases=representativeCases();
    job.live.totalFamilies=cases.length;
    for (const caseSpec of cases) {
      job.live.currentFamily=caseSpec.familyId;
      let item;
      try { item=await executeFamily(job,caseSpec); }
      catch (error) {
        item={familyId:caseSpec.familyId,capabilityId:caseSpec.capabilityId,caseId:caseSpec.id,passed:false,latencyMs:0,executionId:null,provider:null,modelId:null,routeKey:null,rejectionReason:error?.code||error?.message||'UNKNOWN_FAILURE'};
      }
      job.live.results.push(item);
      job.live.completedFamilies+=1;
      if(item.passed) job.live.passedFamilies+=1; else job.live.failedFamilies+=1;
    }
    job.live.currentFamily=null;
    job.status=job.structural?.passed && job.live.failedFamilies===0 ? 'PASSED' : 'FAILED';
  } catch (error) {
    job.status='FAILED';
    job.error={code:error?.code||'TEACHING_ADMIN_AI_DIAGNOSTIC_FAILED',message:error?.message||String(error)};
  } finally {
    job.completedAt=new Date().toISOString();
  }
}

function authorize(req, env=process.env) {
  if (String(req.user?.role || '').toLowerCase() === 'admin') return true;
  const configured=String(env.ADMIN_MASTER_TOKEN || '').trim();
  return Boolean(configured && String(req.headers['x-admin-token'] || '') === configured);
}

function mountTeachingAdminAIDiagnosticRoutes(router,{env=process.env}={}) {
  if(!router) throw new TypeError('Teaching Admin AI diagnostics require an Express router.');
  const requireAdmin=(req,res,next)=>authorize(req,env)?next():res.status(403).json({error:'Admin access required.',code:'TEACHING_ADMIN_ACCESS_REQUIRED'});
  router.get('/admin/ai-diagnostics',requireAdmin,(_req,res)=>{
    const ordered=[...jobs.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    res.json({jobs:ordered.map(publicJob)});
  });
  router.get('/admin/ai-diagnostics/:id',requireAdmin,(req,res)=>{
    const job=jobs.get(String(req.params.id));
    if(!job)return res.status(404).json({error:'Teaching AI diagnostic job not found.',code:'TEACHING_ADMIN_AI_DIAGNOSTIC_NOT_FOUND'});
    return res.json(publicJob(job));
  });
  router.post('/admin/ai-diagnostics',requireAdmin,(_req,res)=>{
    const active=[...jobs.values()].find((item)=>['QUEUED','RUNNING'].includes(item.status));
    if(active)return res.status(202).json(publicJob(active));
    const job={jobId:crypto.randomUUID(),status:'QUEUED',createdAt:new Date().toISOString(),startedAt:null,completedAt:null,structural:null,live:{totalFamilies:20,completedFamilies:0,passedFamilies:0,failedFamilies:0,currentFamily:null,results:[]},error:null};
    jobs.set(job.jobId,job);trimJobs();
    setImmediate(()=>runJob(job));
    return res.status(202).json(publicJob(job));
  });
  return Object.freeze({publicJob,runJob});
}

module.exports={structuralSnapshot,representativeCases,authorize,mountTeachingAdminAIDiagnosticRoutes};
