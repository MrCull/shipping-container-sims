/**
 * Seam 4, the hero container faces (#255): 3 sizes x 4 face kinds, one GLB each. Reads only the committed GLBs,
 * sidecars, previews and budgets (no Blender), like the CI budget check.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, loadBudgets, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson } from '../cli/assets/glb'

const DIR = join(MODELS_DIR, 'hero')
const SIZES = ['20', '40', '40hc']
const FACES = ['side', 'door', 'front', 'roof']
const names = SIZES.flatMap((s) => FACES.map((f) => `hero-${s}-${f}`))
const meta = (name: string): Record<string, any> => JSON.parse(readFileSync(join(DIR, `${name}.meta.json`), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any

describe('hero container faces', () => {
  it('has a GLB, sidecar and preview for every size and face kind, and an assembled preview per size', () => {
    for (const name of names) {
      expect(existsSync(join(DIR, `${name}.glb`)), name).toBe(true)
      expect(existsSync(join(DIR, `${name}.meta.json`)), name).toBe(true)
      expect(existsSync(join(DIR, 'previews', `${name}-view.webp`)), `${name} preview`).toBe(true)
    }
    for (const s of SIZES) expect(existsSync(join(DIR, 'previews', `hero-${s}-assembled.webp`)), s).toBe(true)
  })

  it('passes the budget check as the hero-container kind, one tinted paint node plus fixed hardware and rubber', () => {
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    for (const name of names) {
      const a = report.assets.find((x) => x.name === name)!
      expect(a.kind).toBe('hero-container')
      expect(a.lods.LOD0.triangles).toBeGreaterThan(60)
      const json = readGlbJson(join(DIR, `${name}.glb`))
      const paint = (json.materials as { name?: string; pbrMetallicRoughness?: Record<string, unknown>; normalTexture?: unknown }[]).find((m) => m.name === 'hero_paint')!
      expect(paint.pbrMetallicRoughness?.baseColorFactor, 'white base colour so livery and tint multiply it').toBeUndefined()
      expect(paint.pbrMetallicRoughness?.metallicRoughnessTexture, 'roughness variation').toBeDefined()
      expect(paint.normalTexture, 'detail normal').toBeDefined()
    }
  })

  it('models the door end furniture and the 20 ft forklift pockets', () => {
    const tris = (n: string) => checkAssetLibrary().assets.find((x) => x.name === n)!.lods.LOD0.triangles
    expect(meta('hero-40-door').nodes.map((n: { name: string }) => n.name)).toEqual(expect.arrayContaining(['paint', 'hardware', 'dark']))
    expect(tris('hero-40-door')).toBeGreaterThan(tris('hero-40-front') * 3)
    expect(meta('hero-40hc-door').provenance.some((p: { fact: string }) => p.fact.includes('5 on high cube'))).toBe(true)
    expect(meta('hero-20-side').provenance.some((p: { fact: string }) => p.fact.includes('forklift pockets'))).toBe(true)
  })

  it('corrugates at about the real 0.25 m pitch', () => {
    for (const name of names) {
      const { ribs, pitchM } = meta(name).hero
      expect(ribs, name).toBeGreaterThan(5)
      expect(pitchM, name).toBeGreaterThan(0.22)
      expect(pitchM, name).toBeLessThan(0.29)
    }
  })

  it('keeps the recommended per-level caps inside the triangle budget measured from the faces', () => {
    const budgets = loadBudgets() as unknown as { heroCaps: { facesPerBox: number; levels: Record<string, { boxes: number; maxTriangles: number }> } }
    const report = checkAssetLibrary()
    const worst = Math.max(...names.map((n) => report.assets.find((x) => x.name === n)!.lods.LOD0.triangles))
    const { facesPerBox, levels } = budgets.heroCaps
    expect(levels.low.boxes).toBe(0)
    expect(levels.high.boxes).toBeGreaterThan(levels.medium.boxes)
    for (const [level, cap] of Object.entries(levels)) {
      expect(cap.boxes * facesPerBox * worst, level).toBeLessThanOrEqual(cap.maxTriangles)
    }
  })

  it('is not referenced at page load: only the lazy hero loader (heroAssets.ts), the dev viewer and tests mention the hero models', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (['assets', 'tests', 'dev', 'docs', 'node_modules'].includes(e.name)) continue
          walk(p)
        } else if (e.name !== 'heroAssets.ts' && /\.(ts|vue)$/.test(e.name) && /models\/hero/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
