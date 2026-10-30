/** TT-15: the setup dialog's 2D plan updates with the counts and matches the 3D layout's quay, STS and block positions. */
import { describe, expect, it } from 'vitest'
import { planOf } from '../modules/planModel'
import { SceneModel } from '../modules/sceneModel'
import { applyOverrides } from '../scenario/overrides'
import { relayoutBlocks } from '../scenario/layout'
import { presets } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const withBlockCount = (c: ScenarioConfig, blocks: number): ScenarioConfig => {
  const next: ScenarioConfig = JSON.parse(JSON.stringify(c))
  next.yard!.blocks = Array.from({ length: blocks }, (_, i) => ({ ...next.yard!.blocks[0], id: `B${String(i + 1).padStart(2, '0')}` }))
  return relayoutBlocks(next)
}

describe('plan preview', () => {
  const tti = presets['TTI Algeciras baseline']()

  it('lists the quay, every STS and every block of the config', () => {
    const plan = planOf(tti)
    expect(plan.quay.x1).toBe(850)
    expect(plan.sts.map((s) => s.id)).toHaveLength(8)
    expect(plan.blocks).toHaveLength(16)
    expect(plan.gate).not.toBeNull()
    expect(plan.bounds.x0).toBeLessThanOrEqual(plan.gate!.lanes.x0)
  })

  it('updates as counts change', () => {
    const more = planOf(applyOverrides(tti, { stsCount: 10, quayLengthM: 1000 }))
    expect(more.sts).toHaveLength(10)
    expect(more.quay.x1).toBe(1000)
    expect(planOf(withBlockCount(tti, 10)).blocks).toHaveLength(10)
    const fewer = planOf(withBlockCount(tti, 4))
    expect(fewer.blocks).toHaveLength(4)
    // blocks stay centred on the quay when their number changes
    const mid = (fewer.blocks[0].x + fewer.blocks[3].x) / 2
    expect(mid).toBeCloseTo(425, 0)
  })

  it('matches the 3D scene: STS gantry X, block X and quay length', () => {
    for (const config of [tti, fixtures['asc-2asc-block-conflict'], presets['Small automated']()]) {
      const plan = planOf(config)
      const scene = new SceneModel(config)
      for (const s of plan.sts) expect(scene.stsPose(s.id, 0).gantryX).toBeCloseTo(s.x, 6)
      for (const b of plan.blocks) {
        expect(scene.ascPose(`${b.id}-ASC1`, 0).x).toBeCloseTo(b.x, 6)
        expect((b.stacks.x0 + b.stacks.x1) / 2).toBeCloseTo(b.x, 6)
        expect(scene.blockOfAsc(`${b.id}-ASC1`).x).toBeCloseTo(b.x, 6)
      }
      expect(plan.quay.x1).toBe(scene.config.quay.lengthM)
    }
  })
})
