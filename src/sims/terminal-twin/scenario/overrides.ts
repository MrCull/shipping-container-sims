/**
 * Setup-dialog edits on top of a fixture or preset: quay length, STS count
 * and the vessel table. Pure; `validateOverrides` returns readable errors and
 * warnings for the dialog (the engine still validates on start).
 */
import type { ScenarioConfig, StsConfig, VesselConfig } from './types'
import { cellCapacity, vesselClass } from './vesselClasses'

export interface ScenarioOverrides {
  quayLengthM?: number
  stsCount?: number
  vessels?: VesselConfig[]
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
  // an edited vessel table ends when all its vessels have departed
  if (o.vessels && config.endConditions.vesselsCompleted !== undefined) config.endConditions.vesselsCompleted = o.vessels.length
  return config
}

export interface OverrideCheck {
  errors: string[]
  warnings: string[]
}

export function validateOverrides(config: ScenarioConfig): OverrideCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const L = config.quay.lengthM
  if (!(L >= LIMITS.quayLengthM.min && L <= LIMITS.quayLengthM.max))
    errors.push(`Quay length must be ${LIMITS.quayLengthM.min}–${LIMITS.quayLengthM.max} m`)
  const n = config.sts.length
  if (!(Number.isInteger(n) && n >= LIMITS.sts.min && n <= LIMITS.sts.max)) errors.push(`STS count must be ${LIMITS.sts.min}–${LIMITS.sts.max}`)
  else if (L / n < config.quay.stsMinSpacingM)
    errors.push(`${n} STS need at least ${n * config.quay.stsMinSpacingM} m of quay (${config.quay.stsMinSpacingM} m each)`)
  if (config.vessels.length === 0) errors.push('Add at least one vessel')
  if (config.vessels.length > LIMITS.vessels) errors.push(`At most ${LIMITS.vessels} vessels`)
  const ids = new Set<string>()
  for (const v of config.vessels) {
    if (ids.has(v.id)) errors.push(`Duplicate vessel id ${v.id}`)
    ids.add(v.id)
    const spec = vesselClass(v.sizeClass)
    const counts = [v.discharge, v.load, v.transshipment, v.maxSts]
    if (counts.some((c) => !Number.isInteger(c) || c < 0)) errors.push(`${v.id}: counts must be whole numbers ≥ 0`)
    if (!(v.arrivalS >= 0)) errors.push(`${v.id}: arrival must be at or after the scenario start`)
    if (v.maxSts < 1) errors.push(`${v.id}: max STS must be at least 1`)
    if (v.discharge + v.load + v.transshipment > cellCapacity(spec))
      errors.push(`${v.id}: ${v.discharge + v.load + v.transshipment} boxes exceed a ${spec.label}'s ~${cellCapacity(spec)} slots`)
    if (spec.loaM > L) warnings.push(`${v.id}: a ${spec.label} (${spec.loaM} m) is longer than the quay and can never berth`)
  }
  return { errors, warnings }
}
