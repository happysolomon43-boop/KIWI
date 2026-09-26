'use strict';

const ACADEMIC_INPUT_LIMITS = Object.freeze({ bytes: 65_536, depth: 16, entries: 4096 });

function serializeAcademicInput(input) {
  const fail = () => {
    const error = new TypeError('Teaching academic input must be plain JSON within the 64 KiB, 16-level and 4096-entry limits.');
    error.code = 'TEACHING_ACADEMIC_INPUT_INVALID';
    throw error;
  };
  const root = input == null ? {} : input;
  if (typeof root !== 'object' || Array.isArray(root)) fail();
  const ancestors = new Set();
  let entries = 0;
  let bytes = 0;
  function add(text) {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > ACADEMIC_INPUT_LIMITS.bytes) fail();
    return text;
  }
  function visit(value, depth) {
    if (depth > ACADEMIC_INPUT_LIMITS.depth) fail();
    if (value === null || typeof value === 'boolean') return add(JSON.stringify(value));
    if (typeof value === 'string') {
      if (value.length > ACADEMIC_INPUT_LIMITS.bytes) fail();
      return add(JSON.stringify(value));
    }
    if (typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value));
    if (typeof value !== 'object' || ancestors.has(value)) fail();
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail();
    if (array && value.length > ACADEMIC_INPUT_LIMITS.entries) fail();
    ancestors.add(value);
    const parts = [];
    add(array ? '[' : '{');
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ++entries > ACADEMIC_INPUT_LIMITS.entries) fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
      if (array && key !== String(parts.length)) fail();
      if (parts.length) add(',');
      if (key.length > ACADEMIC_INPUT_LIMITS.bytes) fail();
      const prefix = array ? '' : add(JSON.stringify(key)) + add(':');
      parts.push(prefix + visit(descriptor.value, depth + 1));
    }
    if (array && parts.length !== value.length) fail();
    ancestors.delete(value);
    add(array ? ']' : '}');
    return (array ? '[' : '{') + parts.join(',') + (array ? ']' : '}');
  }
  return visit(root, 0);
}

module.exports = { serializeAcademicInput, ACADEMIC_INPUT_LIMITS };
