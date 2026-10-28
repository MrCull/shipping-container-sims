/**
 * Performance state (TT-19): the quality setting (Low / Medium / High / Auto, default Auto), the
 * level actually in force, the live frame stats the overlay shows, and the overlay switch.
 * `useTwinScene` feeds it; `PerfOverlay.vue` and `QualityPicker.vue` read it. The setting and the
 * overlay switch are remembered in localStorage (a per-viewer convenience: every access is guarded).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_QUALITY_SETTING, QUALITY_SETTINGS, type QualityLevel, type QualitySetting } from '../modules/quality'

const KEY_QUALITY = 'terminal-twin.quality'
const KEY_OVERLAY = 'terminal-twin.perfOverlay'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage blocked: the setting just does not persist */
  }
}

export interface PerfStats {
  fps: number
  /** Draw calls and triangles of the last frame (main pass + shadow pass). */
  calls: number
  triangles: number
  /** Main-thread ms per frame spent posing the scene and submitting the render (not GPU time). */
  cpuMs: number
}

export const usePerfStore = defineStore('terminal-twin-perf', () => {
  const stored = read(KEY_QUALITY)
  const setting = ref<QualitySetting>(QUALITY_SETTINGS.find((s) => s === stored) ?? DEFAULT_QUALITY_SETTING)
  /** The level in force: the fixed setting, or what Auto currently picked. */
  const effective = ref<QualityLevel>(setting.value === 'auto' ? 'high' : setting.value)
  const overlayVisible = ref(read(KEY_OVERLAY) === '1')
  const stats = ref<PerfStats>({ fps: 0, calls: 0, triangles: 0, cpuMs: 0 })
  /** How many times Auto changed the level (dev API / tests). */
  const autoChanges = ref(0)
  /** Dev only: busy-wait this many ms every frame, to prove Auto steps down and recovers. */
  const debugLoadMs = ref(0)

  function setSetting(next: QualitySetting): void {
    setting.value = next
    write(KEY_QUALITY, next)
    if (next !== 'auto') effective.value = next
  }

  function setEffective(level: QualityLevel, byAuto = false): void {
    if (effective.value === level) return
    effective.value = level
    if (byAuto) autoChanges.value++
  }

  function toggleOverlay(): void {
    overlayVisible.value = !overlayVisible.value
    write(KEY_OVERLAY, overlayVisible.value ? '1' : '0')
  }

  function report(next: PerfStats): void {
    stats.value = next
  }

  return { setting, effective, overlayVisible, stats, autoChanges, debugLoadMs, setSetting, setEffective, toggleOverlay, report }
})
