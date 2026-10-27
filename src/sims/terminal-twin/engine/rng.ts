/**
 * The single seeded RNG (mulberry32). Its whole state is one uint32 kept in
 * SimState.rngState, so snapshots capture it for free. All engine randomness
 * MUST go through `EngineContext.random()`; never use Math.random.
 */

export function seedState(seed: number): number {
  return seed >>> 0
}

/** Advance the state and return [value in [0, 1), next state]. */
export function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a >>> 0]
}
