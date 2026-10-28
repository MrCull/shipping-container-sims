/**
 * TT-07 browser smoke tests: KPI strip, end conditions, final report and export.
 * Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { HeadlineKpis } from '../../engine'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'asc-1sts-10-boxes-1block'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, options?: Parameters<NonNullable<typeof window.__tt>['load']>[1]): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(([name, opts]) => window.__tt!.load(name as string, opts as never), [FIXTURE, options ?? {}])
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('the KPI strip is over the 3D view and shows the engine headline KPIs', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runTo(900))
  const strip = page.getByTestId('tt-kpi-strip')
  await expect(strip).toBeVisible()
  const { headline } = await page.evaluate(() => window.__tt!.query<{ headline: HeadlineKpis }>('kpiHeadline'))
  expect(headline.movesDone).toBeGreaterThan(0)
  // the strip polls once a second; wait for it to settle on the engine's numbers
  await expect(page.getByTestId('tt-kpi-moves')).toHaveAttribute('data-value', String(headline.movesDone))
  await expect(page.getByTestId('tt-kpi-moves')).toContainText(String(headline.movesDone))
  await expect(page.getByTestId('tt-kpi-asc')).toBeVisible()
  await expect(page.getByTestId('tt-kpi-yard')).toBeVisible()
  const box = await strip.boundingBox()
  const scene = await page.getByTestId('tt-scene').boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(scene!.y)
  expect(box!.x + box!.width).toBeLessThanOrEqual(scene!.x + scene!.width)
  expect(errors).toEqual([])
})

test('an end condition ends the run: report shown, time controls locked, scene still inspectable', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, { endConditions: { moves: 4 } })
  await page.evaluate(() => window.__tt!.runUntil())
  const report = page.getByTestId('tt-final-report')
  await expect(report).toBeVisible()
  await expect(page.getByTestId('tt-report-reason')).toContainText('Reached 4 container moves')
  await expect(page.getByTestId('tt-report-highlights')).toContainText('STS01 worked hardest')
  await expect(page.getByTestId('tt-report-moves')).toHaveText('4')

  // time controls are disabled; Reset and New Scenario still work
  await expect(page.locator('[data-speed="10"]')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Run to…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reset' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'New Scenario' })).toBeEnabled()
  await page.evaluate(() => window.__tt!.setSpeed(60))
  expect((await page.evaluate(() => window.__tt!.clock())).paused).toBe(true)

  // the scene and the queries stay usable after the end
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  expect((await page.evaluate(() => window.__tt!.scene()))!.containers).toBeGreaterThan(0)
  await page.evaluate(() => window.__tt!.select('STS01'))
  expect((await page.evaluate(() => window.__tt!.ui())).selectedId).toBe('STS01')
  expect((await page.evaluate(() => window.__tt!.query<{ movesCompleted: number }>('kpis'))).movesCompleted).toBe(4)

  // the report opened as the dashboard's report tab (TT-16); closing the dashboard docks it over the 3D view
  await expect(page.getByTestId('tt-dashboard-report')).toBeVisible()
  await page.getByTestId('tt-dashboard-close').click()
  await expect(page.getByTestId('tt-dashboard')).toBeHidden()
  await expect(report).toBeVisible()

  // close and reopen the report
  await page.getByTestId('tt-report-close').click()
  await expect(report).toBeHidden()
  await page.getByTestId('tt-report-reopen').click()
  await expect(report).toBeVisible()

  // Reset returns to t = 0 and unlocks the controls
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(report).toBeHidden()
  await expect(page.locator('[data-speed="10"]')).toBeEnabled()
  expect(errors).toEqual([])
})

test('the report exports the KPI report and the event log as JSON and CSV downloads', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil())
  await expect(page.getByTestId('tt-final-report')).toBeVisible()

  const download = async (kind: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`tt-export-${kind}`).click()])
    const stream = await dl.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return { name: dl.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') }
  }
  const events = await page.evaluate(() => window.__tt!.query<unknown[]>('eventLog'))
  const kpiJson = await download('kpi-json')
  expect(kpiJson.name).toMatch(/kpi-report\.json$/)
  const parsed = JSON.parse(kpiJson.text) as { format: string; kpis: { movesCompleted: number } }
  expect(parsed.format).toBe('terminal-twin-kpi-report')
  expect(parsed.kpis.movesCompleted).toBe(10)
  const eventsJson = await download('events-json')
  expect(JSON.parse(eventsJson.text)).toHaveLength(events.length)
  expect((await download('kpi-csv')).text.split('\n')[0]).toBe('kpi,unit,entityKind,entity,bucket,index,startS,endS,value')
  expect((await download('events-csv')).text.trim().split('\n').length).toBeGreaterThan(events.length)
})

test('the setup dialog end conditions stop the run at the first one met', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.getByRole('radio', { name: new RegExp(FIXTURE) }).check()
  await page.locator('input[name="end-moves"]').fill('3')
  await page.locator('input[name="end-hours"]').fill('10')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.evaluate(() => window.__tt!.setSpeed(600))
  await page.waitForFunction(() => window.__tt!.report().ended, undefined, { timeout: 30_000 })
  await expect(page.getByTestId('tt-report-reason')).toContainText('Reached 3 container moves')
  expect((await page.evaluate(() => window.__tt!.config()))!.endConditions).toEqual({ vesselsCompleted: 1, simDurationS: 36000, moves: 3 })

  await page.getByRole('button', { name: 'New Scenario' }).click()
  await page.locator('input[name="end-moves"]').fill('0')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Total moves must be a whole number')).toBeVisible()
})
