// @vitest-environment happy-dom
/**
 * Component test (#338): the saves dialog (TT-17), mounted with the real Pinia store over the engine host in-process and
 * a fake browser save store (in memory; or one that refuses, as where IndexedDB is blocked). Asserts the list, save,
 * load, file export and import, the version-mismatch warning and its restart, and the storage-blocked state. Moved from
 * `browser/terminal-twin-saves.smoke.ts`, which keeps one real reload round trip through IndexedDB and the snapshot and
 * rewind runs that compare event-log hashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { EngineResponse } from '../../modules/engineClient'
import { createEngineHost } from '../../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../../worker/protocol'
import type { SaveFile } from '../../persistence/saves'

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

/** The fake save store: in memory, or blocked (rejects like a browser without IndexedDB). */
const fake = vi.hoisted(() => ({ blocked: false, files: new Map<string, unknown>(), next: 0 }))
vi.mock('../../persistence/saveStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../persistence/saveStore')>()
  const { metaOf: meta } = await import('../../persistence/saves')
  return {
    ...real,
    openSaveStore: async () => {
      if (fake.blocked) throw new real.StorageUnavailableError('blocked in this test')
      return {
        list: async () => [...fake.files.entries()].reverse().map(([id, f]) => meta(id, f as SaveFile)),
        get: async (id: string) => (fake.files.get(id) as SaveFile | undefined) ?? null,
        put: async (f: SaveFile) => {
          const id = `s${++fake.next}`
          fake.files.set(id, f)
          return meta(id, f)
        },
        remove: async (id: string) => void fake.files.delete(id),
      }
    },
  }
})

const { useTwinStore } = await import('../../store/twinStore')
const { default: SavesDialog } = await import('../../components/modals/SavesDialog.vue')

const FIXTURE = 'asc-1sts-10-boxes-1block'
let pinia: Pinia
let wrapper: VueWrapper | null = null
let downloads: Blob[] = []

async function openDialog(): Promise<VueWrapper> {
  const store = useTwinStore()
  await store.startScenario({ ...store.choice, name: FIXTURE }, { autoplay: false })
  await store.openSaves()
  wrapper = mount(SavesDialog, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const events = () => useTwinStore().controller()!.info!.eventsTotal

async function importText(w: VueWrapper, text: string): Promise<void> {
  const input = w.get('[data-testid=tt-import-file]')
  Object.defineProperty(input.element, 'files', { value: [new File([text], 'save.json', { type: 'application/json' })], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  fake.blocked = false
  fake.files.clear()
  downloads = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    downloads.push(b as Blob)
    return 'blob:fake'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('saves dialog', () => {
  it('lists nothing at first; Save adds a config and a snapshot to the list, newest first', async () => {
    const w = await openDialog()
    expect(w.findAll('[data-testid=tt-saves-item]')).toHaveLength(0)
    await w.get('[data-testid=tt-save-name]').setValue('My config')
    await w.get('[data-testid=tt-save-config]').trigger('click')
    await flushPromises()
    await useTwinStore().controller()!.runUntil({ maxEvents: 30 })
    await w.get('[data-testid=tt-save-name]').setValue('My snapshot')
    await w.get('[data-testid=tt-save-snapshot]').trigger('click')
    await flushPromises()
    const items = w.findAll('[data-testid=tt-saves-item]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('My snapshot')
    expect(items[1].text()).toContain('My config')
  })

  it('Load restores a saved snapshot and closes the dialog', async () => {
    const w = await openDialog()
    const store = useTwinStore()
    await store.controller()!.runUntil({ maxEvents: 40 })
    await w.get('[data-testid=tt-save-snapshot]').trigger('click')
    await flushPromises()
    await store.controller()!.runUntil({ maxEvents: 40 })
    expect(events()).toBe(80)
    await w.get('[data-testid=tt-save-load]').trigger('click')
    await flushPromises()
    expect(events()).toBe(40)
    expect(store.savesOpen).toBe(false)
  })

  it('Export downloads the save file, and importing that file loads it', async () => {
    const w = await openDialog()
    await w.get('[data-testid=tt-export-config]').trigger('click')
    await flushPromises()
    expect(downloads).toHaveLength(1)
    const text = await downloads[0].text()
    expect(JSON.parse(text).config.name).toBe(useTwinStore().config!.name)
    await useTwinStore().controller()!.runUntil({ maxEvents: 20 })
    await importText(w, text)
    expect(events()).toBe(0)
    expect(useTwinStore().savesOpen).toBe(false)
  })

  it('a snapshot from another engine version warns, replaces nothing, and Restart starts its config', async () => {
    const w = await openDialog()
    const store = useTwinStore()
    await store.controller()!.runUntil({ maxEvents: 60 })
    const file = JSON.parse(await saveText('snapshot'))
    file.snapshot.engineVersion = '0.0.1'
    file.engineVersion = '0.0.1'
    await importText(w, JSON.stringify(file))
    const warning = w.get('[data-testid=tt-version-warning]')
    expect(warning.text()).toContain('0.0.1')
    expect(events()).toBe(60)
    await w.get('[data-testid=tt-version-restart]').trigger('click')
    await flushPromises()
    expect(events()).toBe(0)
    expect(store.savesOpen).toBe(false)
  })

  it('where storage is blocked it says so, Save is disabled, and export and import still work', async () => {
    fake.blocked = true
    const w = await openDialog()
    expect(useTwinStore().storage).toBe('unavailable')
    expect(w.find('[data-testid=tt-saves-storage-warning]').exists()).toBe(true)
    expect(w.get('[data-testid=tt-save-config]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid=tt-saves-list]').exists()).toBe(false)
    await w.get('[data-testid=tt-export-config]').trigger('click')
    await flushPromises()
    expect(downloads).toHaveLength(1)
    await useTwinStore().controller()!.runUntil({ maxEvents: 20 })
    await importText(w, await downloads[0].text())
    expect(events()).toBe(0)
  })
})

/** The current run as an exported file's text (through the dialog's store, as Export writes it). */
async function saveText(type: 'config' | 'snapshot'): Promise<string> {
  const before = downloads.length
  await useTwinStore().exportToFile(type, 'Old engine')
  return downloads[before].text()
}
