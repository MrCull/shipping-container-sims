/**
 * Engine rate per speed step in the browser (#246), the second half of `pnpm run tt:baseline`: the engine in its worker,
 * a playback clock driven as the scene drives it, and no rendering at all (no scene is built), so what limits the
 * achieved rate is the engine plus the main thread applying its deltas. Skipped unless `TT_BASELINE_OUT` names the
 * JSON file to write (the baseline command sets it); never run in CI (`@load`).
 */
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const OUT = process.env.TT_BASELINE_OUT
const SPEEDS = [60, 120, 300, 600, 1200, 1800, 3600]

test('engine rate per speed step, rendering excluded @load @baseline', async ({ page }) => {
  test.skip(!OUT, 'run through pnpm run tt:baseline')
  test.setTimeout(1_200_000)
  const preset = process.env.TT_BASELINE_PRESET ?? 'TTI Algeciras baseline'
  const startS = Number(process.env.TT_BASELINE_START_S ?? 7200)
  const windowMs = Number(process.env.TT_BASELINE_WINDOW_MS ?? 8000)
  await page.goto('/')
  const rows: { speed: number; achieved: number; engine: number; wallS: number }[] = []
  for (const speed of SPEEDS) {
    const row = await page.evaluate(
      async (o) => {
        const load = (path: string): Promise<any> => import(/* @vite-ignore */ path) // eslint-disable-line @typescript-eslint/no-explicit-any
        const { TwinController } = await load('/src/sims/terminal-twin/modules/twinController.ts')
        const { presets } = await load('/src/sims/terminal-twin/scenario/presets.ts')
        const config = presets[o.preset]()
        const controller = new TwinController()
        await controller.load(config, config.seed)
        await controller.runTo(o.startS)
        controller.setSpeed(o.speed)
        const timer = setInterval(() => controller.tick(performance.now()), 16)
        // the display clock waits for the engine's look-ahead first; let it settle before measuring
        await new Promise((r) => setTimeout(r, 2000))
        const d0 = controller.displayTime
        const e0 = controller.info.now
        const w0 = performance.now()
        await new Promise((r) => setTimeout(r, o.windowMs))
        const wallS = (performance.now() - w0) / 1000
        const out = { speed: o.speed, achieved: (controller.displayTime - d0) / wallS, engine: (controller.info.now - e0) / wallS, wallS }
        clearInterval(timer)
        controller.dispose()
        return out
      },
      { speed, preset, startS, windowMs },
    )
    console.log(`x${speed}: achieved ${row.achieved.toFixed(0)} sim s per wall s, engine advanced ${row.engine.toFixed(0)}`)
    rows.push(row)
  }
  writeFileSync(OUT!, `${JSON.stringify({ preset, startS, windowMs, rows }, null, 2)}\n`)
  expect(rows.length).toBe(SPEEDS.length)
})
