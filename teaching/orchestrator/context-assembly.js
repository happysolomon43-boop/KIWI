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

  async function guard(ref, authorization, contextKind, accessPurpose, accessContext) {
    const protectionClass = String(
      authorization?.protectionClass || authorization?.protection_class || ref.protection_class || ''
    ).trim();
    if (!protectionClass) return;
    if (typeof protectedContentGuard !== 'function') {
      const error = new Error(
        `Protected Teaching context reference ${ref.ref} cannot be loaded without the deterministic protected-content guard.`
      );
      error.code = 'TEACHING_D05_PROTECTED_CONTEXT_GUARD_REQUIRED';
      throw error;
    }
    await protectedContentGuard({
      protectionClass,
      contextKind,
      accessPurpose,
      authorization: accessContext,
    });
  }

  async function authorize(capability, lane, ref, contextSpec) {
    const result = await authorizeContextRef({ capability, lane, ref, contextSpec });
    const allowed = result === true || (result && typeof result === 'object' && result.allowed === true);
    if (!allowed) {
      const error = new Error(`Context reference ${ref.ref} is not authorized for ${capability.id} (${lane}).`);
      error.code = 'TEACHING_D05_CONTEXT_REFERENCE_NOT_AUTHORIZED';
      throw error;
    }
    return result === true ? Object.freeze({ allowed: true }) : Object.freeze({ ...result });
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
      const authorization = await authorize(capability, 'trustedAuthoritativeState', ref, contextSpec);
      await guard(ref, authorization, contextKind, accessPurpose, accessContext);
      authoritativeState[ref.ref] = await readAuthoritative(ref, capability);
    }

    const permissionConstraints = {};
    for (const ref of permissionRefs) {
      await authorize(capability, 'permissionConstraints', ref, contextSpec);
      permissionConstraints[ref.ref] = await readPermissions(ref, capability);
    }

    const provenanceLinkedAcademicContent = [];
    for (const ref of provenanceRefs) {
      const authorization = await authorize(capability, 'provenanceLinkedAcademicContent', ref, contextSpec);
      await guard(ref, authorization, contextKind, accessPurpose, accessContext);
      provenanceLinkedAcademicContent.push(await readProvenance(ref, capability));
    }

    const untrustedContent = [];
    for (const ref of untrustedRefs) {
      const authorization = await authorize(capability, 'untrustedContent', ref, contextSpec);
      await guard(ref, authorization, contextKind, accessPurpose, accessContext);
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
