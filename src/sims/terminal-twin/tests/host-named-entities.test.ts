/**
 * Worker host reads only the entities an event names (#253): for recorded runs the deltas equal those of the
 * full scan (every STS, SHC, ASC and vessel read after every event), and the end-of-request safety net finds nothing.
 */
import { describe, expect, it } from 'vitest'
import { fixtures } from '../scenario/fixtures'
import { TTI_PRESET_NAME, presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, WorkerRequest } from '../worker/protocol'

async function deltas(config: ScenarioConfig, fullScan: boolean, steps: WorkerRequest[]) {
  const h = createEngineHost({ fullScan })
  let rid = 0
  const out: { delta: Delta; hash: string }[] = []
  for (const req of [{ op: 'load', config, seed: config.seed } as WorkerRequest, ...steps]) {
    const reply = await h.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    out.push({ delta: reply.delta, hash: reply.info.eventLogHash })
  }
  return { out, missed: h.missedByEvents() }
}

async function same(config: ScenarioConfig, steps: WorkerRequest[]) {
  const full = await deltas(config, true, steps)
  const named = await deltas(config, false, steps)
  expect(named.out).toEqual(full.out)
  expect(named.missed).toBe(0)
  expect(full.out.some((o) => o.delta.motion.length > 0)).toBe(true)
}

const advances = (to: number, every: number): WorkerRequest[] => {
  const steps: WorkerRequest[] = []
  for (let t = every; t <= to; t += every) steps.push({ op: 'advance', to: t } as WorkerRequest)
  return steps
}

describe('named-entity observation equals the full scan', () => {
  for (const name of Object.keys(fixtures)) {
    it(`fixture ${name}`, async () => {
      await same(fixtures[name], advances(3000, 150))
    })
  }
  it('fixture run flat out', async () => {
    await same(fixtures['two-vessels-compete-for-berth'], [{ op: 'run', condition: {} } as WorkerRequest])
  })
  it('TTI preset slice', async () => {
    await same(presets[TTI_PRESET_NAME](), advances(7200, 900))
  }, 120_000)
})
