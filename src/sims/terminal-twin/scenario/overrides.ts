/**
 * Setup-dialog edits on top of a fixture or preset: quay length, STS count
 * and the vessel table. Pure; `validateOverrides` returns readable errors and
 * warnings for the dialog (the engine still validates on start).
 */
import type { MessageKey, MessageParams } from '../i18n/messages'
import type { DecisionsConfig } from '../engine/decisions/types'
import type { ScenarioConfig, StsConfig, StsKinematics, SubsystemModes, VesselConfig } from './types'
import { DEFAULT_TRANSSHIPMENT } from './dwell'
import { cellCapacity, vesselClass } from './vesselClasses'
import { SCALE_LIMITS } from './limits'
import { deriveSts } from './layout'

export interface ScenarioOverrides {
  quayLengthM?: number
  stsCount?: number
  vessels?: VesselConfig[]
  /** Median transshipment dwell (s); keeps a lognormal distribution (TT-11). */
  dwellMedianS?: number
  /** Empty pool at start: box count and the longest age (s) (TT-11). */
  emptyPool?: { count: number; maxAgeS?: number }
  /** STS kinematics (TT-15 kinematics editor). */
  stsKinematics?: StsKinematics
  /** ± % random variation of each STS move (0 = none). */
  moveVariationPct?: number
  /** ± % random variation of each SHC trip (driver variability). */
  driverVariabilityPct?: number
  /** Peak trucks per hour: scales the scenario's hourly profile so its maximum is this (needs a landside). */
  peakTrucksPerHour?: number
  /** Gate lanes (needs a landside). */
  gate?: { inLanes: number; outLanes: number }
  /** Decision points: async mode, strategy per point and latency injection; replaces the scenario's. */
  decisions?: DecisionsConfig
  /** Subsystem modes (V11-10: quay, berth, yard; merged over the scenario's own). */
  subsystems?: SubsystemModes
  /** Derive the STS and block positions from the counts and the quay length (presets); fixtures keep their layout. */
  derive?: boolean
}

/** Spec scale limits. */
export const LIMITS = SCALE_LIMITS

/** STS cranes spread evenly along the quay (rail order), keeping the first crane's ground positions. */
export function spreadSts(config: ScenarioConfig, count: number, lengthM: number): StsConfig[] {
  return deriveSts(config, count, lengthM)
}

export function applyOverrides(base: ScenarioConfig, o: ScenarioOverrides): ScenarioConfig {
  const config: ScenarioConfig = JSON.parse(JSON.stringify(base))
  if (o.quayLengthM !== undefined) config.quay.lengthM = o.quayLengthM
  const stsCount = o.stsCount ?? config.sts.length
  const outOfQuay = config.sts.some((s) => s.gantryX > config.quay.lengthM)
  const quayMoved = o.derive === true && config.quay.lengthM !== base.quay.lengthM
  if (stsCount !== config.sts.length || outOfQuay || quayMoved) config.sts = spreadSts(config, stsCount, config.quay.lengthM)
  if (o.stsKinematics) config.kinematics.sts = JSON.parse(JSON.stringify(o.stsKinematics))
  if (o.moveVariationPct !== undefined) config.moveVariationPct = o.moveVariationPct
  if (o.driverVariabilityPct !== undefined) config.driverVariabilityPct = o.driverVariabilityPct
  if (config.landside) {
    const peak = Math.max(0, ...config.landside.hourlyProfile)
    if (o.peakTrucksPerHour !== undefined && peak > 0)
      config.landside.hourlyProfile = config.landside.hourlyProfile.map((n) => Math.round((n * o.peakTrucksPerHour!) / peak))
    if (o.gate) config.landside.gate = { ...config.landside.gate, ...o.gate }
  }
  if (o.subsystems) config.subsystems = { ...config.subsystems, ...o.subsystems }
  if (o.decisions) config.decisions = JSON.parse(JSON.stringify(o.decisions))
  if (o.vessels) config.vessels = JSON.parse(JSON.stringify(o.vessels))
  if (o.dwellMedianS !== undefined) {
    const current = (base.transshipment ?? DEFAULT_TRANSSHIPMENT).dwell
    const sigma = current.kind === 'lognormal' ? current.sigma : 0.6
    config.transshipment = { dwell: { kind: 'lognormal', medianS: o.dwellMedianS, sigma } }
  }
  if (o.emptyPool) config.emptyPool = { ...config.emptyPool, ...o.emptyPool }
  // an edited vessel table ends when all its vessels have departed
  if (o.vessels && config.endConditions.vesselsCompleted !== undefined) config.endConditions.vesselsCompleted = o.vessels.length
  return config
}

/** A validation finding as a message-catalogue key plus its parameters (the dialog renders it with `t()`). */
export interface CheckMessage {
  key: MessageKey
  params?: MessageParams
}

export interface OverrideCheck {
  errors: CheckMessage[]
  warnings: CheckMessage[]
}

export function validateOverrides(config: ScenarioConfig): OverrideCheck {
  const errors: CheckMessage[] = []
  const warnings: CheckMessage[] = []
  const err = (key: MessageKey, params?: MessageParams) => errors.push({ key, params })
  const L = config.quay.lengthM
  if (!(L >= LIMITS.quayLengthM.min && L <= LIMITS.quayLengthM.max))
    err('setup.check.quayLength', { min: LIMITS.quayLengthM.min, max: LIMITS.quayLengthM.max })
  const n = config.sts.length
  const spacing = config.quay.stsMinSpacingM
  if (!(Number.isInteger(n) && n >= LIMITS.sts.min && n <= LIMITS.sts.max))
    err('setup.check.stsCount', { min: LIMITS.sts.min, max: LIMITS.sts.max })
  else if (L / n < spacing) err('setup.check.stsSpacing', { count: n, length: n * spacing, spacing })
  if (config.vessels.length === 0) err('setup.check.noVessels')
  if (config.vessels.length > LIMITS.vessels) err('setup.check.tooManyVessels', { max: LIMITS.vessels })
  const ids = new Set<string>()
  for (const v of config.vessels) {
    if (ids.has(v.id)) err('setup.check.duplicateId', { id: v.id })
    ids.add(v.id)
    const spec = vesselClass(v.sizeClass)
    const counts = [v.discharge, v.load, v.transshipment, v.maxSts]
    if (counts.some((c) => !Number.isInteger(c) || c < 0)) err('setup.check.counts', { id: v.id })
    if ((v.dischargeTransshipment ?? 0) > v.discharge) err('setup.check.tsIn', { id: v.id })
    if (!(v.arrivalS >= 0)) err('setup.check.arrival', { id: v.id })
    if (v.maxSts < 1) err('setup.check.maxSts', { id: v.id })
    const boxes = v.discharge + v.load + v.transshipment + (v.empties ?? []).reduce((n, e) => n + e.count, 0)
    if (boxes > cellCapacity(spec))
      err('setup.check.capacity', { id: v.id, boxes, vesselClass: spec.label, capacity: cellCapacity(spec) })
    if (spec.loaM > L) warnings.push({ key: 'setup.check.tooLong', params: { id: v.id, vesselClass: spec.label, loa: spec.loaM } })
  }
  const dwell = config.transshipment?.dwell
  if (dwell?.kind === 'lognormal' && !(dwell.medianS > 0)) err('setup.check.dwell')
  if (config.emptyPool && !(config.emptyPool.count >= 0)) err('setup.check.pool')
  return { errors, warnings }
}
