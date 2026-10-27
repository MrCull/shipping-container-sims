/**
 * Typed scenario builder. Fixtures and (later) presets are produced through
 * this builder so every ScenarioConfig is complete and consistent.
 *
 *   const cfg = new ScenarioBuilder('my-fixture', 'What it exercises')
 *     .seed(7)
 *     .sts('STS01', { gantryX: 100, groundPositions: 3 })
 *     .vessel('V001', { stsIds: ['STS01'], bays: 2, rows: 5 })
 *     .dischargeBoxes('V001', 10)
 *     .endWhen({ vesselsCompleted: 1 })
 *     .build()
 *
 * Default values are approximations [A] of Malaccamax STS performance.
 */
import { makeIso6346Id } from './iso6346'
import {
  SCENARIO_SCHEMA_VERSION,
  type ApronLayout,
  type BlockConfig,
  type ContainerConfig,
  type ContainerSize,
  type EndConditions,
  type LayoutConfig,
  type ScenarioConfig,
  type ShcKinematics,
  type StsConfig,
  type SubsystemModes,
  type StsKinematics,
  type VesselConfig,
} from './types'

/** [A] Malaccamax-class STS kinematics. */
export const DEFAULT_STS_KINEMATICS: StsKinematics = {
  gantry: { vMax: 0.75, accel: 0.25, decel: 0.25 },
  trolley: { vMax: 4, accel: 0.8, decel: 0.8 },
  hoistLoaded: { vMax: 1.5, accel: 0.6, decel: 0.6 },
  hoistEmpty: { vMax: 3, accel: 0.8, decel: 0.8 },
  lockS: 3,
  unlockS: 3,
}

/** [A] Shuttle-carrier (1-over-0/1) kinematics: ~30 km/h empty, ~25 km/h loaded. */
export const DEFAULT_SHC_KINEMATICS: ShcKinematics = {
  driveEmpty: { vMax: 8.3, accel: 0.6, decel: 0.8 },
  driveLoaded: { vMax: 6.9, accel: 0.4, decel: 0.6 },
  lift: { vMax: 0.4, accel: 0.4, decel: 0.4 },
  liftHeightM: 1,
  lockS: 2,
  unlockS: 2,
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

export const DEFAULT_LAYOUT: LayoutConfig = {
  stsGroundLaneZ0M: 8,
  stsGroundLaneSpacingM: 3,
  stsSafeHoistM: 45,
}

/** Owner prefixes (owner code + "U") per shipping line. */
export const LINE_OWNER_PREFIX: Record<string, string> = {
  HMM: 'HDMU',
  MSC: 'MSCU',
  Maersk: 'MAEU',
  'CMA CGM': 'CMAU',
  'Hapag-Lloyd': 'HLXU',
  ONE: 'ONEU',
  Evergreen: 'EGHU',
  COSCO: 'CSNU',
  ZIM: 'ZIMU',
  'Yang Ming': 'YMLU',
}

type VesselOptions = Partial<Omit<VesselConfig, 'id'>> & Pick<VesselConfig, 'stsIds'>

export interface DischargeOptions {
  size?: ContainerSize
  full?: boolean
  line?: string
}

export class ScenarioBuilder {
  private config: ScenarioConfig
  private nextSerial = 100001

  constructor(name: string, description: string) {
    this.config = {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      name,
      description,
      seed: 1,
      startDateTime: '2026-01-05T06:00:00Z',
      quay: { lengthM: 400 },
      layout: { ...DEFAULT_LAYOUT },
      kinematics: { sts: structuredClone(DEFAULT_STS_KINEMATICS) },
      moveVariationPct: 0,
      sts: [],
      vessels: [],
      containers: [],
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

  quay(lengthM: number): this {
    this.config.quay = { lengthM }
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

  sts(id: string, opts: Omit<StsConfig, 'id'>): this {
    this.config.sts.push({ id, ...opts })
    return this
  }

  vessel(id: string, opts: VesselOptions): this {
    this.config.vessels.push({
      id,
      name: opts.name ?? id,
      berthAtS: opts.berthAtS ?? 0,
      berthX: opts.berthX ?? 50,
      stsIds: opts.stsIds,
      bays: opts.bays ?? 4,
      rows: opts.rows ?? 6,
      tiersOnDeck: opts.tiersOnDeck ?? 1,
      bayPitchM: opts.bayPitchM ?? 13,
      rowPitchM: opts.rowPitchM ?? 2.5,
      deckHeightM: opts.deckHeightM ?? 18,
      fenderGapM: opts.fenderGapM ?? 2,
    })
    return this
  }

  /**
   * Place `count` discharge boxes on the vessel's deck, filling bay by bay,
   * row by row, tier by tier. Ids are deterministic valid ISO 6346 ids.
   */
  dischargeBoxes(vesselId: string, count: number, opts: DischargeOptions = {}): this {
    const vessel = this.config.vessels.find((v) => v.id === vesselId)
    if (!vessel) throw new Error(`Unknown vessel ${vesselId}`)
    const line = opts.line ?? 'HMM'
    const prefix = LINE_OWNER_PREFIX[line]
    if (!prefix) throw new Error(`Unknown shipping line ${line}`)
    const taken = new Set(
      this.config.containers
        .filter((c) => c.initial.vesselId === vesselId)
        .map((c) => `${c.initial.bay}:${c.initial.row}:${c.initial.tier}`),
    )
    let placed = 0
    for (let bay = 0; bay < vessel.bays && placed < count; bay++) {
      for (let tier = 0; tier < vessel.tiersOnDeck && placed < count; tier++) {
        for (let row = 0; row < vessel.rows && placed < count; row++) {
          if (taken.has(`${bay}:${row}:${tier}`)) continue
          const c: ContainerConfig = {
            id: makeIso6346Id(prefix, this.nextSerial++),
            size: opts.size ?? '40',
            full: opts.full ?? true,
            line,
            initial: { kind: 'vesselSlot', vesselId, bay, row, tier },
          }
          this.config.containers.push(c)
          placed++
        }
      }
    }
    if (placed < count) throw new Error(`Vessel ${vesselId} has room for only ${placed} more boxes`)
    return this
  }

  /** Add `count` SHCs (SHC01…) with optional kinematics overrides. */
  shcs(count: number, kinematics: Partial<ShcKinematics> = {}): this {
    this.config = withShcFleet(this.config, count, kinematics)
    return this
  }

  /** Add a yard block (with its WTP pads). */
  block(id: string, opts: Omit<BlockConfig, 'id'>): this {
    this.config.yard ??= { blocks: [] }
    this.config.yard.blocks.push({ id, ...opts })
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

  endWhen(conditions: EndConditions): this {
    this.config.endConditions = { ...conditions }
    return this
  }

  build(): ScenarioConfig {
    return structuredClone(this.config)
  }
}
