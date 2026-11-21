// @vitest-environment happy-dom
/**
 * Component test (#332): the setup dialog (#161), mounted with the real Pinia store. The store's `startScenario` is
 * replaced by a fake, so Start records the request instead of booting the engine. Asserts what the user sees (tabs,
 * checked boxes, values, the Start button) and the request Start sends. Moved from the setup smoke specs
 * (`browser/terminal-twin-strict-checks.smoke.ts`, the dialog half of `browser/terminal-twin-yard-start.smoke.ts` and
 * `browser/terminal-twin-subsystem-modes.smoke.ts`), which keep the wiring to the running twin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import SetupDialog from '../../components/modals/SetupDialog.vue'
import { useTwinStore } from '../../store/twinStore'

let pinia: Pinia
let wrapper: VueWrapper | null = null
let startScenario: ReturnType<typeof vi.fn>

function mountDialog(): VueWrapper {
  const store = useTwinStore()
  startScenario = vi.fn(() => Promise.resolve())
  store.startScenario = startScenario as unknown as typeof store.startScenario
  wrapper = mount(SetupDialog, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

const tabButton = (w: VueWrapper, id: string) => w.get(`[data-testid=tt-setup-tab-${id}]`)
const input = (w: VueWrapper, testid: string) => w.get(`[data-testid=${testid}]`).element as HTMLInputElement

async function openTab(w: VueWrapper, id: string): Promise<void> {
  await tabButton(w, id).trigger('click')
  expect(tabButton(w, id).attributes('aria-selected')).toBe('true')
}

async function start(w: VueWrapper): Promise<Record<string, unknown>> {
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(startScenario).toHaveBeenCalledTimes(1)
  return startScenario.mock.calls[0][0] as Record<string, unknown>
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

describe('setup dialog', () => {
  it('shows four tabs, Scenario open first, and a tab click opens its panel', async () => {
    const w = mountDialog()
    const tabs = w.findAll('[data-testid^=tt-setup-tab-]')
    expect(tabs.map((t) => t.text())).toEqual(['Scenario', 'Vessels', 'Yard and equipment', 'Advanced'])
    expect(tabButton(w, 'scenario').attributes('aria-selected')).toBe('true')
    await openTab(w, 'yard')
    expect(tabButton(w, 'scenario').attributes('aria-selected')).toBe('false')
    expect(w.find('[data-testid=tt-subsystem-modes]').isVisible()).toBe(true)
  })

  it('Start is enabled for the default scenario and sends it to the store', async () => {
    const w = mountDialog()
    expect(w.get('[data-testid=tt-setup-start-button]').attributes('disabled')).toBeUndefined()
    const req = await start(w)
    expect(req.name).toBe('TTI Algeciras baseline')
    expect(req.seed).toBe(2026)
  })

  it('the scenario picker lists scenarios and test benches; a picked bench is what Start sends', async () => {
    const w = mountDialog()
    expect(Number(w.get('[data-testid=tt-count-scenarios]').text())).toBeGreaterThan(0)
    expect(Number(w.get('[data-testid=tt-count-benches]').text())).toBeGreaterThan(10)
    await w.get('[data-testid=tt-tab-benches]').trigger('click')
    await w.get('[data-testid=tt-fixture-row][data-scenario=landside-morning-peak]').trigger('click')
    expect(w.get('[data-testid=tt-setup-footer-name]').text()).not.toBe('')
    expect((await start(w)).name).toBe('landside-morning-peak')
  })

  it('a yard problem is listed on its tab, marks the tab, and Start does not start', async () => {
    const w = mountDialog()
    await openTab(w, 'yard')
    expect(w.get('[data-testid=tt-yard-readout]').text()).toContain('Capacity')
    await w.get('[data-testid=tt-yard-target]').setValue('150')
    expect(tabButton(w, 'yard').attributes('data-has-error')).toBe('true')
    expect(w.get('[data-testid=tt-setup-issues-yard]').text()).toContain('The fill target must be from 0 to 100 %')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(startScenario).not.toHaveBeenCalled()
  })

  it('ASCs per block: one per block goes with Start', async () => {
    const w = mountDialog()
    await openTab(w, 'yard')
    expect(input(w, 'tt-yard-ascs-2').checked).toBe(true)
    await w.get('[data-testid=tt-yard-ascs-1]').setValue(true)
    expect((await start(w)).yard).toMatchObject({ ascsPerBlock: 1 })
  })

  it('strict checks is off by default; checking it sets the store and is remembered', async () => {
    const w = mountDialog()
    await openTab(w, 'advanced')
    expect(input(w, 'tt-strict-checks').checked).toBe(false)
    await w.get('[data-testid=tt-strict-checks]').setValue(true)
    expect(useTwinStore().strictChecks).toBe(true)
    w.unmount()
    wrapper = null
    pinia = createPinia()
    setActivePinia(pinia)
    const again = mountDialog()
    await openTab(again, 'advanced')
    expect(input(again, 'tt-strict-checks').checked).toBe(true)
  })

  it('subsystem modes default to real; the chosen modes go with Start', async () => {
    const w = mountDialog()
    await openTab(w, 'yard')
    expect(input(w, 'tt-mode-quay-real').checked).toBe(true)
    await w.get('[data-testid=tt-mode-quay-instant]').setValue(true)
    await w.get('[data-testid=tt-mode-berth-off]').setValue(true)
    await w.get('[data-testid=tt-mode-yard-instant]').setValue(true)
    const req = await start(w)
    expect((req.overrides as { subsystems: unknown }).subsystems).toEqual({ quay: 'instant', berth: 'off', yard: 'instant' })
  })

  it('the yard starts pre-filled at 60 % by default; the empty start goes with Start', async () => {
    const w = mountDialog()
    await openTab(w, 'yard')
    expect(input(w, 'tt-yard-start-prefilled').checked).toBe(true)
    expect(input(w, 'tt-yard-target').value).toBe('60')
    await w.get('[data-testid=tt-yard-start-empty]').setValue(true)
    expect((await start(w)).yard).toMatchObject({ start: { mode: 'empty' } })
  })

  it('the warm-up start shows its length field and goes with Start', async () => {
    const w = mountDialog()
    await openTab(w, 'yard')
    expect(w.find('[data-testid=tt-yard-warmup]').exists()).toBe(false)
    await w.get('[data-testid=tt-yard-start-warmup]').setValue(true)
    await w.get('[data-testid=tt-yard-warmup]').setValue('1')
    expect((await start(w)).yard).toMatchObject({ start: { mode: 'warmup' } })
  })
})
