/**
 * Colour by (spec #116, ticket #130): which colour a box gets in a colour mode, and what the legend of a mode lists.
 * Pure TS (no Vue, no Three.js): the 3D renderer, the bay viewer and the menu all ask this module, so one value has
 * one colour everywhere.
 *
 * A `ColourSubject` is the plain data a mode needs about a box. `subjectOfBox` builds it from an engine
 * `ContainerState` (or the scene model's replayed custody) and the sim time, reusing the stored properties, the
 * transit status and the dwell functions of the engine; `colourOf` maps subject + time + mode to `{ key, hex }`, the
 * key being one of `legendOf(mode)`. Colours are the skin's data tokens (`--tt-data-*`, `--tt-ramp-*`), mirrored here
 * because three.js and the bay viewer's inline swatches cannot read CSS variables per instance (`tests/colour-by.test.ts`
 * keeps them in step).
 *
 * Modes: `default` (the line's livery, textured in 3D), `line`, `pod`, `weight`, `iso`, `special`, `flow`, `dwell`,
 * `departure`, `transit`, `call`, `length`. `dwell`, `departure` and `transit` depend on the sim time (`isTimeBased`).
 */
import atlas from '../assets/models/containers/livery-atlas.json'
import { terminalArrivalS, terminalExitS, transitStatus, type ContainerState, type TransitStatus, type TransitWorld } from '../engine'
import { resolveContainerProps, type WeightClass } from '../scenario/containerProps'
import type { ScenarioConfig } from '../scenario/types'

export type ColourBy = 'default' | 'line' | 'pod' | 'weight' | 'iso' | 'special' | 'flow' | 'dwell' | 'departure' | 'transit' | 'call' | 'length'
export const COLOUR_BY_MODES: readonly ColourBy[] = ['default', 'line', 'pod', 'weight', 'iso', 'length', 'special', 'flow', 'dwell', 'departure', 'transit', 'call']
export const DEFAULT_COLOUR_BY: ColourBy = 'default'

/** A stored mode (localStorage), or the default for anything else. */
export function parseColourBy(raw: unknown): ColourBy {
  return COLOUR_BY_MODES.find((m) => m === raw) ?? DEFAULT_COLOUR_BY
}

/** Modes whose colour changes as the sim clock runs (the renderer re-evaluates them every so often). */
export const isTimeBased = (mode: ColourBy): boolean => mode === 'dwell' || mode === 'departure' || mode === 'transit'

/** `--tt-data-0` .. `--tt-data-7`: categorical. */
export const DATA_PALETTE = ['#4c9be8', '#e8a33c', '#5cc08a', '#d9627a', '#9a7be0', '#3fb8c4', '#c9c04a', '#e07c4c'] as const
/** `--tt-ramp-0` .. `--tt-ramp-4`: light to dark, for ordered classes. */
export const RAMP_PALETTE = ['#9ed0f0', '#5aa9e0', '#2f7fc8', '#1f5aa0', '#163c70'] as const
/** `--tt-dwell-0` .. `--tt-dwell-3` (#140): light traffic-light ramp for dwell, green (under 1 day) to red (over 7 days). */
export const DWELL_PALETTE = ['#8fdca4', '#cfe77a', '#f6c65f', '#f28b82'] as const
/** `--tt-length-0` .. `--tt-length-2` (#140): light colours for 20 ft, 40 ft and 45 (40 ft high cube) boxes. */
export const LENGTH_PALETTE = ['#8ec9f2', '#c5aef0', '#f2aacb'] as const
/** `--tt-data-done`: no value. */
const UNKNOWN_HEX = '#8a97ab'
/** `--tt-data-rob` (#159): every remain-on-board box in every mode, 3D and bay viewer alike; a desaturated light grey, easy to ignore. */
export const ROB_HEX = '#c8cacd'
/** `--tt-data-3`: overdue. */
const OVERDUE_HEX = DATA_PALETTE[3]

/** What a mode needs about a box, in plain data. Absent fields give the mode's "unknown" colour. */
export interface ColourSubject {
  line: string
  full: boolean
  isoType?: string
  pod?: string
  weightClass?: WeightClass
  direction?: string
  /** Sim time (s) the box is planned to leave. */
  plannedDepartureS?: number
  /** Transit status at the asked time (the caller resolves it: it needs the carriers' state). */
  transit?: TransitStatus
  /** When the box first came into terminal custody, and left it again (null = not yet / still here). */
  arrivedS?: number | null
  leftS?: number | null
  /** The box is on a vessel call of this scenario (its inbound or outbound vessel is one of the scenario's). */
  onCall?: boolean
  /** A display-only remain-on-board box. */
  rob?: boolean
}

/** Scenario facts the legends need: the ports of the rotation, in rotation order. */
export interface ColourContext {
  ports: readonly string[]
}

export function colourContextOf(config: Pick<ScenarioConfig, 'containerProps'>): ColourContext {
  return { ports: resolveContainerProps(config).portRotation.ports }
}

export interface ColourEntry {
  key: string
  hex: string
}

/** ISO types the twin produces (`isoTypeOf`): 20 / 40 / 40 HC, dry and reefer. */
export const ISO_TYPES = ['22G1', '22R1', '42G1', '42R1', '45G1', '45R1'] as const

const LINES = atlas.liveries.filter((l) => l.line !== null)
const lineBody = (line: string): string | null => LINES.find((l) => l.line === line)?.body ?? null

const H = 3600
const D = 86400

interface ModeDef {
  keys(ctx: ColourContext): string[]
  keyOf(s: ColourSubject, t: number, ctx: ColourContext): string
  hexOf(key: string, ctx: ColourContext): string
}

const palette = (i: number): string => DATA_PALETTE[i % DATA_PALETTE.length]
const indexed =
  (all: (ctx: ColourContext) => readonly string[]) =>
  (key: string, ctx: ColourContext): string => {
    const i = all(ctx).indexOf(key)
    return i < 0 ? UNKNOWN_HEX : palette(i)
  }

const lineMode: ModeDef = {
  keys: () => [...LINES.map((l) => l.line as string), 'other'],
  keyOf: (s) => (lineBody(s.line) ? s.line : 'other'),
  hexOf: (key) => lineBody(key) ?? UNKNOWN_HEX,
}

/** [A] ISO 6346 type group (third character): R reefer, T tank (dangerous goods), U open top and P platform (out of gauge). The twin has no hazardous or out-of-gauge boxes yet; the classes are ready for them. */
function specialOf(iso: string | undefined): 'reefer' | 'hazardous' | 'oog' | 'standard' {
  switch (iso?.[2]) {
    case 'R':
      return 'reefer'
    case 'T':
      return 'hazardous'
    case 'U':
    case 'P':
      return 'oog'
    default:
      return 'standard'
  }
}

const FLOW_KEYS = ['import', 'export', 'transshipment', 'empty'] as const
const WEIGHT_KEYS = ['LIGHT', 'MEDIUM', 'HEAVY'] as const
const DWELL_KEYS = ['none', 'lt1d', 'lt3d', 'lt7d', 'gt7d'] as const
const LENGTH_KEYS = ['20', '40', '45'] as const
const DEPARTURE_KEYS = ['overdue', 'lt6h', 'lt24h', 'lt3d', 'later'] as const
const TRANSIT_KEYS: readonly TransitStatus[] = ['ADVISED', 'ARRIVED', 'ON_TERMINAL', 'LOADED', 'DEPARTED']

function dwellKey(s: ColourSubject, t: number): string {
  if (s.arrivedS === undefined || s.arrivedS === null) return 'none'
  const d = Math.max(0, (s.leftS ?? t) - s.arrivedS)
  return d < D ? 'lt1d' : d < 3 * D ? 'lt3d' : d < 7 * D ? 'lt7d' : 'gt7d'
}

/** [A] Length class from the ISO size code (first two characters): 22 = 20 ft, 42 = 40 ft, 45 = 40 ft high cube (the twin's "45"). */
function lengthKey(iso: string | undefined): string {
  const code = iso?.slice(0, 2)
  return code === '22' ? '20' : code === '42' ? '40' : code === '45' ? '45' : 'unknown'
}

function departureKey(s: ColourSubject, t: number): string {
  if (s.plannedDepartureS === undefined) return 'unknown'
  const left = s.plannedDepartureS - t
  return left <= 0 ? 'overdue' : left < 6 * H ? 'lt6h' : left < D ? 'lt24h' : left < 3 * D ? 'lt3d' : 'later'
}

const MODES: Record<ColourBy, ModeDef> = {
  default: lineMode,
  line: lineMode,
  pod: {
    keys: (ctx) => [...ctx.ports, 'other'],
    keyOf: (s, _t, ctx) => (s.pod !== undefined && ctx.ports.includes(s.pod) ? s.pod : 'other'),
    hexOf: indexed((ctx) => ctx.ports),
  },
  weight: {
    keys: () => [...WEIGHT_KEYS, 'unknown'],
    keyOf: (s) => s.weightClass ?? 'unknown',
    hexOf: (key) => (key === 'unknown' ? UNKNOWN_HEX : palette(WEIGHT_KEYS.indexOf(key as WeightClass) * 3)),
  },
  iso: {
    keys: () => [...ISO_TYPES, 'other'],
    keyOf: (s) => (s.isoType !== undefined && (ISO_TYPES as readonly string[]).includes(s.isoType) ? s.isoType : 'other'),
    hexOf: indexed(() => ISO_TYPES),
  },
  special: {
    keys: () => ['reefer', 'hazardous', 'oog', 'standard'],
    keyOf: (s) => specialOf(s.isoType),
    hexOf: (key) => (key === 'reefer' ? DATA_PALETTE[5] : key === 'hazardous' ? DATA_PALETTE[3] : key === 'oog' ? DATA_PALETTE[1] : UNKNOWN_HEX),
  },
  flow: {
    keys: () => [...FLOW_KEYS, 'unknown'],
    keyOf: (s) => (!s.full ? 'empty' : s.direction === 'IMPORT' ? 'import' : s.direction === 'EXPORT' ? 'export' : s.direction === 'TRANSSHIPMENT' ? 'transshipment' : 'unknown'),
    hexOf: (key) => (key === 'import' ? DATA_PALETTE[0] : key === 'export' ? DATA_PALETTE[1] : key === 'transshipment' ? DATA_PALETTE[4] : key === 'empty' ? DATA_PALETTE[2] : UNKNOWN_HEX),
  },
  dwell: {
    keys: () => [...DWELL_KEYS],
    keyOf: (s, t) => dwellKey(s, t),
    hexOf: (key) => (key === 'none' ? UNKNOWN_HEX : DWELL_PALETTE[DWELL_KEYS.indexOf(key as (typeof DWELL_KEYS)[number]) - 1]),
  },
  length: {
    keys: () => [...LENGTH_KEYS, 'unknown'],
    keyOf: (s) => lengthKey(s.isoType),
    hexOf: (key) => (key === 'unknown' ? UNKNOWN_HEX : LENGTH_PALETTE[LENGTH_KEYS.indexOf(key as (typeof LENGTH_KEYS)[number])]),
  },
  departure: {
    keys: () => [...DEPARTURE_KEYS, 'unknown'],
    keyOf: (s, t) => departureKey(s, t),
    hexOf: (key) => (key === 'overdue' ? OVERDUE_HEX : key === 'unknown' ? UNKNOWN_HEX : RAMP_PALETTE[4 - (DEPARTURE_KEYS.indexOf(key as (typeof DEPARTURE_KEYS)[number]) - 1)]),
  },
  transit: {
    keys: () => [...TRANSIT_KEYS, 'unknown'],
    keyOf: (s) => s.transit ?? 'unknown',
    hexOf: (key) => (key === 'unknown' ? UNKNOWN_HEX : palette(TRANSIT_KEYS.indexOf(key as TransitStatus))),
  },
  call: {
    keys: () => ['call', 'other'],
    keyOf: (s) => (s.onCall ? 'call' : 'other'),
    hexOf: (key) => (key === 'call' ? DATA_PALETTE[0] : UNKNOWN_HEX),
  },
}

/** The colour of a box in a mode at sim time `t`; its `key` is an entry of `legendOf(mode, ctx)`. A ROB box is `rob` in every mode (#159). */
export function colourOf(mode: ColourBy, subject: ColourSubject, t: number, ctx: ColourContext): ColourEntry {
  if (subject.rob) return { key: 'rob', hex: ROB_HEX }
  const def = MODES[mode]
  const key = def.keyOf(subject, t, ctx)
  return { key, hex: def.hexOf(key, ctx) }
}

/** Every value the mode can produce, with its colour; `rob` (remain on board) last in every mode. */
export function legendOf(mode: ColourBy, ctx: ColourContext): ColourEntry[] {
  const def = MODES[mode]
  return [...def.keys(ctx).map((key) => ({ key, hex: def.hexOf(key, ctx) })), { key: 'rob', hex: ROB_HEX }]
}

/** `#rrggbb` as a number, for three.js. */
export const hexToInt = (hex: string): number => parseInt(hex.slice(1), 16)

type HistoryBox = Pick<ContainerState, 'custody' | 'custodyHistory' | 'yardSince'>

/**
 * The subject of an engine box at sim time `t`. Only the custody records up to `t` count, so the scene (which holds
 * a box's whole replayed run) and the live engine (where all records are in the past) agree.
 */
export function subjectOfBox(
  box: Pick<ContainerState, 'line' | 'full'> & HistoryBox & Partial<Pick<ContainerState, 'props'>>,
  world: TransitWorld,
  t: number,
  opts: { vessels?: ReadonlySet<string> } = {},
): ColourSubject {
  const hist = box.custodyHistory
  let n = hist.length
  while (n > 0 && hist[n - 1].t > t) n--
  const at: HistoryBox = n === hist.length || n === 0 ? box : { custody: hist[n - 1].owner, custodyHistory: hist.slice(0, n), yardSince: box.yardSince }
  const p = box.props
  const onCall = (c: { kind: string; id?: string } | undefined): boolean => c?.kind === 'vessel' && c.id !== undefined && (opts.vessels ? opts.vessels.has(c.id) : true)
  return {
    line: box.line,
    full: box.full,
    ...(p ? { isoType: p.isoType, pod: p.pod, weightClass: p.weightClass, direction: p.direction, plannedDepartureS: p.plannedDepartureS } : {}),
    transit: transitStatus(at as ContainerState, world),
    arrivedS: terminalArrivalS(at as ContainerState),
    leftS: terminalExitS(at as ContainerState),
    onCall: p ? onCall(p.inbound) || onCall(p.outbound) : false,
  }
}
