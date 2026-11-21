// @vitest-environment happy-dom
/**
 * Component test (#338): locale and units formatting in components, with the real Pinia store. The setup dialog's
 * scenario summary in each locale and unit system, and the locale date and time field (`LocaleDateTimeInput.vue`)
 * showing and parsing the chosen locale's format. Moved from `browser/terminal-twin-display.smoke.ts`, which keeps the
 * browser's own locale as the first-open default, persistence through a reload and the live clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import SetupDialog from '../../components/modals/SetupDialog.vue'
import LocaleDateTimeInput from '../../components/LocaleDateTimeInput.vue'
import { useTwinStore } from '../../store/twinStore'
import type { DisplaySettings } from '../../scenario/types'

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

async function summary(display: DisplaySettings): Promise<(id: string) => string> {
  const store = useTwinStore()
  store.startScenario = vi.fn(() => Promise.resolve()) as unknown as typeof store.startScenario
  store.setDisplay(display)
  wrapper = mount(SetupDialog, { global: { plugins: [pinia] }, attachTo: document.body })
  await wrapper.get('[data-testid=tt-tab-benches]').trigger('click')
  await wrapper.get('[data-testid=tt-fixture-row][data-scenario=tracer-1sts-10-boxes]').trigger('click')
  await flushPromises()
  return (id) => wrapper!.get(`[data-testid=tt-summary-${id}]`).text()
}

describe('scenario summary in the setup dialog', () => {
  it('en-GB metric', async () => {
    expect((await summary({ locale: 'en-GB', units: 'metric' }))('quay')).toBe('400 m')
  })
  it('en-GB imperial: feet and miles per hour', async () => {
    const s = await summary({ locale: 'en-GB', units: 'imperial' })
    expect(s('quay')).toBe('1,312 ft')
    expect(s('gantry')).toBe('1.7 mi/h')
  })
  it('en-US imperial', async () => {
    const s = await summary({ locale: 'en-US', units: 'imperial' })
    expect(s('quay')).toBe('1,312 ft')
    expect(s('trolley')).toBe('8.9 mi/h')
  })
  it('de-DE groups and decimals: imperial and metric', async () => {
    expect((await summary({ locale: 'de-DE', units: 'imperial' }))('quay')).toBe('1.312 ft')
    wrapper!.unmount()
    const s = await summary({ locale: 'de-DE', units: 'metric' })
    expect(s('quay')).toBe('400 m')
    expect(s('trolley')).toBe('14,4 km/h')
  })
})

describe('locale date and time field', () => {
  it('shows and parses the chosen locale: en-GB, en-US (03/04 is 4 March), de-DE, and flags an impossible date', async () => {
    const store = useTwinStore()
    store.setDisplay({ locale: 'en-GB', units: 'metric' })
    const model = ref('2026-10-26T13:45')
    wrapper = mount(
      defineComponent({ setup: () => () => h(LocaleDateTimeInput, { modelValue: model.value, 'onUpdate:modelValue': (v: string) => (model.value = v), testId: 'start' }) }),
      { global: { plugins: [pinia] }, attachTo: document.body },
    )
    const input = () => wrapper!.get('input')
    expect((input().element as HTMLInputElement).value).toBe('26/10/2026, 13:45')
    store.setDisplay({ locale: 'en-US' })
    await flushPromises()
    expect((input().element as HTMLInputElement).value).toMatch(/^10\/26\/2026, 1:45.PM$/)
    await input().setValue('03/04/2026, 9:30 AM')
    await input().trigger('blur')
    expect(model.value).toBe('2026-03-04T09:30')
    expect(input().attributes('aria-invalid')).not.toBe('true')
    store.setDisplay({ locale: 'de-DE' })
    await flushPromises()
    expect((input().element as HTMLInputElement).value).toBe('04.03.2026, 09:30')
    await input().setValue('31.02.2026, 09:30')
    await input().trigger('blur')
    expect(input().attributes('aria-invalid')).toBe('true')
    expect(model.value).toBe('')
  })
})
