// @vitest-environment happy-dom
/**
 * Component test (#338): the final report, mounted with the real Pinia store over the engine host in-process (fixture
 * `asc-1sts-10-boxes-1block`). Asserts the end reason, the highlights, the headline moves, close and reopen, and the four
 * exports (KPI report and event log as JSON and CSV). Moved from `browser/terminal-twin-kpi.smoke.ts` and
 * `browser/terminal-twin-dashboard.smoke.ts`, which keep the wiring (an end condition locks the time controls, the
 * report opens as the dashboard's report tab and docks over the 3D view, Reset hides it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h } from 'vue'
import type { EngineResponse } from '../../modules/engineClient'
import { createEngineHost } from '../../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../../worker/protocol'
import type { ScenarioChoice } from '../../store/twinStore'

vi.mock('../../modules/engineClient', () => ({
  EngineClient: class {
    private host = createEngineHost()
    private rid = 0
    async request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
      const reply = await this.host.handle({ ...req, rid: ++this.rid })
      if (!reply.ok) throw new Error(reply.error)
      return { result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo }
    }
    dispose() {}
  },
}))

const { useTwinStore } = await import('../../store/twinStore')
const { default: FinalReport } = await import('../../components/FinalReport.vue')

let pinia: Pinia
let wrapper: VueWrapper | null = null
let downloads: { blob: Blob; name: string }[] = []

const Host = defineComponent({ setup: () => () => h(FinalReport) })

async function endedReport(endConditions?: ScenarioChoice['endConditions']): Promise<VueWrapper> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: 'asc-1sts-10-boxes-1block', ...(endConditions ? { endConditions } : {}) }, { autoplay: false })
  await store.controller()!.runUntil()
  store.sync()
  await store.refreshKpis()
  store.sync()
  wrapper = mount(Host, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function download(w: VueWrapper, kind: string): Promise<{ name: string; text: string }> {
  const before = downloads.length
  await w.get(`[data-testid=tt-export-${kind}]`).trigger('click')
  await flushPromises()
  expect(downloads.length).toBe(before + 1)
  const d = downloads[before]
  return { name: d.name, text: await d.blob.text() }
}

beforeEach(() => {
  localStorage.clear()
  downloads = []
  let pending: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    pending = b as Blob
    return 'blob:fake'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (pending) downloads.push({ blob: pending, name: this.download })
    pending = null
  })
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('final report', () => {
  it('names the end reason, the highlights and the moves; closes and reopens', async () => {
    const w = await endedReport({ moves: 4 })
    const store = useTwinStore()
    expect(store.runEnded).toBe(true)
    expect(w.get('[data-testid=tt-report-reason]').text()).toContain('Reached 4 container moves')
    expect(w.get('[data-testid=tt-report-highlights]').text()).toContain('STS01 worked hardest')
    expect(w.get('[data-testid=tt-report-moves]').text()).toBe('4')
    store.reportOpen = true
    await flushPromises()
    await w.get('[data-testid=tt-report-close]').trigger('click')
    expect(w.find('[data-testid=tt-final-report]').exists()).toBe(false)
    await w.get('[data-testid=tt-report-reopen]').trigger('click')
    expect(w.find('[data-testid=tt-final-report]').exists()).toBe(true)
  })

  it('exports the KPI report and the event log as JSON and CSV downloads', async () => {
    const w = await endedReport()
    const events = await useTwinStore().controller()!.query<unknown[]>('eventLog')
    const kpiJson = await download(w, 'kpi-json')
    expect(kpiJson.name).toMatch(/kpi-report\.json$/)
    const parsed = JSON.parse(kpiJson.text) as { format: string; kpis: { movesCompleted: number } }
    expect(parsed.format).toBe('terminal-twin-kpi-report')
    expect(parsed.kpis.movesCompleted).toBe(10)
    expect(JSON.parse((await download(w, 'events-json')).text)).toHaveLength(events.length)
    expect((await download(w, 'kpi-csv')).text.split('\n')[0]).toBe('kpi,unit,entityKind,entity,bucket,index,startS,endS,value')
    expect((await download(w, 'events-csv')).text.trim().split('\n').length).toBeGreaterThan(events.length)
  })
})
