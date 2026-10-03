'use strict';

const VIEWPORT_COMPOSITIONS = Object.freeze({
  desktop: Object.freeze({ minWidth: 1100, teachingNavigation: 'persistent-local-rail', classroomZones: 3 }),
  tablet: Object.freeze({ minWidth: 700, maxWidth: 1099, teachingNavigation: 'compact-dock', classroomZones: 2 }),
  mobile: Object.freeze({ maxWidth: 699, teachingNavigation: 'five-item-bottom-dock', classroomZones: 1 }),
});

const ASSESSMENT_SEMANTICS = Object.freeze([
  'class-mode', 'question-position', 'marks-available', 'authoritative-timer',
  'response-state', 'save-state', 'navigation-state', 'significant-warning',
]);

const VISUAL_STATE_COVERAGE = Object.freeze([
  'course-plan', 'classroom-independent', 'classroom-break', 'classroom-assessment-takeover',
  'assessment-mixed', 'assessment-constructed', 'calendar', 'work-assignment', 'requests',
  'results-record-gpa', 'remediation-resit-recovery', 'mobile-today', 'mobile-classroom', 'mobile-assessment',
]);

const AUTHORITY_BOUNDARIES = Object.freeze({
  informationArchitecture: 'D23', classroom: 'D14', assessment: 'D17/D18/D19',
  marks: 'D20', progression: 'D21', teacher: 'D22', timer: 'D17_SERVER',
  accommodationApproval: 'EXTERNAL_AUTHORITY_UNRESOLVED_NOT_D24', presentation: 'D24',
});

function publicAccommodationSummary(packageRow = {}) {
  const policy = packageRow.accommodation_policy && typeof packageRow.accommodation_policy === 'object'
    ? packageRow.accommodation_policy
    : {};
  const extra = Math.max(0, Number(policy.extra_time_percent) || 0);
  const adjustments = Array.isArray(policy.presentation_adjustments) ? policy.presentation_adjustments.length : 0;
  const technologies = Array.isArray(policy.assistive_technology) ? policy.assistive_technology.length : 0;
  return Object.freeze({
    timerAdjusted: extra > 0,
    accessSettingsApplied: extra > 0 || Boolean(policy.breaks_allowed) || adjustments > 0 || technologies > 0,
    standardUnchanged: policy.standard_unchanged !== false,
  });
}

module.exports = {
  VIEWPORT_COMPOSITIONS,
  ASSESSMENT_SEMANTICS,
  VISUAL_STATE_COVERAGE,
  AUTHORITY_BOUNDARIES,
  publicAccommodationSummary,
};
