/**
 * TT-16 browser smoke tests: the dashboard tab (lazy ECharts, KPI time series,
 * yard heatmap, Gantt timeline, final report tab).
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const ASC = 'asc-1sts-10-boxes-1block'
const TWO_VESSELS = 'two-vessels-compete-for-berth'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, fixture: string, options?: Parameters<NonNullable<typeof window.__tt>['load']>[1]): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(([name, opts]) => window.__tt!.load(name as string, opts as never), [fixture, options ?? {}])
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

/** Wait until the KPI poll has delivered the final report, then show the charts tab. */
async function showCharts(page: Page, group: string, bucketing: 'hour' | 'shift' = 'hour'): Promise<void> {
  await page.waitForFunction(() => window.__tt!.report().reportReady)
  await page.evaluate(([g, b]) => window.__tt!.openDashboard({ tab: 'charts', group: g, bucketing: b as 'hour' | 'shift' }), [group, bucketing])
  await expect(page.getByTestId('tt-dashboard-charts')).toBeVisible()
}

test('B opens the dashboard, which loads ECharts only then, and B closes it', async ({ page }) => {
  const errors = collectErrors(page)
  const chartChunks: string[] = []
  page.on('request', (r) => {
    if (/echarts|chartLib/i.test(r.url())) chartChunks.push(r.url())
  })
  await open(page, TWO_VESSELS)
  await page.evaluate(() => window.__tt!.runTo(1200))
  await page.waitForTimeout(500)
  expect(chartChunks).toEqual([]) // the 3D view never pays for the chart library
  await page.keyboard.press('b')
  await expect(page.getByTestId('tt-dashboard')).toBeVisible()
  await expect(page.getByTestId('tt-chart-sts.gross-moves-per-hour')).toBeVisible()
  await page.waitForFunction(() => window.__tt!.dashboard().rendered?.chartLibLoaded === true)
  await page.waitForFunction(() => window.__tt!.dashboard().rendered?.charts.every((c) => c.drawn))
  expect(chartChunks.length).toBeGreaterThan(0)
  await expect(page.getByTestId('tt-chart-sts.gross-moves-per-hour').locator('canvas').first()).toBeVisible()
  await page.keyboard.press('b')
  await expect(page.getByTestId('tt-dashboard')).toBeHidden()
  await page.getByTestId('tt-dashboard-button').click()
  await expect(page.getByTestId('tt-dashboard')).toBeVisible()
  expect(errors).toEqual([])
})

test('the TOS handlers tab draws the handler wall latency over time with latency injection on', async ({ page }) => {
  const errors = collectErrors(page)
  const decisions = { points: { stsGroundPosition: { timeoutMs: 60_000, latency: { delay: { kind: 'uniform', minMs: 200, maxMs: 1200 } } } } }
  await open(page, ASC, { endConditions: { simDurationS: 3 * 3600 }, overrides: { decisions } as never })
  await page.evaluate(() => window.__tt!.runUntil())
  await showCharts(page, 'handlers')
  await page.waitForFunction(() => window.__tt!.dashboard().rendered?.charts.some((c) => c.kpiId === 'handler.wall-latency-s' && c.drawn))
  const chart = (await page.evaluate(() => window.__tt!.dashboard().rendered!)).charts.find((c) => c.kpiId === 'handler.wall-latency-s')!
  expect(chart.drawn).toBe(true)
  await expect(page.getByTestId('tt-chart-handler.wall-latency-s').locator('canvas').first()).toBeVisible()
  expect(errors).toEqual([])
})

test('a 24 h run draws hourly series that zoom', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, ASC, { endConditions: { simDurationS: 24 * 3600 } })
  await page.evaluate(() => window.__tt!.runUntil())
  await showCharts(page, 'quay')
  await page.waitForFunction(() => window.__tt!.dashboard().rendered?.charts.some((c) => c.drawn))
  const rendered = await page.evaluate(() => window.__tt!.dashboard().rendered!)
  const gross = rendered.charts.find((c) => c.kpiId === 'sts.gross-moves-per-hour')!
  expect(gross.points).toBeGreaterThanOrEqual(24)
  expect(gross.lines).toContain('STS01')

  // wheel-zoom on the chart narrows the data window
  const canvas = page.getByTestId('tt-chart-sts.gross-moves-per-hour').locator('canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -400)
  await page.waitForFunction(() => {
    const z = window.__tt!.dashboard().rendered?.charts.find((c) => c.kpiId === 'sts.gross-moves-per-hour')?.zoom
    return !!z && z.end - z.start < 99
  })

  // shift buckets: 24 h = 3 shifts of 8 h (+ the partial first one when the clock starts mid-shift)
  await showCharts(page, 'quay', 'shift')
  const shifts = (await page.evaluate(() => window.__tt!.dashboard().rendered!)).charts.find((c) => c.kpiId === 'sts.gross-moves-per-hour')!
  expect(shifts.points).toBeGreaterThanOrEqual(3)
  expect(shifts.points).toBeLessThan(gross.points)
  expect(errors).toEqual([])
})

test('the yard heatmap matches the engine fill of every block', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, ASC)
  await page.evaluate(() => window.__tt!.runUntil())
  await showCharts(page, 'yard')
  await expect(page.getByTestId('tt-dashboard-heatmap')).toBeVisible()
  await page.waitForFunction(() => !!window.__tt!.dashboard().rendered?.heatmap)

  const result = await page.evaluate(async () => {
    const tt = window.__tt!
    const blocks = await tt.query<{ id: string; bays: number; rows: number; tiers: number }[]>('yardBlocks')
    const engine: Record<string, number> = {}
    for (const b of blocks) {
      const slots = await tt.query<{ span: number }[]>('yardSlots', b.id)
      const cells = slots.reduce((n, s) => n + s.span, 0)
      engine[b.id] = Math.round(((100 * cells) / (b.bays * b.rows * b.tiers)) * 1000) / 1000
    }
    const heat = tt.dashboard().rendered!.heatmap!
    const lastColumn = Object.fromEntries(heat.blocks.map((id) => [id, heat.values[id][heat.hours.length - 1]]))
    return { engine, live: heat.liveFill, lastColumn }
  })
  expect(Object.keys(result.engine).length).toBeGreaterThan(0)
  for (const [id, fill] of Object.entries(result.engine)) {
    expect(fill).toBeGreaterThan(0)
    expect(result.live[id]).toBeCloseTo(fill, 3)
    expect(result.lastColumn[id]).toBeCloseTo(fill, 1)
    await expect(page.locator(`[data-testid="tt-yard-fill"] [data-block="${id}"]`)).toContainText('%')
  }
  expect(errors).toEqual([])
})

test('the Gantt timeline shows the berth and anchorage windows of the two-vessel fixture', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, TWO_VESSELS)
  await page.evaluate(() => window.__tt!.runUntil())
  await showCharts(page, 'quay')
  await expect(page.getByTestId('tt-dashboard-gantt')).toBeVisible()
  await page.waitForFunction(() => !!window.__tt!.dashboard().rendered?.gantt)

  const { gantt, vessels } = await page.evaluate(async () => {
    const tt = window.__tt!
    const v = await tt.query<{ id: string; arrivedAt: number; berthAllocatedAt: number; berthedAt: number; workCompletedAt: number; departedAt: number; anchorageWaitS: number }[]>('vessels')
    return { gantt: tt.dashboard().rendered!.gantt!, vessels: v }
  })
  expect(vessels).toHaveLength(2)
  for (const v of vessels) {
    const bar = (phase: string) => gantt.bars.find((b) => b.row === v.id && b.phase === phase)
    expect(bar('mooring')).toMatchObject({ startS: v.berthAllocatedAt, endS: v.berthedAt })
    expect(bar('work')).toMatchObject({ startS: v.berthedAt, endS: v.workCompletedAt })
    expect(bar('unmooring')).toMatchObject({ startS: v.workCompletedAt, endS: v.departedAt })
    if (v.anchorageWaitS > 0) expect(bar('anchorage')).toMatchObject({ startS: v.arrivedAt, endS: v.berthAllocatedAt })
    else expect(bar('anchorage')).toBeUndefined()
    expect(gantt.bars.filter((b) => b.row.startsWith(`${v.id}:`) && b.phase === 'package').length).toBeGreaterThan(0)
  }
  expect(vessels.filter((v) => v.anchorageWaitS > 0)).toHaveLength(1)
  // the legend names every phase in words, and the table view lists the windows
  await expect(page.getByTestId('tt-gantt-legend')).toContainText('Anchorage')
  await expect(page.getByTestId('tt-gantt-legend')).toContainText('Crane work package')
  expect(errors).toEqual([])
})

test('the final report opens as the dashboard report tab when the scenario ends and stays browsable', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, ASC, { endConditions: { moves: 4 } })
  await page.evaluate(() => window.__tt!.runUntil())
  await expect(page.getByTestId('tt-dashboard')).toBeVisible()
  await expect(page.getByTestId('tt-dashboard-report')).toBeVisible()
  await expect(page.getByTestId('tt-report-highlights')).toContainText('STS01 worked hardest')
  await page.getByTestId('tt-dashboard-tab-charts').click()
  await expect(page.getByTestId('tt-dashboard-charts')).toBeVisible()
  await page.getByTestId('tt-dashboard-tab-report').click()
  await expect(page.getByTestId('tt-report-moves')).toHaveText('4')
  // charts keep the run's data after the end
  expect((await page.evaluate(() => window.__tt!.dashboard())).open).toBe(true)
  expect(errors).toEqual([])
})

test('the Landside group charts the truck turnaround metrics and its summary table matches the engine report (TT-R18)', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, 'truck-holding-overflow')
  await page.evaluate(() => window.__tt!.runUntil())
  await showCharts(page, 'landside')
  await expect(page.getByTestId('tt-dashboard-landside')).toBeVisible()
  await page.waitForFunction(() => !!window.__tt!.dashboard().rendered?.landside)
  for (const id of ['landside.gate-processing-s', 'landside.internal-drive-s', 'landside.total-turnaround-s', 'landside.road-trucks', 'landside.holding-utilisation-pct'])
    await expect(page.getByTestId(`tt-chart-${id}`)).toBeVisible()
  const { rows, report } = await page.evaluate(async () => {
    const tt = window.__tt!
    const report = await tt.query<{ landside: { totalTurnaroundS: { mean: number }; road: { maxTrucks: number }; holding: { heldOutside: number } } }>('kpis')
    return { rows: Object.fromEntries(tt.dashboard().rendered!.landside!.map((r) => [r.id, r.value])), report }
  })
  expect(rows.turnaroundMean).toBe(report.landside.totalTurnaroundS.mean)
  expect(rows.roadMax).toBe(report.landside.road.maxTrucks)
  expect(rows.heldOutside).toBe(report.landside.holding.heldOutside)
  await expect(page.locator('[data-testid="tt-dashboard-landside"] [data-metric="turnaroundMean"]')).toContainText(/\d/)
  await page.screenshot({ path: '.screenshots/tt-r18-landside-dashboard.png' })
  expect(errors).toEqual([])
})
