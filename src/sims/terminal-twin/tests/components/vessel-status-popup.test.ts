// @vitest-environment happy-dom
/**
 * Component test (#338): the vessel status popup (#116, #126) in the inspector, mounted with the real Pinia store over
 * the engine host in-process. Fixture `two-vessels-compete-for-berth` from 08:00 (V001 moors for 10 min, first pick at
 * 690 s; V002 arrives at 300 s and waits at anchorage). Asserts the phase, ops start, countdown and moves the popup
 * shows. Moved from `browser/terminal-twin-vessel-status.smoke.ts`, which keeps the floating countdown labels over the
 * 3D scene.
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
const { default: InspectorPanel } = await import('../../components/debug/InspectorPanel.vue')

let pinia: Pinia
let wrapper: VueWrapper | null = null

async function boot(): Promise<void> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: 'two-vessels-compete-for-berth', startDateTime: '2026-03-02T08:00:00' }, { autoplay: false })
  wrapper = mount(InspectorPanel, { global: { plugins: [pinia] }, attachTo: document.body })
}

/** Run to `t`, select the vessel and let the inspector read it. */
async function selectAt(t: number, id: string): Promise<VueWrapper> {
  const store = useTwinStore()
  await store.controller()!.runTo(t)
  store.pause()
  store.sync()
  store.select(id)
  await store.refreshEntity()
  await flushPromises()
  expect(wrapper!.get('[data-testid=tt-entity-heading]').text()).toContain(id)
  expect(wrapper!.find('[data-testid=tt-vessel-status]').exists()).toBe(true)
  return wrapper!
}

const text = (w: VueWrapper, id: string) => w.get(`[data-testid=${id}]`).text()

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('vessel status popup', () => {
  it('a mooring vessel counts down to 08:10, a vessel at anchorage waits for a berth, then Working with no countdown', async () => {
    await boot()
    let w = await selectAt(120, 'V001') // 08:02
    expect(text(w, 'tt-vessel-phase')).toBe('Mooring')
    expect(text(w, 'tt-vessel-ops-start')).toMatch(/8:10/)
    expect(text(w, 'tt-vessel-countdown')).toMatch(/^0[78]:\d\d$/)
    expect(text(w, 'tt-vessel-moves')).toMatch(/\d+ done, \d+ remaining/)

    w = await selectAt(400, 'V002')
    expect(text(w, 'tt-vessel-phase')).toBe('Waiting for berth')
    expect(w.find('[data-testid=tt-vessel-countdown]').exists()).toBe(false)

    w = await selectAt(700, 'V001')
    expect(text(w, 'tt-vessel-phase')).toBe('Working')
    w = await selectAt(1000, 'V001')
    expect(text(w, 'tt-vessel-phase')).toBe('Working')
    expect(w.find('[data-testid=tt-vessel-countdown]').exists()).toBe(false)
  })
})
