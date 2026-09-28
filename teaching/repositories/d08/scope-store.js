'use strict';

function createScopeStore({ q, withTransaction, randomUUID, clock, json }) {
  async function saveScopeChangeCandidate({ studentId, courseId, expectedCourseStateVersion, previousSnapshotRef, observedSnapshotRef, classification, addedRefs, removedRefs, changedRefs }) {
    return withTransaction(async (tx) => {
      const locked = await q(tx, `select * from public.teaching_courses where student_id=$1 and course_id=$2 for update`, [studentId, courseId]);
      const course = locked.rows?.[0];
      if (!course) {
        const error = new Error('Teaching Course not found.');
        error.status = 404; error.code = 'TEACHING_COURSE_NOT_FOUND'; throw error;
      }
      if (String(course.state_version) !== String(expectedCourseStateVersion)) {
        const error = new Error('Course state changed during scope review.');
        error.status = 409; error.code = 'TEACHING_D08_STALE_COURSE_STATE'; throw error;
      }
      const existing = await q(tx, `
        select * from public.teaching_course_scope_changes
        where student_id=$1 and course_id=$2 and previous_snapshot_ref=$3 and observed_snapshot_ref=$4
        order by detected_at desc limit 1
      `, [studentId, courseId, previousSnapshotRef, observedSnapshotRef]);
      if (existing.rows?.[0]) return existing.rows[0];
      const now = clock();
      const status = classification.changeKind === 'NO_CHANGE' ? 'NO_CHANGE'
        : classification.changeKind === 'MINOR_SUPPLEMENT' ? 'MINOR_SUPPLEMENT' : 'OPEN';
      const { rows } = await q(tx, `
        insert into public.teaching_course_scope_changes(
          scope_change_id,student_id,course_id,previous_snapshot_ref,observed_snapshot_ref,change_kind,status,
          added_source_refs,removed_source_refs,changed_source_refs,requires_plan_version,review_required,detected_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13) returning *
      `, [
        randomUUID(), studentId, courseId, previousSnapshotRef, observedSnapshotRef, classification.changeKind, status,
        json(addedRefs || []), json(removedRefs || []), json(changedRefs || []),
        classification.requiresPlanVersion === true, classification.requiresReview === true, now,
      ]);
      return rows[0];
    });
  }

  async function saveScopeChangeImpact({ studentId, courseId, scopeChangeId, impact }) {
    return withTransaction(async (tx) => {
      const locked = await q(tx, `select * from public.teaching_course_scope_changes where student_id=$1 and course_id=$2 and scope_change_id=$3 for update`, [studentId, courseId, scopeChangeId]);
      const row = locked.rows?.[0];
      if (!row) {
        const error = new Error('Scope-change candidate not found.');
        error.status = 404; error.code = 'TEACHING_D08_SCOPE_CHANGE_NOT_FOUND'; throw error;
      }
      if (!['OPEN','MINOR_SUPPLEMENT'].includes(row.status)) {
        const error = new Error('Scope change is not awaiting impact analysis.');
        error.status = 409; error.code = 'TEACHING_D08_SCOPE_CHANGE_STATE_INVALID'; throw error;
      }
      const now = clock();
      const material = impact.change_kind === 'MATERIAL_SCOPE_CHANGE' || impact.plan_version_recommended === true;
      const status = material ? 'PENDING_PLAN_UPDATE' : 'MINOR_SUPPLEMENT';
      const { rows } = await q(tx, `
        update public.teaching_course_scope_changes
           set change_kind=$4,status=$5,impact_summary=$6::jsonb,requires_plan_version=$7,review_required=$8,analyzed_at=$9
         where student_id=$1 and course_id=$2 and scope_change_id=$3 returning *
      `, [studentId, courseId, scopeChangeId, material ? 'MATERIAL_SCOPE_CHANGE' : 'MINOR_SUPPLEMENT', status, json(impact), material, impact.review_needed === true || material, now]);
      return rows[0];
    });
  }

  async function adoptAuthoritativeScopeChange({ studentId, courseId, scopeChangeId, expectedCourseStateVersion, inventory }) {
    return withTransaction(async (tx) => {
      const lockedCourse = await q(tx, `select * from public.teaching_courses where student_id=$1 and course_id=$2 for update`, [studentId, courseId]);
      const course = lockedCourse.rows?.[0];
      if (!course) {
        const error = new Error('Teaching Course not found.');
        error.status = 404; error.code = 'TEACHING_COURSE_NOT_FOUND'; throw error;
      }
      if (String(course.state_version) !== String(expectedCourseStateVersion)) {
        const error = new Error('Course state changed before scope adoption.');
        error.status = 409; error.code = 'TEACHING_D08_STALE_COURSE_STATE'; throw error;
      }
      const lockedChange = await q(tx, `select * from public.teaching_course_scope_changes where student_id=$1 and course_id=$2 and scope_change_id=$3 for update`, [studentId, courseId, scopeChangeId]);
      const change = lockedChange.rows?.[0];
      if (!change || change.status !== 'PENDING_PLAN_UPDATE' || change.change_kind !== 'MATERIAL_SCOPE_CHANGE') {
        const error = new Error('Scope change is not ready for adoption.');
        error.status = 409; error.code = 'TEACHING_D08_SCOPE_CHANGE_NOT_ADOPTABLE'; throw error;
      }
      const expectedObserved = `subject:${course.subject_id}:${inventory.snapshotDigest}`;
      if (String(change.observed_snapshot_ref) !== expectedObserved) {
        const error = new Error('Observed Subject snapshot no longer matches the reviewed scope change.');
        error.status = 409; error.code = 'TEACHING_D08_SCOPE_CHANGE_STALE'; throw error;
      }
      const now = clock();
      const currentSources = await q(tx, `select * from public.teaching_source_content_items where student_id=$1 and course_id=$2 and superseded_at is null for update`, [studentId, courseId]);
      const oldByRef = new Map((currentSources.rows || []).map((row) => [String(row.source_ref), row]));
      const maxVersion = Math.max(0, ...(currentSources.rows || []).map((row) => Number(row.scope_version_no || 1)));
      const nextVersion = maxVersion + 1;
      const changedOrRemoved = [...new Set([...(change.changed_source_refs || []), ...(change.removed_source_refs || [])].map(String))];
      const addedOrChanged = new Set([...(change.added_source_refs || []), ...(change.changed_source_refs || [])].map(String));
      if (changedOrRemoved.length) {
        await q(tx, `update public.teaching_source_content_items set superseded_at=$3
          where student_id=$1 and course_id=$2 and source_kind='PRIMARY_KIWI_SUBJECT'
            and superseded_at is null and source_ref=any($4::text[])`,
        [studentId, courseId, now, changedOrRemoved]);
      }
      for (const item of (inventory.items || []).filter((candidate) => addedOrChanged.has(String(candidate.sourceRef)))) {
        const predecessor = oldByRef.get(String(item.sourceRef));
        await q(tx, `
          insert into public.teaching_source_content_items(
            source_content_item_id,student_id,course_id,source_kind,source_ref,source_version_ref,locator,content_hash,content_summary,
            academically_meaningful,classification,classification_reason,classifier_rule_version,scope_version_no,
            supersedes_source_content_item_id,discovered_scope_change_id,discovered_at
          ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,null,null,null,null,$10,$11,$12,$13)
        `, [
          randomUUID(), studentId, courseId, item.sourceKind, item.sourceRef, item.sourceVersionRef, json(item.locator), item.contentHash,
          item.content, nextVersion, predecessor?.source_content_item_id || null, scopeChangeId, now,
        ]);
      }
      await q(tx, `update public.teaching_course_plans set plan_state='REVIEW_REQUIRED' where student_id=$1 and course_id=$2 and plan_state='REVIEW_READY'`, [studentId, courseId]);
      const { rows } = await q(tx, `
        update public.teaching_courses
           set subject_snapshot_ref=$3,source_version_ref=$4,state_version=state_version+1,updated_at=$5
         where student_id=$1 and course_id=$2 returning *
      `, [studentId, courseId, expectedObserved, inventory.snapshotDigest, now]);
      await q(tx, `
        update public.teaching_course_scope_changes set status='ADOPTED_PENDING_AUDIT',adopted_at=$4
        where student_id=$1 and course_id=$2 and scope_change_id=$3
      `, [studentId, courseId, scopeChangeId, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,action,entity_type,entity_id,authoritative_owner,state_version_ref,reason,
          before_ref,after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM','COURSE_SCOPE_CHANGE_ADOPTED','COURSE',$4,'Course Plan/Coverage',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      `, [
        randomUUID(), studentId, now, courseId, `course:${courseId}:state:${Number(course.state_version)+1}`,
        'Reviewed authoritative Subject scope change adopted; previous Course Plan remains historical and requires re-audit/replan.',
        json({ subject_snapshot_ref: course.subject_snapshot_ref }), json({ subject_snapshot_ref: expectedObserved }),
        json([`scope-change:${scopeChangeId}`]), json({ scope_version_no: nextVersion }),
      ]);
      return rows[0];
    });
  }

  return Object.freeze({ saveScopeChangeCandidate, saveScopeChangeImpact, adoptAuthoritativeScopeChange });
}

module.exports = { createScopeStore };
