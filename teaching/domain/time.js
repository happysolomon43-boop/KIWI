'use strict';

const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function assertAcademicTimestamp(value, field = 'timestamp') {
  if (typeof value !== 'string' || !OFFSET_TIMESTAMP.test(value)) {
    throw new TypeError(`${field} must be an ISO-8601 timestamp with Z or an explicit UTC offset.`);
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`${field} is not a valid timestamp.`);
  }

  return value;
}

function academicTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Cannot create an academic timestamp from an invalid date.');
  }
  return date.toISOString();
}

function compareAcademicTime(left, right) {
  assertAcademicTimestamp(left, 'left timestamp');
  assertAcademicTimestamp(right, 'right timestamp');
  return Date.parse(left) - Date.parse(right);
}

function addAcademicDuration(timestamp, milliseconds) {
  assertAcademicTimestamp(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('Academic duration must be a finite number of milliseconds.');
  }
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

module.exports = {
  assertAcademicTimestamp,
  academicTimestamp,
  compareAcademicTime,
  addAcademicDuration,
};
