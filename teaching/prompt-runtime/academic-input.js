'use strict';

const ACADEMIC_INPUT_LIMITS = Object.freeze({ bytes: 65_536, depth: 16, entries: 4096 });
// Full source-census tasks use a separate, bounded server-owned envelope.
// Routing events and ordinary feature inputs keep their smaller default limit.
const SOURCE_CENSUS_INPUT_LIMITS = Object.freeze({ bytes: 1_048_576, depth: 16, entries: 32768 });

function serializeAcademicInput(input, limits = ACADEMIC_INPUT_LIMITS) {
  if (limits !== ACADEMIC_INPUT_LIMITS && limits !== SOURCE_CENSUS_INPUT_LIMITS) {
    throw new TypeError('Academic input limits must use a server-owned policy.');
  }
  const fail = (reason = 'INVALID_JSON_SHAPE') => {
    const messages = {
      BYTE_LIMIT_EXCEEDED: `Teaching academic input exceeds the ${limits.bytes / 1024} KiB limit and must be reduced before model execution.`,
      DEPTH_LIMIT_EXCEEDED: 'Teaching academic input exceeds the 16-level nesting limit.',
      ENTRY_LIMIT_EXCEEDED: `Teaching academic input exceeds the ${limits.entries}-entry limit.`,
      UNSUPPORTED_VALUE: 'Teaching academic input contains a non-JSON value.',
      INVALID_JSON_SHAPE: 'Teaching academic input must contain plain JSON objects and arrays only.',
    };
    const error = new TypeError(messages[reason] || messages.INVALID_JSON_SHAPE);
    error.code = 'TEACHING_ACADEMIC_INPUT_INVALID';
    error.reason = reason;
    throw error;
  };
  const root = input == null ? {} : input;
  if (typeof root !== 'object' || Array.isArray(root)) fail();
  const ancestors = new Set();
  let entries = 0;
  let bytes = 0;
  function add(text) {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > limits.bytes) fail('BYTE_LIMIT_EXCEEDED');
    return text;
  }
  function visit(value, depth) {
    if (depth > limits.depth) fail('DEPTH_LIMIT_EXCEEDED');
    if (value === null || typeof value === 'boolean') return add(JSON.stringify(value));
    if (typeof value === 'string') {
      if (value.length > limits.bytes) fail('BYTE_LIMIT_EXCEEDED');
      return add(JSON.stringify(value));
    }
    if (typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value));
    if (typeof value !== 'object') fail('UNSUPPORTED_VALUE');
    if (ancestors.has(value)) fail('INVALID_JSON_SHAPE');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('INVALID_JSON_SHAPE');
    if (array && value.length > limits.entries) fail('ENTRY_LIMIT_EXCEEDED');
    ancestors.add(value);
    const parts = [];
    add(array ? '[' : '{');
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') fail('INVALID_JSON_SHAPE');
      if (++entries > limits.entries) fail('ENTRY_LIMIT_EXCEEDED');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_JSON_SHAPE');
      if (array && key !== String(parts.length)) fail('INVALID_JSON_SHAPE');
      if (parts.length) add(',');
      if (key.length > limits.bytes) fail('BYTE_LIMIT_EXCEEDED');
      const prefix = array ? '' : add(JSON.stringify(key)) + add(':');
      parts.push(prefix + visit(descriptor.value, depth + 1));
    }
    if (array && parts.length !== value.length) fail('INVALID_JSON_SHAPE');
    ancestors.delete(value);
    add(array ? ']' : '}');
    return (array ? '[' : '{') + parts.join(',') + (array ? ']' : '}');
  }
  return visit(root, 0);
}

module.exports = { serializeAcademicInput, ACADEMIC_INPUT_LIMITS, SOURCE_CENSUS_INPUT_LIMITS };
