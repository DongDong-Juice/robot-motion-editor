// Horizontal time window shared by the track and graph views (module-level so switching views keeps it).
export const tv = { scrollF: 0, ppf: 4 }
// Sequence view's message flash, registered by SequenceCanvas so key handlers (transport) can show a message at an item's row.
export const seqFlash: { fn: ((text: string, itemId: string) => void) | null } = { fn: null }
// the sequence scrolls a piece into view (its lane, its frames); set while the sequence canvas is mounted
export const seqFocus: { fn: ((itemId: string) => void) | null } = { fn: null }
