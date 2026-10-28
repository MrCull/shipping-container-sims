/**
 * Loading a snapshot and rewinding as the browser does it: the TwinController (scene model,
 * display clock) over the engine host in-process. The scene a restored run shows must equal
 * the scene of the original run at the same time. Also storage resilience.
 */
import { describe, expect, it } from 'vitest'
import type { SimSnapshot } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { TwinController } from '../modules/twinController'
import type { EngineResponse } from '../modules/engineClient'
import { openSaveStore, StorageUnavailableError } from '../persistence/saveStore'
import { createEngineHost } from '../worker/engineHost'
import type { Checkpoint, Delta, EngineInfo, WorkerRequest } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']

function link() {
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

function custody(ctl: TwinController, t: number) {
  const m = ctl.model!
  return Object.fromEntries(m.containerIds.map((id) => [id, m.custodyAt(id, t)]))
}

describe('snapshot load and rewind in the browser controller', () => {
  it('a restored run shows the same scene as the original and continues to the same hash', async () => {
    const a = new TwinController(() => {}, link())
    await a.setCheckpointInterval(60)
    await a.load(config, config.seed)
    await a.runUntil({ maxEvents: 120 })
    const t = a.info!.now
    const snapshot = await a.passthrough<SimSnapshot>({ op: 'snapshot' })

    const b = new TwinController(() => {}, link())
    expect(await b.restore(snapshot)).toBe(true)
    expect(b.displayTime).toBe(t)
    expect(b.paused).toBe(true)
    expect(custody(b, t)).toEqual(custody(a, t))
    expect(b.model!.stsPose('STS01', t)).toEqual(a.model!.stsPose('STS01', t))

    await a.runUntil()
    await b.runUntil()
    expect(b.info!.eventLogHash).toBe(a.info!.eventLogHash)
  })

  it('rewinding to a rewind point shows the scene as it was, and running on reproduces the run', async () => {
    const a = new TwinController(() => {}, link())
    await a.setCheckpointInterval(60)
    await a.load(config, config.seed)
    await a.runUntil()
    const end = a.info!.eventLogHash
    const points = await a.query<Checkpoint[]>('checkpoints')
    expect(points.length).toBeGreaterThan(2)
    const p = points[1]
    const before = custody(a, p.t - 1)
    expect(await a.rewind(p)).toBe(true)
    expect(a.paused).toBe(true)
    expect(a.info!.eventsTotal).toBe(p.events)
    expect(custody(a, p.t - 1)).toEqual(before)
    await a.runUntil()
    expect(a.info!.eventLogHash).toBe(end)
  })
})

describe('storage resilience', () => {
  it('reports storage as unavailable without IndexedDB', async () => {
    await expect(openSaveStore(undefined)).rejects.toBeInstanceOf(StorageUnavailableError)
  })

  it('reports storage as unavailable when opening throws (private mode)', async () => {
    const factory = {
      open() {
        const req: Partial<IDBOpenDBRequest> = {}
        setTimeout(() => (req.onerror as () => void)(), 0)
        return req
      },
    } as unknown as IDBFactory
    await expect(openSaveStore(factory)).rejects.toBeInstanceOf(StorageUnavailableError)
  })
})
