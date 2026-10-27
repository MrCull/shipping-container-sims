/**
 * Typed scenario builder. Fixtures and (later) presets are produced through
 * this builder so every ScenarioConfig is complete and consistent.
 *
 *   const cfg = new ScenarioBuilder('my-fixture', 'What it exercises')
 *     .seed(7)
 *     .quay(600)
 *     .sts('STS01', { gantryX: 100, groundPositions: 3 })     // rail order
 *     .vesselCall('V001', { sizeClass: 'panamax', arrivalS: 0, discharge: 40 })
 *     .endWhen({ vesselsCompleted: 1 })
 *     .build()
 *
 * Default values are approximations [A] (Malaccamax STS performance,
 * typical berth times). The bay plan is generated from the vessel table and
 * the seed when the simulation starts (`bayPlan.ts`).
 */
import { DEFAULT_CARGO, LINE_OWNER_PREFIX } from './lines'
import {
  SCENARIO_SCHEMA_VERSION,
  type CargoConfig,
  type EndConditions,
  type LayoutConfig,
  type QuayConfig,
  type ScenarioConfig,
  type StsConfig,
  type StsKinematics,
  type VesselConfig,
} from './types'
import type { DecisionsConfig } from '../engine/decisions/types'
import type { VesselSizeClass } from './types'

export { LINE_OWNER_PREFIX }

/** [A] Malaccamax-class STS kinematics. */
export const DEFAULT_STS_KINEMATICS: StsKinematics = {
  gantry: { vMax: 0.75, accel: 0.25, decel: 0.25 },
  trolley: { vMax: 4, accel: 0.8, decel: 0.8 },
  hoistLoaded: { vMax: 1.5, accel: 0.6, decel: 0.6 },
  hoistEmpty: { vMax: 3, accel: 0.8, decel: 0.8 },
  lockS: 3,
  unlockS: 3,
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  stsGroundLaneZ0M: 8,
  stsGroundLaneSpacingM: 3,
  stsSafeHoistM: 50,
}

/** [A] Berth and crane rules. */
export const DEFAULT_QUAY: QuayConfig = {
  lengthM: 400,
  berthGapM: 15,
  mooringS: 1800,
  unmooringS: 1200,
  stsMinSpacingM: 27,
  twinLift: true,
}

/** [A] Default maximum STS per vessel by size class. */
export const DEFAULT_MAX_STS: Record<VesselSizeClass, number> = {
  feeder: 2,
  feedermax: 3,
  panamax: 4,
  'neo-panamax': 5,
  ulcv: 6,
}

export type VesselCallOptions = Partial<Omit<VesselConfig, 'id'>> & Pick<VesselConfig, 'sizeClass'>

export function makeVesselCall(id: string, opts: VesselCallOptions): VesselConfig {
  const v: VesselConfig = {
    id,
    name: opts.name ?? id,
    arrivalS: opts.arrivalS ?? 0,
    sizeClass: opts.sizeClass,
    discharge: opts.discharge ?? 0,
    load: opts.load ?? 0,
    transshipment: opts.transshipment ?? 0,
    maxSts: opts.maxSts ?? DEFAULT_MAX_STS[opts.sizeClass],
  }
  if (opts.sizeMix) v.sizeMix = { ...opts.sizeMix }
  return v
}

export class ScenarioBuilder {
  private config: ScenarioConfig

  constructor(name: string, description: string) {
    this.config = {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      name,
      description,
      seed: 1,
      startDateTime: '2026-01-05T06:00:00Z',
      quay: { ...DEFAULT_QUAY },
      layout: { ...DEFAULT_LAYOUT },
      kinematics: { sts: structuredClone(DEFAULT_STS_KINEMATICS) },
      moveVariationPct: 0,
      sts: [],
      vessels: [],
      cargo: structuredClone(DEFAULT_CARGO),
      endConditions: {},
    }
  }

  seed(seed: number): this {
    this.config.seed = seed
    return this
  }

  startAt(isoDateTime: string): this {
    this.config.startDateTime = isoDateTime
    return this
  }

  quay(lengthM: number, ops: Partial<Omit<QuayConfig, 'lengthM'>> = {}): this {
    this.config.quay = { ...this.config.quay, ...ops, lengthM }
    return this
  }

  layout(layout: Partial<LayoutConfig>): this {
    this.config.layout = { ...this.config.layout, ...layout }
    return this
  }

  stsKinematics(k: Partial<StsKinematics>): this {
    this.config.kinematics.sts = { ...this.config.kinematics.sts, ...k }
    return this
  }

  moveVariation(pct: number): this {
    this.config.moveVariationPct = pct
    return this
  }

  /** Add an STS; call in rail order (ascending gantryX). */
  sts(id: string, opts: Omit<StsConfig, 'id'>): this {
    this.config.sts.push({ id, ...opts })
    return this
  }

  /** Add one vessel call to the vessel table. */
  vesselCall(id: string, opts: VesselCallOptions): this {
    this.config.vessels.push(makeVesselCall(id, opts))
    return this
  }

  /** Replace the vessel table (e.g. with `generateVessels(...)`). */
  vessels(vessels: VesselConfig[]): this {
    this.config.vessels = structuredClone(vessels)
    return this
  }

  cargo(cargo: Partial<CargoConfig>): this {
    this.config.cargo = { ...this.config.cargo, ...structuredClone(cargo) }
    return this
  }

  decisions(decisions: DecisionsConfig): this {
    this.config.decisions = structuredClone(decisions)
    return this
  }

  endWhen(conditions: EndConditions): this {
    this.config.endConditions = { ...conditions }
    return this
  }

  build(): ScenarioConfig {
    return structuredClone(this.config)
  }
}
