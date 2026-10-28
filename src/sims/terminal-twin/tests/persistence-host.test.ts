/**
 * Snapshot resume and rewind over the worker protocol (TT-17). Seam: the engine host
 * (`createEngineHost`), the same requests the browser sends.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type SimSnapshot } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { createEngineHost } from '../worker/engineHost'
import type { Checkpoint, Delta, WorkerReply, WorkerRequest } from '../worker/protocol'

const FIXTURE = 'asc-1sts-10-boxes-1block'
const config = fixtures[FIXTURE]

function newHost() {
  const host = createEngineHost()
  let rid = 0
  return async (req: WorkerRequest): Promise<Extract<WorkerReply, { ok: true }>> => {
    const reply = await host.handle({ ...req, rid: rid++ } as never)
    if (!reply.ok) throw new Error(reply.error)
    return reply
  }
}

function reference(): { hash: string; log: { id: number; t: number; type: string }[] } {
  const sim = createSimulation(config)
  sim.runUntil()
  return { hash: sim.eventLogHash(), log: sim.eventLog().map((e) => ({ id: e.id, t: e.t, type: e.type })) }
}

describe('rewind points', () => {
  it('are recorded every interval as the run passes it, each with the hash of the log before it', async () => {
    const call = newHost()
    await call({ op: 'setCheckpointInterval', seconds: 60 })
    await call({ op: 'load', config, seed: config.seed })
    await call({ op: 'run', condition: {} })
    const points = (await call({ op: 'query', kind: 'checkpoints' })).result as Checkpoint[]
    expect(points.length).toBeGreaterThan(2)
    points.forEach((p, i) => expect(p.t).toBe((i + 1) * 60))
    // independent check: a fresh run stopped after `events` events has the recorded hash
    const p = points[1]
    const sim = createSimulation(config)
    sim.runUntil({ maxEvents: p.events })
    expect(sim.eventLogHash()).toBe(p.hash)
    expect(sim.eventLog().every((e) => e.t < p.t)).toBe(true)
  })

  it('default to every 15 sim-minutes', async () => {
    const call = newHost()
    await call({ op: 'load', config, seed: config.seed })
    await call({ op: 'run', condition: {} })
    const points = (await call({ op: 'query', kind: 'checkpoints' })).result as Checkpoint[]
    for (const p of points) expect(p.t % 900).toBe(0)
  })

  it('jumping back and running forward reproduces the original events from that point', async () => {
    const call = newHost()
    await call({ op: 'setCheckpointInterval', seconds: 60 })
    await call({ op: 'load', config, seed: config.seed })
    await call({ op: 'run', condition: {} })
    const ref = reference()
    const points = (await call({ op: 'query', kind: 'checkpoints' })).result as Checkpoint[]
    const p = points[Math.floor(points.length / 2)]
    const back = await call({ op: 'rewind', events: p.events, hash: p.hash })
    expect((back.result as { hashMatched: boolean }).hashMatched).toBe(true)
    expect(back.info.eventsTotal).toBe(p.events)
    const rest = await call({ op: 'run', condition: {} })
    expect(rest.info.eventLogHash).toBe(ref.hash)
    const log = (await call({ op: 'query', kind: 'eventLog' })).result as { id: number; t: number; type: string }[]
    expect(log.slice(p.events).map((e) => [e.id, e.t, e.type])).toEqual(ref.log.slice(p.events).map((e) => [e.id, e.t, e.type]))
    // the rewound timeline's later points are rebuilt, identical to the first run's
    const again = (await call({ op: 'query', kind: 'checkpoints' })).result as Checkpoint[]
    expect(again).toEqual(points)
  })

  it('a hash that does not match the replay is reported', async () => {
    const call = newHost()
    await call({ op: 'load', config, seed: config.seed })
    const res = await call({ op: 'rewind', events: 5, hash: 'nope' })
    expect((res.result as { hashMatched: boolean }).hashMatched).toBe(false)
  })
})

describe('restore', () => {
  it('a mid-run snapshot restored into a fresh host continues identically to an uninterrupted run', async () => {
    const a = newHost()
    await a({ op: 'load', config, seed: config.seed })
    await a({ op: 'run', condition: { maxEvents: 50 } })
    const snapshot = (await a({ op: 'snapshot' })).result as SimSnapshot

    const b = newHost()
    const res = await b({ op: 'restore', snapshot })
    expect((res.result as { hashMatched: boolean }).hashMatched).toBe(true)
    expect(res.info.eventsTotal).toBe(50)
    // the scene learns the whole history from the restore's delta
    const delta: Delta = res.delta
    expect(delta.custody.length).toBeGreaterThan(0)
    const end = await b({ op: 'run', condition: {} })
    expect(end.info.eventLogHash).toBe(reference().hash)
  })

  it('restores the snapshot state exactly, including an injected event still in the queue', async () => {
    const sim = createSimulation(config)
    sim.runUntil({ maxEvents: 20 })
    sim.inject('WarmUpEnded', sim.now + 1, {}, { warmUpS: 0 })
    const snapshot = sim.snapshot()
    const b = newHost()
    const res = await b({ op: 'restore', snapshot })
    expect(res.info.eventsTotal).toBe(20)
    expect((await b({ op: 'snapshot' })).result).toEqual(snapshot)
  })
})
