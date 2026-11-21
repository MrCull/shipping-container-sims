// @vitest-environment happy-dom
/**
 * Component test (#338): the keyboard shortcuts (`composables/useTwinShortcuts.ts`) and the help overlay
 * (`ShortcutHelp.vue`), mounted in a small host with the real Pinia store over the engine host in-process (fixture
 * `tracer-1sts-10-boxes` at sim 60 s, paused). Keys drive the store; the help overlay lists every shortcut; typing in a
 * field triggers nothing. Moved from `browser/terminal-twin-display.smoke.ts`, which keeps one key reaching the running
 * twin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h } from 'vue'
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
const { useTwinShortcuts } = await import('../../composables/useTwinShortcuts')
const { default: ShortcutHelp } = await import('../../components/modals/ShortcutHelp.vue')

let pinia: Pinia
let wrapper: VueWrapper | null = null

const Host = defineComponent({
  setup() {
    useTwinShortcuts()
    const store = useTwinStore()
    return () => h('div', [h('input', { 'data-testid': 'field', 'aria-label': 'Target sim time' }), store.helpOpen ? h(ShortcutHelp) : null])
  },
})

async function boot(): Promise<ReturnType<typeof useTwinStore>> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: 'tracer-1sts-10-boxes' }, { autoplay: false })
  await store.controller()!.runTo(60)
  store.pause()
  store.sync()
  wrapper = mount(Host, { global: { plugins: [pinia] }, attachTo: document.body })
  return store
}

async function press(key: string, target: EventTarget = document.body): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : undefined, bubbles: true, cancelable: true }))
  await flushPromises()
  useTwinStore().sync()
}

const events = () => useTwinStore().controller()!.info!.eventsTotal

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  useTwinStore().pause()
})

describe('keyboard shortcuts', () => {
  it('Space toggles pause, digits leave the speed alone, 0 pauses and . steps one event', async () => {
    const store = await boot()
    expect(store.paused).toBe(true)
    await press(' ')
    expect(store.paused).toBe(false)
    await press(' ')
    expect(store.paused).toBe(true)
    store.setSpeed(5)
    store.resume()
    for (const d of ['3', '9', '1']) await press(d)
    expect(store.speed).toBe(5)
    expect(store.paused).toBe(false)
    await press('0')
    expect(store.paused).toBe(true)
    const before = events()
    await press('.')
    expect(events()).toBe(before + 1)
    expect(store.paused).toBe(true)
  })

  it('B toggles the dashboard, O the overlays, F follows the selection and Esc unwinds inspector then selection', async () => {
    const store = await boot()
    await press('b')
    expect(store.dashboardOpen).toBe(true)
    await press('b')
    expect(store.dashboardOpen).toBe(false)
    expect(store.overlaysVisible).toBe(true)
    await press('o')
    expect(store.overlaysVisible).toBe(false)
    await press('o')
    expect(store.overlaysVisible).toBe(true)
    await press('f')
    expect(store.following).toBe(false)
    store.select('STS01')
    await press('f')
    expect(store.selectedId).toBe('STS01')
    expect(store.following).toBe(true)
    await press('Escape')
    expect(store.inspectorOpen).toBe(false)
    expect(store.selectedId).toBe('STS01')
    await press('Escape')
    expect(store.selectedId).toBeNull()
    expect(store.following).toBe(false)
  })

  it('? opens the help overlay listing every shortcut; Esc closes it', async () => {
    await boot()
    await press('?')
    const help = wrapper!.get('[data-testid=tt-shortcut-help]')
    expect(help.attributes('role')).toBe('dialog')
    expect(help.text()).toContain('Keyboard shortcuts')
    const keys = help.findAll('kbd').map((k) => k.text())
    for (const key of ['Space', '0', '.', 'F', 'Esc', 'B', 'O', '?', 'WASD', 'Shift + AD', 'Shift + WS', '= / -']) {
      expect(keys.filter((k) => k === key), key).toHaveLength(1)
    }
    await press('Escape')
    expect(wrapper!.find('[data-testid=tt-shortcut-help]').exists()).toBe(false)
  })

  it('typing in a field triggers nothing', async () => {
    const store = await boot()
    const field = wrapper!.get('[data-testid=field]').element as HTMLInputElement
    field.focus()
    const before = { paused: store.paused, speed: store.speed, events: events(), overlays: store.overlaysVisible, help: store.helpOpen, dash: store.dashboardOpen, following: store.following }
    for (const key of [' ', '3', '0', '.', 'f', 'b', 'w', 'a', 'o', '?', 'Escape']) await press(key, field)
    expect({ paused: store.paused, speed: store.speed, events: events(), overlays: store.overlaysVisible, help: store.helpOpen, dash: store.dashboardOpen, following: store.following }).toEqual(before)
  })
})
