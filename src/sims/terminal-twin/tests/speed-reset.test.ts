/**
 * #157: every run start puts the speed back to the default x10; a speed chosen during a run is kept until then.
 * Seam: the twin store (what the top bar reads), over the engine host in-process instead of the Web Worker.
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineResponse } from '../modules/engineClient'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../worker/protocol'

vi.mock('../modules/engineClient', () => ({
  EngineClient: class {
    private host = createEngineHost()
    private rid = 0
    async request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
      const reply = await this.host.handle({ ...req, rid: ++this.rid })
      if (!reply.ok) throw new Error(reply.error)
      return { result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo }
    }
    dispose() {}
  },
}))

const { useTwinStore } = await import('../store/twinStore')

const TRACER = 'tracer-1sts-10-boxes'

async function runningAtX600() {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: TRACER, seed: 3 })
  store.setSpeed(600)
  expect(store.speed).toBe(600)
  return store
}

describe('speed on run start', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts the first run at x10', async () => {
    const store = useTwinStore()
    await store.startScenario({ ...store.choice, name: TRACER, seed: 3 })
    expect(store.speed).toBe(10)
  })

  it('New scenario then Start resets x600 to x10', async () => {
    const store = await runningAtX600()
    store.newScenario()
    await store.startScenario({ ...store.choice, name: TRACER, seed: 4 })
    expect(store.speed).toBe(10)
    expect(store.controller()!.speed).toBe(10)
  })

  it('Reset (restart from t = 0) resets x600 to x10', async () => {
    const store = await runningAtX600()
    await store.reset()
    expect(store.speed).toBe(10)
  })

  it('loading a config save resets x600 to x10', async () => {
    const store = await runningAtX600()
    const text = JSON.stringify(await store.buildSave('config'))
    store.setSpeed(600)
    expect(await store.importSaveText(text)).toBe('loaded')
    expect(store.speed).toBe(10)
  })

  it('loading a snapshot save resets x600 to x10', async () => {
    const store = await runningAtX600()
    await store.runTo(60)
    const text = JSON.stringify(await store.buildSave('snapshot'))
    store.setSpeed(600)
    expect(await store.importSaveText(text)).toBe('loaded')
    expect(store.speed).toBe(10)
  })

  it('keeps a mid-run speed across pause, play, New scenario then Cancel, and the dashboard', async () => {
    const store = await runningAtX600()
    store.pause()
    store.togglePause()
    store.newScenario()
    store.cancelSetup()
    store.toggleDashboard()
    store.toggleDashboard()
    store.sync()
    expect(store.speed).toBe(600)
  })
})
