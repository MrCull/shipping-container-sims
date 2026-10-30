/**
 * Bay viewer view-model (spec #106, #115): pure TS, no Vue, no Three.js. Turns a vessel's slots, the boxes in or
 * booked to them, the work-package state and the ROB list into one bay at a time as hold and deck cross-sections
 * (row x tier): cells with a status, a colour key and hover details, plus the bay strip, bay navigation and the
 * bay's work packages. The component only draws what this returns.
 *
 * Cell status:
 *  - planned discharge: a box still in its slot, waiting to come off;
 *  - planned load: a slot booked for a box (or an empty) that has not been loaded yet;
 *  - in progress: the box hangs from an STS spreader right now (lifted from its slot, or on its way to it);
 *  - done: a discharged slot that is empty again, or a load slot that now holds its box;
 *  - ROB: a display-only remain-on-board box (never worked here);
 *  - empty: nothing planned.
 * Positions use the maritime notation (`modules/locationNotation.ts`): bay, row and tier numbers on the axes, the
 * notation of each slot in the hover details (through the `locate` callback).
 */
import type { CustodyKind, VesselSlotState, VesselStatus, WorkPackage } from '../engine'
import type { RobBox } from '../scenario/robBays'
import type { ContainerSize, VesselSizeClass } from '../scenario/types'
import { vesselSlotId, VESSEL_CLASSES, type CellHalf } from '../scenario/vesselClasses'
import { vesselBayNumber, vesselRowNumber, vesselTierNumber } from './locationNotation'

export type CellStatus = 'planned-discharge' | 'planned-load' | 'in-progress' | 'done' | 'rob' | 'empty'
export const CELL_STATUSES: readonly CellStatus[] = ['planned-discharge', 'planned-load', 'in-progress', 'done', 'rob', 'empty']

/** What the cells are coloured by: the state, or a box property (to check the stowage logic). */
export type ColourMode = 'status' | 'pod' | 'weight' | 'line'
export const COLOUR_MODES: readonly ColourMode[] = ['status', 'pod', 'weight', 'line']

/** A box in or booked to a slot, as the host reports it (properties are absent on a snapshot from before spec #106). */
export interface BayBox {
  id: string
  size: ContainerSize
  line: string
  full: boolean
  /** Custody kind now: `sts` means it hangs from a spreader. */
  custody: CustodyKind
  isoType?: string
  pol?: string
  pod?: string
  weightClass?: 'LIGHT' | 'MEDIUM' | 'HEAVY'
  grossKg?: number
  direction?: string
}

/** Everything the viewer needs about one vessel, in plain data (a worker query result). */
export interface BayViewData {
  vesselId: string
  sizeClass: VesselSizeClass
  status: VesselStatus
  slots: VesselSlotState[]
  /** The box a slot holds, held, or is booked for, by slot id. */
  boxes: Record<string, BayBox>
  packages: WorkPackage[]
  robBoxes: RobBox[]
}

export interface BayViewOptions {
  colourMode: ColourMode
  /** Maritime notation of a vessel slot id (default: the id itself). */
  locate?: (slotId: string) => string
}

/** What a hover shows. Everything but `slotId`, `location` and `status` is absent when unknown. */
export interface CellDetails {
  slotId: string
  location: string
  status: CellStatus
  boxId?: string
  size?: ContainerSize
  line?: string
  full?: boolean
  isoType?: string
  pol?: string
  pod?: string
  weightClass?: 'LIGHT' | 'MEDIUM' | 'HEAVY'
  grossKg?: number
  direction?: string
  /** A slot booked for an empty: the requirement (ISO type and line). */
  emptyFor?: { isoType?: string; line: string; size: ContainerSize }
}

export interface BayCell {
  slotId: string
  half: CellHalf
  status: CellStatus
  /** What the colour mode groups by (`pod`: `ESVLC`, `weight`: `HEAVY`, `status`: the status); null = no box, no colour. */
  colourKey: string | null
  /** Stable palette index of the colour key (same key, same index, in every bay of the vessel); null = no colour. */
  colourIndex: number | null
  details: CellDetails
}

/** One (row, tier) position: a whole 40 ft cell (one cell) or two 20 ft halves, aft first. */
export interface BayPosition {
  row: number
  tier: number
  cells: BayCell[]
}

export interface BayTierRow {
  tier: number
  /** Maritime tier number (hold 02, 04, ...; deck 82, 84, ...). */
  number: number
  /** One per row, quay side (port) first. */
  positions: BayPosition[]
}

export interface BaySection {
  deck: boolean
  /** Maritime row number of each column, port side first. */
  rowNumbers: number[]
  /** Top tier first. */
  tiers: BayTierRow[]
}

export interface StripEntry {
  /** Internal bay index (0 = aft). */
  bay: number
  /** Maritime bay number (the 40 ft bay is the even one). */
  number: number
  rob: boolean
  /** `empty`: nothing to work; `idle`: work to do, none done; `active`: some done; `complete`: all done. */
  state: 'rob' | 'empty' | 'idle' | 'active' | 'complete'
  done: number
  total: number
}

export interface PackageRow {
  id: string
  kind: WorkPackage['kind']
  section: 'deck' | 'hold'
  status: WorkPackage['status']
  stsId: string
  seq: number
  /** Boxes done and planned in this bay section (discharge and load packages; null for a hatch step). */
  done: number | null
  total: number | null
}

export interface LegendEntry {
  key: string
  /** Palette index, null for the fixed state colours of the status mode. */
  index: number | null
}

export interface BayView {
  vesselId: string
  /** Internal bay index shown (0 = aft). */
  bay: number
  /** Maritime bay number of the 40 ft bay. */
  bayNumber: number
  rob: boolean
  /** Deck first, then hold. */
  sections: BaySection[]
  counts: Record<CellStatus, number>
  packages: PackageRow[]
  /** Bay strip, bow first (maritime bay number ascending). */
  strip: StripEntry[]
  /** Internal indices of the neighbours towards the bow / the stern, null at the ends. */
  prev: number | null
  next: number | null
  legend: LegendEntry[]
  colourMode: ColourMode
}

const WEIGHT_KEYS = ['LIGHT', 'MEDIUM', 'HEAVY'] as const

/** Status of a slot (not a ROB box). `box` is the box in or booked to it. */
export function slotStatus(slot: Pick<VesselSlotState, 'purpose' | 'containerId' | 'plannedContainerId' | 'emptyReq'>, box: Pick<BayBox, 'custody'> | undefined): CellStatus {
  if (slot.purpose === 'discharge') {
    if (slot.containerId !== null) return 'planned-discharge'
    return box?.custody === 'sts' ? 'in-progress' : 'done'
  }
  if (slot.containerId !== null) return 'done'
  if (slot.plannedContainerId || slot.emptyReq) return box?.custody === 'sts' ? 'in-progress' : 'planned-load'
  return 'empty'
}

/** Bays of a vessel class, bow first (`strip` order), as internal indices. */
export function bayOrder(sizeClass: VesselSizeClass): number[] {
  const n = VESSEL_CLASSES[sizeClass].bays
  return Array.from({ length: n }, (_, i) => n - 1 - i)
}

/** The neighbour of `bay` towards the bow (`-1`) or the stern (`+1`) in strip order; null at the ends or for an unknown bay. */
export function stepBay(sizeClass: VesselSizeClass, bay: number, direction: -1 | 1): number | null {
  const order = bayOrder(sizeClass)
  const i = order.indexOf(bay)
  if (i < 0) return null
  return order[i + direction] ?? null
}

/** The first bay that has work to do (or is being worked), else the bow-most bay: where the viewer opens. */
export function defaultBay(data: BayViewData): number {
  const order = bayOrder(data.sizeClass)
  const entries = stripOf(data)
  const active = entries.find((e) => e.state === 'active') ?? entries.find((e) => e.state === 'idle')
  return active ? active.bay : order[0]
}

function slotBox(data: BayViewData, slot: VesselSlotState): BayBox | undefined {
  return data.boxes[slot.id]
}

/** The bay strip: one entry per bay, bow first, with progress. */
export function stripOf(data: BayViewData): StripEntry[] {
  const spec = VESSEL_CLASSES[data.sizeClass]
  const robBays = new Set(data.robBoxes.map((b) => b.bay))
  const total = new Map<number, number>()
  const done = new Map<number, number>()
  for (const s of data.slots) {
    const st = slotStatus(s, slotBox(data, s))
    if (st === 'empty') continue
    total.set(s.bay, (total.get(s.bay) ?? 0) + 1)
    if (st === 'done') done.set(s.bay, (done.get(s.bay) ?? 0) + 1)
  }
  return bayOrder(data.sizeClass).map((bay) => {
    const t = total.get(bay) ?? 0
    const d = done.get(bay) ?? 0
    const rob = robBays.has(bay)
    const state: StripEntry['state'] = rob && t === 0 ? 'rob' : t === 0 ? 'empty' : d === 0 ? 'idle' : d === t ? 'complete' : 'active'
    return { bay, number: vesselBayNumber(bay, spec.bays, null), rob, state, done: d, total: t }
  })
}

/** Palette indices of the colour keys of a mode, stable over the whole vessel. */
function colourKeys(data: BayViewData, mode: ColourMode): string[] {
  if (mode === 'status') return []
  if (mode === 'weight') return [...WEIGHT_KEYS]
  const keys = new Set<string>()
  for (const b of Object.values(data.boxes)) {
    const k = mode === 'pod' ? b.pod : b.line
    if (k) keys.add(k)
  }
  for (const b of data.robBoxes) keys.add(mode === 'pod' ? b.pod : b.line)
  return [...keys].sort()
}

function keyOf(mode: ColourMode, status: CellStatus, d: { pod?: string; line?: string; weightClass?: string }): string | null {
  if (mode === 'status') return status === 'empty' ? null : status
  const k = mode === 'pod' ? d.pod : mode === 'weight' ? d.weightClass : d.line
  return k ?? null
}

/** One bay of a vessel as cross-sections, strip and package list. */
export function buildBayView(data: BayViewData, bay: number, opts: BayViewOptions): BayView {
  const spec = VESSEL_CLASSES[data.sizeClass]
  if (!(bay >= 0 && bay < spec.bays)) throw new Error(`Bay ${bay} is not a bay of a ${data.sizeClass}`)
  const locate = opts.locate ?? ((id: string) => id)
  const keys = colourKeys(data, opts.colourMode)
  const indexOf = (key: string | null): number | null => {
    if (key === null || opts.colourMode === 'status') return null
    const i = keys.indexOf(key)
    return i < 0 ? null : i
  }

  const slotsHere = new Map<string, VesselSlotState[]>()
  for (const s of data.slots) {
    if (s.bay !== bay) continue
    const k = `${s.row}:${s.tier}`
    slotsHere.set(k, [...(slotsHere.get(k) ?? []), s])
  }
  const robHere = new Map<string, RobBox[]>()
  for (const b of data.robBoxes) {
    if (b.bay !== bay) continue
    const k = `${b.row}:${b.tier}`
    robHere.set(k, [...(robHere.get(k) ?? []), b])
  }

  const counts = Object.fromEntries(CELL_STATUSES.map((s) => [s, 0])) as Record<CellStatus, number>
  const allCells: { cell: BayCell; deck: boolean; purpose: VesselSlotState['purpose'] | null }[] = []

  const emptyCell = (row: number, tier: number, half: CellHalf): BayCell => {
    const slotId = vesselSlotId(data.vesselId, bay, row, tier, half)
    return {
      slotId,
      half,
      status: 'empty',
      colourKey: null,
      colourIndex: null,
      details: { slotId, location: locate(slotId), status: 'empty' },
    }
  }
  const cellOfSlot = (s: VesselSlotState): BayCell => {
    const box = slotBox(data, s)
    const status = slotStatus(s, box)
    const details: CellDetails = { slotId: s.id, location: locate(s.id), status }
    if (box) {
      Object.assign(details, {
        boxId: box.id,
        size: box.size,
        line: box.line,
        full: box.full,
        ...(box.isoType ? { isoType: box.isoType } : {}),
        ...(box.pol ? { pol: box.pol } : {}),
        ...(box.pod ? { pod: box.pod } : {}),
        ...(box.weightClass ? { weightClass: box.weightClass } : {}),
        ...(box.grossKg !== undefined ? { grossKg: box.grossKg } : {}),
        ...(box.direction ? { direction: box.direction } : {}),
      })
    } else if (s.emptyReq) {
      details.emptyFor = { isoType: s.emptyReq.isoType, line: s.emptyReq.line, size: s.emptyReq.size }
      details.line = s.emptyReq.line
    }
    const colourKey = status === 'empty' ? null : keyOf(opts.colourMode, status, details)
    return { slotId: s.id, half: s.half, status, colourKey, colourIndex: indexOf(colourKey), details }
  }
  const cellOfRob = (b: RobBox): BayCell => {
    const details: CellDetails = {
      slotId: b.slotId,
      location: locate(b.slotId),
      status: 'rob',
      size: b.size,
      line: b.line,
      full: b.full,
      isoType: b.isoType,
      pod: b.pod,
      weightClass: b.weightClass,
      grossKg: b.grossKg,
    }
    const colourKey = keyOf(opts.colourMode, 'rob', details)
    return { slotId: b.slotId, half: b.half, status: 'rob', colourKey, colourIndex: indexOf(colourKey), details }
  }

  const positionOf = (row: number, tier: number, deck: boolean): BayPosition => {
    const k = `${row}:${tier}`
    const own = (slotsHere.get(k) ?? []).map((s) => ({ cell: cellOfSlot(s), purpose: s.purpose as VesselSlotState['purpose'] | null }))
    const rob = (robHere.get(k) ?? []).map((b) => ({ cell: cellOfRob(b), purpose: null as VesselSlotState['purpose'] | null }))
    const found = [...own, ...rob]
    let cells: BayCell[]
    const whole = found.find((f) => f.cell.half === null)
    if (whole) cells = [whole.cell]
    else if (found.length === 0) cells = [emptyCell(row, tier, null)]
    else cells = [found.find((f) => f.cell.half === 'aft')?.cell ?? emptyCell(row, tier, 'aft'), found.find((f) => f.cell.half === 'fore')?.cell ?? emptyCell(row, tier, 'fore')]
    for (const c of cells) {
      counts[c.status]++
      const f = found.find((x) => x.cell === c)
      allCells.push({ cell: c, deck, purpose: f?.purpose ?? null })
    }
    return { row, tier, cells }
  }

  const rowNumbers = Array.from({ length: spec.rows }, (_, r) => vesselRowNumber(r, spec.rows))
  const section = (deck: boolean): BaySection => {
    const first = deck ? spec.holdTiers : 0
    const last = deck ? spec.holdTiers + spec.deckTiers - 1 : spec.holdTiers - 1
    const tiers: BayTierRow[] = []
    for (let tier = last; tier >= first; tier--) {
      tiers.push({ tier, number: vesselTierNumber(tier, spec.holdTiers), positions: Array.from({ length: spec.rows }, (_, row) => positionOf(row, tier, deck)) })
    }
    return { deck, rowNumbers, tiers }
  }
  const sections = [section(true), section(false)]

  const packages = data.packages
    .filter((p) => p.vesselId === data.vesselId && p.bay === bay)
    .sort((a, b) => (a.stsId < b.stsId ? -1 : a.stsId > b.stsId ? 1 : a.seq - b.seq))
    .map((p) => {
      const deck = p.section === 'deck'
      const mine = allCells.filter((c) => c.deck === deck && (p.kind === 'discharge' ? c.purpose === 'discharge' : p.kind === 'load' ? c.purpose !== null && c.purpose !== 'discharge' : false))
      const hatch = p.kind === 'hatch-remove' || p.kind === 'hatch-replace'
      const planned = mine.filter((c) => c.cell.status !== 'empty')
      return {
        id: p.id,
        kind: p.kind,
        section: p.section,
        status: p.status,
        stsId: p.stsId,
        seq: p.seq,
        done: hatch ? null : planned.filter((c) => c.cell.status === 'done').length,
        total: hatch ? null : planned.length,
      } satisfies PackageRow
    })

  const strip = stripOf(data)
  const legend: LegendEntry[] = opts.colourMode === 'status' ? CELL_STATUSES.map((key) => ({ key, index: null })) : keys.map((key, index) => ({ key, index }))
  return {
    vesselId: data.vesselId,
    bay,
    bayNumber: vesselBayNumber(bay, spec.bays, null),
    rob: strip.find((e) => e.bay === bay)?.rob ?? false,
    sections,
    counts,
    packages,
    strip,
    prev: stepBay(data.sizeClass, bay, -1),
    next: stepBay(data.sizeClass, bay, 1),
    legend,
    colourMode: opts.colourMode,
  }
}
