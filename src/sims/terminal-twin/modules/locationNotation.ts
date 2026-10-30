/**
 * Maritime location notation (TT-R08): how the UI names a vessel or yard slot. Display only: internal slot ids
 * (`V1:03-04-05a`, `B01:02-3-1`), the engine API, saves and goldens keep their own form.
 *
 *  - Vessel: `VESSEL.V<nn>.<bay>.<row>.<tier>`, e.g. `VESSEL.V01.04.02.82`.
 *    Bays count from the bow. An odd bay is a 20 ft half cell, the even bay between two odd ones is the 40 ft cell
 *    (cell k from the bow: fore half 2k-1, 40 ft cell 2k, aft half 2k+1). Row 00 is the centreline of an odd beam,
 *    starboard rows are odd and port rows even, counting outwards. A ship lies port side to the quay (the quay side,
 *    internal row 0, is port). Tiers: hold 02, 04, ...; deck 82, 84, ....
 *  - Yard: `YARD.B<nn>.<bay>.<row>.<tier>`, e.g. `YARD.B01.03.02.1`. Same bay convention (a 20 ft box in internal bay
 *    b is bay 2b-1, a 40 ft box anchored there is bay 2b), two-digit row, one-digit tier.
 */
import type { ContainerSize, ScenarioConfig } from '../scenario/types'
import { parseVesselSlotId, VESSEL_CLASSES } from '../scenario/vesselClasses'
import { parseYardSlotId } from '../engine'

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The trailing number of an id (`V3` is 3, `B01` is 1), or the 1-based position when it has none. */
function numberOf(id: string, index: number): number {
  const m = /(\d+)$/.exec(id)
  return m ? Number(m[1]) : index + 1
}

/** Maritime bay of a vessel cell. `bay` counts 40 ft bays from the stern (0 = aft); `bays` is their number. */
export function vesselBayNumber(bay: number, bays: number, half: 'aft' | 'fore' | null): number {
  const fromBow = bays - 1 - bay // 0 = the bow-most cell
  const even = 2 * (fromBow + 1)
  return half === 'fore' ? even - 1 : half === 'aft' ? even + 1 : even
}

/** Maritime row of an internal row (0 = quay side = port, counting seaward = towards starboard). */
export function vesselRowNumber(row: number, rows: number): number {
  if (rows % 2 === 1) {
    const c = (rows - 1) / 2
    return row === c ? 0 : row > c ? 2 * (row - c) - 1 : 2 * (c - row)
  }
  const h = rows / 2
  return row >= h ? 2 * (row - h) + 1 : 2 * (h - 1 - row) + 2
}

/** Maritime tier of an internal tier (0 = bottom of the hold): hold 02, 04, ...; deck 82, 84, .... */
export function vesselTierNumber(tier: number, holdTiers: number): number {
  return tier < holdTiers ? 2 * (tier + 1) : 82 + 2 * (tier - holdTiers)
}

/** Maritime bay of a yard box: odd for a 20 ft box, the even bay between two odd ones for a 40 ft box. */
export function yardBayNumber(bay: number, size: ContainerSize): number {
  return size === '20' ? 2 * bay - 1 : 2 * bay
}

export interface FormattedLocation {
  /** `VESSEL.V01.04.02.82` or `YARD.B01.03.02.1`. */
  notation: string
  /** The vessel's name for a vessel location (shown beside the notation). */
  vesselName?: string
  /** What the UI shows: `MSC Aurora · VESSEL.V01.04.02.82` for a vessel, the notation for the yard. */
  text: string
}

export interface LocationNotation {
  /** A vessel slot id, or null when the id is not one of this scenario's. */
  vesselSlot(slotId: string): FormattedLocation | null
  /** A yard slot id; `size` picks the 20 ft or 40 ft bay number (default 20). */
  yardSlot(slotId: string, size?: ContainerSize): FormattedLocation | null
  /** A custody owner as text: slots in notation, any other owner as `kind:id`. */
  owner(kind: string, id: string, size?: ContainerSize): string
  /** Every slot id found in `text`, with its notation (for an event payload). `sizeOf` maps a container id to its size. */
  scan(text: string, sizeOf?: (containerId: string) => ContainerSize | undefined): { id: string; text: string }[]
}

const VESSEL_ID = /[A-Za-z0-9_-]+:\d{2}-\d{2}-\d{2}[af]?/g
const YARD_ID = /[A-Za-z0-9_-]+:\d{2}-\d+-\d+/g

export function createLocationNotation(config: Pick<ScenarioConfig, 'vessels' | 'yard'>): LocationNotation {
  const vessels = new Map(config.vessels.map((v, i) => [v.id, { v, no: numberOf(v.id, i) }]))
  const blocks = new Map((config.yard?.blocks ?? []).map((b, i) => [b.id, numberOf(b.id, i)]))

  function vesselSlot(slotId: string): FormattedLocation | null {
    let p: ReturnType<typeof parseVesselSlotId>
    try {
      p = parseVesselSlotId(slotId)
    } catch {
      return null
    }
    const entry = vessels.get(p.vesselId)
    if (!entry) return null
    const spec = VESSEL_CLASSES[entry.v.sizeClass]
    const notation = `VESSEL.V${pad2(entry.no)}.${pad2(vesselBayNumber(p.bay, spec.bays, p.half))}.${pad2(vesselRowNumber(p.row, spec.rows))}.${pad2(vesselTierNumber(p.tier, spec.holdTiers))}`
    return { notation, vesselName: entry.v.name, text: `${entry.v.name} · ${notation}` }
  }

  function yardSlot(slotId: string, size: ContainerSize = '20'): FormattedLocation | null {
    let c: ReturnType<typeof parseYardSlotId>
    try {
      c = parseYardSlotId(slotId)
    } catch {
      return null
    }
    const no = blocks.get(c.blockId)
    if (no === undefined) return null
    const notation = `YARD.B${pad2(no)}.${pad2(yardBayNumber(c.bay, size))}.${pad2(c.row)}.${c.tier}`
    return { notation, text: notation }
  }

  return {
    vesselSlot,
    yardSlot,
    owner(kind, id, size) {
      const f = kind === 'vesselSlot' ? vesselSlot(id) : kind === 'yardSlot' ? yardSlot(id, size) : null
      return f ? f.text : `${kind}:${id}`
    },
    scan(text, sizeOf) {
      const out: { id: string; text: string }[] = []
      const seen = new Set<string>()
      const box = /"containerId": "([^"]+)"/.exec(text)?.[1]
      const size = box ? sizeOf?.(box) : undefined
      for (const m of text.matchAll(VESSEL_ID)) {
        const f = vesselSlot(m[0])
        if (f && !seen.has(m[0])) {
          seen.add(m[0])
          out.push({ id: m[0], text: f.text })
        }
      }
      for (const m of text.matchAll(YARD_ID)) {
        const f = yardSlot(m[0], size)
        if (f && !seen.has(m[0])) {
          seen.add(m[0])
          out.push({ id: m[0], text: f.text })
        }
      }
      return out
    },
  }
}
