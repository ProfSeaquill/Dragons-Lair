// eventBus.js — tiny pub/sub
const listeners = new Map(); // eventName -> Set(fn)

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => off(evt, fn);
}

export function off(evt, fn) {
  listeners.get(evt)?.delete(fn);
  if (listeners.get(evt)?.size === 0) listeners.delete(evt);
}

export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (err) { console.error(`[eventBus ${evt}]`, err); }
  }
}
