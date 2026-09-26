'use strict';

function createOrchestrationPlan(steps = []) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('Teaching orchestration composition requires at least one explicit step.');
  }
  const byId = new Map();
  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new TypeError('Orchestration step must be an object.');
    const id = String(step.id || '').trim();
    if (!id) throw new TypeError('Orchestration step requires id.');
    if (byId.has(id)) throw new TypeError(`Duplicate orchestration step id: ${id}`);
    const dependencies = Array.isArray(step.depends_on) ? step.depends_on.map(String) : [];
    byId.set(id, Object.freeze({
      ...step,
      id,
      depends_on: Object.freeze(dependencies),
      independent_validation_of: step.independent_validation_of == null
        ? null
        : String(step.independent_validation_of),
    }));
  }
  for (const step of byId.values()) {
    for (const dependency of step.depends_on) {
      if (!byId.has(dependency)) throw new TypeError(`${step.id} depends on missing step ${dependency}.`);
      if (dependency === step.id) throw new TypeError(`${step.id} cannot depend on itself.`);
    }
    if (step.independent_validation_of) {
      if (!byId.has(step.independent_validation_of)) {
        throw new TypeError(`${step.id} validates missing step ${step.independent_validation_of}.`);
      }
      if (!step.depends_on.includes(step.independent_validation_of)) {
        throw new TypeError('Independent validation must explicitly depend on the artifact it validates.');
      }
    }
  }

  const remaining = new Map(byId);
  const resolved = new Set();
  const layers = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((step) => step.depends_on.every((dep) => resolved.has(dep)));
    if (!ready.length) throw new TypeError('Orchestration composition contains a dependency cycle.');
    layers.push(Object.freeze(ready));
    for (const step of ready) {
      resolved.add(step.id);
      remaining.delete(step.id);
    }
  }
  return Object.freeze({ steps: Object.freeze([...byId.values()]), layers: Object.freeze(layers) });
}

async function executeOrchestrationPlan(plan, executor) {
  if (!plan?.layers || typeof executor !== 'function') throw new TypeError('Valid plan and executor are required.');
  const results = new Map();
  for (const layer of plan.layers) {
    const completed = await Promise.all(layer.map(async (step) => {
      const dependencies = Object.fromEntries(step.depends_on.map((id) => [id, results.get(id)]));
      return [step.id, await executor(step, Object.freeze(dependencies))];
    }));
    for (const [id, result] of completed) results.set(id, result);
  }
  return Object.freeze(Object.fromEntries(results));
}

module.exports = { createOrchestrationPlan, executeOrchestrationPlan };
