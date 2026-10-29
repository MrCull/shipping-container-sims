/**
 * V11-05 browser smoke: view presets by dev API, button and shortcut; the help lists the shortcuts; the TTI Overview
 * with Labels on has no two visible labels overlapping; the HUD regions still do not overlap with the new controls.
 * Dev-only `window.__tt` API. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import { overlappingRegions } from '../../modules/hudLayout'
import type {} from '../../dev/devApi' // window.__tt typing

async function open(page: Page, scenario: string): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), scenario)
  await page.evaluate(() => window.__tt!.runUntil({ maxEvents: 400 }))
  await expect(page.getByTestId('tt-kpi-strip')).toBeVisible()
}

test('presets frame each region; the dev API, buttons and shortcuts set them', async ({ page }) => {
  await open(page, 'landside-morning-peak')
  const targets: Record<string, { x: number; z: number }> = {}
  for (const name of ['quay', 'yard', 'gate', 'overview']) {
    expect(await page.evaluate((n) => window.__tt!.viewPreset(n), name), name).toBe(true)
    targets[name] = (await page.evaluate(() => window.__tt!.cameraTarget()))!
  }
  expect(await page.evaluate(() => window.__tt!.viewPreset('nope'))).toBe(false)
  // the quay view looks at the water side of the yard view
  expect(targets.quay.z).toBeLessThan(targets.yard.z)

  await page.getByTestId('tt-view-yard').click()
  const yard = (await page.evaluate(() => window.__tt!.cameraTarget()))!
  expect(yard.z).toBeCloseTo(targets.yard.z, 3)
  await page.getByTestId('tt-view-quay').click()
  expect((await page.evaluate(() => window.__tt!.cameraTarget()))!.z).toBeCloseTo(targets.quay.z, 3)

  await page.keyboard.press('g')
  expect((await page.evaluate(() => window.__tt!.cameraTarget()))!.x).toBeCloseTo(targets.gate.x, 3)
  await page.keyboard.press('v')
  expect((await page.evaluate(() => window.__tt!.cameraTarget()))!.x).toBeCloseTo(targets.overview.x, 3)

  // listed in the ? help
  await page.keyboard.press('?')
  const help = page.getByRole('dialog')
  for (const text of ['View: quay', 'View: yard', 'View: landside and gate', 'View: whole terminal']) await expect(help).toContainText(text)
})

test('with Labels on, the TTI Overview shows no two overlapping labels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await open(page, 'TTI Algeciras baseline')
  await page.evaluate(() => window.__tt!.overlays({ labels: true }))
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  await expect.poll(async () => (await page.evaluate(() => window.__tt!.scene()))!.layers.labels, { timeout: 20_000 }).toBeGreaterThan(0)
  const layers = (await page.evaluate(() => window.__tt!.scene()))!.layers
  const boxes = layers.labelBoxes
  expect(boxes.length).toBe(layers.labels)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      expect(apart, `${a.id} and ${b.id}`).toBe(true)
    }
  const layout = await page.evaluate(() => window.__tt!.hudLayout())
  expect(overlappingRegions(layout)).toEqual([])
})
