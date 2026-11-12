/**
 * #254 production-build check: the performance panel's Benchmark button runs a shortened tour (`?benchmark=quick`) with
 * no console and downloads one well-formed JSON. Software WebGL has no real frame rate, so nothing here asserts fps or ms,
 * only that every field is present and a number for every stage.
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { pickScenario } from './scenarioPicker'

const TRACER = 'tracer-1sts-10-boxes'

const isNumber = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x)

test('the Benchmark button runs the tour in a production build and downloads a complete report', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/sim/terminal-twin?benchmark=quick')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await pickScenario(page, TRACER)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  expect(await page.evaluate(() => typeof (window as { __tt?: unknown }).__tt)).toBe('undefined')

  const downloading = page.waitForEvent('download', { timeout: 200_000 })
  await page.getByTestId('tt-benchmark-start').click()
  await expect(page.getByTestId('tt-benchmark-progress')).toBeVisible()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^terminal-twin-benchmark-.*\.json$/)
  const report = JSON.parse(readFileSync((await download.path()) as string, 'utf8'))

  expect(report.format).toBe(1)
  expect(report.scenario).toMatchObject({ name: TRACER })
  expect(typeof report.build.engineVersion).toBe('string')
  expect(report.build.production).toBe(true)
  expect(typeof report.machine.userAgent).toBe('string')
  expect('gpu' in report.machine && 'hardwareConcurrency' in report.machine && 'devicePixelRatio' in report.machine).toBe(true)

  const views = ['overview', 'yard', 'crane', 'closeup', 'flythrough']
  expect(report.stages.map((s: { name: string }) => s.name)).toEqual([...views.map((v) => `${v}-low`), 'speed-x60', 'speed-x600'])
  for (const stage of report.stages) {
    for (const key of ['frames', 'fps', 'poseMs', 'cpuMs', 'heroFaces', 'achievedSpeed', 'speed']) expect(isNumber(stage[key]), `${stage.name}.${key}`).toBe(true)
    for (const key of ['p50', 'p95', 'p99', 'longest']) expect(isNumber(stage.frameMs[key]), `${stage.name}.frameMs.${key}`).toBe(true)
    for (const group of ['drawCalls', 'triangles', 'boxesPosed']) {
      expect(isNumber(stage[group].mean) && isNumber(stage[group].max), `${stage.name}.${group}`).toBe(true)
    }
    expect(stage.frames).toBeGreaterThan(0)
  }

  // the panel is back to its button, and the tour left the quality setting where it was
  await expect(page.getByTestId('tt-benchmark-start')).toBeVisible()
})
