'use strict';

const TEACHING_ACCESSIBILITY_BASELINE = Object.freeze({
  keyboardOperable: true,
  semanticStructure: true,
  visibleFocus: true,
  statusNotColorOnly: true,
  textScalingSafe: true,
});

const REQUIRED_PRIMITIVE_FIELDS = Object.freeze([
  'keyboardOperable',
  'semanticStructure',
  'visibleFocus',
  'statusNotColorOnly',
  'textScalingSafe',
]);

function assertAccessiblePrimitiveDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('Teaching UI primitive accessibility definition is required.');
  }

  const missing = REQUIRED_PRIMITIVE_FIELDS.filter((field) => definition[field] !== true);
  if (missing.length) {
    const error = new Error(
      `Teaching UI primitive violates the D02 accessibility baseline: ${missing.join(', ')}`
    );
    error.code = 'TEACHING_ACCESSIBILITY_BASELINE_VIOLATION';
    error.missing = Object.freeze(missing);
    throw error;
  }

  return true;
}

module.exports = {
  TEACHING_ACCESSIBILITY_BASELINE,
  REQUIRED_PRIMITIVE_FIELDS,
  assertAccessiblePrimitiveDefinition,
};
