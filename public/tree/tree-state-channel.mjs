import { deriveTreeReactions } from './tree-reaction-plan.mjs';

let currentState = null;
const subscribers = new Set();

function cloneState(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    ...state,
    vineStructure: state.vineStructure ? { ...state.vineStructure } : state.vineStructure,
    vineHealth: state.vineHealth ? { ...state.vineHealth } : state.vineHealth,
    milestones: Array.isArray(state.milestones) ? [...state.milestones] : [],
  };
}

export function getCurrentTreeState() {
  return currentState;
}

export function publishTreeState(nextState, options = {}) {
  if (!nextState || typeof nextState !== 'object') return null;
  const previous = currentState;
  const next = cloneState(nextState);
  const reactions =
    options.silent === true ? [] : deriveTreeReactions(previous, next);
  currentState = next;

  const event = Object.freeze({
    previous,
    state: next,
    reactions: Object.freeze(reactions),
    source: String(options.source || 'unknown'),
    at: Date.now(),
  });

  for (const subscriber of [...subscribers]) {
    try { subscriber(event); } catch (error) {
      console.warn('[KIWI] Tree-state subscriber failed:', error);
    }
  }

  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent('kiwi:tree-state', { detail: event }));
  }

  return event;
}

export function subscribeTreeState(subscriber, options = {}) {
  if (typeof subscriber !== 'function') return () => {};
  subscribers.add(subscriber);

  if (options.emitCurrent === true && currentState) {
    subscriber({
      previous: null,
      state: currentState,
      reactions: Object.freeze([]),
      source: 'current',
      at: Date.now(),
    });
  }

  return () => subscribers.delete(subscriber);
}

export function resetTreeStateChannel() {
  currentState = null;
  subscribers.clear();
}
