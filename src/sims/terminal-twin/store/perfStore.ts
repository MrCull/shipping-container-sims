/**
 * Performance state (TT-19): the quality setting (Low / Medium / High / Auto, default Auto), the
 * level actually in force, the live frame stats the overlay shows, and the overlay switch.
 * `useTwinScene` feeds it; `PerfOverlay.vue` and `QualityPicker.vue` read it. The setting and the
 * overlay switch are remembered in localStorage (a per-viewer convenience: every access is guarded).
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_QUALITY_SETTING, MANUAL_RUNG, QUALITY_SETTINGS, TOP_RUNG, clampRung, levelOfRung, rungName, type AutoRungName, type QualityLevel, type QualitySetting } from '../modules/quality'

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
  /** The part of cpuMs spent posing the scene from the sim state (instanced boxes, rigs), before the render submit. */
  poseMs: number
  /** Container boxes currently drawn with close-up markings (#119). */
  closeup: number
  /** Close-up marking faces currently drawn (#143), never above the quality level's face budget. */
  closeupFaces: number
  /** Hero faces currently drawn (#258), never above the quality level's hero cap. */
  heroFaces: number
  /** Container boxes posed in the last frame (every box with a pose, visible or not) (#246). */
  boxesPosed: number
  /** Bytes the container instance buffers hand to the GPU upload in the last frame (#246). */
  instanceBytes: number
}

/** Where the one-click benchmark is (#254); null when none runs. */
export interface BenchmarkProgress {
  /** 0 while the scenario loads and warms up, then 1 to `total`. */
  stage: number
  total: number
  label: string
}

export const usePerfStore = defineStore('terminal-twin-perf', () => {
  const stored = read(KEY_QUALITY)
  const setting = ref<QualitySetting>(QUALITY_SETTINGS.find((s) => s === stored) ?? DEFAULT_QUALITY_SETTING)
  /** The level in force: the fixed setting, or what Auto currently picked. */
  const effective = ref<QualityLevel>(setting.value === 'auto' ? 'high' : setting.value)
  /** The ladder rung in force (#261): Auto's current rung, or the rung a manual level fixes it at. 0 is the best look. */
  const rung = ref(setting.value === 'auto' ? TOP_RUNG : MANUAL_RUNG[setting.value])
  const rungLabel = computed<AutoRungName>(() => rungName(rung.value))
  const overlayVisible = ref(read(KEY_OVERLAY) === '1')
  const stats = ref<PerfStats>({ fps: 0, calls: 0, triangles: 0, cpuMs: 0, poseMs: 0, closeup: 0, closeupFaces: 0, heroFaces: 0, boxesPosed: 0, instanceBytes: 0 })
  const benchmark = ref<BenchmarkProgress | null>(null)
  /** How many times Auto changed the level (dev API / tests). */
  const autoChanges = ref(0)
  /** Dev only: busy-wait this many ms every frame, to prove Auto steps down and recovers. */
  const debugLoadMs = ref(0)
  /** Dev only: retuned Auto thresholds (fps), for renderers that cannot reach 45 / 57 fps (headless software rendering). */
  const debugAuto = ref<{ down: number; up: number } | null>(null)

  function setSetting(next: QualitySetting): void {
    setting.value = next
    write(KEY_QUALITY, next)
    if (next !== 'auto') {
      effective.value = next
      rung.value = MANUAL_RUNG[next]
    }
  }

  /** Puts a ladder rung in force (Auto, or the dev API); the level follows the rung. */
  function setRung(next: number, byAuto = false): void {
    const r = clampRung(next)
    if (rung.value === r) return
    rung.value = r
    effective.value = levelOfRung(r)
    if (byAuto) autoChanges.value++
  }

  function toggleOverlay(): void {
    overlayVisible.value = !overlayVisible.value
    write(KEY_OVERLAY, overlayVisible.value ? '1' : '0')
  }

  function report(next: PerfStats): void {
    stats.value = next
  }

  return { benchmark, setting, effective, rung, rungLabel, overlayVisible, stats, autoChanges, debugLoadMs, debugAuto, setSetting, setRung, toggleOverlay, report }
})
