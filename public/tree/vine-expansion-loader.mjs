let contractPromise = null;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function validateExpansionContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('KIWI vine expansion contract is missing.');
  }
  if (contract.version !== 2) {
    throw new Error('Unsupported KIWI vine expansion contract version: ' + contract.version);
  }
  if (!contract.routeExpansionMap || !contract.routePolicy) {
    throw new Error('KIWI vine expansion contract is incomplete.');
  }
  return contract;
}

export async function loadExpansionContract(fetchImpl = globalThis.fetch) {
  if (contractPromise) return contractPromise;
  if (typeof fetchImpl !== 'function') {
    throw new Error('KIWI vine expansion loader requires fetch.');
  }

  contractPromise = (async () => {
    const response = await fetchImpl('/tree/vine-expansion-map.json', {
      cache: 'force-cache',
      credentials: 'same-origin',
    });
    if (!response || !response.ok) {
      throw new Error(
        'Failed to load KIWI vine expansion contract' +
          (response ? ' (' + response.status + ')' : '')
      );
    }
    return deepFreeze(validateExpansionContract(await response.json()));
  })();

  try {
    return await contractPromise;
  } catch (error) {
    contractPromise = null;
    throw error;
  }
}

export function resetExpansionContractCacheForTests() {
  contractPromise = null;
}
