/**
 * Scenario presets (TT-15): TTI Algeciras baseline, Small automated, TTI Algeciras — peak day.
 * Every value is overridable in the setup dialog. The layout is derived from the
 * counts (`scenario/layout.ts`), not placed by hand.
 */
import { DEFAULT_HOURLY_PROFILE, ScenarioBuilder } from './builder'
import { deriveBlockXs, deriveSts } from './layout'
import { TTI_FLOW_MIX, generateVessels } from './vesselGenerator'
import type { AppointmentConfig, HoldingConfig, ScenarioConfig, VesselConfig, YardStartConfig } from './types'

/** TTI Algeciras' published capacity (TEU): the source of the bay count. */
export const TTI_YARD_TEU = 28647
export const TTI_BLOCKS = 16
export const TTI_ROWS = 8
export const TTI_TIERS = 5
/**
 * [A] 20 ft bays per block: derived from the published 28,647 TEU capacity (16 blocks x 8 rows x 5 tiers
 * x bays), rounded. The block layout itself is not published, so the UI marks this as an assumption.
 */
export const TTI_BAYS = Math.round(TTI_YARD_TEU / (TTI_BLOCKS * TTI_ROWS * TTI_TIERS))

interface TerminalSpec {
  name: string
  description: string
  seed: number
  quayM: number
  /** First STS number: TTI numbers its cranes 101-108. */
  stsFirst: number
  sts: number
  blocks: number
  bays: number
  tiers: number
  shc: number
  gate: { inLanes: number; outLanes: number }
  vessels: VesselConfig[]
  yardStart: YardStartConfig
  /** Multiplier on the default hourly truck profile. */
  truckScale: number
  /** Truck appointment windows (TT-R15); absent = Poisson arrivals. */
  appointments?: AppointmentConfig
  holding?: HoldingConfig
}

function terminal(spec: TerminalSpec): ScenarioConfig {
  const b = new ScenarioBuilder(spec.name, spec.description)
    .seed(spec.seed)
    .moveVariation(10)
    .driverVariability(10)
    .startAt('2026-01-05T08:00:00Z') // daylight start (V11-03); fixtures keep 06:00 so goldens don't change
    .clockStart(8 * 3600)
    .quay(spec.quayM, { mooringS: 1800, unmooringS: 1200 })
    .vessels(spec.vessels)
    .shcs(spec.shc)
    // TT-R12: queue areas near every STS and every block's pads, and chained dispatch. Capacities are assumptions [unverified].
    .queueAreas({ stsCapacity: 3, blockCapacity: 3 })
    .decisions({ points: { shcDispatch: { strategy: 'chained-nearest' } } })
    .ascsPerBlock(2)
    .yardStart(spec.yardStart)
    .landside({
      hourlyProfile: DEFAULT_HOURLY_PROFILE.map((n) => Math.round(n * spec.truckScale)),
      gate: { inLanes: spec.gate.inLanes, outLanes: spec.gate.outLanes, oogLane: true },
      ...(spec.appointments ? { appointments: spec.appointments } : {}),
      ...(spec.holding ? { holding: spec.holding } : {}),
    })
    .endWhen({ vesselsCompleted: spec.vessels.length })
  const base = b.build()
  const sts = deriveSts({ ...base, sts: [{ id: `STS${spec.stsFirst}`, gantryX: 0, groundPositions: 3 }] }, spec.sts, spec.quayM)
  for (const s of sts) b.sts(s.id, { gantryX: s.gantryX, groundPositions: s.groundPositions })
  deriveBlockXs(spec.quayM, spec.blocks).forEach((x, i) => b.block(`B${String(i + 1).padStart(2, '0')}`, { x, bays: spec.bays, tiers: spec.tiers }))
  return b.build()
}

/** Vessel calls for a TTI-style hub: ~85% transshipment, a spread of sizes. */
function hubVessels(count: number, intervalS: number, jitterS: number, movesScale: number, seed: number): VesselConfig[] {
  return generateVessels({
    count,
    startS: 0,
    intervalS,
    jitterS,
    seed,
    movesScale,
    sizeMix: { ulcv: 2, 'neo-panamax': 3, panamax: 3, feedermax: 2 },
    flowMix: TTI_FLOW_MIX,
  })
}

/** Presets whose bay count is derived from the published TTI capacity (the UI marks it as an assumption). */
/** Preset names other modules key on (TT-21: the Algeciras backdrop, the daylight-lock default). */
export const TTI_PRESET_NAME = 'TTI Algeciras baseline'
export const PEAK_DAY_PRESET_NAME = 'TTI Algeciras — peak day'

export const TTI_DERIVED_BAYS_PRESETS = ['TTI Algeciras baseline', 'TTI Algeciras — peak day']

export const presets: Record<string, () => ScenarioConfig> = {
  'TTI Algeciras baseline': () =>
    terminal({
      name: 'TTI Algeciras baseline',
      description:
        '850 m quay, 8 STS (101-108), 16 blocks x 2 ASC x 8 rows x 45 bays x 5 tiers (bay count derived from 28,647 TEU: an assumption), 23 SHC, gate 3 in / 3 out + OOG, ~85% transshipment',
      seed: 2026,
      quayM: 850,
      stsFirst: 101,
      sts: 8,
      blocks: TTI_BLOCKS,
      bays: TTI_BAYS,
      tiers: TTI_TIERS,
      shc: 23,
      gate: { inLanes: 3, outLanes: 3 },
      vessels: hubVessels(4, 3 * 3600, 900, 0.05, 11),
      yardStart: { mode: 'prefilled', targetPct: 60 },
      truckScale: 1,
    }),
  'Small automated': () =>
    terminal({
      name: 'Small automated',
      description: '400 m quay, 3 STS, 6 blocks, 8 SHC: a small automated terminal',
      seed: 7,
      quayM: 400,
      stsFirst: 1,
      sts: 3,
      blocks: 6,
      bays: 30,
      tiers: 4,
      shc: 8,
      gate: { inLanes: 2, outLanes: 2 },
      vessels: generateVessels({
        count: 3,
        startS: 0,
        intervalS: 4 * 3600,
        jitterS: 600,
        seed: 5,
        movesScale: 0.1,
        sizeMix: { feedermax: 2, panamax: 2, feeder: 1 },
        flowMix: { import: 30, export: 30, transshipment: 40 },
      }),
      yardStart: { mode: 'prefilled', targetPct: 60 },
      truckScale: 0.4,
    }),
  'TTI Algeciras — peak day': () =>
    terminal({
      name: 'TTI Algeciras — peak day',
      description: 'TTI layout; 5 vessels arrive within 40 minutes; heavy truck peak (about 3x the default profile)',
      seed: 99,
      quayM: 850,
      stsFirst: 101,
      sts: 8,
      blocks: TTI_BLOCKS,
      bays: TTI_BAYS,
      tiers: TTI_TIERS,
      shc: 23,
      gate: { inLanes: 3, outLanes: 3 },
      vessels: hubVessels(5, 600, 300, 0.05, 21),
      yardStart: { mode: 'prefilled', targetPct: 75 },
      truckScale: 3,
      // Peak day: appointments bunched into the first two hours (x1.5, 4 windows). [A] unverified: TTI's real window
      // length, caps and peak shape are not public; the cap itself comes from the gate and stall counts.
      appointments: { windowS: 1800, bunching: [{ fromS: 0, toS: 7200, factor: 1.5 }], unverified: true },
      // [A] unverified: TTI's real number of holding positions is not public.
      holding: { positions: 6, unverified: true },
    }),
}
