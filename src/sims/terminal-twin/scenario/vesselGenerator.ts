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
import type { FlowMix, VesselConfig, VesselSizeClass, Weights } from './types'

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
  /** Share of the loaded boxes that are transshipment (0–1, default 0.3). Ignored when `flowMix` is given. */
  transshipmentShare?: number
  /**
   * Flow mix (TT-11): shares of each vessel's box moves (discharge + load) that are imports, exports and
   * transshipment (percent; normalised). Transshipment moves split between discharge and load in proportion to
   * the call's discharge and load sizes. The TTI preset default is ~85% transshipment (`TTI_FLOW_MIX`).
   */
  flowMix?: FlowMix
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

/** [A] TTI Algeciras is a transshipment hub: ~85% of its moves are transshipment. */
export const TTI_FLOW_MIX: FlowMix = { import: 8, export: 7, transshipment: 85 }

/** A vessel's flow mix as percentages of its box moves (all zero for a vessel without moves). */
export function flowMixOf(v: Pick<VesselConfig, 'discharge' | 'load' | 'transshipment' | 'dischargeTransshipment'>): FlowMix {
  const tsIn = Math.min(v.discharge, v.dischargeTransshipment ?? 0)
  const imports = v.discharge - tsIn
  const total = v.discharge + v.load + v.transshipment
  if (total === 0) return { import: 0, export: 0, transshipment: 0 }
  const pct = (n: number) => (100 * n) / total
  return { import: pct(imports), export: pct(v.load), transshipment: pct(tsIn + v.transshipment) }
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
    const name = vesselName(line, rng)
    const dischargeBoxes = Math.round(moves.discharge * scale * (0.8 + rng() * 0.4))
    let discharge = dischargeBoxes
    let load = loaded - Math.round(loaded * tsShare)
    let transshipment = Math.round(loaded * tsShare)
    let dischargeTransshipment = 0
    if (opts.flowMix) {
      const { import: i, export: x, transshipment: t } = opts.flowMix
      const sum = i + x + t
      if (sum <= 0) throw new Error('The flow mix needs at least one positive share')
      const total = dischargeBoxes + loaded
      const imports = Math.round((total * i) / sum)
      const ts = Math.round((total * t) / sum)
      const exports = total - imports - ts
      dischargeTransshipment = Math.round((ts * dischargeBoxes) / total)
      discharge = imports + dischargeTransshipment
      load = exports
      transshipment = ts - dischargeTransshipment
    }
    return {
      sizeClass,
      arrivalS,
      line,
      name,
      discharge,
      transshipment,
      load,
      dischargeTransshipment,
      order: i,
    }
  })
  drafts.sort((a, b) => a.arrivalS - b.arrivalS || a.order - b.order)
  return drafts.map((d, i) => ({
    ...(d.dischargeTransshipment > 0 ? { dischargeTransshipment: d.dischargeTransshipment } : {}),
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
