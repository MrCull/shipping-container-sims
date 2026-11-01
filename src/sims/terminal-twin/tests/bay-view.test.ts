/**
 * Bay viewer view-model (spec #106, #115): a vessel's slots, boxes, work packages and ROB list become the cells of one
 * bay at a time. Pure functions over plain data; the headless engine supplies the data (`collectBayViewData`).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import { VESSEL_CLASSES, vesselSlotId } from '../scenario/vesselClasses'
import type { VesselSlotState } from '../engine'
import { buildBayView, bayOrder, CELL_STATUSES, defaultBay, slotStatus, stepBay, stripOf, type BayBox, type BayCell, type BayView, type BayViewData, type ColourMode } from '../modules/bayView'
import { collectBayViewData } from '../modules/bayViewData'
import { COLOUR_BY_MODES, ROB_HEX, colourContextOf, legendOf } from '../modules/colourBy'
import { createLocationNotation } from '../modules/locationNotation'

const config = fixtures['rob-bays'] as ScenarioConfig
const spec = VESSEL_CLASSES.feeder
const make = (): Simulation => createSimulation(config, {}, { invariants: { sweepEvery: 500 } })

const dataOf = (sim: Simulation, vesselId = 'V001'): BayViewData => collectBayViewData(sim.query, vesselId, config)
const allCells = (v: BayView): BayCell[] => v.sections.flatMap((s) => s.tiers.flatMap((t) => t.positions.flatMap((p) => p.cells)))
const view = (data: BayViewData, bay: number, colourMode: ColourMode = 'status'): BayView => buildBayView(data, bay, { colourMode })
/** Every bay's cells, summed over the statuses. */
const totals = (data: BayViewData, mode: ColourMode = 'status'): Record<string, number> => {
  const sum: Record<string, number> = Object.fromEntries(CELL_STATUSES.map((s) => [s, 0]))
  for (const bay of bayOrder(data.sizeClass)) for (const c of allCells(view(data, bay, mode))) sum[c.status]++
  return sum
}
const worked = (data: BayViewData): number => data.slots.filter((s) => s.purpose === 'discharge' || s.containerId !== null || s.plannedContainerId || s.emptyReq).length

describe('slot status', () => {
  const slot = (o: Partial<Parameters<typeof slotStatus>[0]>): Parameters<typeof slotStatus>[0] => ({ purpose: 'discharge', containerId: null, ...o })
  it('discharge: planned while the box is in its slot, in progress while it hangs from a crane, done after', () => {
    expect(slotStatus(slot({ containerId: 'C1' }), { custody: 'vesselSlot' })).toBe('planned-discharge')
    expect(slotStatus(slot({}), { custody: 'sts' })).toBe('in-progress')
    expect(slotStatus(slot({}), { custody: 'groundPosition' })).toBe('done')
    expect(slotStatus(slot({}), undefined)).toBe('done')
  })
  it('load: planned while booked, in progress on the spreader, done once the slot holds the box; unbooked is empty', () => {
    expect(slotStatus(slot({ purpose: 'load', plannedContainerId: 'C2' }), { custody: 'yardSlot' })).toBe('planned-load')
    expect(slotStatus(slot({ purpose: 'load', plannedContainerId: 'C2' }), { custody: 'sts' })).toBe('in-progress')
    expect(slotStatus(slot({ purpose: 'load', plannedContainerId: 'C2', containerId: 'C2' }), { custody: 'vesselSlot' })).toBe('done')
    expect(slotStatus(slot({ purpose: 'load', emptyReq: { index: 0, size: '20', line: 'MSC' } }), undefined)).toBe('planned-load')
    expect(slotStatus(slot({ purpose: 'load' }), undefined)).toBe('empty')
    expect(slotStatus(slot({ purpose: 'transshipment', plannedContainerId: 'C3' }), { custody: 'yardSlot' })).toBe('planned-load')
  })
})

describe('bay view of a running vessel', () => {
  const sim = make()
  const before = dataOf(sim)

  it('shows hold and deck cross-sections of rows x tiers, deck on top, with maritime axis numbers', () => {
    const bay = bayOrder('feeder').find((b) => !before.robBoxes.some((r) => r.bay === b))!
    const v = view(before, bay)
    expect(v.sections.map((s) => s.deck)).toEqual([true, false])
    const [deck, hold] = v.sections
    expect(deck.tiers).toHaveLength(spec.deckTiers)
    expect(hold.tiers).toHaveLength(spec.holdTiers)
    expect(deck.tiers.map((t) => t.number)).toEqual([86, 84, 82])
    expect(hold.tiers.map((t) => t.number)).toEqual([8, 6, 4, 2])
    expect(deck.rowNumbers).toEqual([8, 6, 4, 2, 1, 3, 5, 7]) // port (quay side) first, then starboard
    for (const t of [...deck.tiers, ...hold.tiers]) expect(t.positions).toHaveLength(spec.rows)
    expect(v.bayNumber % 2).toBe(0)
  })

  it('starts with planned discharge and planned load cells, nothing done or in progress, and counts them', () => {
    const t = totals(before)
    expect(t['planned-discharge']).toBeGreaterThan(0)
    expect(t['planned-load']).toBeGreaterThan(0)
    expect(t['in-progress'] + t.done).toBe(0)
    expect(t.rob).toBe(before.robBoxes.length)
    expect(t['planned-discharge'] + t['planned-load']).toBe(worked(before))
  })

  it('shows ROB bays as ROB cells only, with POD, line and weight class in the hover details', () => {
    const robBay = before.robBoxes[0].bay
    const v = view(before, robBay)
    expect(v.rob).toBe(true)
    const cells = allCells(v)
    expect(cells.filter((c) => c.status === 'rob').length).toBe(before.robBoxes.filter((b) => b.bay === robBay).length)
    expect(cells.every((c) => c.status === 'rob' || c.status === 'empty')).toBe(true)
    expect(v.packages).toEqual([]) // a ROB bay is never worked
    const box = cells.find((c) => c.status === 'rob')!
    expect(box.details).toMatchObject({ status: 'rob', pod: expect.stringMatching(/^[A-Z]{5}$/), line: expect.any(String), weightClass: expect.stringMatching(/LIGHT|MEDIUM|HEAVY/), isoType: expect.stringMatching(/G1$/) })
    expect(box.details.slotId).toBe(box.slotId)
  })

  it('goes planned, in progress, done as the run proceeds, and ends with everything worked done', () => {
    const slot = before.slots.find((s) => s.purpose === 'discharge' && s.containerId)!
    const cellOf = (data: BayViewData): BayCell => allCells(view(data, slot.bay)).find((c) => c.slotId === slot.id)!
    expect(cellOf(before).status).toBe('planned-discharge')
    let saw = false
    let status = cellOf(before).status
    for (let i = 0; i < 20000 && status !== 'done'; i++) {
      if (!sim.step()) break
      if (i % 3 !== 0) continue
      status = cellOf(dataOf(sim)).status
      if (status === 'in-progress') saw = true
    }
    expect(status).toBe('done')
    expect(saw).toBe(true)
    sim.runUntil({})
    const end = dataOf(sim)
    const t = totals(end)
    expect(t['planned-discharge'] + t['planned-load'] + t['in-progress']).toBe(0)
    expect(t.done).toBe(worked(end)) // truck exports book extra load slots while the run goes
    expect(worked(end)).toBeGreaterThanOrEqual(worked(before))
    // a discharged box keeps its properties on the done cell (they come from the box's history)
    expect(cellOf(end).details).toMatchObject({ status: 'done', boxId: expect.any(String), pod: expect.any(String) })
  })
})

describe('colour modes', () => {
  const data = dataOf(make())
  const bay = data.slots.find((s) => s.containerId)!.bay

  it('status mode keys cells by their state and uses no palette index', () => {
    const v = view(data, bay)
    for (const c of allCells(v)) {
      expect(c.colourIndex).toBeNull()
      expect(c.colourKey).toBe(c.status === 'empty' ? null : c.status)
    }
    expect(v.legend.map((l) => l.key)).toEqual([...CELL_STATUSES])
  })

  it('POD, weight class and line modes key cells by the box property; the same key has the same index in every bay', () => {
    for (const [mode, prop] of [['pod', 'pod'], ['weight', 'weightClass'], ['line', 'line']] as const) {
      const seen = new Map<string, number>()
      let coloured = 0
      for (const b of bayOrder('feeder')) {
        const v = view(data, b, mode)
        for (const c of allCells(v)) {
          if (c.rob) {
            // ROB grey (the default display, #168): its own key and grey, no legend index
            expect(c.colourKey).toBe('rob')
            expect(c.colour).toBe(ROB_HEX)
            expect(c.colourIndex).toBeNull()
            continue
          }
          if (c.colourKey === null) {
            expect(c.colourIndex).toBeNull()
            continue
          }
          coloured++
          expect(c.colourKey).toBe(c.details[prop])
          expect(c.colourIndex).not.toBeNull()
          expect(seen.get(c.colourKey) ?? c.colourIndex).toBe(c.colourIndex)
          seen.set(c.colourKey, c.colourIndex!)
        }
        expect(v.legend.map((l) => l.key)).toEqual(view(data, 0, mode).legend.map((l) => l.key))
      }
      expect(coloured).toBeGreaterThan(0)
      if (mode !== 'weight') expect(seen.size).toBeGreaterThan(1)
    }
    expect(view(data, bay, 'weight').legend.map((l) => l.key)).toEqual(['LIGHT', 'MEDIUM', 'HEAVY', 'unknown'])
  })

  it('every colour-by mode fills the coloured cells with the colour of the shared module, and lists the same legend', () => {
    const ctx = colourContextOf(config)
    for (const mode of COLOUR_BY_MODES.filter((m) => m !== 'default')) {
      const v = view(data, bay, mode)
      expect(v.legend.map((l) => [l.key, l.hex])).toEqual(legendOf(mode, ctx).map((e) => [e.key, e.hex]))
      const coloured = allCells(v).filter((c) => c.colour !== null)
      expect(coloured.length, mode).toBeGreaterThan(0)
      for (const c of coloured) expect(v.legend.find((l) => l.key === c.colourKey)?.hex, `${mode}:${c.colourKey}`).toBe(c.colour)
    }
  })

  it('the time-based modes read the data time: the same box is in another dwell class a day later', () => {
    const dwellKeys = (now: number): Set<string | null> => new Set(allCells(view({ ...data, now }, bay, 'dwell')).filter((c) => c.status !== 'rob').map((c) => c.colourKey))
    expect(dwellKeys(0)).not.toEqual(dwellKeys(5 * 86400))
  })

  it('grey ROB cells are the one ROB grey in every colour mode, with no legend entry (#159, #168)', () => {
    const robBay = data.robBoxes[0].bay
    for (const mode of COLOUR_BY_MODES.filter((m) => m !== 'default')) {
      const v = buildBayView(data, robBay, { colourMode: mode, robDisplay: 'grey' })
      const cells = allCells(v).filter((c) => c.status === 'rob')
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.every((c) => c.colourKey === 'rob' && c.colour === ROB_HEX && c.colourIndex === null), mode).toBe(true)
      expect(v.legend.map((l) => l.key), mode).not.toContain('rob')
    }
    // the state view draws grey ROB cells as the hatched state (no fill)
    const state = buildBayView(data, robBay, { colourMode: 'status', robDisplay: 'grey' })
    expect(allCells(state).filter((c) => c.status === 'rob').every((c) => c.colourKey === 'rob' && c.colour === null)).toBe(true)
  })

  it('show ROB cells take the colour their mode gives any box, not the ROB grey (#168)', () => {
    const robBay = data.robBoxes[0].bay
    for (const mode of COLOUR_BY_MODES.filter((m) => m !== 'default')) {
      const cells = allCells(buildBayView(data, robBay, { colourMode: mode, robDisplay: 'show' })).filter((c) => c.status === 'rob')
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.every((c) => c.colour !== null && c.colour !== ROB_HEX && c.colourKey !== 'rob'), mode).toBe(true)
    }
    // the state view shows a ROB box in the line colour, as the 3D view does in its default mode
    const state = allCells(buildBayView(data, robBay, { colourMode: 'status', robDisplay: 'show' })).filter((c) => c.status === 'rob')
    expect(state.every((c) => c.colour !== null && c.colour !== ROB_HEX)).toBe(true)
  })

  it('hide draws no ROB cell in the bay (the strip still marks the bay, #159)', () => {
    const robBay = data.robBoxes[0].bay
    for (const mode of COLOUR_BY_MODES) expect(allCells(buildBayView(data, robBay, { colourMode: mode, robDisplay: 'hide' })).filter((c) => c.rob), mode).toEqual([])
  })
})

describe('bay navigation and strip', () => {
  it('steps from the bow to the stern in maritime order and stops at the ends', () => {
    expect(bayOrder('feeder')).toEqual([6, 5, 4, 3, 2, 1, 0]) // internal bay 0 is aft; the strip starts at the bow
    expect(stepBay('feeder', 6, -1)).toBeNull()
    expect(stepBay('feeder', 6, 1)).toBe(5)
    expect(stepBay('feeder', 0, 1)).toBeNull()
    expect(stepBay('feeder', 0, -1)).toBe(1)
    expect(stepBay('feeder', 99, 1)).toBeNull()
  })

  it('reports prev/next, the maritime bay number and a strip entry for every bay', () => {
    const data = dataOf(make())
    const v = view(data, 3)
    expect(v.prev).toBe(4)
    expect(v.next).toBe(2)
    expect(v.strip.map((e) => e.number)).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(v.strip.find((e) => e.bay === 3)!.number).toBe(v.bayNumber)
    expect(v.strip.filter((e) => e.rob).map((e) => e.bay).sort()).toEqual([...new Set(data.robBoxes.map((b) => b.bay))].sort())
    expect(view(data, 6).prev).toBeNull()
    expect(view(data, 0).next).toBeNull()
    expect(() => view(data, 7)).toThrow(/not a bay/)
  })

  it('opens on the first bay with work to do, and the strip shows progress', () => {
    const sim = make()
    const data = dataOf(sim)
    const start = stripOf(data).find((e) => e.bay === defaultBay(data))!
    expect(start.state).toBe('idle')
    sim.runUntil({ eventType: 'StsPicked' })
    sim.runUntil({ moves: 3 })
    expect(stripOf(dataOf(sim)).some((e) => e.state === 'active' || e.state === 'complete')).toBe(true)
    sim.runUntil({})
    const end = stripOf(dataOf(sim))
    expect(end.filter((e) => !e.rob && e.state !== 'empty').every((e) => e.state === 'complete' && e.done === e.total)).toBe(true)
  })
})

describe('work packages of the bay', () => {
  it('lists the bay section packages with their state and progress, and nothing for a ROB bay', () => {
    const sim = make()
    sim.runUntil({ eventType: 'StsPicked' })
    const data = dataOf(sim)
    const bay = defaultBay(data)
    const v = view(data, bay)
    expect(v.packages.length).toBeGreaterThan(0)
    expect(v.packages.every((p) => data.packages.some((q) => q.id === p.id && q.bay === bay))).toBe(true)
    for (const p of v.packages.filter((x) => x.kind === 'discharge' || x.kind === 'load')) {
      expect(p.total).toBeGreaterThan(0)
      expect(p.done).toBeLessThanOrEqual(p.total!)
    }
    for (const p of v.packages.filter((x) => x.kind.startsWith('hatch'))) expect([p.done, p.total]).toEqual([null, null])
    expect(view(data, data.robBoxes[0].bay).packages).toEqual([])
  })
})

describe('location notation', () => {
  it('uses the locate callback for every cell, so labels read like the inspector', () => {
    const sim = make()
    const notation = createLocationNotation(sim.config)
    const data = dataOf(sim)
    const v = buildBayView(data, defaultBay(data), { colourMode: 'status', locate: (id) => notation.vesselSlot(id)?.notation ?? id })
    for (const c of allCells(v)) {
      expect(c.details.location).toMatch(/^VESSEL\.V01\.\d\d\.\d\d\.\d\d$/)
      expect(c.details.location).toBe(notation.vesselSlot(c.slotId)!.notation)
    }
    // the whole 40 ft cells of the bay carry the bay's even number
    expect(allCells(v).some((c) => c.half === null && c.details.location.split('.')[2] === String(v.bayNumber).padStart(2, '0'))).toBe(true)
  })
})

describe('paired-bay panels (#127)', () => {
  // Hand-made data: bay 3 of a feeder; hold tier 0 (feeder: rows 2 to 5 exist): row 2 a 40, row 3 two 20s, row 4 one lone aft 20, row 5 a ROB 40.
  const vesselId = 'V9'
  const bay = 3
  const slot = (row: number, half: 'aft' | 'fore' | null, containerId: string | null): VesselSlotState => ({
    id: vesselSlotId(vesselId, bay, row, 0, half),
    vesselId,
    bay,
    row,
    tier: 0,
    deck: false,
    half,
    purpose: 'discharge',
    containerId,
  })
  const box = (id: string, size: '20' | '40'): BayBox => ({ id, size, line: 'MSC', full: true, custody: 'vesselSlot' })
  const slots = [slot(2, null, 'A40'), slot(3, 'aft', 'B20'), slot(3, 'fore', 'C20'), slot(4, 'aft', 'D20')]
  const data: BayViewData = {
    vesselId,
    sizeClass: 'feeder',
    status: 'berthed',
    slots,
    boxes: { [slots[0].id]: box('A40', '40'), [slots[1].id]: box('B20', '20'), [slots[2].id]: box('C20', '20'), [slots[3].id]: box('D20', '20') },
    packages: [],
    robBoxes: [
      { slotId: vesselSlotId(vesselId, bay, 5, 0, null), vesselId, bay, row: 5, tier: 0, deck: false, half: null, size: '40', isoType: '42G1', pod: 'ESVLC', line: 'MSC', weightClass: 'LIGHT', grossKg: 9000, full: true },
    ],
  }
  const v = buildBayView(data, bay, { colourMode: 'status' })
  const holdRow = (panel: number): BayCell[] => v.panels[panel].sections[1].tiers.find((t) => t.tier === 0)!.cells

  it('has two panels, the two odd bays of the 40 ft bay, fore (lower number) first', () => {
    expect(v.panels.map((p) => p.half)).toEqual(['fore', 'aft'])
    expect(v.panels.map((p) => p.bayNumber)).toEqual([v.bayNumber - 1, v.bayNumber + 1])
    expect(v.panels[0].sections.map((s) => s.deck)).toEqual([true, false])
  })

  it('draws each 20 ft box in the panel of its half', () => {
    expect(holdRow(0)[3].details.boxId).toBe('C20') // fore
    expect(holdRow(1)[3].details.boxId).toBe('B20') // aft
    expect(holdRow(0)[3].continuation).toBe(false)
    expect(holdRow(1)[3].continuation).toBe(false)
  })

  it('shows a lone 20 only in its half; the other panel has an empty cell', () => {
    expect(holdRow(1)[4].details.boxId).toBe('D20')
    expect(holdRow(0)[4].status).toBe('empty')
    expect(holdRow(0)[4].details.boxId).toBeUndefined()
  })

  it('spans a 40 over both panels, the second half flagged as the continuation', () => {
    expect(holdRow(0)[2]).toMatchObject({ continuation: false, details: { boxId: 'A40', size: '40' } })
    expect(holdRow(1)[2]).toMatchObject({ continuation: true, status: 'planned-discharge', details: { boxId: 'A40' } })
  })

  it('flags ROB boxes (and their continuation) and keeps them in the panels', () => {
    expect(holdRow(0)[5]).toMatchObject({ rob: true, status: 'rob', continuation: false })
    expect(holdRow(1)[5]).toMatchObject({ rob: true, status: 'rob', continuation: true })
    expect(holdRow(0)[2].rob).toBe(false)
  })

  it('counts a 40 once, however many panels show it, and steps by 40 ft bay', () => {
    expect(v.counts['planned-discharge']).toBe(4)
    expect(v.counts.rob).toBe(1)
    expect(v.prev).toBe(4)
    expect(v.next).toBe(2)
  })
})
