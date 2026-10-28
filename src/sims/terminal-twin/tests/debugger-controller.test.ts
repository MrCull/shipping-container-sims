/**
 * The debugger as the browser drives it: the TwinController (playback clock,
 * look-ahead, single-step) talking to the engine host in-process instead of a
 * Web Worker. Proves pause-at-breakpoint and step at fast playback speed.
 */
import { describe, expect, it } from 'vitest'
import { fixtures } from '../scenario/fixtures'
import { TwinController } from '../modules/twinController'
import type { EngineResponse } from '../modules/engineClient'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, EventSummary, WorkerRequest } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']

function inProcessClient() {
  const host = createEngineHost()
  let rid = 0
  return {
    async request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
      const reply = await host.handle({ ...req, rid: ++rid })
      if (!reply.ok) throw new Error(reply.error)
      return { result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo }
    },
    dispose() {},
  }
}

async function loaded() {
  const events: EventSummary[] = []
  const ctl = new TwinController((d) => events.push(...d.events), inProcessClient())
  await ctl.load(config, config.seed)
  return { ctl, events }
}

/** Run the playback loop for up to `maxFrames` 60 Hz frames, until `until()` holds. */
async function play(ctl: TwinController, until: () => boolean, maxFrames = 6000): Promise<number> {
  let frame = 0
  for (; frame < maxFrames && !until(); frame++) {
    ctl.tick(frame * (1000 / 60))
    await new Promise((r) => setTimeout(r, 0))
  }
  return frame
}

describe('breakpoints pause playback', () => {
  it('at x600 the display pauses exactly at the matching event, which the engine has processed', async () => {
    const { ctl } = await loaded()
    await ctl.setBreakpoints([{ id: 1, kind: 'eventType', value: 'ShcRoutingLoaded' }])
    ctl.setSpeed(600)
    await play(ctl, () => ctl.breakHit !== null)
    expect(ctl.breakHit?.event.type).toBe('ShcRoutingLoaded')
    expect(ctl.paused).toBe(true)
    expect(ctl.displayTime).toBe(ctl.breakHit!.event.t)
    expect(ctl.info!.now).toBe(ctl.displayTime)
    const log = await ctl.query<EventSummary[]>('eventLog')
    expect(log.at(-1)!.id).toBe(ctl.breakHit!.event.id)
  })

  it('playing on stops at the next hit, not the same one again', async () => {
    const { ctl } = await loaded()
    await ctl.setBreakpoints([{ id: 1, kind: 'eventType', value: 'StsPicked' }])
    ctl.setSpeed(600)
    await play(ctl, () => ctl.breakHit !== null)
    const first = ctl.breakHit!
    ctl.play()
    expect(ctl.breakHit).toBeNull()
    await play(ctl, () => ctl.breakHit !== null)
    expect(ctl.breakHit!.event.type).toBe('StsPicked')
    expect(ctl.breakHit!.event.id).not.toBe(first.event.id)
    expect(ctl.breakHit!.event.t).toBeGreaterThan(first.event.t)
  })

  it('a flat-out run (Run to…) also stops at the breakpoint and shows it', async () => {
    const { ctl } = await loaded()
    await ctl.setBreakpoints([{ id: 4, kind: 'container', value: ctl.model!.containerIds[1] }])
    await ctl.runTo(1e5)
    expect(ctl.breakHit?.breakpointId).toBe(4)
    expect(ctl.displayTime).toBe(ctl.breakHit!.event.t)
  })

  it('removing the breakpoint lets the run finish', async () => {
    const { ctl } = await loaded()
    await ctl.setBreakpoints([{ id: 1, kind: 'equipment', value: 'SHC01' }])
    await ctl.setBreakpoints([])
    await ctl.runUntil({})
    expect(ctl.breakHit).toBeNull()
    expect(ctl.info!.status).toBe('ended')
  })
})

describe('single-step', () => {
  it.each([1, 60, 600])('processes exactly one event per press at x%i', async (speed) => {
    const { ctl } = await loaded()
    ctl.setSpeed(speed)
    ctl.pause()
    let total = ctl.info!.eventsTotal
    for (let i = 0; i < 5; i++) {
      const ev = await ctl.step()
      expect(ev).not.toBeNull()
      expect(ctl.info!.eventsTotal).toBe(total + 1)
      expect(ctl.displayTime).toBe(ev!.t)
      expect(ctl.paused).toBe(true)
      total = ctl.info!.eventsTotal
    }
  })

  it('stepping onto a breakpoint event reports the hit', async () => {
    const { ctl } = await loaded()
    await ctl.setBreakpoints([{ id: 2, kind: 'eventType', value: 'VesselArrived' }])
    for (let i = 0; i < 10 && !ctl.breakHit; i++) await ctl.step()
    expect(ctl.breakHit?.event.type).toBe('VesselArrived')
  })
})
