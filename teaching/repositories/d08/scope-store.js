'use strict';

function createScopeStore({ q, withTransaction, randomUUID, clock, json }) {
  async function recordScopeChange({ studentId, course, candidateInventory, classification, studentSummary }) {
    return withTransaction(async (tx) => {
      const locked = await q(tx, `select * from public.teaching_courses where student_id=$1 and course_id=$2 for update`, [studentId, course.course_id]);
      if (!locked.rows?.[0]) {
        const error = new Error('Teaching Course not found.');
        error.status = 404;
        error.code = 'TEACHING_COURSE_NOT_FOUND';
        throw error;
      }
      const existing = await q(tx, `select * from public.teaching_course_scope_changes where student_id=$1 and course_id=$2 and candidate_inventory_digest=$3 order by detected_at desc limit 1`, [studentId, course.course_id, candidateInventory.snapshotDigest]);
      if (existing.rows?.[0]) return existing.rows[0];

      const now = clock();
      const scopeChangeId = randomUUID();
      const latestPlan = await q(tx, `select course_plan_id from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1`, [studentId, course.course_id]);
      const { rows } = await q(tx, `
        insert into public.teaching_course_scope_changes(
          scope_change_id,student_id,course_id,prior_course_plan_id,observed_subject_snapshot_ref,candidate_snapshot_ref,
          candidate_inventory_digest,change_classification,requires_plan_version,added_source_refs,changed_source_refs,removed_source_refs,
          diff_summary,student_summary,detected_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15) returning *
      `, [
        scopeChangeId, studentId, course.course_id, latestPlan.rows?.[0]?.course_plan_id || null, course.subject_snapshot_ref,
        `subject:${course.subject_id}:inventory:${candidateInventory.snapshotDigest}`, candidateInventory.snapshotDigest,
        classification.classification, classification.requiresPlanVersion,
        json(classification.added.map((item) => item.source_ref)),
        json(classification.changed.map((item) => item.after.source_ref)),
        json(classification.removed.map((item) => item.source_ref)),
        json({ added: classification.added.length, changed: classification.changed.length, removed: classification.removed.length, policy_version: classification.policyVersion }),
        studentSummary, now,
      ]);

      for (const removed of classification.removed) {
        if (!removed.source_content_item_id) continue;
        await q(tx, `update public.teaching_source_content_items set superseded_at=$3 where student_id=$1 and source_content_item_id=$2 and superseded_at is null`, [studentId, removed.source_content_item_id, now]);
      }
      const changedByKey = new Map(classification.changed.map((entry) => [`${entry.after.source_kind}|${entry.after.source_ref}`, entry.before]));
      const addedKeys = new Set(classification.added.map((item) => `${item.source_kind}|${item.source_ref}`));
      for (const item of candidateInventory.items) {
        const key = `${item.sourceKind}|${item.sourceRef}`;
        const prior = changedByKey.get(key) || null;
        if (!prior && !addedKeys.has(key)) continue;
        if (prior?.source_content_item_id) {
          await q(tx, `update public.teaching_source_content_items set superseded_at=$3 where student_id=$1 and source_content_item_id=$2 and superseded_at is null`, [studentId, prior.source_content_item_id, now]);
        }
        const nextVersion = prior ? Number(prior.scope_version_no || 1) + 1 : 1;
        const newId = randomUUID();
        const insertedSource = await q(tx, `
          insert into public.teaching_source_content_items(
            source_content_item_id,student_id,course_id,source_kind,source_ref,source_version_ref,locator,content_hash,content_summary,
            academically_meaningful,classification,classification_reason,classifier_rule_version,discovered_at,
            scope_version_no,supersedes_source_content_item_id,superseded_at,discovered_scope_change_id
          ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,null,null,null,null,$10,$11,$12,null,$13)
          on conflict(course_id,source_kind,source_ref,content_hash) do update set
            superseded_at=null,
            discovered_scope_change_id=excluded.discovered_scope_change_id,
            source_version_ref=excluded.source_version_ref
          returning source_content_item_id
        `, [newId, studentId, course.course_id, item.sourceKind, item.sourceRef, item.sourceVersionRef, json(item.locator), item.contentHash, item.content, now, nextVersion, prior?.source_content_item_id || null, scopeChangeId]);
        if (!insertedSource.rows?.[0]?.source_content_item_id) throw new Error('Failed to persist versioned source-content scope change.');
      }

      await q(tx, `update public.teaching_courses set state_version=state_version+1,updated_at=$3 where student_id=$1 and course_id=$2`, [studentId, course.course_id, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,action,entity_type,entity_id,authoritative_owner,state_version_ref,reason,after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM','COURSE_SCOPE_CHANGE_DETECTED','COURSE_SCOPE_CHANGE',$4,'Course Plan/Coverage',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
      `, [randomUUID(), studentId, now, scopeChangeId, `course:${course.course_id}`, classification.classification, json({ candidate_inventory_digest: candidateInventory.snapshotDigest, requires_plan_version: classification.requiresPlanVersion }), json([course.subject_snapshot_ref].filter(Boolean)), json({ policy_version: classification.policyVersion })]);
      return rows[0];
    });
  }
  return Object.freeze({ recordScopeChange });
}

module.exports = { createScopeStore };
