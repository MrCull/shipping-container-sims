/**
 * "Generate N vessels": fills the vessel table from a start time, an
 * interval, a size-class mix and seeded jitter. Pure and deterministic for a
 * seed (it uses its own RNG, independent of the scenario seed).
 */
import { nextRandom } from '../engine/rng'
import { pickWeighted } from './bayPlan'
import { DEFAULT_MAX_STS } from './builder'
import { DEFAULT_LINE_WEIGHTS } from './lines'
import { vesselName } from './vesselNames'
import type { VesselConfig, VesselSizeClass, Weights } from './types'

export interface VesselGeneratorOptions {
  count: number
  /** First arrival (s from scenario start). */
  startS: number
  /** Nominal time between arrivals (s). */
  intervalS: number
  /** Size-class mix (weights). */
  sizeMix: Weights<VesselSizeClass>
  /** Each arrival moves by a uniform random ± jitterS (never before 0). */
  jitterS: number
  seed: number
  /** Multiplies the default moves per call (default 1). */
  movesScale?: number
  /** Share of the loaded boxes that are transshipment (0–1, default 0.3). */
  transshipmentShare?: number
  /** Vessel id prefix (default "V"). */
  idPrefix?: string
}

/** [A] Typical boxes discharged and loaded per call, by size class. */
export const DEFAULT_CALL_MOVES: Record<VesselSizeClass, { discharge: number; load: number }> = {
  feeder: { discharge: 150, load: 150 },
  feedermax: { discharge: 300, load: 250 },
  panamax: { discharge: 600, load: 500 },
  'neo-panamax': { discharge: 1200, load: 1000 },
  ulcv: { discharge: 1800, load: 1600 },
}

export function generateVessels(opts: VesselGeneratorOptions): VesselConfig[] {
  let state = (opts.seed ^ 0x2545f491) >>> 0
  const rng = () => {
    const [value, next] = nextRandom(state)
    state = next
    return value
  }
  const scale = opts.movesScale ?? 1
  const tsShare = opts.transshipmentShare ?? 0.3
  const prefix = opts.idPrefix ?? 'V'
  const drafts = Array.from({ length: opts.count }, (_, i) => {
    const sizeClass = pickWeighted(opts.sizeMix, rng)
    const arrivalS = Math.max(0, Math.round(opts.startS + i * opts.intervalS + (rng() * 2 - 1) * opts.jitterS))
    const moves = DEFAULT_CALL_MOVES[sizeClass]
    const loaded = Math.round(moves.load * scale * (0.8 + rng() * 0.4))
    const line = pickWeighted(DEFAULT_LINE_WEIGHTS, rng)
    return {
      sizeClass,
      arrivalS,
      line,
      name: vesselName(line, rng),
      discharge: Math.round(moves.discharge * scale * (0.8 + rng() * 0.4)),
      transshipment: Math.round(loaded * tsShare),
      load: loaded - Math.round(loaded * tsShare),
      order: i,
    }
  })
  drafts.sort((a, b) => a.arrivalS - b.arrivalS || a.order - b.order)
  return drafts.map((d, i) => ({
    id: `${prefix}${String(i + 1).padStart(3, '0')}`,
    name: d.name,
    line: d.line,
    arrivalS: d.arrivalS,
    sizeClass: d.sizeClass,
    discharge: d.discharge,
    load: d.load,
    transshipment: d.transshipment,
    maxSts: DEFAULT_MAX_STS[d.sizeClass],
  }))
}
