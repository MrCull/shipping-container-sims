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
  type ApronLayout,
  type AscKinematics,
  type BlockConfig,
  type CargoConfig,
  type EndConditions,
  type GateConfig,
  type LandsideConfig,
  type LayoutConfig,
  type QuayConfig,
  type ScenarioConfig,
  type ShcKinematics,
  type StsConfig,
  type SubsystemModes,
  type StsKinematics,
  type VesselConfig,
} from './types'
import { DEFAULT_WTP_PADS } from '../engine/yardLayout'
import type { DecisionsConfig } from '../engine/decisions/types'
import type { DwellDistribution, EmptyPoolConfig, VesselSizeClass, YardStartConfig } from './types'

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

/**
 * [A] Shuttle-carrier (1-over-0/1) kinematics: ~30 km/h empty, ~25 km/h loaded.
 * SHCs stop at every turn of the lane graph, so short runs never reach top
 * speed: acceleration matters as much as vMax.
 */
export const DEFAULT_SHC_KINEMATICS: ShcKinematics = {
  driveEmpty: { vMax: 8.3, accel: 1.0, decel: 1.2 },
  driveLoaded: { vMax: 6.9, accel: 0.7, decel: 0.9 },
  lift: { vMax: 0.4, accel: 0.4, decel: 0.4 },
  liftHeightM: 1,
  lockS: 2,
  unlockS: 2,
}

/**
 * [A] ASC kinematics: gantry 4 m/s along the block, trolley 1 m/s across the
 * 25.4 m span, hoist 0.5 m/s loaded / 1.0 m/s empty.
 */
export const DEFAULT_ASC_KINEMATICS: AscKinematics = {
  gantry: { vMax: 4, accel: 0.4, decel: 0.5 },
  trolley: { vMax: 1, accel: 0.4, decel: 0.4 },
  hoistLoaded: { vMax: 0.5, accel: 0.3, decel: 0.3 },
  hoistEmpty: { vMax: 1, accel: 0.5, decel: 0.5 },
  lockS: 2,
  unlockS: 2,
}

/** [A] Trucks per hour by clock hour: quiet nights, a morning peak (07–10) and an afternoon peak (14–17). */
export const DEFAULT_HOURLY_PROFILE: number[] = [
  4, 3, 3, 3, 4, 8, 20, 40, 48, 44, 30, 24, 22, 28, 38, 46, 42, 30, 18, 12, 10, 8, 6, 5,
]

/** [A] Gate: four lanes each way, 40 s to process an inbound truck (documents, OCR, seal check), 20 s outbound. */
export const DEFAULT_GATE: GateConfig = { inLanes: 4, outLanes: 4, inProcessingS: 40, outProcessingS: 20, processingVariationPct: 0, oogLane: true }

/**
 * [A] Landside defaults: the hourly profile above, a mix dominated by single moves with 20% dual transactions,
 * lognormal import dwell with a 3-day median, exports delivered 1 to 5 days before the vessel's ETA, 8 m/s trucks.
 */
export const DEFAULT_LANDSIDE: LandsideConfig = {
  hourlyProfile: DEFAULT_HOURLY_PROFILE,
  mix: { dropExport: 0.25, pickImport: 0.3, dropEmpty: 0.1, pickEmpty: 0.1, dual: 0.25 },
  importDwell: { kind: 'lognormal', medianS: 3 * 86400, sigma: 0.6 },
  exportWindow: { minBeforeEtaS: 86400, maxBeforeEtaS: 5 * 86400 },
  gate: DEFAULT_GATE,
  drive: { vMax: 8, accel: 1, decel: 1.5 },
}

/** SHC ids: SHC01, SHC02, … */
export function shcId(index: number): string {
  return `SHC${String(index + 1).padStart(2, '0')}`
}

/**
 * Replace a config's SHC fleet and/or kinematics (setup dialog). Returns a
 * new config; the input is not modified.
 */
export function withShcFleet(config: ScenarioConfig, count: number, kinematics?: Partial<ShcKinematics>): ScenarioConfig {
  const next: ScenarioConfig = JSON.parse(JSON.stringify(config)) // also copies Vue reactive proxies
  next.shcs = Array.from({ length: count }, (_, i) => ({ id: shcId(i) }))
  next.kinematics.shc = JSON.parse(JSON.stringify({ ...(config.kinematics.shc ?? DEFAULT_SHC_KINEMATICS), ...kinematics }))
  return next
}

/** Distance between neighbouring blocks' centres added by the setup dialog (m): the 25.4 m span plus a road. */
export const BLOCK_PITCH_M = 40

/** The setup dialog's yard fields: one entry per block, the ASCs per block and the ASC kinematics. */
export interface YardSetup {
  blocks: { bays: number; tiers: number; wtpPads: number; transferStalls: number }[]
  asc: AscKinematics
  /** ASCs per block (TT-08); omitted keeps the scenario's value. */
  ascsPerBlock?: 1 | 2
}

/**
 * Replace a config's yard blocks and ASC kinematics (setup dialog). Existing
 * blocks keep their id and position; extra blocks are added east of the last
 * one. Returns a new config; the input is not modified.
 */
export function withYard(config: ScenarioConfig, setup: YardSetup): ScenarioConfig {
  const next: ScenarioConfig = JSON.parse(JSON.stringify(config)) // also copies Vue reactive proxies
  const old = config.yard?.blocks ?? []
  let lastX = old[0]?.x ?? 0
  next.yard = {
    blocks: setup.blocks.map((b, i) => {
      const kept = old[i]
      lastX = kept?.x ?? lastX + BLOCK_PITCH_M
      return {
        id: kept?.id ?? `B${String(i + 1).padStart(2, '0')}`,
        x: lastX,
        wtpPads: b.wtpPads,
        bays: b.bays,
        tiers: b.tiers,
        transferStalls: b.transferStalls,
      }
    }),
  }
  const ascsPerBlock = setup.ascsPerBlock ?? config.yard?.ascsPerBlock
  if (ascsPerBlock) next.yard.ascsPerBlock = ascsPerBlock
  next.kinematics.asc = JSON.parse(JSON.stringify(setup.asc))
  return next
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
  if (opts.dischargeTransshipment) v.dischargeTransshipment = opts.dischargeTransshipment
  if (opts.empties?.length) v.empties = structuredClone(opts.empties)
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

  /** Transshipment dwell distribution (TT-11). */
  transshipmentDwell(dwell: DwellDistribution): this {
    this.config.transshipment = { dwell: structuredClone(dwell) }
    return this
  }

  /** Empty pool pre-filled into the yard (TT-11). */
  emptyPool(pool: EmptyPoolConfig): this {
    this.config.emptyPool = structuredClone(pool)
    return this
  }

  decisions(decisions: DecisionsConfig): this {
    this.config.decisions = structuredClone(decisions)
    return this
  }

  /** Add `count` SHCs (SHC01…) with optional kinematics overrides. */
  shcs(count: number, kinematics: Partial<ShcKinematics> = {}): this {
    this.config = withShcFleet(this.config, count, kinematics)
    return this
  }

  /** Add a yard block: `x` across the quay; 5 WTP pads, 20 bays, 5 tiers and 5 transfer stalls unless given. */
  block(id: string, opts: Omit<BlockConfig, 'id' | 'wtpPads'> & Partial<Pick<BlockConfig, 'wtpPads'>>): this {
    this.config.yard ??= { blocks: [] }
    this.config.yard.blocks.push({ id, ...opts, wtpPads: opts.wtpPads ?? DEFAULT_WTP_PADS })
    return this
  }

  /** ASCs per block (TT-08): 1 (default) or 2 sharing the rail. */
  ascsPerBlock(n: 1 | 2): this {
    this.config.yard ??= { blocks: [] }
    this.config.yard.ascsPerBlock = n
    return this
  }

  /** ASC kinematics. */
  ascKinematics(k: Partial<AscKinematics>): this {
    this.config.kinematics.asc = structuredClone({ ...(this.config.kinematics.asc ?? DEFAULT_ASC_KINEMATICS), ...k })
    return this
  }

  apron(layout: Partial<ApronLayout>): this {
    this.config.apron = { ...this.config.apron, ...layout }
    return this
  }

  driverVariability(pct: number): this {
    this.config.driverVariabilityPct = pct
    return this
  }

  subsystems(modes: SubsystemModes): this {
    this.config.subsystems = { ...this.config.subsystems, ...modes }
    return this
  }

  /** Where the scenario clock sits at t = 0 (seconds since midnight): aligns the hourly truck profile and the KPI buckets. */
  clockStart(startTimeOfDayS: number): this {
    this.config.kpi = { ...this.config.kpi, startTimeOfDayS }
    return this
  }

  /** Landside (TT-13): trucks, gate and transfer stalls; unspecified fields take `DEFAULT_LANDSIDE`. */
  landside(opts: Partial<Omit<LandsideConfig, 'gate'>> & { gate?: Partial<GateConfig> } = {}): this {
    const { gate, ...rest } = opts
    this.config.landside = structuredClone({
      ...DEFAULT_LANDSIDE,
      ...this.config.landside,
      ...rest,
      gate: { ...DEFAULT_GATE, ...this.config.landside?.gate, ...gate },
    })
    return this
  }

  /** Yard start mode (TT-14): pre-filled to a target %, warm-up, or empty. */
  yardStart(start: YardStartConfig): this {
    this.config.yardStart = { ...start }
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
