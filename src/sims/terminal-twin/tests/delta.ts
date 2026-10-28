import type { Delta } from '../worker/protocol'

/** A Delta with nothing in it. Hand-built Deltas in tests start here, so a new Delta field never breaks them. */
export function emptyDelta(overrides: Partial<Delta> = {}): Delta {
  return { motion: [], custody: [], entities: [], reservations: [], events: [], eventCounts: {}, breakpoint: null, ...overrides }
}
