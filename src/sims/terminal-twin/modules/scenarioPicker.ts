/**
 * Pure display model of the setup dialog's scenario picker (TT-R04): stat chips and the layout sketch of a
 * preset, the rows of the engine-test-fixtures table, and the catalogue keys of the preset copy. Everything
 * numeric is derived from the `ScenarioConfig`, never written by hand.
 */
import type { MessageKey } from '../i18n/messages'
import { planOf } from './planModel'
import { PEAK_DAY_PRESET_NAME, SMALL_PRESET_NAME, TTI_PRESET_NAME } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'

export interface ScenarioStats {
  blocks: number
  vessels: number
  sts: number
  shcs: number
  /** Peak of the hourly truck profile (0 without landside). */
  trucksPerHour: number
  /** Pre-fill target (% of cells), null when the yard does not start pre-filled. */
  yardFillPct: number | null
}

export function scenarioStats(config: ScenarioConfig): ScenarioStats {
  const start = config.yardStart
  return {
    blocks: config.yard?.blocks.length ?? 0,
    vessels: config.vessels.length,
    sts: config.sts.length,
    shcs: config.shcs?.length ?? 0,
    trucksPerHour: Math.max(0, ...(config.landside?.hourlyProfile ?? [])),
    yardFillPct: start?.mode === 'prefilled' ? (start.targetPct ?? 60) : null,
  }
}

/** Productive moves per STS per hour assumed by the run-length estimate (a typical gross crane rate). */
const ESTIMATE_MOVES_PER_STS_HOUR = 25
/** Mooring time before a berthed vessel starts working (s). */
const ESTIMATE_MOORING_S = 1800

/**
 * Run length shown on a scenario card (s): the stated end time when the scenario has one, else an estimate of when
 * the last vessel is done (its arrival, mooring, then its moves at the assumed rate over its crane limit).
 */
export function scenarioDurationS(config: ScenarioConfig): number {
  const stated = config.endConditions.simDurationS
  if (stated !== undefined) return stated
  let end = 0
  for (const v of config.vessels) {
    const moves = v.discharge + v.load + v.transshipment
    const workS = (moves / (Math.max(1, v.maxSts) * ESTIMATE_MOVES_PER_STS_HOUR)) * 3600
    end = Math.max(end, v.arrivalS + ESTIMATE_MOORING_S + workS)
  }
  return end
}

export interface ChipSpec {
  id: 'blocks' | 'vessels' | 'sts' | 'shcs' | 'trucks' | 'fill'
  key: MessageKey
  value: number
}

/** Chips of a hero card, in display order; chips that do not apply (no yard fill, no trucks) are left out. */
export function statChips(stats: ScenarioStats): ChipSpec[] {
  const chips: ChipSpec[] = [
    { id: 'blocks', key: 'setup.chip.blocks', value: stats.blocks },
    { id: 'vessels', key: 'setup.chip.vessels', value: stats.vessels },
    { id: 'sts', key: 'setup.chip.sts', value: stats.sts },
    { id: 'shcs', key: 'setup.chip.shcs', value: stats.shcs },
    { id: 'trucks', key: 'setup.chip.trucks', value: stats.trucksPerHour },
  ]
  if (stats.yardFillPct !== null) chips.push({ id: 'fill', key: 'setup.chip.fill', value: stats.yardFillPct })
  return chips.filter((c) => c.value > 0)
}

export interface FixtureRow {
  name: string
  sts: number
  vessels: number
  blocks: number
  shcs: number
  landside: boolean
}

export function fixtureRow(name: string, config: ScenarioConfig): FixtureRow {
  const s = scenarioStats(config)
  return { name, sts: s.sts, vessels: s.vessels, blocks: s.blocks, shcs: s.shcs, landside: config.landside !== undefined }
}

/** Catalogue keys of a preset's tagline and plain-language description; null for a preset without copy. */
export function presetCopy(name: string): { tagline: MessageKey; description: MessageKey } | null {
  if (name === TTI_PRESET_NAME) return { tagline: 'preset.baseline.tagline', description: 'preset.baseline.description' }
  if (name === PEAK_DAY_PRESET_NAME) return { tagline: 'preset.peakDay.tagline', description: 'preset.peakDay.description' }
  if (name === SMALL_PRESET_NAME) return { tagline: 'preset.small.tagline', description: 'preset.small.description' }
  return null
}

export interface SketchRect {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutSketch {
  viewBox: string
  sea: SketchRect
  quay: { x1: number; x2: number }
  sts: number[]
  blocks: SketchRect[]
  gate: SketchRect | null
}

const rect = (r: { x0: number; x1: number; z0: number; z1: number }): SketchRect => ({ x: r.x0, y: r.z0, w: r.x1 - r.x0, h: r.z1 - r.z0 })

/** Top-down sketch geometry (1 unit = 1 m; X along the quay, Y landside) taken from the scenario's own plan. */
export function layoutSketch(config: ScenarioConfig): LayoutSketch | null {
  try {
    const plan = planOf(config)
    const b = plan.bounds
    const pad = 20
    return {
      viewBox: `${b.x0 - pad} ${b.z0 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.z1 - b.z0 + 2 * pad}`,
      sea: rect({ x0: b.x0 - pad, x1: b.x1 + pad, z0: plan.quay.z0, z1: 0 }),
      quay: { x1: plan.quay.x0, x2: plan.quay.x1 },
      sts: plan.sts.map((s) => s.x),
      blocks: plan.blocks.map((blk) => rect(blk.stacks)),
      gate: plan.gate ? rect(plan.gate.lanes) : null,
    }
  } catch {
    return null
  }
}
