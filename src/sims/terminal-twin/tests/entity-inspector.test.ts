/**
 * Entity inspector model (TT-18): current state, current job and history of
 * a container, STS, SHC or vessel, built from the engine's query results.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { SceneModel } from '../modules/sceneModel'
import { describeEntity, entityKind, eventsInvolving } from '../modules/entityInspector'
import { summarizeEvent } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']
const model = new SceneModel(config, config.seed)

function simAt(t: number) {
  const sim = createSimulation(config)
  sim.runUntil({ time: t })
  return sim
}

describe('entityKind', () => {
  it('classifies ids by what the scene knows', () => {
    expect(entityKind(model, model.containerIds[0])).toBe('container')
    expect(entityKind(model, model.shcIds[0])).toBe('shc')
    expect(entityKind(model, model.stsIds[0])).toBe('sts')
    expect(entityKind(model, model.vesselIds[0])).toBe('vessel')
    expect(entityKind(model, 'nope')).toBeNull()
  })
})

describe('describeEntity', () => {
  it('a container shows line, size and its custody history up to now, current owner last', () => {
    const sim = simAt(1e6)
    const id = model.containerIds[0]
    const view = describeEntity('container', sim.query.container(id))
    expect(view.id).toBe(id)
    expect(view.custody.map((c) => c.ownerKind).slice(0, 5)).toEqual(['vesselSlot', 'sts', 'groundPosition', 'shc', 'wtpPad'])
    expect(view.custody.at(-1)!.current).toBe(true)
    expect(view.custody.filter((c) => c.current)).toHaveLength(1)
    expect(view.facts.map((f) => f.label)).toEqual(expect.arrayContaining(['inspector.fact.line', 'inspector.fact.size', 'inspector.fact.custody']))
  })

  it('a container lists its stored properties, and its tooltip the key ones (spec #106)', () => {
    const sim = simAt(0)
    const box = sim.query.container(model.containerIds[0])
    const view = describeEntity('container', box)
    const labels = view.facts.map((f) => f.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'inspector.fact.direction',
        'inspector.fact.isoType',
        'inspector.fact.pol',
        'inspector.fact.pod',
        'inspector.fact.grossWeight',
        'inspector.fact.tareWeight',
        'inspector.fact.cargoWeight',
        'inspector.fact.weightClass',
        'inspector.fact.plannedDeparture',
        'inspector.fact.inbound',
        'inspector.fact.outbound',
        'inspector.fact.booking',
        'inspector.fact.holds',
      ]),
    )
    const value = (l: string) => view.facts.find((f) => f.label === l)!.value
    expect(value('inspector.fact.pod')).toBe(box.props.pod)
    expect(value('inspector.fact.grossWeight')).toBe(box.props.tareKg + box.props.cargoKg)
    expect(value('inspector.fact.direction')).toBe('IMPORT')
    expect(view.tooltip!.map((f) => f.label)).toEqual(
      ['direction', 'isoType', 'pol', 'pod', 'grossWeight', 'weightClass'].map((k) => `inspector.fact.${k}`),
    )
    for (const f of view.tooltip!) expect(view.facts).toContainEqual(f)
    // a restored box that predates the properties still describes itself
    const old = { ...box, props: undefined }
    expect(describeEntity('container', old).tooltip).toEqual([])
  })

  it('a reefer shows its setpoint', () => {
    const config = fixtures['reefer-powered-rows']
    const sim = createSimulation(config)
    const reefer = sim.query.containers().find((c) => c.reefer)!
    const view = describeEntity('container', reefer)
    expect(view.facts.find((f) => f.label === 'inspector.fact.setpoint')!.value).toBe(reefer.props.reeferSetpointC)
  })

  it('an SHC that is on a job shows the job, the box it carries and its target pad', () => {
    const sim = createSimulation(config)
    sim.runUntil({ eventType: 'ShcRoutingLoaded' })
    const shc = sim.query.shcs().find((s) => s.jobId)!
    const view = describeEntity('shc', shc, { job: sim.query.shcJobs().find((j) => j.id === shc.jobId) })
    expect(view.job).not.toBeNull()
    expect(view.job!.map((f) => f.value)).toEqual(expect.arrayContaining([shc.jobId, shc.carrying]))
  })

  it('an idle STS or SHC has no job', () => {
    const sim = simAt(0)
    const view = describeEntity('shc', sim.query.shcs()[0])
    expect(view.job).toBeNull()
    expect(view.facts.find((f) => f.label === 'inspector.fact.status')!.value).toBe('parked')
  })

  it('a working STS shows its vessel, assigned bays and what it carries', () => {
    const sim = createSimulation(config)
    sim.runUntil({ eventType: 'StsPicked' })
    const sts = sim.query.stsList()[0]
    const view = describeEntity('sts', sts)
    expect(view.facts.find((f) => f.label === 'inspector.fact.vessel')!.value).toBe(sts.vesselId)
    expect(view.job).not.toBeNull()
  })

  it('a vessel shows status, berth and remaining discharge', () => {
    const sim = simAt(1e6)
    const vessel = sim.query.vessels()[0]
    const view = describeEntity('vessel', vessel)
    expect(view.facts.find((f) => f.label === 'inspector.fact.remaining')!.value).toBe(vessel.remainingDischarge)
  })
})

describe('eventsInvolving', () => {
  it('returns the newest events that name the id, oldest first, capped', () => {
    const sim = simAt(1e6)
    const events = sim.eventLog().map(summarizeEvent)
    const id = model.shcIds[0]
    const mine = eventsInvolving(events, id, 5)
    expect(mine).toHaveLength(5)
    for (const e of mine) expect(e.subjects.equipment).toContain(id)
    expect(mine.map((e) => e.seq)).toEqual([...mine.map((e) => e.seq)].sort((a, b) => a - b))
    expect(mine.at(-1)!.id).toBe(events.filter((e) => e.subjects.equipment?.includes(id)).at(-1)!.id)
  })
})

describe('ASC (TT-06 yard crane)', () => {
  const ascConfig = fixtures['asc-1sts-10-boxes-1block']
  const ascModel = new SceneModel(ascConfig, ascConfig.seed)

  it('is classified, and shows status, block, stacked count and the box it carries as the current job', () => {
    const asc = ascModel.ascIds[0]
    expect(entityKind(ascModel, asc)).toBe('asc')
    const sim = createSimulation(ascConfig)
    sim.runUntil({ eventType: 'AscPicked' })
    const state = sim.query.ascs().find((a) => a.carrying !== null) ?? sim.query.ascs()[0]
    const view = describeEntity('asc', state)
    expect(view.id).toBe(state.id)
    expect(view.facts.find((f) => f.label === 'inspector.fact.block')!.value).toBe(state.blockId)
    expect(view.facts.find((f) => f.label === 'inspector.fact.stacked')!.value).toBe(state.stacked)
    if (state.carrying) expect(view.job!.map((f) => f.value)).toContain(state.carrying)
  })
})
