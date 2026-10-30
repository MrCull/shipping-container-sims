/**
 * Whole-scenario validation (TT-15): the checks the setup dialog shows live and
 * `createSimulation` enforces. Errors make a configuration impossible (it cannot
 * start); warnings flag a doubtful one (it can). Findings are catalogue keys plus
 * parameters, rendered with `t()`.
 */
import type { MessageKey, MessageParams } from '../i18n/messages'
import { t } from '../i18n/messages'
import { BLOCK_ROWS } from '../engine/yardLayout'
import { BLOCK_FRONTAGE_M, SCALE_LIMITS, STRESS_SCALE } from './limits'
import { validateOverrides, type CheckMessage, type OverrideCheck } from './overrides'
import type { ScenarioConfig, SubsystemModes } from './types'

export type ScenarioCheck = OverrideCheck

/** Peak of the hourly truck profile (trucks per hour); 0 without a landside. */
export function peakTrucksPerHour(config: ScenarioConfig): number {
  return Math.max(0, ...(config.landside?.hourlyProfile ?? []))
}

/**
 * Impossible subsystem-mode combinations (V11-10): an instant mode that needs equipment the scenario lacks (real is the default and falls back to off), and a running
 * ASC or landside behind a yard that is off. `overrides` (CLI, options) win over `config.subsystems`.
 */
export function validateSubsystemModes(config: ScenarioConfig, overrides: SubsystemModes = {}): CheckMessage[] {
  const modes = { ...config.subsystems, ...overrides }
  const out: CheckMessage[] = []
  if (modes.quay === 'instant' && config.sts.length === 0) out.push({ key: 'setup.check.modeNoSts' })
  if (modes.yard === 'instant' && (config.yard?.blocks.length ?? 0) === 0) out.push({ key: 'setup.check.modeNoBlocks' })
  if (modes.yard === 'off') {
    if (modes.asc !== undefined && modes.asc !== 'off') out.push({ key: 'setup.check.modeYardOff', params: { other: 'ASC' } })
    if (modes.landside !== undefined && modes.landside !== 'off') out.push({ key: 'setup.check.modeYardOff', params: { other: 'landside' } })
  }
  return out
}

export function validateScenario(config: ScenarioConfig, overrides: SubsystemModes = {}): ScenarioCheck {
  const { errors, warnings } = validateOverrides(config)
  const err = (key: MessageKey, params?: MessageParams) => errors.push({ key, params })
  errors.push(...validateSubsystemModes(config, overrides))
  const warn = (key: MessageKey, params?: MessageParams) => warnings.push({ key, params })
  const blocks = config.yard?.blocks ?? []
  const L = config.quay.lengthM
  const lim = SCALE_LIMITS
  if (blocks.length > 0) {
    if (blocks.length > lim.blocks.max) err('setup.check.blocks', { min: lim.blocks.min, max: lim.blocks.max })
    else if (blocks.length * BLOCK_FRONTAGE_M > L)
      err('setup.check.frontage', { count: blocks.length, length: blocks.length * BLOCK_FRONTAGE_M, quay: L })
    blocks.forEach((b, i) => {
      const bays = b.bays ?? 20
      const tiers = b.tiers ?? 5
      const pads = b.wtpPads
      const stalls = b.transferStalls ?? 5
      const bad =
        !Number.isInteger(bays) || bays < lim.bays.min || bays > lim.bays.max ||
        !Number.isInteger(tiers) || tiers < lim.tiers.min || tiers > lim.tiers.max ||
        !Number.isInteger(pads) || pads < 1 || pads > lim.pads ||
        !Number.isInteger(stalls) || stalls < 0 || stalls > lim.stalls
      if (bad)
        err('setup.check.block', { n: i + 1, maxBays: lim.bays.max, maxTiers: lim.tiers.max, maxPads: lim.pads, maxStalls: lim.stalls })
      if (b.x < 0 || b.x > L) warn('setup.check.blockOffQuay', { n: i + 1 })
      if ((b.poweredRows ?? []).some((r) => !Number.isInteger(r) || r < 1 || r > BLOCK_ROWS)) err('setup.check.poweredRows', { n: i + 1, rows: BLOCK_ROWS })
    })
  }
  const reeferShare = config.cargo.reeferShare ?? 0
  if (!(reeferShare >= 0 && reeferShare <= 1)) err('setup.check.reeferShare')
  else if (reeferShare > 0 && blocks.length > 0 && !blocks.some((b) => (b.poweredRows ?? []).length > 0)) err('setup.check.reeferNoPower')
  const shc = config.shcs?.length ?? 0
  if (shc > lim.shc.max) err('setup.check.shcCount', { min: lim.shc.min, max: lim.shc.max })
  const peak = peakTrucksPerHour(config)
  if (peak > lim.trucksPerHour) err('setup.check.trucks', { max: lim.trucksPerHour })
  const mode = config.yardStart?.mode
  if ((mode === 'empty' || mode === 'warmup') && !config.landside) err('setup.check.startNeedsLandside')
  const maxBays = Math.max(0, ...blocks.map((b) => b.bays ?? 20))
  const heavy =
    config.sts.length > STRESS_SCALE.sts ||
    blocks.length > STRESS_SCALE.blocks ||
    maxBays > STRESS_SCALE.bays ||
    shc > STRESS_SCALE.shc ||
    config.vessels.length > STRESS_SCALE.vessels ||
    peak > STRESS_SCALE.trucksPerHour
  if (heavy) warn('setup.check.heavy')
  return { errors, warnings }
}

/** Thrown by `createSimulation` for a configuration with errors. */
export class ScenarioValidationError extends Error {
  readonly errors: CheckMessage[]
  constructor(errors: CheckMessage[]) {
    super(`Invalid scenario: ${errors.map((e) => t(e.key, e.params)).join('; ')}`)
    this.name = 'ScenarioValidationError'
    this.errors = errors
  }
}

/** Errors the engine itself refuses (scale limits and impossible layouts); the dialog also blocks the softer ones, e.g. an empty vessel table. */
const ENGINE_ERROR_KEYS: readonly MessageKey[] = [
  'setup.check.quayLength',
  'setup.check.stsCount',
  'setup.check.blocks',
  'setup.check.block',
  'setup.check.shcCount',
  'setup.check.tooManyVessels',
  'setup.check.trucks',
  'setup.check.frontage',
  'setup.check.startNeedsLandside',
  'setup.check.modeNoSts',
  'setup.check.modeNoBlocks',
  'setup.check.modeYardOff',
]

export function assertValidScenario(config: ScenarioConfig, overrides: SubsystemModes = {}): void {
  const errors = validateScenario(config, overrides).errors.filter((e) => ENGINE_ERROR_KEYS.includes(e.key))
  if (errors.length > 0) throw new ScenarioValidationError(errors)
}
