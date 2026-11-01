/**
 * Colour by (spec #116, ticket #130): a pure module maps a container (plus the sim time) and a mode to a colour, and
 * a mode to a legend. Every mode colours every container, the legend lists every value the mode can produce, the
 * time-based modes move with the sim time, and the palette mirrors the skin tokens.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSimulation, type ContainerState, type CustodyKind, type TransitWorld } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import {
  COLOUR_BY_MODES,
  DATA_PALETTE,
  DWELL_PALETTE,
  LENGTH_PALETTE,
  RAMP_PALETTE,
  ROB_HEX,
  colourContextOf,
  colourOf,
  isTimeBased,
  legendOf,
  parseColourBy,
  subjectOfBox,
  type ColourBy,
  type ColourSubject,
} from '../modules/colourBy'
import { COLOUR_BY_STORAGE_KEY, loadColourBySettings, saveColourBySettings } from '../modules/colourBySettings'
import { colourKeyLabel } from '../modules/colourLabels'
import { buildRobMesh } from '../modules/robBoxes'
import type { RobBox } from '../scenario/robBays'
import { VESSEL_CLASSES } from '../scenario/vesselClasses'
import * as THREE from 'three'

const config = fixtures['rob-bays'] as ScenarioConfig
const HEX = /^#[0-9a-f]{6}$/i
const ctx = colourContextOf(config)

function world(vessels: Record<string, string> = {}, trucks: Record<string, string> = {}): TransitWorld {
  return { vesselStatus: (id) => vessels[id] as never, truckStatus: (id) => trucks[id] as never }
}

function historyBox(history: [number, CustodyKind, string][], props: Partial<ContainerState['props']> = {}): ContainerState {
  const h = history.map(([t, kind, id]) => ({ t, owner: { kind, id }, eventId: null }))
  return {
    id: 'MSKU0000001',
    size: '40',
    full: true,
    line: 'Maersk',
    vesselId: 'V001',
    custody: h[h.length - 1].owner,
    custodyHistory: h,
    props: { direction: 'EXPORT', isoType: '42G1', pol: 'ESALG', pod: 'ESVLC', weightClass: 'MEDIUM', plannedDepartureS: 90000, inbound: { kind: 'truck' }, outbound: { kind: 'vessel', id: 'V001' }, ...props },
  } as ContainerState
}

describe('every mode colours every container', () => {
  const sim = createSimulation(config, {}, { invariants: { sweepEvery: 500 } })
  sim.runUntil({ time: 4000 })
  const w: TransitWorld = {
    vesselStatus: (id) => sim.query.vessel(id).status,
    truckStatus: (id) => sim.query.truck(id).status,
  }
  const boxes = sim.query.containers()

  it('runs far enough to have boxes in several places', () => {
    expect(boxes.length).toBeGreaterThan(30)
    expect(new Set(boxes.map((b) => b.custody.kind)).size).toBeGreaterThan(1)
  })

  for (const mode of COLOUR_BY_MODES) {
    it(`${mode}: a hex colour for every box, and the legend lists its key`, () => {
      const legend = legendOf(mode, ctx)
      const keys = new Set(legend.map((e) => e.key))
      expect(keys.size).toBe(legend.length)
      for (const e of legend) expect(e.hex).toMatch(HEX)
      for (const b of boxes) {
        const c = colourOf(mode, subjectOfBox(b, w, sim.query.now(), { vessels: new Set(config.vessels.map((v) => v.id)) }), sim.query.now(), ctx)
        expect(c.hex).toMatch(HEX)
        expect(keys.has(c.key), `${mode}: ${c.key}`).toBe(true)
        expect(legend.find((e) => e.key === c.key)!.hex).toBe(c.hex)
      }
    })
  }

  it('the property modes use more than one colour on a real run', () => {
    for (const mode of ['line', 'pod', 'weight', 'iso', 'flow', 'transit'] as ColourBy[]) {
      const used = new Set(boxes.map((b) => colourOf(mode, subjectOfBox(b, w, sim.query.now()), sim.query.now(), ctx).key))
      expect(used.size, mode).toBeGreaterThan(1)
    }
  })
})

describe('what each mode produces', () => {
  const subject = (o: Partial<ColourSubject> = {}): ColourSubject => ({ line: 'MSC', full: true, ...o })

  it('line: the livery body of the line; an unknown line is the generic grey', () => {
    expect(colourOf('line', subject({ line: 'Maersk' }), 0, ctx).hex).toBe('#42b0d5')
    expect(colourOf('line', subject({ line: 'Nobody' }), 0, ctx).key).toBe('other')
    expect(colourOf('default', subject({ line: 'MSC' }), 0, ctx).key).toBe('MSC')
  })

  it('pod: one colour per port of the rotation, the same in every view', () => {
    const [a, b] = ctx.ports
    expect(colourOf('pod', subject({ pod: a }), 0, ctx).hex).not.toBe(colourOf('pod', subject({ pod: b }), 0, ctx).hex)
    expect(colourOf('pod', subject({ pod: 'XXXXX' }), 0, ctx).key).toBe('other')
    expect(legendOf('pod', ctx).map((e) => e.key)).toEqual([...ctx.ports, 'other', 'rob'])
  })

  it('special: reefer, tank (hazardous), open top and flat (out of gauge), else standard', () => {
    expect(colourOf('special', subject({ isoType: '45R1' }), 0, ctx).key).toBe('reefer')
    expect(colourOf('special', subject({ isoType: '22T1' }), 0, ctx).key).toBe('hazardous')
    expect(colourOf('special', subject({ isoType: '42U1' }), 0, ctx).key).toBe('oog')
    expect(colourOf('special', subject({ isoType: '42P1' }), 0, ctx).key).toBe('oog')
    expect(colourOf('special', subject({ isoType: '42G1' }), 0, ctx).key).toBe('standard')
  })

  it('flow: an empty is an empty whatever its direction; a full box follows its direction', () => {
    expect(colourOf('flow', subject({ full: false, direction: 'EXPORT' }), 0, ctx).key).toBe('empty')
    expect(colourOf('flow', subject({ direction: 'IMPORT' }), 0, ctx).key).toBe('import')
    expect(colourOf('flow', subject({ direction: 'EXPORT' }), 0, ctx).key).toBe('export')
    expect(colourOf('flow', subject({ direction: 'TRANSSHIPMENT' }), 0, ctx).key).toBe('transshipment')
  })

  it('call: a box on a vessel call of this scenario, a box from elsewhere, a remain-on-board box', () => {
    expect(colourOf('call', subject({ onCall: true }), 0, ctx).key).toBe('call')
    expect(colourOf('call', subject({ onCall: false }), 0, ctx).key).toBe('other')
    expect(colourOf('call', subject({ rob: true }), 0, ctx).key).toBe('rob')
  })

  it('a remain-on-board box has no dwell, departure or transit: its own grey in those modes', () => {
    for (const mode of ['dwell', 'departure', 'transit'] as ColourBy[]) expect(colourOf(mode, subject({ rob: true }), 0, ctx).key).toBe('rob')
  })
})

describe('time-based modes move with the sim time', () => {
  const w = world({ V001: 'berthed' })
  const box = historyBox([
    [0, 'vesselSlot', 'V001:01-01-82'],
    [3600, 'sts', 'STS01'],
    [3700, 'yardSlot', 'B01:01-01-01'],
  ])
  const at = (mode: ColourBy, t: number) => colourOf(mode, subjectOfBox(box, w, t), t, ctx).key

  it('is flagged so the renderer re-evaluates it as the clock runs', () => {
    expect(COLOUR_BY_MODES.filter(isTimeBased).sort()).toEqual(['departure', 'dwell', 'transit'])
  })

  it('transit status: arrived on a berthed vessel, then on terminal', () => {
    expect(at('transit', 1000)).toBe('ARRIVED')
    expect(at('transit', 3650)).toBe('ON_TERMINAL')
  })

  it('dwell: grows from the first terminal custody, in classes', () => {
    expect(at('dwell', 100)).toBe('none')
    const seen = new Set([3600, 3600 + 12 * 3600, 3600 + 2 * 86400, 3600 + 5 * 86400, 3600 + 9 * 86400].map((t) => at('dwell', t)))
    expect(seen.size).toBe(4)
  })

  it('dwell bands switch at 1, 3 and 7 days (#140)', () => {
    const D = 86400
    const key = (d: number) => colourOf('dwell', { line: 'MSC', full: true, arrivedS: 0, leftS: d }, 0, ctx).key
    expect([key(D - 1), key(D), key(3 * D - 1), key(3 * D), key(7 * D - 1), key(7 * D)]).toEqual(['lt1d', 'lt3d', 'lt3d', 'lt7d', 'lt7d', 'gt7d'])
    expect(legendOf('dwell', ctx).map((e) => e.key)).toEqual(['none', 'lt1d', 'lt3d', 'lt7d', 'gt7d', 'rob'])
  })

  it('dwell colours are the light ramp, unknown and ROB stay distinct (#140)', () => {
    const hexes = legendOf('dwell', ctx).map((e) => e.hex)
    expect(new Set(hexes).size).toBe(hexes.length)
    expect(hexes.slice(1, 5)).toEqual([...DWELL_PALETTE])
  })

  it('length: 20, 40 and 45 in three distinct colours, anything else unknown (#140)', () => {
    const key = (isoType?: string) => colourOf('length', { line: 'MSC', full: true, ...(isoType ? { isoType } : {}) }, 0, ctx).key
    expect(['22G1', '22R1', '42G1', '42R1', '45G1', '45R1'].map(key)).toEqual(['20', '20', '40', '40', '45', '45'])
    expect(key()).toBe('unknown')
    expect(key('L5G1')).toBe('unknown')
    expect(legendOf('length', ctx).map((e) => e.hex).slice(0, 3)).toEqual([...LENGTH_PALETTE])
  })

  it('planned departure: counts down to the planned time and turns overdue after it', () => {
    expect(at('departure', 90000 - 3 * 86400 + 3700)).not.toBe(at('departure', 90000 - 1800))
    expect(at('departure', 90000 - 1800)).not.toBe(at('departure', 90000 + 10))
    expect(at('departure', 90000 + 10)).toBe('overdue')
  })

  it('the history after the asked time is ignored (the scene replays the whole run)', () => {
    expect(subjectOfBox(box, w, 1000).transit).toBe('ARRIVED')
    expect(subjectOfBox(box, w, 1000).arrivedS).toBeNull()
    expect(subjectOfBox(box, w, 3650).arrivedS).toBe(3600)
  })
})

describe('legend labels', () => {
  it('every key of every legend has a catalogue label', () => {
    for (const mode of COLOUR_BY_MODES) {
      for (const e of legendOf(mode, ctx)) {
        const label = colourKeyLabel(mode, e.key)
        expect(label, `${mode}:${e.key}`).toBeTruthy()
        expect(label, `${mode}:${e.key}`).not.toMatch(/^colourBy\./)
      }
    }
  })
})

describe('remembered choice', () => {
  const store = (initial: string | null) => {
    const data = new Map<string, string>(initial === null ? [] : [[COLOUR_BY_STORAGE_KEY, initial]])
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }
  it('round-trips the mode and Hide ROB, and falls back to the defaults on nothing, rubbish or a blocked storage', () => {
    const s = store(null)
    expect(loadColourBySettings(s)).toEqual({ mode: 'default', hideRob: false })
    saveColourBySettings(s, { mode: 'dwell', hideRob: true })
    expect(loadColourBySettings(s)).toEqual({ mode: 'dwell', hideRob: true })
    expect(loadColourBySettings(store('{nonsense'))).toEqual({ mode: 'default', hideRob: false })
    expect(loadColourBySettings(store('{"mode":"zzz","hideRob":1}'))).toEqual({ mode: 'default', hideRob: false })
    expect(loadColourBySettings(null)).toEqual({ mode: 'default', hideRob: false })
    expect(() => saveColourBySettings({ setItem: () => { throw new Error('blocked') } }, { mode: 'pod', hideRob: false })).not.toThrow()
  })
})

describe('frame cost', () => {
  it('colours 30 000 boxes in every mode well inside a frame, so a mode switch costs no frame time', () => {
    const w = world({ V001: 'berthed' })
    const boxes = Array.from({ length: 30_000 }, (_, i) =>
      historyBox(
        [
          [0, 'vesselSlot', 'V001:01-01-82'],
          [100 + (i % 500), 'yardSlot', 'B01:01-01-01'],
        ],
        { pod: ctx.ports[i % ctx.ports.length], plannedDepartureS: 5000 + i },
      ),
    )
    for (const mode of COLOUR_BY_MODES) {
      const t0 = performance.now()
      for (const b of boxes) colourOf(mode, subjectOfBox(b, w, 2000), 2000, ctx)
      expect(performance.now() - t0, mode).toBeLessThan(400)
    }
  })
})

describe('mode names and the palette', () => {
  it('parses a stored mode, falling back to the default', () => {
    expect(parseColourBy('pod')).toBe('pod')
    expect(parseColourBy('nonsense')).toBe('default')
    expect(parseColourBy(null)).toBe('default')
  })

  it('mirrors the skin tokens (a new colour goes into skin.css first)', () => {
    const skin = readFileSync(join(__dirname, '..', 'skin.css'), 'utf8')
    const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(skin)?.[1]?.toLowerCase()
    DATA_PALETTE.forEach((hex, i) => expect(token(`--tt-data-${i}`)).toBe(hex))
    RAMP_PALETTE.forEach((hex, i) => expect(token(`--tt-ramp-${i}`)).toBe(hex))
    expect(token('--tt-data-rob')).toBe(ROB_HEX)
  })
})

describe('ROB colour (spec #154, #159)', () => {
  const subject = (o: Partial<ColourSubject> = {}): ColourSubject => ({ line: 'MSC', full: true, ...o })
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

  it('one colour for a remain-on-board box in every mode, listed in every legend', () => {
    for (const mode of COLOUR_BY_MODES) {
      expect(colourOf(mode, subject({ rob: true, pod: ctx.ports[0], weightClass: 'HEAVY', isoType: '22R1' }), 0, ctx), mode).toEqual({ key: 'rob', hex: ROB_HEX })
      expect(legendOf(mode, ctx).filter((e) => e.key === 'rob'), mode).toEqual([{ key: 'rob', hex: ROB_HEX }])
    }
  })

  it('is a desaturated light grey, distinct from the no-value grey', () => {
    const [r, g, b] = rgb(ROB_HEX)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12)
    expect((r + g + b) / 3).toBeGreaterThan(180)
    for (const mode of COLOUR_BY_MODES) expect(legendOf(mode, ctx).filter((e) => e.key !== 'rob' && e.hex === ROB_HEX), mode).toEqual([])
  })

  it('the 3D ROB boxes take it in every mode, the default one included', () => {
    const spec = VESSEL_CLASSES.feeder
    const box: RobBox = { vesselId: 'V001', slotId: 'V001:00-00-04', bay: 0, row: 0, tier: 4, deck: true, half: null, size: '40', isoType: '42G1', pod: 'ESVLC', line: 'MSC', weightClass: 'HEAVY', grossKg: 20000, full: true }
    const mesh = buildRobMesh(spec, [box, { ...box, slotId: 'V001:00-01-04', row: 1, pod: 'MAPTM' }])!
    const c = new THREE.Color()
    for (const mode of COLOUR_BY_MODES) {
      mesh.setColour(mode, ctx)
      for (const i of [0, 1]) {
        mesh.mesh.getColorAt(i, c)
        expect(`#${c.getHexString()}`, mode).toBe(ROB_HEX)
      }
    }
    mesh.dispose()
  })
})
