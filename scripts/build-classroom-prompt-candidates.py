"""Build inactive candidates reproducibly from complete, unchanged approved inputs."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent.parent
sources=root/'docs/teaching/classroom-remodel/sources'
out=root/'teaching/classroom-remodel/prompts'
common='''

## Remodeling runtime reconciliation (binding candidate amendment)

Ordinary classroom question design, interpretation and immediate strategy use the registered Teaching Coordinator modes through their owning services. Substantial lesson replanning remains Lesson Planner responsibility. Official grades, knowledge state, attendance, eligibility, progression, formal work and publication remain authorized domain decisions.

Use authoritative runtime policy and confirmed effects for deadlines, pacing, queues, counts, follow-up and overtime. Missing values are unknown. A generated proposal is not an executed action. Do not promise a system effect before its required confirmation.

Keep prepared assistance, released/accessibly available content, render confirmation and demonstrated evidence separate. Missing receipt is not proof of no exposure. Do not upgrade independence because a previously exposed resource was later hidden.

Ordinary classroom findings can inform Presenter feedback after the engine validates and confirms acceptance for the exact task, criteria, source, assistance and state. This is not independent academic verification. Formal or explicitly external validation remains with its owner.

Use only the registered compatible mode-specific schema. Preserve all required authority, evidence, private/public and confirmation distinctions. If the schema cannot represent required work, return its contract-error form rather than silently dropping fields.
'''
failed='Do not repeat a materially ineffective strategy without addressing its identified cause. A paraphrase alone is not a substantive strategy change. Repetition is permitted for a specific clarification, requested recap or recovery of undelivered content; record its purpose and preserve the resumption point.'
def replace_once(body,old,new):
    if body.count(old)!=1:raise RuntimeError('Source amendment target drift: '+old[:70])
    return body.replace(old,new)
manifest={'version':'classroom-prompt-candidates.v1','activation':'INACTIVE','governanceState':'PROMPT_CANDIDATE_DRAFT','workingCoordinatorAlias':'TPF-5/8','canonicalCoordinatorFamilyProposal':'TPF-21','canonicalRegistration':'CANDIDATE_REGISTERED_NOT_FROZEN','baseRegistryVersion':'1.3','baseManifestVersion':'1.4','retainedFamilies':['TPF-04','TPF-06','TPF-07','TPF-20'],'families':[]}
for family,source in [('TPF-05','TPF_05_v2-1.md'),('TPF-21','TPF_5_8_v2-1.md'),('TPF-08','TPF-08-1.md')]:
    raw=(sources/source).read_bytes();body=raw.decode().replace('\r\n','\n')
    if family=='TPF-05':
        body=replace_once(body,'Any approximately 15-minute normal ceiling, where policy adopts one, is a reference and not permission to extend a class.','Only an explicit adopted runtime policy and Controller authorization can supply an exception; no numerical overtime entitlement is established here.')
        body=replace_once(body,'If an explanation or representation has already failed materially, require a genuinely different strategy; rewording is not one.',failed)
        body=replace_once(body,'Never compress remaining units into a summary.','Never compress remaining units into a summary. For a partial chapter, return completed units intact, the continued candidate/version, preserved reference map and content hashes, last completed unit, remaining required units, content to preserve and next authoring task. Continue without restarting, renumbering unchanged anchors or rewriting preserved content. Record an explicit map for any authorized replacement, split or merge.')
        version='2.0'
    elif family=='TPF-21':
        body=replace_once(body,'Group related material into coherent teaching units and prepare passage-level explanation guidance.',"Preserve the chapter author's teaching-unit identities, structure and source anchors. Create presentation subgroups within those units and prepare passage-level explanation guidance. Propose a structural change only through an authorized revision with an explicit reference map.")
        body=replace_once(body,'Prefix every locally proposed identifier with `local_` so it cannot be mistaken for an authoritative reference.','Preserve every supplied reference exactly, including document-local chapter anchors. Prefix only new coordinator-proposed identifiers with `local_` so they cannot be mistaken for authoritative references. Runtime assignment of authoritative identifiers is separate.')
        body=replace_once(body,'NEVER repeat an unsuccessful action without addressing the reported cause.',failed)
        body+= '\n\nThe runtime supplies the canonical family identity. TPF-5/8 is a design alias; this candidate proposes TPF-21 and does not itself register or authorize a runtime family.\n'
        version='1.0'
    else:
        body=replace_once(body,'No digressions, repeated examples, or longer versions of an explanation that already failed.','No digressions or needless repeated examples. '+failed)
        body=replace_once(body,'Never repeat a failed approach in new wording.',failed)
        body=replace_once(body,'- [ ] No unapproved repeat of a failed strategy.','- [ ] Repetition purpose is recorded; a materially ineffective strategy is not repeated without addressing its cause.')
        version='2.0'
    body+=common
    if family=='TPF-05':
        body+='\nFor pre_class_lesson_blueprint the compatible runtime may request artifacts.controller_blueprint using the retained D11 Blueprint contract. This is an internal provisional artifact, not a second academic owner. It must agree with the chapter and teaching plan on objectives, priorities, counted phase minutes and reserve. D11 alone validates and accepts it.\n'
    if family=='TPF-21':
        body+='\nFor a migrated legacy consumer, return the same nine top-level coordinator fields and artifacts.legacy_consumer containing only payload in the original consumer schema. The server creates the capability/schema/owner/hash/acceptance envelope after validating the original payload. Preserve its missing/partial/blocked semantics. Do not add a second incompatible strategy decision; the retained owner accepts the original result.\n'

    filename=f'{family}_Classroom_v{version}_REVISED_CANDIDATE.md'
    data=body.encode();(out/filename).write_bytes(data)
    manifest['families'].append({'familyId':family,'version':version,'file':filename,'sha256':hashlib.sha256(data).hexdigest(),'sourceFile':source,'sourceSha256':hashlib.sha256(raw).hexdigest(),'status':'qualification_pending','runtimeEffective':False})
(out/'candidate-manifest.v1.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Three inactive reconciled prompt candidates built; immutable source hashes pinned.')
