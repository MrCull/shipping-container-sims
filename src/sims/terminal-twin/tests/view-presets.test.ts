/**
 * V11-05: view presets are camera poses computed from the layout. Each preset's target lies inside the layout region
 * it names, on the TTI and Small presets and the landside fixture; shortcuts are in the table and the help.
 */
import { describe, expect, it } from 'vitest'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { presets, TTI_PRESET_NAME } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'
import { SHORTCUT_HELP, shortcutFor } from '../modules/shortcuts'
import { VIEW_PRESETS, viewPresetPose } from '../modules/viewPresets'

const cases: [string, () => ScenarioConfig][] = [
  ['TTI preset', () => presets[TTI_PRESET_NAME]()],
  ['Small preset', () => presets['Small automated']()],
  ['landside fixture', () => fixtures['landside-morning-peak']],
]

describe.each(cases)('view presets on the %s', (_name, make) => {
  const model = new SceneModel(make())

  it.each(VIEW_PRESETS)('%s: the target lies inside its region and the camera is a sane distance away', (preset) => {
    const pose = viewPresetPose(model, preset)
    if (!pose) {
      expect(preset).toBe('gate') // only the gate view needs a landside
      expect(model.landside).toBeNull()
      return
    }
    const { target, region } = pose
    expect(target.x).toBeGreaterThanOrEqual(region.minX)
    expect(target.x).toBeLessThanOrEqual(region.maxX)
    expect(target.z).toBeGreaterThanOrEqual(region.minZ)
    expect(target.z).toBeLessThanOrEqual(region.maxZ)
    expect(pose.distanceM).toBeGreaterThan(20)
    expect(pose.distanceM).toBeLessThan(3500)
  })

  it('the regions name the right things', () => {
    const quay = viewPresetPose(model, 'quay')!.region
    for (const id of model.stsIds) {
      const c = model.entityCentre(id, 0)!
      expect(c.x).toBeGreaterThanOrEqual(quay.minX)
      expect(c.x).toBeLessThanOrEqual(quay.maxX)
    }
    expect(quay.minZ).toBeLessThanOrEqual(0)
    const yard = viewPresetPose(model, 'yard')!.region
    for (const b of model.blockList) {
      const c = model.entityCentre(b.id, 0)!
      expect(c.x).toBeGreaterThanOrEqual(yard.minX)
      expect(c.x).toBeLessThanOrEqual(yard.maxX)
      expect(c.z).toBeGreaterThanOrEqual(yard.minZ)
      expect(c.z).toBeLessThanOrEqual(yard.maxZ)
    }
    const gate = viewPresetPose(model, 'gate')?.region
    if (gate) {
      const g = model.entityCentre('gate', 0)!
      expect(g.x).toBeGreaterThanOrEqual(gate.minX)
      expect(g.x).toBeLessThanOrEqual(gate.maxX)
      for (const s of model.landside!.stalls) {
        expect(s.x).toBeGreaterThanOrEqual(gate.minX)
        expect(s.x).toBeLessThanOrEqual(gate.maxX)
        expect(s.z).toBeGreaterThanOrEqual(gate.minZ)
        expect(s.z).toBeLessThanOrEqual(gate.maxZ)
      }
    }
    const all = viewPresetPose(model, 'overview')!.region
    for (const r of [quay, yard]) {
      expect(all.minX).toBeLessThanOrEqual(r.minX)
      expect(all.maxX).toBeGreaterThanOrEqual(r.maxX)
      expect(all.minZ).toBeLessThanOrEqual(r.minZ)
      expect(all.maxZ).toBeGreaterThanOrEqual(r.maxZ)
    }
  })

  it('a wider window needs the camera no further away than a narrow one', () => {
    const wide = viewPresetPose(model, 'overview', 2.4)!.distanceM
    const narrow = viewPresetPose(model, 'overview', 0.6)!.distanceM
    expect(wide).toBeLessThanOrEqual(narrow)
  })
})

describe('view preset shortcuts', () => {
  const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: null })

  it('Q, Y, G and V pick a preset', () => {
    expect(shortcutFor(key('q'))).toEqual({ kind: 'view', preset: 'quay' })
    expect(shortcutFor(key('y'))).toEqual({ kind: 'view', preset: 'yard' })
    expect(shortcutFor(key('g'))).toEqual({ kind: 'view', preset: 'gate' })
    expect(shortcutFor(key('v'))).toEqual({ kind: 'view', preset: 'overview' })
  })

  it('are listed in the help and ignored in inputs or with modifiers', () => {
    const actions = SHORTCUT_HELP.map((r) => r.action)
    for (const a of ['shortcuts.viewQuay', 'shortcuts.viewYard', 'shortcuts.viewGate', 'shortcuts.viewOverview']) expect(actions).toContain(a)
    expect(shortcutFor({ ...key('q'), ctrlKey: true })).toBeNull()
  })
})
