/**
 * Even playback pacing (#251): the TwinController against a fake engine that advances at a fixed rate in wall time, on a
 * fake clock. The display must move every frame, stay behind the horizon, report the engine's rate as the achieved speed
 * and return to the chosen speed when the engine speeds up. Large replies are applied over several frames.
 */
import { describe, expect, it } from 'vitest'
import { fixtures } from '../scenario/fixtures'
import { SceneModel } from '../modules/sceneModel'
import { TwinController, sliceDelta } from '../modules/twinController'
import type { EngineResponse } from '../modules/engineClient'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']
const FRAME_MS = 1000 / 60

const emptyDelta = (): Delta => ({ motion: [], custody: [], entities: [], reservations: [], events: [], eventCounts: {}, breakpoint: null })

/** A fake engine: `advance` takes (sim s advanced) / rate wall seconds, and replies with an empty delta. */
function fakeWorld(rate: { value: number }) {
  let clock = 0
  let horizon = 0
  const sizes: number[] = []
  const pending: { due: number; to: number; resolve: (r: EngineResponse<unknown>) => void }[] = []
  const info = (): EngineInfo => ({ now: horizon, status: 'ready', endT: null, endReason: null, eventsTotal: 0, movesCompleted: 0, vesselsCompleted: 0, eventLogHash: '', firstError: null })
  const client = {
    request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
      if (req.op !== 'advance') return Promise.resolve({ result: null as T, delta: emptyDelta(), info: info() })
      sizes.push(req.to - horizon)
      return new Promise((resolve) => {
        pending.push({ due: clock + ((req.to - horizon) / rate.value) * 1000, to: req.to, resolve: resolve as never })
      })
    },
    dispose() {},
  }
  /** Moves the clock one frame, completing requests as they fall due (the clock reads their due time while they do). */
  async function frame(): Promise<void> {
    const end = clock + FRAME_MS
    for (;;) {
      const next = pending[0]
      if (!next || next.due > end) break
      pending.shift()
      clock = Math.max(clock, next.due)
      horizon = Math.max(horizon, next.to)
      next.resolve({ result: null, delta: emptyDelta(), info: info() })
      await new Promise((r) => setTimeout(r, 0))
    }
    clock = end
  }
  return { client, frame, now: () => clock, sizes }
}

async function setup(rate: { value: number }, speed: number) {
  const world = fakeWorld(rate)
  const ctl = new TwinController(() => {}, world.client, { now: world.now })
  await ctl.load(config, config.seed)
  ctl.setSpeed(speed)
  return { ctl, world }
}

async function frames(ctl: TwinController, world: Awaited<ReturnType<typeof setup>>['world'], n: number): Promise<void> {
  for (let f = 0; f < n; f++) {
    await world.frame()
    ctl.tick(world.now())
  }
}

describe('playback pacing', () => {
  it('moves on every frame behind a slow engine, never passes the horizon, and reports the engine rate', async () => {
    const { ctl, world } = await setup({ value: 300 }, 3600)
    let still = 0
    let worstStillMs = 0
    let last = ctl.displayTime
    for (let f = 0; f < 60 * 12; f++) {
      await world.frame()
      ctl.tick(world.now())
      expect(ctl.displayTime).toBeLessThanOrEqual(ctl.info!.now)
      expect(ctl.displayTime).toBeGreaterThanOrEqual(last)
      if (f > 90) {
        still = ctl.displayTime === last ? still + FRAME_MS : 0
        worstStillMs = Math.max(worstStillMs, still)
      }
      last = ctl.displayTime
    }
    expect(worstStillMs).toBeLessThan(100)
    expect(ctl.achievedSpeed).toBeGreaterThan(300 * 0.9)
    expect(ctl.achievedSpeed).toBeLessThan(300 * 1.1)
    expect(ctl.displayTime).toBeGreaterThan(300 * 6)
  })

  it('returns to the chosen speed when the engine speeds up', async () => {
    const rate = { value: 300 }
    const { ctl, world } = await setup(rate, 600)
    await frames(ctl, world, 60 * 6)
    expect(ctl.achievedSpeed).toBeLessThan(600 * 0.9)
    rate.value = 5000
    await frames(ctl, world, 60 * 8)
    expect(ctl.achievedSpeed).toBe(600)
  })

  it('pause and a speed change take effect on the next tick while pacing is active', async () => {
    const { ctl, world } = await setup({ value: 300 }, 3600)
    await frames(ctl, world, 60 * 4)
    ctl.pause()
    const at = ctl.displayTime
    await frames(ctl, world, 1)
    expect(ctl.displayTime).toBe(at)
    ctl.setSpeed(1)
    const before = ctl.displayTime
    await frames(ctl, world, 60)
    expect(ctl.displayTime - before).toBeLessThan(1.5)
    expect(ctl.achievedSpeed).toBe(1)
  })

  it('a look-ahead request is sized to about the request budget, not the whole look-ahead', async () => {
    const { ctl, world } = await setup({ value: 200 }, 3600)
    await frames(ctl, world, 60 * 6)
    // 200 sim s per wall s at a 150 ms budget is 30 sim s; the whole look-ahead would be 5,400
    expect(Math.max(...world.sizes.slice(3))).toBeLessThan(80)
  })
})

describe('applying a delta over several frames', () => {
  it('slices within the allowance, in order, build the same model as the whole delta', async () => {
    const host = createEngineHost()
    await host.handle({ op: 'load', config, seed: config.seed, rid: 1 })
    const reply = (await host.handle({ op: 'advance', to: 900, rid: 2 })) as unknown as { delta: Delta }
    const delta = reply.delta
    const slices = sliceDelta(delta, 7)
    const widest = Math.max(1, ...delta.motion.map((p) => p.segments.length))
    const items = (d: Delta) => (d.newContainers?.length ?? 0) + d.entities.length + d.motion.reduce((n, p) => n + Math.max(1, p.segments.length), 0) + d.custody.length + d.reservations.length + (d.hatch?.length ?? 0)
    expect(slices.length).toBeGreaterThan(3)
    for (const s of slices) expect(items(s)).toBeLessThanOrEqual(7 + widest)
    const whole = new SceneModel(config, config.seed)
    whole.apply(delta)
    const parts = new SceneModel(config, config.seed)
    for (const s of slices) parts.apply(s)
    const plain = (m: SceneModel) => JSON.stringify(m, (_k, v) => (typeof v === "function" ? undefined : v))
    expect(plain(parts)).toBe(plain(whole))
  })

  it('the controller takes a big reply over several ticks and the horizon follows the last slice', async () => {
    const host = createEngineHost()
    let rid = 0
    const client = {
      async request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
        const reply = await host.handle({ ...req, rid: ++rid })
        if (!reply.ok) throw new Error(reply.error)
        return { result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo }
      },
      dispose() {},
    }
    const ctl = new TwinController(() => {}, client, { applyItemsPerFrame: 1 })
    await ctl.load(config, config.seed)
    const horizon0 = ctl.info!.now
    ctl.setSpeed(3600)
    let t = 0
    ctl.tick(t)
    await new Promise((r) => setTimeout(r, 50))
    expect(ctl.info!.now).toBe(horizon0) // slices pending: the display cannot see past the applied horizon
    for (let f = 0; f < 3000 && ctl.info!.now === horizon0; f++) ctl.tick((t += FRAME_MS))
    expect(ctl.info!.now).toBeGreaterThan(horizon0)
  })
})
