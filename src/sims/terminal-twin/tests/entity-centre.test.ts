/**
 * V11-04: `entityCentre` (what `cameraTo` and follow aim at) covers every entity kind the inspector shows: trucks,
 * yard blocks, transfer stalls, WTP pads, the gate, STS cranes, SHCs, ASCs and vessels. Null only for unknown ids.
 */
import { describe, expect, it } from 'vitest'
import { transferStallId } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { presets, TTI_PRESET_NAME } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import { emptyDelta } from './delta'

const cases: [string, () => ScenarioConfig][] = [
  ['landside fixture', () => fixtures['landside-morning-peak']],
  ['TTI preset', () => presets[TTI_PRESET_NAME]()],
]

describe.each(cases)('entityCentre on the %s', (_name, make) => {
  const config = make()
  const model = new SceneModel(config)
  model.apply(emptyDelta({ entities: [{ kind: 'truck', id: 'T1', t: 0, status: 'queued' }] }))
  const block = model.blockList[0]
  const T = 0

  it('answers for one entity of each kind', () => {
    const ids = [
      'T1',
      block.id,
      transferStallId(block.id, 0),
      model.graph.pads.find((p) => p.blockId === block.id)!.id,
      'gate',
      model.stsIds[0],
      model.shcIds[0],
      model.ascIds[0],
      model.vesselIds[0],
    ]
    for (const id of ids) expect(model.entityCentre(id, T), id).not.toBeNull()
  })

  it('is null only for unknown ids', () => {
    expect(model.entityCentre('NOPE', T)).toBeNull()
    expect(model.entityCentre('B99', T)).toBeNull()
  })

  it('puts a block, stall, pad and the gate at their centres', () => {
    const b = model.entityCentre(block.id, T)!
    expect(b.x).toBeCloseTo(block.x, 6)
    // centre of the stacked bays (bay pitch 6.7 m, bay 1 at firstBayZ)
    expect(b.z).toBeCloseTo(block.firstBayZ + ((block.bays - 1) * 6.7) / 2, 6)
    const stall = model.landside!.stalls.find((s) => s.blockId === block.id)!
    const s = model.entityCentre(stall.id, T)!
    expect([s.x, s.z]).toEqual([stall.x, stall.z])
    const pad = model.graph.pads.find((p) => p.blockId === block.id)!
    const p = model.entityCentre(pad.id, T)!
    expect([p.x, p.z]).toEqual([pad.x, pad.z])
    const g = model.entityCentre('gate', T)!
    expect(g.z).toBeCloseTo(model.landside!.gate.kioskZ, 6)
  })

  it('finds a vessel that has not arrived yet (it waits at the anchorage position)', () => {
    expect(model.entityCentre(model.vesselIds[0], 0)).not.toBeNull()
  })
})

describe('entityCentre on holding positions (TT-R16)', () => {
  const model = new SceneModel(fixtures['truck-holding-overflow'])

  it('aims at one holding position or at the middle of all of them', () => {
    const [h1, h2] = (model.landside as NonNullable<typeof model.landside>).holding
    expect(model.entityCentre('H1', 0)).toMatchObject({ x: h1.x, z: h1.z })
    expect(model.entityCentre('holding', 0)).toMatchObject({ x: (h1.x + h2.x) / 2, z: h1.z })
  })

  it('is null for a holding position that does not exist, and for a scene without holding', () => {
    expect(model.entityCentre('H9', 0)).toBeNull()
    expect(new SceneModel(fixtures['truck-gate-queue']).entityCentre('holding', 0)).toBeNull()
  })
})

describe('entityCentre of a truck that left', () => {
  it('is null once the truck is gone', () => {
    const model = new SceneModel(fixtures['landside-morning-peak'])
    model.apply(emptyDelta({ entities: [{ kind: 'truck', id: 'T1', t: 0, status: 'queued' }, { kind: 'truck', id: 'T1', t: 50, status: 'gone' }] }))
    expect(model.entityCentre('T1', 10)).not.toBeNull()
    expect(model.entityCentre('T1', 60)).toBeNull()
  })
})
