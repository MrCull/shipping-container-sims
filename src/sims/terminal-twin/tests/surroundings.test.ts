/**
 * Spec #116 / ticket #123: the TTI Algeciras surroundings (shore, anchorage, tanks, landside, town) live in the terminal
 * folder, the generic coastline shows none of them, and together they stay inside a stated draw-call and triangle budget
 * that the asset budget check enforces.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, loadBudgets, MODELS_DIR } from '../cli/assets/budgetCheck'
import { backdropModelAssets, buildBackdrop, GENERIC_SCENERY, sceneryFor } from '../modules/backdrop'
import { INFRA_ASSET_NAMES } from '../modules/infrastructureAssets'
import { SMALL_PRESET_NAME } from '../scenario/presets'
import { ROCK, SURROUNDINGS, TTI_PRESET_NAME } from '../terminals/tti-algeciras/constants'

const PARTS = ['shore', 'anchorage', 'tanks', 'landside', 'town']
const ASSETS = ['scenery-shore', 'scenery-anchorage', 'scenery-tanks', 'scenery-landside', 'scenery-town']

describe('TTI Algeciras surroundings', () => {
  it('are TTI scenery parts backed by scenery GLBs, and the generic coastline has none', () => {
    const tti = sceneryFor(TTI_PRESET_NAME)
    for (const part of PARTS) expect(tti.parts).toContain(part)
    expect(backdropModelAssets(tti)).toEqual(expect.arrayContaining(ASSETS))
    for (const part of PARTS) expect(GENERIC_SCENERY.parts).not.toContain(part)
    expect(backdropModelAssets(sceneryFor(SMALL_PRESET_NAME)).filter((a) => a.startsWith('scenery-'))).toEqual([])
    const generic = buildBackdrop(sceneryFor(SMALL_PRESET_NAME), 850)
    const tt = buildBackdrop(tti, 850)
    const names = (b: typeof tt) => b.group.children.map((c) => c.name)
    for (const part of PARTS) {
      expect(names(generic)).not.toContain(part)
      expect(names(tt)).toContain(part)
    }
    generic.dispose()
    tt.dispose()
  })

  it('each part is one mesh (one draw call) and sits where the reference puts it', () => {
    const b = buildBackdrop(sceneryFor(TTI_PRESET_NAME), 850)
    const at = (n: string) => b.group.getObjectByName(n)!.position
    for (const part of PARTS) expect(b.group.getObjectByName(part)).toBeDefined()
    // shore and anchorage lie out in the bay (east, -z); the shore is level with the Rock, the anchorage nearer
    expect(at('shore').z).toBeCloseTo(-ROCK.distanceM, 0)
    expect(at('anchorage').z).toBeLessThan(-1500)
    expect(at('anchorage').z).toBeGreaterThan(-ROCK.distanceM)
    // road, rail, tanks and town are landward (+z) of the whole terminal
    expect(at('landside').z).toBeGreaterThan(500) // the yard and gate end near z = 500
    expect(at('tanks').z).toBeGreaterThan(500)
    expect(at('town').z).toBeGreaterThan(at('landside').z)
    b.dispose()
  })

  it('names assets that exist, with a draw-call and triangle budget the budget check enforces', () => {
    expect([...SURROUNDINGS.assets]).toEqual(ASSETS)
    for (const n of ASSETS) expect(INFRA_ASSET_NAMES).toContain(n as (typeof INFRA_ASSET_NAMES)[number])
    const budgets = loadBudgets()
    expect(budgets.groups?.['tti-surroundings']).toEqual({ assets: ASSETS, maxTriangles: SURROUNDINGS.maxTriangles, maxDrawCalls: SURROUNDINGS.maxDrawCalls })
    expect(SURROUNDINGS.maxDrawCalls).toBeLessThanOrEqual(5)
    expect(SURROUNDINGS.maxTriangles).toBeLessThanOrEqual(20000)
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const found = report.assets.filter((a) => ASSETS.includes(a.name))
    expect(found.map((a) => a.name).sort()).toEqual([...ASSETS].sort())
    for (const a of found) {
      expect(a.kind).toBe('scenery')
      expect(a.lods.LOD0.drawCalls).toBe(1)
      expect(a.lods.LOD0.triangles).toBeGreaterThan(100)
    }
    const total = found.reduce((s, a) => s + a.lods.LOD0.triangles, 0)
    expect(total).toBeLessThanOrEqual(SURROUNDINGS.maxTriangles)
  })

  it('records the generator facts of each asset in a sidecar', () => {
    for (const n of ASSETS) {
      const file = join(MODELS_DIR, 'infrastructure', `${n}.meta.json`)
      expect(existsSync(file)).toBe(true)
      const meta = JSON.parse(readFileSync(file, 'utf8'))
      expect(meta.kind).toBe('scenery')
      expect(meta.provenance.length).toBeGreaterThan(1)
    }
  })
})
