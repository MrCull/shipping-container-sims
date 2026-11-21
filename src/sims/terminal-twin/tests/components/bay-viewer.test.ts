// @vitest-environment happy-dom
/**
 * Component test (#338): the bay viewer (#106, #115, #162), mounted with the real Pinia store over the engine host
 * in-process (no worker, no 3D). Fixture `rob-bays` (a feeder with 3 ROB bays of 7; V001 discharges 16 and loads 6).
 * Asserts what the user sees: the cross-sections, stepping bays, the hover tooltip, the Discharge plan | Load plan
 * switch with the boxes left per plan, the legend, cells going to done and the package list following the run.
 * Moved from `browser/bay-viewer.smoke.ts` and `browser/bay-plan-switch.smoke.ts`, which keep the wiring (a vessel click
 * in 3D opens the viewer, the inspector button, Escape).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { EngineResponse } from '../../modules/engineClient'
import { createEngineHost } from '../../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest, WorkerRunCondition } from '../../worker/protocol'

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
const { default: BayViewer } = await import('../../components/BayViewer.vue')

let pinia: Pinia
let wrapper: VueWrapper | null = null

async function boot(until: WorkerRunCondition): Promise<ReturnType<typeof useTwinStore>> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: 'rob-bays' }, { autoplay: false })
  await runUntil(until)
  return store
}

async function runUntil(until: WorkerRunCondition): Promise<void> {
  const store = useTwinStore()
  await store.controller()!.runUntil(until)
  store.sync()
  await store.refreshBayView()
  await flushPromises()
}

async function openViewer(vesselId = 'V001'): Promise<VueWrapper> {
  await useTwinStore().openBayViewer(vesselId)
  wrapper ??= mount(BayViewer, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const heading = (w: VueWrapper) => w.get('[data-testid=tt-bay-heading]').text()
const cells = (w: VueWrapper, status: string): DOMWrapper<Element>[] => w.findAll(`[data-testid=tt-bay-cell][data-status=${status}]`)
const strip = (w: VueWrapper) => w.findAll('[data-testid=tt-bay-strip] button')
const legend = (w: VueWrapper) => w.get('[data-testid=tt-bay-legend]').text()
const planCount = (w: VueWrapper, p: string): number => Number(w.get(`[data-testid=tt-bay-plan-count-${p}]`).text().replace(/[()]/g, ''))

async function firstIdleBay(w: VueWrapper): Promise<void> {
  await w.get('[data-testid^=tt-bay-strip-][data-state=idle]').trigger('click')
}

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('bay viewer', () => {
  it('draws hold and deck cross-sections of two 20 ft panels, with 40 ft continuations aft only', async () => {
    await boot({ eventType: 'VesselBerthed' })
    const w = await openViewer()
    expect(heading(w)).toMatch(/bay \d\d/i)
    expect(w.get('[data-testid=tt-bay-plan]').attributes('data-plan')).toBe('discharge')
    await firstIdleBay(w)
    const fore = w.get('[data-testid=tt-bay-panel-fore]')
    const aft = w.get('[data-testid=tt-bay-panel-aft]')
    expect(fore.findAll('[data-testid=tt-bay-deck] .tier')).toHaveLength(3)
    expect(fore.findAll('[data-testid=tt-bay-hold] .tier')).toHaveLength(4)
    expect(fore.get('[data-testid=tt-bay-deck] .tier').findAll('.pos')).toHaveLength(8)
    expect(aft.get('[data-testid=tt-bay-deck] .tier').findAll('.pos')).toHaveLength(8)
    const evenBay = Number(heading(w).match(/bay (\d\d)/i)![1])
    expect(Number(fore.attributes('data-bay-number'))).toBe(evenBay - 1)
    expect(Number(aft.attributes('data-bay-number'))).toBe(evenBay + 1)
    expect(fore.get('[data-testid=tt-bay-panel-title]').text()).toBe(`Bay ${String(evenBay - 1).padStart(2, '0')}`)
    expect(w.findAll('[data-testid=tt-bay-cell][data-status=planned-discharge]:not([data-continuation])').length).toBeGreaterThan(0)
    const continuation = aft.findAll('[data-testid=tt-bay-cell][data-continuation=true]')
    expect(continuation.length).toBeGreaterThan(0)
    expect(continuation[0].text()).toBe('40′ ▸')
    expect(fore.findAll('[data-continuation=true]')).toHaveLength(0)
  })

  it('hovering a cell shows its tooltip in maritime notation', async () => {
    await boot({ eventType: 'VesselBerthed' })
    const w = await openViewer()
    await firstIdleBay(w)
    await w.get('[data-testid=tt-bay-cell][data-status=planned-discharge]:not([data-continuation])').trigger('mouseenter')
    const tip = w.get('[data-testid=tt-bay-tooltip]').text()
    expect(tip).toMatch(/VESSEL\.V01\.\d\d\.\d\d\.\d\d/)
    expect(tip).toContain('Port of discharge (POD)')
    expect(tip).toContain('Planned discharge')
    await w.get('[data-testid=tt-bay-viewer]').trigger('mouseleave')
    expect(w.find('[data-testid=tt-bay-tooltip]').exists()).toBe(false)
  })

  it('steps between bays with prev, next and the strip; ROB bays show ROB cells and no packages', async () => {
    await boot({ eventType: 'VesselBerthed' })
    const w = await openViewer()
    await firstIdleBay(w)
    const bay0 = heading(w)
    expect(strip(w)).toHaveLength(7)
    expect(w.findAll('[data-testid^=tt-bay-strip-][data-state=rob]')).toHaveLength(3)
    await w.get('[data-testid=tt-bay-next]').trigger('click')
    expect(heading(w)).not.toBe(bay0)
    await w.get('[data-testid=tt-bay-prev]').trigger('click')
    expect(heading(w)).toBe(bay0)
    await strip(w)[0].trigger('click')
    expect(w.get('[data-testid=tt-bay-prev]').attributes('disabled')).toBeDefined()
    await strip(w)[6].trigger('click')
    expect(w.get('[data-testid=tt-bay-next]').attributes('disabled')).toBeDefined()
    await w.get('[data-testid^=tt-bay-strip-][data-state=rob]').trigger('click')
    expect(w.find('[data-testid=tt-bay-rob-note]').exists()).toBe(true)
    expect(cells(w, 'rob').length).toBeGreaterThan(10)
    expect(w.findAll('[data-testid=tt-bay-cell][data-rob=true]').length).toBeGreaterThan(10)
    expect(cells(w, 'planned-discharge')).toHaveLength(0)
    expect(w.find('[data-testid=tt-bay-packages]').exists()).toBe(false)
  })

  it('the POD colour mode keys the cells by port', async () => {
    const store = await boot({ eventType: 'VesselBerthed' })
    const w = await openViewer()
    store.colourBy = 'pod'
    await flushPromises()
    expect(legend(w)).toMatch(/[A-Z]{5}/)
  })

  it('the Discharge plan | Load plan switch shows one plan at a time, with the boxes left per plan and its own key', async () => {
    await boot({ eventType: 'VesselBerthed' })
    const w = await openViewer()
    const discharge = w.get('[data-testid=tt-bay-plan-discharge]')
    expect(discharge.attributes('aria-checked')).toBe('true')
    expect(w.get('[data-testid=tt-bay-plan]').findAll('[role=radio]')[0].attributes('data-testid')).toBe('tt-bay-plan-discharge')
    expect(cells(w, 'planned-discharge').length).toBeGreaterThan(0)
    expect(cells(w, 'planned-load')).toHaveLength(0)
    expect(discharge.text()).toMatch(/^Discharge plan \(\d+\)$/)
    expect(w.get('[data-testid=tt-bay-plan-load]').text()).toMatch(/^Load plan \(\d+\)$/)
    expect(planCount(w, 'discharge')).toBe(16)
    expect(planCount(w, 'load')).toBe(6)
    expect(legend(w)).toContain('Planned discharge')
    expect(legend(w)).toContain('Discharged')
    expect(legend(w)).toContain('Remain on board')
    expect(legend(w)).not.toContain('Planned load')

    await w.get('[data-testid=tt-bay-plan-load]').trigger('click')
    expect(w.get('[data-testid=tt-bay-plan]').attributes('data-plan')).toBe('load')
    await firstIdleBay(w)
    expect(cells(w, 'planned-load').length).toBeGreaterThan(0)
    expect(cells(w, 'planned-discharge')).toHaveLength(0)
    expect(legend(w)).toContain('Planned load')
    expect(legend(w)).toContain('Loaded')
    expect(legend(w)).not.toContain('Planned discharge')

    // another vessel in the same run keeps the choice
    useTwinStore().closeBayViewer()
    await openViewer('V002')
    expect(w.get('[data-testid=tt-bay-plan]').attributes('data-plan')).toBe('load')
  })

  it('cells go to done and the package list completes as the run proceeds; the close button closes it', async () => {
    const store = await boot({ eventType: 'StsPicked' })
    const w = await openViewer()
    const pkgs = () => w.findAll('[data-testid=tt-bay-packages] .pkg').map((p) => p.attributes('data-status'))
    expect(pkgs().length).toBeGreaterThan(0)
    expect(pkgs().every((s) => s !== 'complete')).toBe(true)
    const bay = store.bayViewerBay
    const slot = w.get('[data-testid=tt-bay-cell][data-status=planned-discharge]:not([data-continuation])').attributes('data-slot')
    await runUntil({ vesselsCompleted: 1 })
    expect(pkgs().every((s) => s === 'complete')).toBe(true)
    expect(store.bayViewerBay).toBe(bay)
    expect(w.get(`[data-testid=tt-bay-cell][data-slot="${slot}"]:not([data-continuation])`).attributes('data-status')).toBe('done')
    for (const b of strip(w)) {
      await b.trigger('click')
      expect(cells(w, 'planned-discharge')).toHaveLength(0)
      expect(cells(w, 'planned-load')).toHaveLength(0)
    }
    await w.get('[data-testid=tt-bay-close]').trigger('click')
    expect(store.bayViewerVesselId).toBeNull()
  })
})
