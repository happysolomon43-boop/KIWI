'use strict';

const { asUntrustedData, buildSeparatedContextLanes } = require('../security/context-lanes');

function requireReader(readers, name) {
  if (typeof readers?.[name] !== 'function') {
    throw new TypeError(`Teaching context assembly requires readers.${name}().`);
  }
  return readers[name];
}

function normalizeRefs(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  return value.map((ref) => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
      throw new TypeError(`${field} entries must be structured references.`);
    }
    if (!String(ref.ref || '').trim()) throw new TypeError(`${field} entry requires ref.`);
    return Object.freeze({ ...ref, ref: String(ref.ref).trim() });
  });
}

function createCapabilityContextAssembler({
  readers,
  authorizeContextRef,
  protectedContentGuard = null,
} = {}) {
  const readAuthoritative = requireReader(readers, 'authoritative');
  const readPermissions = requireReader(readers, 'permissions');
  const readProvenance = requireReader(readers, 'provenance');
  const readUntrusted = requireReader(readers, 'untrusted');
  if (typeof authorizeContextRef !== 'function') {
    throw new TypeError('Teaching context assembly requires a capability-scoped authorizeContextRef().');
  }

  async function guard(ref, contextKind, accessPurpose, accessContext) {
    if (!ref.protection_class || typeof protectedContentGuard !== 'function') return;
    await protectedContentGuard({
      protectionClass: ref.protection_class,
      contextKind,
      accessPurpose,
      authorization: accessContext,
    });
  }

  async function authorize(capability, lane, ref, contextSpec) {
    const result = await authorizeContextRef({ capability, lane, ref, contextSpec });
    if (result !== true) {
      const error = new Error(`Context reference ${ref.ref} is not authorized for ${capability.id} (${lane}).`);
      error.code = 'TEACHING_D05_CONTEXT_REFERENCE_NOT_AUTHORIZED';
      throw error;
    }
  }

  async function assemble({ capability, contextSpec = {}, accessContext = {} } = {}) {
    if (!capability?.id) throw new TypeError('Teaching context assembly requires a canonical capability.');
    const authoritativeRefs = normalizeRefs(contextSpec.authoritative_refs, 'authoritative_refs');
    const permissionRefs = normalizeRefs(contextSpec.permission_refs, 'permission_refs');
    const provenanceRefs = normalizeRefs(contextSpec.provenance_refs, 'provenance_refs');
    const untrustedRefs = normalizeRefs(contextSpec.untrusted_refs, 'untrusted_refs');
    const contextKind = String(contextSpec.context_kind || 'orchestration').trim();
    const accessPurpose = String(contextSpec.access_purpose || 'capability_execution').trim();

    const authoritativeState = {};
    for (const ref of authoritativeRefs) {
      await authorize(capability, 'trustedAuthoritativeState', ref, contextSpec);
      await guard(ref, contextKind, accessPurpose, accessContext);
      authoritativeState[ref.ref] = await readAuthoritative(ref, capability);
    }

    const permissionConstraints = {};
    for (const ref of permissionRefs) {
      await authorize(capability, 'permissionConstraints', ref, contextSpec);
      permissionConstraints[ref.ref] = await readPermissions(ref, capability);
    }

    const provenanceLinkedAcademicContent = [];
    for (const ref of provenanceRefs) {
      await authorize(capability, 'provenanceLinkedAcademicContent', ref, contextSpec);
      await guard(ref, contextKind, accessPurpose, accessContext);
      provenanceLinkedAcademicContent.push(await readProvenance(ref, capability));
    }

    const untrustedContent = [];
    for (const ref of untrustedRefs) {
      await authorize(capability, 'untrustedContent', ref, contextSpec);
      await guard(ref, contextKind, accessPurpose, accessContext);
      const item = await readUntrusted(ref, capability);
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new TypeError('Untrusted context reader must return {kind,data,provenance}.');
      }
      untrustedContent.push(asUntrustedData({
        kind: item.kind,
        data: item.data,
        provenance: item.provenance || { ref: ref.ref },
      }));
    }

    return buildSeparatedContextLanes({
      trustedAuthoritativeState: authoritativeState,
      permissionConstraints,
      provenanceLinkedAcademicContent,
      untrustedContent,
    });
  }

  return Object.freeze({ assemble });
}

module.exports = { createCapabilityContextAssembler };
