/**
 * Debugger through the engine worker host (the seam the browser uses):
 * breakpoints stop runs exactly at the matching event, single-step is one
 * event, and the cause chain equals the engine's `why`.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, EventSummary, WorkerRequest } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']

async function host() {
  const h = createEngineHost()
  let rid = 0
  const call = async <T = unknown>(req: WorkerRequest) => {
    const reply = await h.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    return { result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo }
  }
  await call({ op: 'load', config, seed: config.seed })
  return call
}

describe('breakpoints in the engine host', () => {
  it('a flat-out run stops right after the first event of the breakpoint type and reports it', async () => {
    const call = await host()
    await call({ op: 'setBreakpoints', breakpoints: [{ id: 1, kind: 'eventType', value: 'ShcRoutingLoaded' }] })
    const { result, delta, info } = await call<{ reason: string }>({ op: 'run', condition: {} })
    expect(result.reason).toBe('condition')
    expect(delta.breakpoint?.breakpointId).toBe(1)
    expect(delta.breakpoint?.event.type).toBe('ShcRoutingLoaded')
    // The hit event is the last one processed; the engine clock is at its time.
    expect(info.now).toBe(delta.breakpoint!.event.t)
    const log = (await call<EventSummary[]>({ op: 'query', kind: 'eventLog' })).result
    expect(log[log.length - 1].id).toBe(delta.breakpoint!.event.id)
    expect(log.filter((e) => e.type === 'ShcRoutingLoaded')).toHaveLength(1)
  })

  it('playback look-ahead (advance) stops at a breakpoint too, and continuing stops at the next hit', async () => {
    const call = await host()
    await call({ op: 'setBreakpoints', breakpoints: [{ id: 7, kind: 'eventType', value: 'StsPicked' }] })
    const first = await call({ op: 'advance', to: 1e6 })
    expect(first.delta.breakpoint?.event.type).toBe('StsPicked')
    const second = await call({ op: 'advance', to: 1e6 })
    expect(second.delta.breakpoint?.event.type).toBe('StsPicked')
    expect(second.delta.breakpoint!.event.id).not.toBe(first.delta.breakpoint!.event.id)
  })

  it('without breakpoints nothing is reported, and clearing them lets the run finish', async () => {
    const call = await host()
    await call({ op: 'setBreakpoints', breakpoints: [{ id: 1, kind: 'equipment', value: 'SHC01' }] })
    await call({ op: 'setBreakpoints', breakpoints: [] })
    const { result, delta } = await call<{ reason: string }>({ op: 'run', condition: {} })
    expect(result.reason).toBe('ended')
    expect(delta.breakpoint).toBeNull()
  })

  it('breakpoints survive a reset of the scenario', async () => {
    const call = await host()
    await call({ op: 'setBreakpoints', breakpoints: [{ id: 3, kind: 'decision', value: 'shcDispatch' }] })
    await call({ op: 'reset' })
    const { delta } = await call({ op: 'run', condition: {} })
    expect(delta.breakpoint?.event.type).toMatch(/^Decision/)
  })
})

describe('single-step and cause chain', () => {
  it('each step processes exactly one event and reports a breakpoint when it lands on one', async () => {
    const call = await host()
    await call({ op: 'setBreakpoints', breakpoints: [{ id: 1, kind: 'eventType', value: 'VesselArrived' }] })
    const before = (await call({ op: 'query', kind: 'summary' })).info.eventsTotal
    let hit = false
    for (let i = 1; i <= 12 && !hit; i++) {
      const { info, delta } = await call({ op: 'step' })
      expect(info.eventsTotal).toBe(before + i)
      hit = delta.breakpoint?.event.type === 'VesselArrived'
    }
    expect(hit).toBe(true)
  })

  it('why returns the chain to the root event, equal to the engine why for the same run', async () => {
    const call = await host()
    await call({ op: 'run', condition: {} })
    const log = (await call<EventSummary[]>({ op: 'query', kind: 'eventLog' })).result
    const target = log.filter((e) => e.type === 'ShcDroppedAtWtp').pop()!
    const chain = (await call<EngineEvent[]>({ op: 'why', eventId: target.id })).result
    const reference = createSimulation(config)
    reference.runUntil()
    expect(chain.map((e) => e.id)).toEqual(reference.why(target.id).map((e) => e.id))
    expect(chain[0].id).toBe(target.id)
    expect(chain[chain.length - 1].type).toBe('ScenarioStarted')
    expect(chain[chain.length - 1].causedBy).toBeNull()
  })
})
