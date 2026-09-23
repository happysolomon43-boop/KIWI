let blueprintPromise = null;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function validateVineBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') {
    throw new Error('KIWI vine blueprint is missing.');
  }
  if (blueprint.version !== 1) {
    throw new Error('Unsupported KIWI vine blueprint version: ' + blueprint.version);
  }
  if (!blueprint.trellis || !Array.isArray(blueprint.trellis.members)) {
    throw new Error('KIWI vine blueprint trellis is invalid.');
  }
  if (!Array.isArray(blueprint.vineSegments) || blueprint.vineSegments.length === 0) {
    throw new Error('KIWI vine blueprint has no vine segments.');
  }
  if (!Array.isArray(blueprint.foliageZones)) {
    throw new Error('KIWI vine blueprint foliage zones are invalid.');
  }
  if (!Array.isArray(blueprint.reproductiveZones)) {
    throw new Error('KIWI vine blueprint reproductive zones are invalid.');
  }
  return blueprint;
}

export async function loadVineBlueprint(fetchImpl = globalThis.fetch) {
  if (blueprintPromise) return blueprintPromise;
  if (typeof fetchImpl !== 'function') {
    throw new Error('KIWI vine blueprint loader requires fetch.');
  }

  blueprintPromise = (async () => {
    const response = await fetchImpl('/tree/vine-blueprint.json', {
      cache: 'force-cache',
      credentials: 'same-origin',
    });
    if (!response || !response.ok) {
      throw new Error(
        'Failed to load KIWI vine blueprint' +
          (response ? ' (' + response.status + ')' : '')
      );
    }
    const blueprint = validateVineBlueprint(await response.json());
    return deepFreeze(blueprint);
  })();

  try {
    return await blueprintPromise;
  } catch (error) {
    blueprintPromise = null;
    throw error;
  }
}

export function resetVineBlueprintCacheForTests() {
  blueprintPromise = null;
}
