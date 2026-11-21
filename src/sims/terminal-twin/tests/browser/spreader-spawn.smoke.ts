/**
 * #142 browser smoke test: the ASC and SHC spreader rigs (GLB) telescope to the box they carry (20 ft short, 40 ft
 * long, like the STS). SHCs spawning facing their first leg is checked in the headless scene
 * (`headless-scene-equipment.test.ts`, #337). Run with `pnpm run test:smoke`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

const SHORT_M = 5.853
const LONG_M = 11.985

async function open(page: Page, fixture: string): Promise<void> {
  await openTwin(page, { scenario: fixture })
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded' || window.__tt!.scene()?.shcAssets === 'loaded', undefined, { timeout: 30_000 }).catch(() => undefined)
}

test('ASC and SHC spreaders are 20 ft long for a 20 ft box and 40 ft long for a 40', { tag: '@equipment' }, async ({ page }) => {
  test.slow()
  await open(page, 'asc-1sts-10-boxes-1block') // 20 ft and 40 ft boxes mixed, STS to SHC to WTP pad to ASC
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded' && window.__tt!.scene()?.shcAssets === 'loaded')
  // The first picks are 40s and the pair of 20s comes at about 735 s: run past it (x30, until each kind has carried both, 40 s wall at most)
  await page.evaluate(() => window.__tt!.setSpeed(30))
  const samples = await page.evaluate(async () => {
    const tt = window.__tt!
    const sizes = Object.fromEntries(((await tt.query('containers')) as { id: string; size: string }[]).map((c) => [c.id, c.size]))
    tt.play()
    const seen: { kind: 'asc' | 'shc'; size: string; mode: string; lengthM: number }[] = []
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        const s = tt.sceneState()!
        const carriers: [('asc' | 'shc'), Record<string, { carrying: boolean; spreaderMode: string; spreaderLengthM: number }>][] = [
          ['asc', s.ascRigs],
          ['shc', s.shcRigs],
        ]
        for (const [kind, rigs] of carriers) {
          for (const [id, rig] of Object.entries(rigs)) {
            if (!rig.carrying) continue
            const box = Object.entries(s.containers).find(([, c]) => c?.kind === kind && c.id === id)
            if (box) seen.push({ kind, size: sizes[box[0]], mode: rig.spreaderMode, lengthM: rig.spreaderLengthM })
          }
        }
        // done once each kind has carried a 20 and a 40 (the 30 s budget, #340); 40 s wall at most
        const both = (['asc', 'shc'] as const).every((k) => seen.some((x) => x.kind === k && x.size === '20') && seen.some((x) => x.kind === k && x.size !== '20'))
        if (!both && performance.now() - t0 < 40_000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    tt.pause()
    return seen
  })
  for (const kind of ['asc', 'shc'] as const) {
    const mine = samples.filter((s) => s.kind === kind)
    expect(mine.length, `${kind} carried something`).toBeGreaterThan(0)
    for (const s of mine) expect(s.lengthM).toBeCloseTo(s.size === '20' ? SHORT_M : LONG_M, 3)
    expect(mine.some((s) => s.size === '20'), `${kind} carried a 20`).toBe(true)
    expect(mine.some((s) => s.size !== '20'), `${kind} carried a 40`).toBe(true)
  }
})
