/**
 * Setup-dialog edits on top of a fixture or preset: quay length, STS count
 * and the vessel table. Pure; `validateOverrides` returns readable errors and
 * warnings for the dialog (the engine still validates on start).
 */
import type { MessageKey, MessageParams } from '../i18n/messages'
import type { ScenarioConfig, StsConfig, VesselConfig } from './types'
import { DEFAULT_TRANSSHIPMENT } from './dwell'
import { cellCapacity, vesselClass } from './vesselClasses'

export interface ScenarioOverrides {
  quayLengthM?: number
  stsCount?: number
  vessels?: VesselConfig[]
  /** Median transshipment dwell (s); keeps a lognormal distribution (TT-11). */
  dwellMedianS?: number
  /** Empty pool at start: box count and the longest age (s) (TT-11). */
  emptyPool?: { count: number; maxAgeS?: number }
}

/** Spec scale limits. */
export const LIMITS = { quayLengthM: { min: 100, max: 3000 }, sts: { min: 1, max: 24 }, vessels: 60 } as const

/** STS cranes spread evenly along the quay (rail order), keeping the first crane's ground positions. */
export function spreadSts(config: ScenarioConfig, count: number, lengthM: number): StsConfig[] {
  const groundPositions = config.sts[0]?.groundPositions ?? 3
  const pitch = lengthM / count
  return Array.from({ length: count }, (_, i) => ({
    id: `STS${String(i + 1).padStart(2, '0')}`,
    gantryX: Math.round((i + 0.5) * pitch * 10) / 10,
    groundPositions,
  }))
}

export function applyOverrides(base: ScenarioConfig, o: ScenarioOverrides): ScenarioConfig {
  const config: ScenarioConfig = JSON.parse(JSON.stringify(base))
  if (o.quayLengthM !== undefined) config.quay.lengthM = o.quayLengthM
  const stsCount = o.stsCount ?? config.sts.length
  const outOfQuay = config.sts.some((s) => s.gantryX > config.quay.lengthM)
  if (stsCount !== config.sts.length || outOfQuay) config.sts = spreadSts(config, stsCount, config.quay.lengthM)
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
