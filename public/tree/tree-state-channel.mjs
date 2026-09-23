import { deriveTreeReactions } from './tree-reaction-plan.mjs';

let currentState = null;
let lastReactionEvent = null;
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

  if (reactions.length > 0) {
    lastReactionEvent = event;
  }

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
    const now = Date.now();
    const recent =
      options.emitRecentReactions === true &&
      lastReactionEvent &&
      now - lastReactionEvent.at <=
        Math.max(0, Number(options.reactionTtlMs) || 60000) &&
      Number(lastReactionEvent.state?.growthPoints) ===
        Number(currentState.growthPoints) &&
      Number(lastReactionEvent.state?.fruits) ===
        Number(currentState.fruits) &&
      Number(lastReactionEvent.state?.vitality ?? lastReactionEvent.state?.health) ===
        Number(currentState.vitality ?? currentState.health)
        ? lastReactionEvent.reactions
        : Object.freeze([]);

    subscriber({
      previous: null,
      state: currentState,
      reactions: recent,
      source: recent.length ? 'recent-reaction' : 'current',
      at: now,
    });

    if (
      recent.length &&
      options.consumeRecentReactions === true
    ) {
      lastReactionEvent = null;
    }
  }

  return () => subscribers.delete(subscriber);
}

export function getRecentTreeReactionEvent(maxAgeMs = 60000) {
  if (!lastReactionEvent) return null;
  return Date.now() - lastReactionEvent.at <= Math.max(0, Number(maxAgeMs) || 0)
    ? lastReactionEvent
    : null;
}

export function resetTreeStateChannel() {
  currentState = null;
  lastReactionEvent = null;
  subscribers.clear();
}
