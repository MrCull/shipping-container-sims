/**
 * V11-01: every equipment kind (STS, SHC, ASC, truck, vessel) registers in one module (`modules/equipmentKinds/`) and the
 * renderer, dev API, picking, labels and inspector iterate the registry. This test checks the registry and fails on a
 * half-registered kind, so the author learns it from the test run, not from a later merge.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EQUIPMENT_KINDS, kindOfEntity, registrationProblems, type EquipmentKindDef } from '../modules/equipmentKinds'
import { entityBounds } from '../modules/picking'
import { entityKind } from '../modules/entityInspector'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { emptyDelta } from './delta'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, WorkerRequest } from '../worker/protocol'

const shcConfig = fixtures['shc-1sts-2shc-1wtp']
const truckConfig = fixtures['dual-truck-transaction']
const TIME_S = 400

/** A model after the engine has run for a while: a vessel alongside, an STS, SHCs and ASCs at work. */
async function modelAfterRun(): Promise<SceneModel> {
  const host = createEngineHost()
  const model = new SceneModel(shcConfig, shcConfig.seed)
  let rid = 0
  const call = async (req: WorkerRequest) => {
    const reply = await host.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    return reply.delta as Delta
  }
  model.apply(await call({ op: 'load', config: shcConfig, seed: shcConfig.seed }))
  model.apply(await call({ op: 'run', condition: { time: TIME_S } }))
  return model
}

/** A landside model with one truck in the gate queue. */
function modelWithTruck(): SceneModel {
  const model = new SceneModel(truckConfig)
  model.apply(emptyDelta({ entities: [{ kind: 'truck', id: 'T1', t: 0, status: 'queued' }] }))
  return model
}

const catalogue = readFileSync(new URL('../i18n/messages.ts', import.meta.url), 'utf8')

describe('equipment-kind registry', () => {
  it('registers the five kinds once each', () => {
    const names = EQUIPMENT_KINDS.map((k) => k.kind)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(['asc', 'shc', 'sts', 'truck', 'vessel'])
  })

  for (const def of EQUIPMENT_KINDS) {
    describe(def.kind, () => {
      it('is fully registered', () => {
        expect(registrationProblems(def)).toEqual([])
      })

      it('has an inspector catalogue entry', () => {
        expect(catalogue).toContain(`'inspector.kind.${def.kind}'`)
      })

      it('is found by id, has bounds, and scene state for the dev API', async () => {
        const model = def.kind === 'truck' ? modelWithTruck() : await modelAfterRun()
        const ids = def.ids(model)
        expect(ids.length).toBeGreaterThan(0)
        const id = ids[0]!
        expect(kindOfEntity(model, id)).toBe(def.kind)
        expect(entityKind(model, id)).toBe(def.kind)
        expect(entityBounds(model, id, TIME_S)).not.toBeNull()
        expect(def.sceneState(model, id, TIME_S)).toHaveProperty('status')
        expect(def.sceneKey).not.toBe(def.rigKey)
      })
    })
  }

  it('fails on a half-registered kind', () => {
    const half = { ...EQUIPMENT_KINDS[0]!, bounds: undefined, createRenderer: undefined, describe: undefined } as unknown as EquipmentKindDef
    const problems = registrationProblems(half).join(' ')
    expect(problems).toMatch(/bounds/)
    expect(problems).toMatch(/createRenderer/)
    expect(problems).toMatch(/describe/)
  })
})
