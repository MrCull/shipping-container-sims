/**
 * #142 browser smoke tests: the ASC and SHC spreaders telescope to the box they carry (20 ft short, 40 ft long, like
 * the STS), and shuttle carriers spawn facing their first leg. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const SHORT_M = 5.853
const LONG_M = 11.985

async function open(page: Page, fixture: string): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), fixture)
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded' || window.__tt!.scene()?.shcAssets === 'loaded', undefined, { timeout: 30_000 }).catch(() => undefined)
}

test('ASC and SHC spreaders are 20 ft long for a 20 ft box and 40 ft long for a 40', async ({ page }) => {
  test.slow()
  await open(page, 'asc-1sts-10-boxes-1block') // 20 ft and 40 ft boxes mixed, STS to SHC to WTP pad to ASC
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded' && window.__tt!.scene()?.shcAssets === 'loaded')
  await page.evaluate(() => window.__tt!.setSpeed(10))
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
        if (performance.now() - t0 < 40_000) requestAnimationFrame(tick)
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

test('each SHC faces its first leg before it moves: no turn on the first move', async ({ page }) => {
  await open(page, 'shc-1sts-2shc-1wtp')
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await page.evaluate(() => window.__tt!.setSpeed(10))
  const samples = await page.evaluate(async () => {
    const tt = window.__tt!
    tt.play()
    const out: { id: string; yaw: number; steer: number; travelling: boolean }[] = []
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        for (const [id, p] of Object.entries(tt.sceneState()!.shcs)) out.push({ id, yaw: p.yaw, steer: p.steerRad, travelling: p.travelling })
        if (performance.now() - t0 < 20_000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    tt.pause()
    return out
  })
  const ids = [...new Set(samples.map((s) => s.id))]
  expect(ids.length).toBeGreaterThan(0)
  for (const id of ids) {
    const mine = samples.filter((s) => s.id === id)
    const first = mine.findIndex((s) => s.travelling)
    if (first < 1) continue // never moved in the window, or moved from the first sample
    // the yaw it stood at is the yaw it drives off at, and it does not steer while it pulls away
    expect(mine[first].yaw).toBeCloseTo(mine[first - 1].yaw, 6)
    expect(Math.abs(mine[first].steer)).toBeLessThan(1e-6)
  }
})
