/**
 * #171: every run launch starts with the daylight lock on (a toggle lasts for that run only), and entering Terminal
 * Twin mutes the shared audio store, leaving restores the mute from before entry unless the owner changed it inside.
 * Seam: the twin store (over the engine host in-process) for the daylight lock and entry and leave; the shared audio
 * store for the mute it reads and writes.
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioStore } from '@/stores/audio'
import type { EngineResponse } from '../modules/engineClient'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../worker/protocol'
import { SMALL_PRESET_NAME, TTI_PRESET_NAME } from '../scenario/presets'

vi.mock('../modules/engineClient', () => ({
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

const { useTwinStore } = await import('../store/twinStore')

const TRACER = 'tracer-1sts-10-boxes'
const KEY = 'shipping-container-sims'

/** A stand-in for the browser's localStorage behind the shared site storage; returns the backing map. */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
  })
  return data
}

function storedMute(data: Map<string, string>): boolean | undefined {
  const raw = data.get(KEY)
  return raw === undefined ? undefined : (JSON.parse(raw) as { global: { soundMuted: boolean } }).global.soundMuted
}

describe('daylight lock: every run launch starts in daylight', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a fixture run starts lit, and a toggle lasts only for that run', async () => {
    const store = useTwinStore()
    await store.startScenario({ ...store.choice, name: TRACER, seed: 3 })
    expect(store.lockDaylight).toBe(true)
    store.toggleLockDaylight()
    expect(store.lockDaylight).toBe(false)
    await store.startScenario({ ...store.choice, name: TRACER, seed: 4 })
    expect(store.lockDaylight).toBe(true)
  })

  it('a preset run starts lit, the TTI baseline and the small automated preset alike', async () => {
    const store = useTwinStore()
    await store.startScenario({ ...store.choice, name: SMALL_PRESET_NAME, seed: 3 })
    expect(store.lockDaylight).toBe(true)
    store.toggleLockDaylight()
    await store.startScenario({ ...store.choice, name: TTI_PRESET_NAME, seed: 3 })
    expect(store.lockDaylight).toBe(true)
  })
})

describe('sound on entry: muted on every entry, restored on leave', () => {
  let data: Map<string, string>

  beforeEach(() => {
    vi.unstubAllGlobals()
    data = stubStorage()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('entering with sound on mutes it, and the master gain is 0', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    expect(audio.soundMuted).toBe(false)
    store.enterSim()
    expect(audio.soundMuted).toBe(true)
    expect(audio.masterGain).toBe(0)
    expect(storedMute(data)).toBe(true)
  })

  it('leaving without touching the speaker restores unmuted', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    store.enterSim()
    store.leaveSim()
    expect(audio.soundMuted).toBe(false)
    expect(audio.masterGain).toBe(0.4)
    expect(storedMute(data)).toBe(false)
  })

  it('entering while already muted stays muted, and leaving keeps it muted', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    audio.setSoundMuted(true)
    store.enterSim()
    expect(audio.soundMuted).toBe(true)
    store.leaveSim()
    expect(audio.soundMuted).toBe(true)
  })

  it('unmuting inside plays at the master volume', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    store.enterSim()
    audio.toggleSound()
    expect(audio.soundMuted).toBe(false)
    expect(audio.gainFor(0.5)).toBeCloseTo(0.2)
    store.leaveSim()
    expect(audio.soundMuted).toBe(false)
  })

  it('a mute the owner clears inside stays cleared on leave, even from a muted start', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    audio.setSoundMuted(true)
    store.enterSim()
    audio.moveVolumeSlider(0.6)
    store.leaveSim()
    expect(audio.soundMuted).toBe(false)
    expect(audio.volume).toBeCloseTo(0.6)
  })

  it('the owner\'s latest choice stays on leave: unmute then mute inside leaves it muted', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    store.enterSim()
    audio.toggleSound()
    audio.setSoundMuted(true)
    store.leaveSim()
    expect(audio.soundMuted).toBe(true)
  })

  it('a second entry before a leave does not lose the restore point', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    store.enterSim()
    store.enterSim()
    store.leaveSim()
    expect(audio.soundMuted).toBe(false)
  })

  it('leave without an entry changes nothing', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    audio.setSoundMuted(true)
    store.leaveSim()
    expect(audio.soundMuted).toBe(true)
  })

  it('every entry mutes again, after a leave that restored sound', () => {
    const store = useTwinStore()
    const audio = useAudioStore()
    store.enterSim()
    store.leaveSim()
    expect(audio.soundMuted).toBe(false)
    store.enterSim()
    expect(audio.soundMuted).toBe(true)
    store.leaveSim()
    expect(audio.soundMuted).toBe(false)
  })
})
