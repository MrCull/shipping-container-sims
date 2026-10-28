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
