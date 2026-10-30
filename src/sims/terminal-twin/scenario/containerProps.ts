/**
 * Stored container properties (spec #106, ticket #108): transit direction, ISO type, POL / POD, tare and cargo
 * weight, weight class, planned departure, inbound and outbound carrier, reefer setpoint, booking reference and
 * holds. Set once when a container is created (`scenario/containerFactory.ts`); the only later change is an
 * allocated empty becoming EXPORT (`allocateEmptyProps`). Transit status, content status and dwell are NOT here:
 * they are computed from engine state (#109).
 *
 * Randomness: every draw comes from a stream keyed by (seed, container id), like the reefer hash in `reefer.ts`. It
 * consumes no engine or bay-plan stream, so adding these properties moves no existing box, move or golden, and the
 * result does not depend on creation order. Pure: no engine state is read.
 */
import { nextRandom } from '../engine/rng'
import { sampleDwell } from './dwell'
import type {
  CargoWeightSpec,
  ContainerPropsConfig,
  ContainerSize,
  DwellDistribution,
  PortRotation,
  ScenarioConfig,
  TransitDirection,
  VesselConfig,
  WeightClassBands,
} from './types'

export type { TransitDirection } from './types'

export type WeightClass = 'LIGHT' | 'MEDIUM' | 'HEAVY'

/** Heavier ranks higher: vessel-ordering heavy-on-light checks and yard-grouping heavy-at-the-bottom compare it. */
export const WEIGHT_RANK: Record<WeightClass, number> = { LIGHT: 0, MEDIUM: 1, HEAVY: 2 }

/** Who brings a box in or takes it out: a vessel (`id` absent = a call outside this scenario) or a truck. */
export interface CarrierRef {
  kind: 'vessel' | 'truck'
  id?: string
}

export interface ContainerProps {
  direction: TransitDirection
  /** ISO 6346 size and type code, e.g. 22G1, 45G1, 45R1. */
  isoType: string
  /** Port of loading and of discharge: UN/LOCODEs from the scenario's port rotation. */
  pol: string
  pod: string
  tareKg: number
  /** 0 for an empty box: it weighs its tare only. */
  cargoKg: number
  weightClass: WeightClass
  /** Sim time (s) the box is planned to leave: outbound vessel ETD, else truck appointment, else arrival + expected dwell. */
  plannedDepartureS: number
  inbound: CarrierRef
  outbound: CarrierRef
  /** Reefers only (deg C). */
  reeferSetpointC?: number
  bookingRef: string
  /** Carried on every container, never created or enforced yet. */
  holds: string[]
}

/** [A] A generic rotation for scenarios that define none: Algeciras on an Asia-Europe-Med loop. UN/LOCODEs are real, the order is an assumption. */
export const DEFAULT_PORT_ROTATION: PortRotation = { terminal: 'ESALG', ports: ['ESALG', 'MAPTM', 'ESVLC', 'NLRTM', 'DEHAM', 'GBFXT', 'SGSIN'] }

/** [A] Mostly returning empties go to storage. */
export const DEFAULT_DIRECTION_MIX: Partial<Record<TransitDirection, number>> = { IMPORT: 1, STORAGE: 3 }

/** [A] Laden cargo weight by size (kg): payload limits are those of a standard 20 ft / 40 ft box. */
export const DEFAULT_CARGO_WEIGHT: Record<ContainerSize, CargoWeightSpec> = {
  '20': { medianKg: 11000, sigma: 0.45, maxKg: 28000 },
  '40': { medianKg: 14000, sigma: 0.5, maxKg: 26500 },
  '40HC': { medianKg: 14000, sigma: 0.5, maxKg: 26500 },
}

/** [A] Gross weight bands: under 12 t light, up to 24 t medium. */
export const DEFAULT_WEIGHT_BANDS: WeightClassBands = { lightMaxKg: 12000, mediumMaxKg: 24000 }

const DAY = 86400
/** [A] Imports 3-7 days and storage empties 5-20 days; exports and transshipment boxes mostly have a vessel ETD. */
export const DEFAULT_EXPECTED_DWELL: Record<TransitDirection, DwellDistribution> = {
  IMPORT: { kind: 'uniform', minS: 3 * DAY, maxS: 7 * DAY },
  STORAGE: { kind: 'uniform', minS: 5 * DAY, maxS: 20 * DAY },
  EXPORT: { kind: 'uniform', minS: 1 * DAY, maxS: 3 * DAY },
  TRANSSHIPMENT: { kind: 'uniform', minS: 1 * DAY, maxS: 4 * DAY },
}

/** [A] Tare weights (kg) by size, dry and reefer. */
const TARE_KG: Record<ContainerSize, { dry: number; reefer: number }> = {
  '20': { dry: 2300, reefer: 3000 },
  '40': { dry: 3750, reefer: 4500 },
  '40HC': { dry: 3900, reefer: 4800 },
}

/** [A] Reefer setpoints (deg C), chosen by weight: frozen, chilled, fruit. */
const REEFER_SETPOINTS: [number, number][] = [
  [-25, 1],
  [-18, 5],
  [2, 3],
  [13, 1],
]

/** [A] Vessel work rate behind the ETD estimate (moves per STS per hour) and the berth-to-sail allowance (s). */
const ETD_MOVES_PER_STS_HOUR = 25
const ETD_ALLOWANCE_S = 1800

/** The configured settings, each falling back to its default. */
export function resolveContainerProps(config: Pick<ScenarioConfig, 'containerProps'>): Required<ContainerPropsConfig> {
  const c = config.containerProps ?? {}
  return {
    portRotation: c.portRotation ?? DEFAULT_PORT_ROTATION,
    directionMix: c.directionMix ?? DEFAULT_DIRECTION_MIX,
    cargoWeight: { ...DEFAULT_CARGO_WEIGHT, ...c.cargoWeight },
    weightClassBands: c.weightClassBands ?? DEFAULT_WEIGHT_BANDS,
    expectedDwell: { ...DEFAULT_EXPECTED_DWELL, ...c.expectedDwell },
  }
}

export function isoTypeOf(size: ContainerSize, reefer: boolean): string {
  const code = size === '20' ? '22' : size === '40' ? '42' : '45'
  return `${code}${reefer ? 'R1' : 'G1'}`
}

export function tareKgOf(size: ContainerSize, reefer: boolean): number {
  return reefer ? TARE_KG[size].reefer : TARE_KG[size].dry
}

export function weightClassOf(grossKg: number, bands: WeightClassBands): WeightClass {
  return grossKg <= bands.lightMaxKg ? 'LIGHT' : grossKg <= bands.mediumMaxKg ? 'MEDIUM' : 'HEAVY'
}

/** Gross weight (kg): tare plus cargo. */
export const grossKgOf = (p: Pick<ContainerProps, 'tareKg' | 'cargoKg'>): number => p.tareKg + p.cargoKg

/** Estimated sailing time (s) of a vessel call [A]: arrival, plus its moves at the crane rate, plus an allowance. */
export function vesselEtdS(v: Pick<VesselConfig, 'arrivalS' | 'discharge' | 'load' | 'transshipment' | 'maxSts' | 'empties'>): number {
  const moves = v.discharge + v.load + v.transshipment + (v.empties ?? []).reduce((n, e) => n + e.count, 0)
  return Math.round(v.arrivalS + ETD_ALLOWANCE_S + (moves / (Math.max(1, v.maxSts) * ETD_MOVES_PER_STS_HOUR)) * 3600)
}

/** Validation messages (empty = valid) for the configured settings. */
export function validateContainerProps(c: ContainerPropsConfig | undefined): string[] {
  if (!c) return []
  const out: string[] = []
  const r = c.portRotation
  if (r) {
    if (new Set(r.ports).size < 2) out.push('port rotation needs at least two distinct ports')
    if (!r.ports.includes(r.terminal)) out.push('port rotation must include the terminal')
  }
  const b = c.weightClassBands
  if (b && !(b.lightMaxKg > 0 && b.mediumMaxKg > b.lightMaxKg)) out.push('weight class bands must rise: 0 < light < medium')
  for (const w of Object.values(c.cargoWeight ?? {})) if (!(w.medianKg > 0 && w.sigma >= 0 && w.maxKg >= w.medianKg)) out.push('cargo weight needs 0 < median <= max and sigma >= 0')
  return out
}

function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The property stream of one box: independent of every other stream and of creation order. */
export function propsStream(seed: number, id: string): () => number {
  let state = hash32(`${seed >>> 0}:props:${id}`)
  return () => {
    const [value, next] = nextRandom(state)
    state = next
    return value
  }
}

const pickOne = <T>(items: readonly T[], rng: () => number): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]

export interface PropsInput {
  id: string
  size: ContainerSize
  full: boolean
  line: string
  reefer: boolean
  /** Set by the box's flow; null = draw it from the direction mix (an empty box discharged but not transshipment). */
  direction: TransitDirection | null
  inbound: CarrierRef
  /** The vessel that will take the box out (EXPORT and linked transshipment); absent = it leaves by truck (or a vessel outside this scenario). */
  outboundVesselId?: string
  /** Sim time the box arrives on the terminal (s). */
  arrivalS: number
  /** A booked truck appointment, when known: used when there is no outbound vessel. */
  appointmentS?: number
}

/** Draw every stored property of a new container. */
export function drawContainerProps(config: ScenarioConfig, seed: number, input: PropsInput): ContainerProps {
  const cfg = resolveContainerProps(config)
  const rng = propsStream(seed, input.id)
  // fixed draw order: direction, POL, POD, weight (two draws), setpoint, booking, dwell
  const directionDraw = rng()
  const direction: TransitDirection = input.direction ?? (input.full ? 'IMPORT' : pickWeightedFrom(cfg.directionMix, ['IMPORT', 'STORAGE'], directionDraw))
  if (direction === 'STORAGE' && input.full) throw new Error(`Container ${input.id}: a storage box is always empty`)
  const finalDirection = direction
  const { terminal, ports } = cfg.portRotation
  const others = ports.filter((p) => p !== terminal)
  const polDraw = rng()
  const podDraw = rng()
  let pol: string
  let pod: string
  switch (finalDirection) {
    case 'EXPORT':
      pol = terminal
      pod = pickOne(others, () => podDraw)
      break
    case 'TRANSSHIPMENT':
      pol = pickOne(others, () => polDraw)
      pod = pickOne(others.filter((p) => p !== pol).length > 0 ? others.filter((p) => p !== pol) : others, () => podDraw)
      break
    default: // IMPORT, STORAGE: came from another port, ends here
      pol = pickOne(others, () => polDraw)
      pod = terminal
  }
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  const spec = cfg.cargoWeight[input.size] as CargoWeightSpec
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const cargoKg = input.full ? Math.round(Math.min(spec.maxKg, Math.max(100, spec.medianKg * Math.exp(spec.sigma * normal))) / 10) * 10 : 0
  const tareKg = tareKgOf(input.size, input.reefer)
  const setpointDraw = rng()
  const bookingDraw = rng()
  const dwellDraw = rng()

  const outbound: CarrierRef = input.outboundVesselId
    ? { kind: 'vessel', id: input.outboundVesselId }
    : finalDirection === 'EXPORT' || finalDirection === 'TRANSSHIPMENT'
      ? { kind: 'vessel' }
      : { kind: 'truck' }
  const etdVessel = input.outboundVesselId ? config.vessels.find((v) => v.id === input.outboundVesselId) : undefined
  // never before the scenario starts: a box that has already stood longer than its expected dwell is due now
  const plannedDepartureS = Math.max(
    input.arrivalS,
    0,
    etdVessel
      ? vesselEtdS(etdVessel)
      : input.appointmentS !== undefined
        ? input.appointmentS
        : input.arrivalS + sampleDwell(cfg.expectedDwell[finalDirection] as DwellDistribution, () => dwellDraw),
  )
  const props: ContainerProps = {
    direction: finalDirection,
    isoType: isoTypeOf(input.size, input.reefer),
    pol,
    pod,
    tareKg,
    cargoKg,
    weightClass: weightClassOf(tareKg + cargoKg, cfg.weightClassBands),
    plannedDepartureS: Math.round(plannedDepartureS),
    inbound: { ...input.inbound },
    outbound,
    bookingRef: `${input.line}${String(Math.floor(bookingDraw * 1e7)).padStart(7, '0')}`,
    holds: [],
  }
  if (input.reefer) props.reeferSetpointC = pickSetpoint(setpointDraw)
  return props
}

function pickWeightedFrom(weights: Partial<Record<TransitDirection, number>>, allowed: TransitDirection[], draw: number): TransitDirection {
  const entries = allowed.map((d) => [d, weights[d] ?? 0] as const).filter(([, w]) => w > 0)
  if (entries.length === 0) return allowed[0]
  const total = entries.reduce((n, [, w]) => n + w, 0)
  let r = draw * total
  for (const [d, w] of entries) {
    r -= w
    if (r < 0) return d
  }
  return entries[entries.length - 1][0]
}

function pickSetpoint(draw: number): number {
  let r = draw * REEFER_SETPOINTS.reduce((n, [, w]) => n + w, 0)
  for (const [c, w] of REEFER_SETPOINTS) {
    r -= w
    if (r < 0) return c
  }
  return REEFER_SETPOINTS[REEFER_SETPOINTS.length - 1][0]
}

/**
 * An empty that a vessel work package allocated becomes an EXPORT for that vessel, still empty (spec #106): it now
 * starts here (POL = the terminal), goes to a port of the rotation (own stream, keyed by seed and id), and leaves on
 * that vessel at its ETD.
 */
export function allocateEmptyProps(config: ScenarioConfig, seed: number, id: string, props: ContainerProps, vesselId: string): ContainerProps {
  const vessel = config.vessels.find((v) => v.id === vesselId)
  const { terminal, ports } = resolveContainerProps(config).portRotation
  const others = ports.filter((p) => p !== terminal)
  return {
    ...props,
    direction: 'EXPORT',
    pol: terminal,
    pod: pickOne(others, propsStream(seed, `${id}#export`)),
    outbound: { kind: 'vessel', id: vesselId },
    plannedDepartureS: vessel ? vesselEtdS(vessel) : props.plannedDepartureS,
  }
}
