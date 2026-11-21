// @vitest-environment happy-dom
/**
 * Component test (#338): the bay viewer's Crane plan view (#288), mounted in the bay viewer with the real Pinia store
 * over the engine host in-process. Fixture `crane-split-4sts` (one vessel, four cranes) at sim 1500 s. Asserts a band
 * per crane, the now line, the summary, the key and its labels, the crane named on every bay column, the hover that dims
 * the other cranes' packages, and a package click landing on its bay. Moved from `browser/crane-plan.smoke.ts`, which
 * keeps the floating panel's real layout (key beside the chart, drag and resize remembered).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { EngineResponse } from '../../modules/engineClient'
import { createEngineHost } from '../../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../../worker/protocol'

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

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function openCranePlan(): Promise<VueWrapper> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: 'crane-split-4sts' }, { autoplay: false })
  await store.controller()!.runTo(1500)
  store.sync()
  await store.openBayViewer('V001')
  wrapper = mount(BayViewer, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  expect(wrapper.get('[data-testid=tt-bay-mode]').attributes('data-mode')).toBe('bays')
  await wrapper.get('[data-testid=tt-bay-mode-crane-plan]').trigger('click')
  await store.refreshBayView()
  await flushPromises()
  return wrapper
}

describe('crane plan view', () => {
  it('shows a band per crane, the now line, the summary and the key with its labels', async () => {
    const w = await openCranePlan()
    expect(w.find('[data-testid=tt-crane-plan]').exists()).toBe(true)
    for (const id of ['STS01', 'STS02', 'STS03', 'STS04']) expect(w.find(`[data-testid=tt-crane-plan-band-${id}]`).exists()).toBe(true)
    expect(w.find('[data-testid=tt-crane-plan-now]').exists()).toBe(true)
    expect(w.get('[data-testid=tt-crane-plan-summary]').text()).toContain('as-today')
    for (const k of ['discharge', 'load', 'hatch', 'ghost', 'conflict', 'obstacle', 'now']) {
      expect(w.get(`[data-testid=tt-crane-plan-key-${k}]`).text()).not.toBe('')
    }
    expect(w.find('[data-testid=tt-crane-plan-key-crane-STS01]').exists()).toBe(true)
    const cols = w.findAll('[data-testid^=tt-crane-plan-col-]')
    expect(cols.length).toBeGreaterThan(0)
    for (const c of cols) expect(c.attributes('data-sts')).toMatch(/^STS\d+$/)
  })

  it('hovering a crane in the key dims the other cranes packages', async () => {
    const w = await openCranePlan()
    await w.get('[data-testid=tt-crane-plan-key-crane-STS01]').trigger('mouseenter')
    expect(w.get('[data-testid^=tt-crane-plan-pkg-][data-sts=STS02]').classes()).toContain('dim')
    expect(w.get('[data-testid^=tt-crane-plan-pkg-][data-sts=STS01]').classes()).not.toContain('dim')
  })

  it('a package click opens its bay in the Bays view', async () => {
    const w = await openCranePlan()
    await w.get('[data-testid^=tt-crane-plan-pkg-]').trigger('click')
    expect(w.get('[data-testid=tt-bay-mode]').attributes('data-mode')).toBe('bays')
    expect(w.get('[data-testid=tt-bay-heading]').text()).toMatch(/bay \d\d/i)
  })
})
