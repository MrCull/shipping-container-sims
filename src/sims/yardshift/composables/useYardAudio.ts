/**
 * Yardshift sound (#388): plays the store's cues (modules/audioCues.ts) through Web Audio. Every tone and sample
 * goes through one bus `GainNode` on the shared `'sfx'` channel, set from `gainFor(1, 'sfx')` and watched, so the
 * master and effects sliders and mute change sounds live, even mid-note. A cue's own levels (`Tone.vol`,
 * `sampleGain`) are relative sound gains scaled by that bus; no fixed volume anywhere.
 */
import { onBeforeUnmount, watch } from 'vue'
import { useAudioStore } from '@/stores/audio'
import type { Cue, SampleName, Tone } from '../modules/audioCues'

const SAMPLE_URLS: Record<SampleName, string> = {
  pick: new URL('../assets/audio/crane-pick.mp3', import.meta.url).href,
  land: new URL('../assets/audio/crane-land.mp3', import.meta.url).href,
  truck: new URL('../assets/audio/truck.mp3', import.meta.url).href,
}

/** Envelope floor: exponential ramps cannot reach 0. */
const SILENT = 0.0001

export function useYardAudio(onCue: (listener: (cue: Cue) => void) => () => void): void {
  const audio = useAudioStore()
  let ctx: AudioContext | null = null
  let bus: GainNode | null = null
  const buffers = new Map<SampleName, AudioBuffer>()

  function context(): AudioContext | null {
    if (ctx) return ctx
    const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    bus = ctx.createGain()
    bus.gain.value = audio.gainFor(1, 'sfx')
    bus.connect(ctx.destination)
    for (const [name, url] of Object.entries(SAMPLE_URLS) as [SampleName, string][]) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx!.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        .catch(() => {})
    }
    return ctx
  }

  const stopGain = watch(
    () => audio.gainFor(1, 'sfx'),
    (gain) => {
      if (ctx && bus) bus.gain.setTargetAtTime(gain, ctx.currentTime, 0.015)
    },
  )

  function playTone(ac: AudioContext, out: GainNode, t: Tone): void {
    const start = ac.currentTime + t.delay
    const osc = ac.createOscillator()
    const env = ac.createGain()
    osc.type = t.type
    osc.frequency.setValueAtTime(t.f0, start)
    osc.frequency.exponentialRampToValueAtTime(t.f1, start + t.dur)
    env.gain.setValueAtTime(SILENT, start)
    env.gain.exponentialRampToValueAtTime(t.vol, start + 0.008)
    env.gain.exponentialRampToValueAtTime(SILENT, start + t.dur)
    osc.connect(env).connect(out)
    osc.start(start)
    osc.stop(start + t.dur + 0.01)
  }

  function playSample(ac: AudioContext, out: GainNode, name: SampleName, soundGain: number): void {
    const buffer = buffers.get(name)
    if (!buffer) return
    const src = ac.createBufferSource()
    const env = ac.createGain()
    src.buffer = buffer
    env.gain.value = soundGain
    src.connect(env).connect(out)
    src.start()
  }

  function play(cue: Cue): void {
    const ac = context()
    if (!ac || !bus) return
    if (ac.state === 'suspended') void ac.resume().catch(() => {})
    for (const t of cue.tones) playTone(ac, bus, t)
    if (cue.sample) playSample(ac, bus, cue.sample, cue.sampleGain ?? 1)
  }

  /** Browsers start an AudioContext only after a gesture: create it on the first pointer or key press. */
  function unlock(): void {
    const ac = context()
    if (ac?.state === 'suspended') void ac.resume().catch(() => {})
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })

  const stopCues = onCue(play)

  onBeforeUnmount(() => {
    stopCues()
    stopGain()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    void ctx?.close().catch(() => {})
    ctx = null
    bus = null
  })
}
