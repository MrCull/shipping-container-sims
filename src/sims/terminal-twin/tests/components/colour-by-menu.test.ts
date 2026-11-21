// @vitest-environment happy-dom
/**
 * Component test (#332): the Colour by menu (#130, #168), mounted with the real Pinia store and no engine. Asserts what
 * the user sees (button, panel, select value, legend text) and the store change a pick causes. Moved from
 * `browser/colour-by.smoke.ts`, which keeps the wiring to the running twin (the mode reaches the scene and the bay viewer).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ColourByMenu from '../../components/ColourByMenu.vue'
import { useTwinStore } from '../../store/twinStore'
import { fixtures } from '../../scenario/fixtures'

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountMenu(): VueWrapper {
  wrapper = mount(ColourByMenu, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

const panel = (w: VueWrapper) => w.find('[data-testid=tt-colour-by-panel]')
const legendText = (w: VueWrapper) => w.get('[data-testid=tt-colour-by-legend]').text()
const selectValue = (w: VueWrapper) => (w.get('[data-testid=tt-colour-by-select]').element as HTMLSelectElement).value

async function openMenu(w: VueWrapper): Promise<void> {
  if (!panel(w).exists()) await w.get('[data-testid=tt-colour-by]').trigger('click')
  expect(panel(w).exists()).toBe(true)
}

async function pick(w: VueWrapper, mode: string): Promise<void> {
  await openMenu(w)
  await w.get('[data-testid=tt-colour-by-select]').setValue(mode)
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

describe('Colour by menu', () => {
  it('opens from its button with the default mode selected and a legend', async () => {
    const w = mountMenu()
    const button = w.get('[data-testid=tt-colour-by]')
    expect(button.text()).toContain('Colour by')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(panel(w).exists()).toBe(false)
    await openMenu(w)
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(panel(w).attributes('aria-label')).toBe('Colour by menu')
    expect(selectValue(w)).toBe('default')
    expect(w.findAll('[data-testid=tt-colour-by-legend] li').length).toBeGreaterThan(0)
  })

  it('offers the modes by their labels', async () => {
    const w = mountMenu()
    await openMenu(w)
    const labels = w.findAll('option').map((o) => o.text())
    expect(labels).toEqual(expect.arrayContaining(['POD', 'Weight class', 'Length (20 / 40 / 45)', 'Dwell time', 'Flow']))
  })

  it('a pick sets the mode in the store and closes the panel', async () => {
    const w = mountMenu()
    const store = useTwinStore()
    await pick(w, 'pod')
    expect(store.colourBy).toBe('pod')
    expect(panel(w).exists()).toBe(false)
    // the button stays highlighted while a mode other than the default is on
    expect(w.get('[data-testid=tt-colour-by]').classes()).toContain('on')
  })

  it('the legend follows the mode: POD lists the ports of the scenario', async () => {
    const w = mountMenu()
    useTwinStore().config = structuredClone(fixtures['rob-bays'])
    await pick(w, 'pod')
    await openMenu(w)
    expect(w.get('[data-testid=tt-colour-by-legend]').attributes('data-mode')).toBe('pod')
    expect(legendText(w)).toMatch(/[A-Z]{5}/)
  })

  it('the legend follows the mode: weight, length and dwell', async () => {
    const w = mountMenu()
    await pick(w, 'weight')
    await openMenu(w)
    expect(legendText(w)).toContain('Heavy')
    await pick(w, 'length')
    await openMenu(w)
    expect(legendText(w)).toContain('20 ft')
    expect(legendText(w)).toContain('40 ft')
    expect(legendText(w)).toContain('45')
    await pick(w, 'dwell')
    await openMenu(w)
    expect(legendText(w)).toContain('Over 7 days')
  })

  it('a pointer-down outside the menu closes it; one inside does not', async () => {
    const w = mountMenu()
    await openMenu(w)
    w.get('[data-testid=tt-colour-by-select]').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(panel(w).exists()).toBe(true)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(panel(w).exists()).toBe(false)
  })

  it('the button toggles the panel open and closed', async () => {
    const w = mountMenu()
    const button = w.get('[data-testid=tt-colour-by]')
    await button.trigger('click')
    expect(panel(w).exists()).toBe(true)
    await button.trigger('click')
    expect(panel(w).exists()).toBe(false)
  })

  it('the picked mode and the ROB display survive a reload (a fresh store reads them back)', async () => {
    const w = mountMenu()
    await pick(w, 'flow')
    useTwinStore().setRobDisplay('hide')
    w.unmount()
    wrapper = null
    pinia = createPinia()
    setActivePinia(pinia)
    const again = mountMenu()
    expect(useTwinStore().robDisplay).toBe('hide')
    await openMenu(again)
    expect(selectValue(again)).toBe('flow')
  })
})
