/**
 * Scenario presets (TT-15): TTI Algeciras baseline, Small automated, TTI Algeciras — peak day.
 * Every value is overridable in the setup dialog. The layout is derived from the
 * counts (`scenario/layout.ts`), not placed by hand.
 */
import { DEFAULT_HOURLY_PROFILE, ScenarioBuilder } from './builder'
import { deriveBlockXs, deriveSts } from './layout'
import { TTI_FLOW_MIX, generateVessels } from './vesselGenerator'
import type { AppointmentConfig, FlowMix, HoldingConfig, PortRotation, ScenarioConfig, VesselConfig, YardStartConfig } from './types'
import {
  PEAK_DAY_FLOW_MIX,
  PEAK_DAY_PRESET_NAME,
  PEAK_DAY_ROB,
  PEAK_DAY_ROTATION,
  TTI_BAYS,
  TTI_BLOCKS,
  TTI_PRESET_NAME,
  TTI_REEFERS,
  TTI_TIERS,
} from '../terminals/tti-algeciras/constants'

// The TTI Algeciras constants live in the terminal folder; re-exported for the code that already imports them from here.
export { PEAK_DAY_FLOW_MIX, PEAK_DAY_ROB, PEAK_DAY_ROTATION, TTI_BAYS, TTI_BLOCKS, TTI_ROWS, TTI_TIERS, TTI_YARD_TEU } from '../terminals/tti-algeciras/constants'

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
  /** Reefers (R19): share of full boxes and the powered rows of every block; absent = none. */
  reefers?: { share: number; poweredRows: number[] }
  /** Port rotation of the service (spec #106): sets POL and POD; absent = the generic default rotation. */
  portRotation?: PortRotation
  /** ROB bays (spec #106): share of each vessel's bays held back as remain-on-board and their fill level; absent = none. */
  rob?: { bayFraction: number; fill: number }
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
    .cargo(spec.reefers ? { reeferShare: spec.reefers.share } : {})
    .yardStart(spec.yardStart)
    .landside({
      hourlyProfile: DEFAULT_HOURLY_PROFILE.map((n) => Math.round(n * spec.truckScale)),
      gate: { inLanes: spec.gate.inLanes, outLanes: spec.gate.outLanes, oogLane: true },
      ...(spec.appointments ? { appointments: spec.appointments } : {}),
      ...(spec.holding ? { holding: spec.holding } : {}),
    })
    .endWhen({ vesselsCompleted: spec.vessels.length })
  if (spec.portRotation) b.containerProps({ portRotation: spec.portRotation })
  if (spec.rob) b.robBays(spec.rob.bayFraction, spec.rob.fill)
  const base = b.build()
  const sts = deriveSts({ ...base, sts: [{ id: `STS${spec.stsFirst}`, gantryX: 0, groundPositions: 3 }] }, spec.sts, spec.quayM)
  for (const s of sts) b.sts(s.id, { gantryX: s.gantryX, groundPositions: s.groundPositions })
  deriveBlockXs(spec.quayM, spec.blocks).forEach((x, i) => b.block(`B${String(i + 1).padStart(2, '0')}`, { x, bays: spec.bays, tiers: spec.tiers, ...(spec.reefers ? { poweredRows: spec.reefers.poweredRows } : {}) }))
  return b.build()
}

/** Vessel calls for a TTI-style hub: ~85% transshipment, a spread of sizes. */
function hubVessels(count: number, intervalS: number, jitterS: number, movesScale: number, seed: number, flowMix: FlowMix = TTI_FLOW_MIX): VesselConfig[] {
  return generateVessels({
    count,
    startS: 0,
    intervalS,
    jitterS,
    seed,
    movesScale,
    sizeMix: { ulcv: 2, 'neo-panamax': 3, panamax: 3, feedermax: 2 },
    flowMix,
  })
}

export { PEAK_DAY_PRESET_NAME, TTI_PRESET_NAME }
export const SMALL_PRESET_NAME = 'Small automated'

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
      reefers: TTI_REEFERS,
    }),
  [SMALL_PRESET_NAME]: () =>
    terminal({
      name: SMALL_PRESET_NAME,
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
      description:
        'TTI layout; 5 vessels arrive within 40 minutes; heavy truck peak (about 3x the default profile); Asia-Mediterranean port rotation, ~89% transshipment and 30% of each vessel kept as remain-on-board bays (all unverified assumptions)',
      seed: 99,
      quayM: 850,
      stsFirst: 101,
      sts: 8,
      blocks: TTI_BLOCKS,
      bays: TTI_BAYS,
      tiers: TTI_TIERS,
      shc: 23,
      gate: { inLanes: 3, outLanes: 3 },
      vessels: hubVessels(5, 600, 300, 0.05, 21, PEAK_DAY_FLOW_MIX),
      yardStart: { mode: 'prefilled', targetPct: 75 },
      truckScale: 3,
      // Peak day: appointments bunched into the first two hours (x1.5, 4 windows). [A] unverified: TTI's real window
      // length, caps and peak shape are not public; the cap itself comes from the gate and stall counts.
      appointments: { windowS: 1800, bunching: [{ fromS: 0, toS: 7200, factor: 1.5 }], unverified: true },
      // [A] unverified: TTI's real number of holding positions is not public.
      holding: { positions: 6, unverified: true },
      reefers: TTI_REEFERS,
      portRotation: PEAK_DAY_ROTATION,
      rob: PEAK_DAY_ROB,
    }),
}
