// A tiny event bus so overlays (the tutorial) can see what the player is doing
// in the game UI — phone open, which app, looking around — without threading
// callbacks through every component.
const listeners = new Set();
export function emitUi(type, detail) { listeners.forEach((fn) => fn(type, detail)); }
export function onUi(fn) { listeners.add(fn); return () => listeners.delete(fn); }
