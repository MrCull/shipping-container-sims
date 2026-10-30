import { describe, expect, it } from 'vitest'
import {
  createSimulation,
  hatchLaydownProblems,
  hatchSettings,
  laydownSites,
  restoreSimulation,
  type EngineEvent,
  type SimSnapshot,
  type Simulation,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'
import { hatchPanelOfRow, hatchPanelRows, hatchPanelWidthM, VESSEL_CLASSES, type VesselClassSpec } from '../scenario/vesselClasses'

const cycle = fixtures['hatch-cover-cycle'] as ScenarioConfig
const deckOnly = fixtures['hatch-deck-only-no-open'] as ScenarioConfig

const withHatch = (config: ScenarioConfig, hatch: NonNullable<ScenarioConfig['hatch']>): ScenarioConfig => ({
  ...config,
  hatch: { ...config.hatch, ...hatch },
})

function run(config: ScenarioConfig): Simulation {
  const sim = createSimulation(config)
  sim.runUntil()
  return sim
}

const hatchEvents = (sim: Simulation): EngineEvent[] => sim.eventLog().filter((e) => /^(Hatch|StsHatch|StsWaitingForHatch)/.test(e.type))
const payloadOf = (e: EngineEvent) => e.payload as unknown as Record<string, unknown>
const eventsOfPanel = (sim: Simulation, panelId: string): EngineEvent[] =>
  sim.eventLog().filter((e) => e.type.startsWith('Hatch') && payloadOf(e).panelId === panelId)
const firstOf = (events: EngineEvent[], type: string): EngineEvent => {
  const e = events.find((x) => x.type === type)
  if (!e) throw new Error(`no ${type} event`)
  return e
}
const lastOf = (events: EngineEvent[], type: string): EngineEvent => {
  const e = [...events].reverse().find((x) => x.type === type)
  if (!e) throw new Error(`no ${type} event`)
  return e
}

/** The bay of V001 that has deck discharge, hold discharge, hold load and deck load. */
function fullBay(sim: Simulation): number {
  const sections = new Map<number, Set<string>>()
  for (const s of sim.query.vesselSlots('V001')) {
    const kind = `${s.purpose === 'discharge' ? 'discharge' : 'load'}-${s.deck ? 'deck' : 'hold'}`
    if (!sections.has(s.bay)) sections.set(s.bay, new Set())
    sections.get(s.bay)?.add(kind)
  }
  const bay = [...sections.entries()].find(([, kinds]) => kinds.size === 4)
  if (!bay) throw new Error('the fixture has no bay with all four sections')
  return bay[0]
}

describe('hatch cover configuration (vessel classes)', () => {
  it('every class has panels across the beam with size, weight, lashing delay, cycle time and laydown limit', () => {
    for (const [name, spec] of Object.entries(VESSEL_CLASSES) as [string, VesselClassSpec][]) {
      const h = spec.hatch
      expect(h.panels, name).toBeGreaterThanOrEqual(1)
      expect(h.panelLengthM, name).toBeGreaterThan(0)
      expect(h.panelWeightT, name).toBeGreaterThan(0)
      expect(h.lashingReleaseS, name).toBeGreaterThan(0)
      expect(h.cycleS, name).toBeGreaterThan(0)
      expect(h.laydownStackLimit, name).toBe(3)
      // the panels cover every row exactly once
      const covered = Array.from({ length: h.panels }, (_, i) => hatchPanelRows(spec, i)).flatMap(({ from, to }) =>
        Array.from({ length: to - from }, (_, k) => from + k),
      )
      expect(covered, name).toEqual(Array.from({ length: spec.rows }, (_, r) => r))
      for (let r = 0; r < spec.rows; r++) {
        const { from, to } = hatchPanelRows(spec, hatchPanelOfRow(spec, r))
        expect(r >= from && r < to).toBe(true)
      }
    }
    expect(VESSEL_CLASSES.panamax.hatch.panels).toBeGreaterThan(VESSEL_CLASSES.feeder.hatch.panels - 1)
    expect(VESSEL_CLASSES.ulcv.hatch.panelWeightT).toBeGreaterThan(VESSEL_CLASSES.feeder.hatch.panelWeightT)
  })

  it('the scenario overrides cycle time, lashing delays and the laydown limit', () => {
    const cfg = withHatch(cycle, { cycleS: 100, lashingReleaseS: 10, lashingSecureS: 20, laydownStackLimit: 2 })
    expect(hatchSettings(cfg, 'feeder')).toMatchObject({ cycleS: 100, lashingReleaseS: 10, lashingSecureS: 20, laydownStackLimit: 2 })
    expect(hatchSettings(cycle, 'feeder').cycleS).toBe(240)
  })

  it('panels carry identity, dimensions, weight, position and state, and are not containers', () => {
    const sim = createSimulation(cycle)
    sim.runUntil({ eventType: 'VesselBerthed' })
    const state = sim.snapshot().state
    const panels = Object.values(state.hatchPanels)
    expect(panels.length).toBeGreaterThan(0)
    const p = panels.find((x) => x.bay === 0 && x.index === 0)
    expect(p).toMatchObject({ id: 'V001:H00-0', vesselId: 'V001', status: 'secured', weightT: VESSEL_CLASSES.feeder.hatch.panelWeightT })
    expect(p?.widthM).toBeCloseTo(hatchPanelWidthM(VESSEL_CLASSES.feeder, 0), 6)
    expect(p?.home.y).toBe(VESSEL_CLASSES.feeder.deckHeightM)
    expect(Object.keys(state.containers).some((id) => id.includes(':H'))).toBe(false)
  })
})

describe('hatch-cover-cycle: remove, hold work, replace, deck load in one bay', () => {
  const sim = run(cycle)
  const bay = fullBay(sim)
  const panelIds = Object.values(sim.snapshot().state.hatchPanels)
    .filter((p) => p.bay === bay)
    .map((p) => p.id)

  it('runs to the end with no invariant violation', () => {
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.firstError).toBeNull()
  })

  it('every panel of the bay goes through lashing release, lift, laydown, lift, replace and secure in order', () => {
    expect(panelIds.length).toBeGreaterThan(0)
    for (const id of panelIds) {
      const types = eventsOfPanel(sim, id).map((e) => e.type)
      expect(types, id).toEqual(['HatchLashingReleased', 'HatchLifted', 'HatchSetInLaydown', 'HatchLifted', 'HatchReplaced', 'HatchSecured'])
      const from = eventsOfPanel(sim, id).filter((e) => e.type === 'HatchLifted').map((e) => payloadOf(e).from)
      expect(from).toEqual(['hatch', 'laydown'])
    }
  })

  it('hatch work follows deck discharge → hold discharge → hold load → replace → deck load within the bay', () => {
    const log = sim.eventLog()
    const state = sim.snapshot().state
    const slotOf = (id: string) => state.vesselSlots[id]
    const picks = log.filter((e) => e.type === 'StsPicked').map((e) => ({ t: e.t, slot: slotOf((payloadOf(e).from as { id: string }).id) }))
    const loads = log.filter((e) => e.type === 'StsLoaded').map((e) => ({ t: e.t, slot: slotOf(payloadOf(e).slotId as string) }))
    const spec = VESSEL_CLASSES.feeder
    const panelOf = (row: number) => `V001:H${String(bay).padStart(2, '0')}-${hatchPanelOfRow(spec, row)}`
    const checked = { deckDischarge: 0, holdDischarge: 0, holdLoad: 0, deckLoad: 0 }
    for (const { t, slot } of picks.filter((p) => p.slot.bay === bay)) {
      const ev = eventsOfPanel(sim, panelOf(slot.row))
      if (slot.deck) {
        expect(t, `deck discharge ${slot.id}`).toBeLessThan(firstOf(ev, 'HatchLashingReleased').t)
        checked.deckDischarge++
      } else if (ev.length > 0) {
        expect(t, `hold discharge ${slot.id}`).toBeGreaterThan(firstOf(ev, 'HatchSetInLaydown').t)
        expect(t).toBeLessThan(firstOf(ev, 'HatchReplaced').t)
        checked.holdDischarge++
      }
    }
    for (const { t, slot } of loads.filter((p) => p.slot.bay === bay)) {
      const ev = eventsOfPanel(sim, panelOf(slot.row))
      if (slot.deck) {
        expect(t, `deck load ${slot.id}`).toBeGreaterThan(lastOf(ev, 'HatchSecured').t)
        checked.deckLoad++
      } else {
        expect(t, `hold load ${slot.id}`).toBeGreaterThan(firstOf(ev, 'HatchSetInLaydown').t)
        expect(t).toBeLessThan(firstOf(ev, 'HatchReplaced').t)
        checked.holdLoad++
      }
    }
    expect(checked.deckDischarge).toBeGreaterThan(0)
    expect(checked.holdDischarge).toBeGreaterThan(0)
    expect(checked.holdLoad).toBeGreaterThan(0)
    expect(checked.deckLoad).toBeGreaterThan(0)
  })

  it('hatch events carry causality back to the scenario start', () => {
    const set = lastOf(hatchEvents(sim), 'HatchSecured')
    const chain = sim.why(set.id).map((e) => e.type)
    expect(chain).toContain('HatchReplaced')
    expect(chain).toContain('StsHatchStarted')
    expect(chain.at(-1)).toBe('ScenarioStarted')
    const setDown = sim.eventLog().find((e) => e.type === 'HatchSetInLaydown') as EngineEvent
    const lift = sim.why(setDown.id)
    expect(lift[1].type).toBe('HatchLifted')
    expect(lift[2].type).toBe('StsHatchStarted')
  })

  it('panels never take custody, never count as boxes', () => {
    const state = sim.snapshot().state
    for (const c of Object.values(state.containers)) expect(c.id.includes(':H')).toBe(false)
    const boxMoves = sim.eventLog().filter((e) => e.type === 'StsPicked' || e.type === 'StsLoaded').length
    expect(sim.kpiReport().sts.STS01.moves).toBe(boxMoves)
    for (const e of hatchEvents(sim)) expect(e.subjects.containers ?? []).toEqual([])
  })

  it('the KPI report counts hatch moves and their STS time', () => {
    const k = sim.kpiReport().hatch
    expect(k).toBeDefined()
    const opened = Object.values(sim.snapshot().state.hatchPanels).filter((p) => p.cycles > 0).length
    expect(k?.removes).toBe(opened)
    expect(k?.replaces).toBe(opened)
    expect(k?.moves).toBe(2 * opened)
    expect(k?.sts.STS01.moves).toBe(2 * opened)
    // about the configured cycle time per move (a little more: the hoist back up)
    const perMove = (k?.stsTimeS ?? 0) / (k?.moves ?? 1)
    expect(perMove).toBeGreaterThan(230)
    expect(perMove).toBeLessThan(280)
    expect(k?.sts.STS01.timeS).toBeCloseTo(k?.stsTimeS ?? 0, 3)
    expect(k?.waitS).toBeGreaterThan(0) // the first lashing release is waited for
  })

  it('every panel is secured and the laydown is empty when the vessel leaves', () => {
    const state = sim.snapshot().state
    expect(Object.values(state.hatchPanels).every((p) => p.status === 'secured')).toBe(true)
    expect(Object.values(state.hatchLaydown).every((s) => s.panelIds.length === 0)).toBe(true)
  })

  it('hatch time counts towards turnaround', () => {
    const without = run(withHatch(cycle, { enabled: false }))
    const turn = (s: Simulation) => s.kpiReport().vessels.V001.turnaroundS as number
    expect(without.status).toBe('ended')
    expect(without.kpiReport().hatch).toBeUndefined()
    expect(turn(sim)).toBeGreaterThan(turn(without) + (sim.kpiReport().hatch?.stsTimeS ?? 0) * 0.5)
  })

  it('a longer lashing release delays the first lift and the turnaround', () => {
    const slow = run(withHatch(cycle, { lashingReleaseS: 900 }))
    expect(slow.invariantReport().violations).toEqual([])
    const first = (s: Simulation) => firstOf(hatchEvents(s), 'HatchLifted').t
    expect(first(slow)).toBeGreaterThan(first(sim) + 500)
  })

  it('a shorter cycle time shortens each hatch move', () => {
    const fast = run(withHatch(cycle, { cycleS: 120 }))
    const perMove = (s: Simulation) => (s.kpiReport().hatch?.stsTimeS ?? 0) / (s.kpiReport().hatch?.moves ?? 1)
    expect(perMove(fast)).toBeLessThan(perMove(sim) - 80)
  })
})

describe('laydown', () => {
  it('stacks the panels of one hatch up to the limit and spills over to the next laydown bay beyond it', () => {
    const stacked = run(cycle)
    const sets = (s: Simulation) => s.eventLog().filter((e) => e.type === 'HatchSetInLaydown').map(payloadOf)
    const bay0 = (s: Simulation) => sets(s).filter((p) => String(p.panelId).startsWith('V001:H00-'))
    expect(new Set(bay0(stacked).map((p) => p.siteId)).size).toBe(1)
    expect(bay0(stacked).map((p) => p.level)).toEqual([0, 1])
    const single = run(withHatch(cycle, { laydownStackLimit: 1 }))
    expect(single.invariantReport().violations).toEqual([])
    expect(new Set(bay0(single).map((p) => p.siteId)).size).toBe(2)
    expect(bay0(single).map((p) => p.level)).toEqual([0, 0])
  })

  it('replaces the top panel first, each panel only on its own hatch', () => {
    const sim = run(cycle)
    const replaced = sim.eventLog().filter((e) => e.type === 'HatchReplaced')
    for (const e of replaced) {
      const p = payloadOf(e)
      expect(p.hatch).toEqual({ vesselId: 'V001', bay: Number(String(p.panelId).slice(6, 8)), index: Number(String(p.panelId).slice(9)) })
    }
    const bay0 = replaced.map((e) => payloadOf(e).panelId as string).filter((id) => id.startsWith('V001:H00-'))
    expect(bay0).toEqual(['V001:H00-1', 'V001:H00-0'])
  })

  it('every laydown position is clear of the SHC lane graph, the ground lanes and the STS rails', () => {
    const configs: ScenarioConfig[] = [...Object.values(fixtures), ...Object.values(presets).map((build) => build())]
    let withShcs = 0
    for (const config of configs) {
      if ((config.shcs?.length ?? 0) > 0) withShcs++
      expect(hatchLaydownProblems(config), config.name).toEqual([])
      expect(laydownSites(config).length, config.name).toBeGreaterThan(0)
    }
    expect(withShcs).toBeGreaterThan(5)
    // the widest panel of every class fits too
    const everyClass = hatchLaydownProblems(cycle, ['feeder', 'feedermax', 'panamax', 'neo-panamax', 'ulcv'])
    expect(everyClass).toEqual([])
  })

  it('detects a laydown that would sit in the SHC network (more ground lanes than the strip holds)', () => {
    const wide: ScenarioConfig = { ...cycle, sts: cycle.sts.map((s) => ({ ...s, groundPositions: 6 })) }
    expect(hatchLaydownProblems(wide).length).toBeGreaterThan(0)
    expect(() => createSimulation(wide)).toThrow(/hatch cover laydown/)
    expect(() => createSimulation(withHatch(wide, { enabled: false }))).not.toThrow()
  })
})

describe('hatch-deck-only-no-open: no hold work, no hatch moves', () => {
  const sim = run(deckOnly)

  it('opens no hatch and keeps every panel secured', () => {
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(hatchEvents(sim)).toEqual([])
    expect(sim.kpiReport().hatch).toBeUndefined()
    expect(Object.values(sim.snapshot().state.hatchPanels).every((p) => p.status === 'secured' && p.cycles === 0)).toBe(true)
    expect(sim.kpiReport().movesCompleted).toBe(6)
  })

  it('has no hold boxes at all', () => {
    expect(sim.query.vesselSlots('V001').every((s) => s.deck)).toBe(true)
  })
})

describe('instant quay mode', () => {
  it('runs the hatch cycle with zero crane time, same events', () => {
    const sim = createSimulation(cycle, undefined, { subsystems: { quay: 'instant' } })
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.eventLog().some((e) => e.type === 'HatchReplaced')).toBe(true)
  })
})

describe('invariants (each trips on a tampered snapshot)', () => {
  /** Tamper with a snapshot, resume, step until the run fails, and return the violation and the event it was found at. */
  function tampered(sim: Simulation, tamper: (snap: SimSnapshot) => void) {
    const snap = sim.snapshot()
    tamper(snap)
    const resumed = restoreSimulation(snap)
    for (let i = 0; i < 400 && resumed.status === 'ready'; i++) resumed.step()
    const last = resumed.eventLog().at(-1) as EngineEvent
    if (last.type !== 'InvariantViolated') throw new Error(`expected InvariantViolated, got ${last.type} (${resumed.status})`)
    const offending = resumed.eventLog().find((e) => e.id === last.payload.offendingEventId) as EngineEvent
    return { invariant: last.payload.invariant, message: last.payload.message, offending }
  }
  const stopAfter = (type: string, nth = 1): Simulation => {
    const sim = createSimulation(cycle)
    for (let i = 0; i < nth; i++) sim.runUntil({ eventType: type as EngineEvent['type'] })
    return sim
  }
  /** Run until an event matching `match` has just been processed. */
  const stopAfterMatching = (match: (e: EngineEvent, sim: Simulation) => boolean): Simulation => {
    const sim = createSimulation(cycle)
    for (;;) {
      const e = sim.step()
      if (!e) throw new Error('the run ended without the event')
      if (match(e, sim)) return sim
    }
  }

  it('hatch.no-lift-before-lashing-release: a panel lifted that was never released', () => {
    const sim = stopAfter('StsHatchStarted', 2) // the second start is the real one (the first waits for the lashing)
    const pending = sim.snapshot().state.sts.STS01.hatchJob?.panelId as string
    const r = tampered(sim, (snap) => {
      snap.state.hatchPanels[pending].lashingReleasedAt = null
    })
    expect(r.invariant).toBe('hatch.no-lift-before-lashing-release')
    expect(r.offending.type).toBe('HatchLifted')
  })

  it('hatch.no-removal-with-boxes-on-top: a panel lifted with a discharge box standing on it', () => {
    // the first bay with deck discharge: put a deck box back on its panel
    const sim = stopAfter('StsHatchStarted', 2)
    const state = sim.snapshot().state
    const panelId = state.sts.STS01.hatchJob?.panelId as string
    const panel = state.hatchPanels[panelId]
    const r = tampered(sim, (snap) => {
      const slot = Object.values(snap.state.vesselSlots).find((s) => s.vesselId === 'V001' && s.deck && s.bay === panel.bay && s.row >= panel.rowFrom && s.row < panel.rowTo)
      const box = Object.values(snap.state.containers).find((c) => c.vesselId === 'V001' && c.custody.kind === 'vesselSlot')
      if (!slot || !box) throw new Error('no slot to tamper')
      slot.purpose = 'discharge'
      slot.containerId = box.id
    })
    expect(r.invariant).toBe('hatch.no-removal-with-boxes-on-top')
    expect(r.offending.type).toBe('HatchLifted')
  })

  it('hatch.no-hold-access-through-closed-hatch: the spreader goes into the hold under a closed panel', () => {
    const sim = stopAfter('HatchSetInLaydown')
    const r = tampered(sim, (snap) => {
      // the panels are back on their hatches (closed) while the crane works the hold below them
      for (const p of Object.values(snap.state.hatchPanels))
        if (p.status === 'in-laydown') Object.assign(p, { status: 'secured', pos: { ...p.home }, lashingReleasedAt: null, liftedAt: null })
    })
    expect(r.invariant).toBe('hatch.no-hold-access-through-closed-hatch')
    expect(r.offending.type).toMatch(/^Sts/)
  })

  it('hatch.no-deck-load-on-missing-hatch: a deck box loaded while the panel is not secured', () => {
    const r = tampered(stopBeforeDeckLoad(), (snap) => {
      // the bay's panels are replaced but not yet secured when the first deck box comes down
      for (const p of Object.values(snap.state.hatchPanels))
        if (p.cycles > 0) Object.assign(p, { status: 'replaced', lashingReleasedAt: 0, liftedAt: 1, pos: { ...p.home } })
    })
    expect(r.invariant).toBe('hatch.no-deck-load-on-missing-hatch')
    expect(r.offending.type).toBe('StsLoaded')
  })

  it('hatch.replace-own-hatch: a panel carried to another hatch', () => {
    const sim = stopAfterMatching((e) => e.type === 'HatchLifted' && payloadOf(e).from === 'laydown')
    const r = tampered(sim, (snap) => {
      // the replacement is already queued: send the panel to the next bay's hatch instead
      const queued = snap.state.queue.find((e) => e.type === 'HatchReplaced')
      if (!queued) throw new Error('no queued replacement')
      const hatch = (queued.payload as { hatch: { bay: number } }).hatch
      hatch.bay += 1
    })
    expect(r.invariant).toBe('hatch.replace-own-hatch')
    expect(r.offending.type).toBe('HatchReplaced')
  })

  it('hatch.laydown-stack-limit: more panels in a laydown bay than its limit', () => {
    // the second panel of bay 0 has claimed the laydown bay of the first (stack limit 3); the limit then drops to 1
    const sim = stopAfterMatching((e, s) => e.type === 'StsHatchStarted' && payloadOf(e).op === 'remove' && String(payloadOf(e).panelId).endsWith('-1') && !!s.snapshot().state.sts.STS01.hatchJob?.siteId)
    const r = tampered(sim, (snap) => {
      snap.config.hatch = { ...snap.config.hatch, laydownStackLimit: 1 } // the second panel of the bay stacks on the first
    })
    expect(r.invariant).toBe('hatch.laydown-stack-limit')
    expect(r.offending.type).toBe('HatchSetInLaydown')
  })

  it('hatch.no-departure-open: the vessel is released with a hatch panel still off', () => {
    const sim = createSimulation(cycle)
    sim.runUntil({ eventType: 'StsWorkComplete' })
    const r = tampered(sim, (snap) => {
      const p = Object.values(snap.state.hatchPanels)[0]
      p.status = 'in-laydown'
    })
    expect(r.invariant).toBe('hatch.no-departure-open')
  })
})

/** The simulation stopped just before the first deck box is loaded (the event after the last hold load). */
function stopBeforeDeckLoad(): Simulation {
  const sim = createSimulation(cycle)
  let snapshot: SimSnapshot | null = null
  for (;;) {
    const e = sim.step()
    if (!e) throw new Error('the fixture never loads a deck box')
    if (e.type === 'StsLoadStarted') {
      const slot = sim.snapshot().state.vesselSlots[e.payload.slotId]
      if (slot.deck) return restoreSimulation(snapshot as SimSnapshot)
    }
    snapshot = sim.snapshot()
  }
}
