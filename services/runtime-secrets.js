'use strict';

function requireRuntimeSecret(env, primaryName, aliases = []) {
  const names = [primaryName, ...aliases];
  for (const name of names) {
    const value = String(env?.[name] || '').trim();
    if (value) return value;
  }

  throw new Error(
    `Missing required server environment variable: ${names.join(' or ')}`
  );
}

function optionalRuntimeSecret(env, name) {
  const value = String(env?.[name] || '').trim();
  return value || null;
}

module.exports = {
  requireRuntimeSecret,
  optionalRuntimeSecret,
};
