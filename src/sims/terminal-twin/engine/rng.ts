/**
 * Seeded RNG streams (mulberry32). Each stream's whole state is one uint32, so
 * snapshots capture it for free. Every source of engine randomness draws from
 * its own stream (#310), seeded from the scenario seed with its own salt, so a
 * change that alters how often one source draws (a different strategy) never
 * shifts another source's draws. Reactors draw through
 * `EngineContext.random(stream)`; never use Math.random.
 *
 * Streams in `SimState.rng.streams` (created on first draw):
 * - `sts:<id>`: that STS's move-variation factors (`moveVariationPct`).
 * - `shc:<id>`: that SHC's driver-variability factors (`driverVariabilityPct`).
 * - `decisions`: the `random` field of yard-allocation and ASC requests.
 * - `reactor`: any other reactor randomness (none today).
 * Side streams kept in their own state, with the salts below: `latency`
 * (`SimState.decisions.rngState`, injected decision latency) and `landside`
 * (`SimState.landside.rngState`, truck arrivals, transactions, dwell). The bay
 * plan, pre-fill and container-property streams have their own salts in their
 * modules.
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

/** A reactor stream: one per STS, one per SHC, decision requests, and the rest. */
export type RngStream = `sts:${string}` | `shc:${string}` | 'decisions' | 'reactor'

/** Salts of the named streams. `latency` and `landside` were both 0x5bd1e995 before 0.59.0, so their draws correlated. */
const SALTS: Record<string, number> = {
  latency: 0x5bd1e995,
  landside: 0x1b873593,
  decisions: 0x27d4eb2f,
  reactor: 0x165667b1,
}

/** FNV-1a of a stream name, for the per-equipment streams. */
function nameHash(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** The first state of stream `name` for a scenario seed. */
export function streamSeedState(seed: number, name: string): number {
  return seedState((seed ^ (SALTS[name] ?? nameHash(name))) >>> 0)
}

/** The reactor streams of one run: the scenario seed and each stream's current state. */
export interface RngStreams {
  seed: number
  streams: Record<string, number>
}

/** Draw a uniform [0, 1) from `stream`, seeding it on first use. */
export function drawFrom(rng: RngStreams, stream: RngStream): number {
  const [value, next] = nextRandom(rng.streams[stream] ?? streamSeedState(rng.seed, stream))
  rng.streams[stream] = next
  return value
}
