// @vitest-environment happy-dom
/**
 * Component test (#338): the KPI strip, mounted with the real Pinia store over the engine host in-process (fixture
 * `asc-1sts-10-boxes-1block` at sim 900 s). Asserts every card's label and value, the values matching the engine's headline
 * KPIs, a fixed minimum width per value and tabular figures (the strip's own CSS). Moved from
 * `browser/terminal-twin-hud.smoke.ts` and `browser/terminal-twin-kpi.smoke.ts`, which keep the real layout (the
 * strip over the 3D view, no card clipped at 1280x720 with both panels open).
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { EngineResponse } from '../../modules/engineClient'
import type { HeadlineKpis } from '../../engine'
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
const { default: KpiStrip } = await import('../../components/KpiStrip.vue')

let pinia: Pinia
let wrapper: VueWrapper | null = null

async function mountStrip(): Promise<VueWrapper> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: 'asc-1sts-10-boxes-1block' }, { autoplay: false })
  await store.controller()!.runTo(900)
  store.sync()
  await store.refreshKpis()
  wrapper = mount(KpiStrip, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
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

describe('KPI strip', () => {
  it('shows the engine headline KPIs: every card has a label and a value', async () => {
    const w = await mountStrip()
    const { headline } = await useTwinStore().controller()!.query<{ headline: HeadlineKpis }>('kpiHeadline')
    expect(headline.movesDone).toBeGreaterThan(0)
    const moves = w.get('[data-testid=tt-kpi-moves]')
    expect(moves.attributes('data-value')).toBe(String(headline.movesDone))
    expect(moves.text()).toContain(String(headline.movesDone))
    expect(w.find('[data-testid=tt-kpi-asc]').exists()).toBe(true)
    expect(w.find('[data-testid=tt-kpi-yard]').exists()).toBe(true)
    const cards = w.findAll('[data-testid=tt-kpi-strip] li.kpi')
    expect(cards.length).toBeGreaterThan(4)
    for (const c of cards) {
      expect(c.get('.label').text(), c.text()).not.toBe('')
      expect(c.get('.value').text(), c.text()).not.toBe('')
    }
  })

  it('each value keeps a fixed minimum width, and the strip sets tabular figures', async () => {
    const w = await mountStrip()
    const values = w.findAll('[data-testid=tt-kpi-strip] .value')
    expect(values.length).toBeGreaterThan(3)
    for (const v of values) expect(parseFloat((v.element as HTMLElement).style.minWidth)).toBeGreaterThan(3)
    const css = readFileSync('src/sims/terminal-twin/components/KpiStrip.vue', 'utf8')
    const valueRule = css.slice(css.indexOf('<style')).match(/\.value\s*\{[^}]*\}/g)?.join('\n') ?? ''
    expect(valueRule).toContain('font-variant-numeric: tabular-nums')
  })
})
