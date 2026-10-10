const DATA_CLEARED_EVENT = "tradetracker:data-cleared";

/** Tells the other sections (the storage meter) that Clear All Data finished. */
export function announceDataCleared(): void {
  window.dispatchEvent(new Event(DATA_CLEARED_EVENT));
}

/** Calls listener each time the data is cleared; returns the unsubscribe. */
export function onDataCleared(listener: () => void): () => void {
  window.addEventListener(DATA_CLEARED_EVENT, listener);
  return () => window.removeEventListener(DATA_CLEARED_EVENT, listener);
}
