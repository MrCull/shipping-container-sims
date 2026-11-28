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

/** Disconnects a one-shot source and the nodes behind it when it ends, so finished cues leave no graph behind. */
export function releaseOnEnded(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  src.onended = () => {
    src.disconnect()
    for (const n of nodes) n.disconnect()
  }
}

/**
 * Plays one tone into `out` (the sfx bus): an oscillator ramping f0 to f1 through its own envelope gain (8 ms attack
 * to `vol`, exponential decay over `dur`). A `noise` tone is a white-noise buffer through a band-pass filter whose
 * centre ramps f0 to f1 (the air-brake hiss). Every node disconnects when the source ends.
 */
export function playTone(ac: BaseAudioContext, out: AudioNode, t: Tone): void {
  const start = ac.currentTime + t.delay
  const env = ac.createGain()
  env.gain.setValueAtTime(SILENT, start)
  env.gain.exponentialRampToValueAtTime(t.vol, start + 0.008)
  env.gain.exponentialRampToValueAtTime(SILENT, start + t.dur)
  env.connect(out)
  let src: AudioScheduledSourceNode
  if (t.type === 'noise') {
    const length = Math.max(1, Math.ceil(ac.sampleRate * (t.dur + 0.01)))
    const buffer = ac.createBuffer(1, length, ac.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    const noise = ac.createBufferSource()
    noise.buffer = buffer
    const filter = ac.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.2
    filter.frequency.setValueAtTime(t.f0, start)
    filter.frequency.exponentialRampToValueAtTime(t.f1, start + t.dur)
    noise.connect(filter).connect(env)
    releaseOnEnded(noise, filter, env)
    src = noise
  } else {
    const osc = ac.createOscillator()
    osc.type = t.type
    osc.frequency.setValueAtTime(t.f0, start)
    osc.frequency.exponentialRampToValueAtTime(t.f1, start + t.dur)
    osc.connect(env)
    releaseOnEnded(osc, env)
    src = osc
  }
  src.start(start)
  src.stop(start + t.dur + 0.01)
}

/** The gestures that may start audio: iOS Safari unlocks on `touchend` and `pointerdown`, desktops on any of them. */
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const

/**
 * Keeps the context running (art pass 3, item 5): on every gesture while it is not `running` ('suspended' before
 * the first gesture, 'interrupted' on iOS after a call or backgrounding), `resume()` inside the gesture, and on
 * the first gesture with a context, also play a one-sample silent buffer, which is what makes iOS Safari unlock
 * Web Audio reliably. `context` creates the context lazily (it may return null with no Web Audio). Returns a
 * function that removes the listeners.
 */
export function installAudioUnlock(target: EventTarget, context: () => AudioContext | null): () => void {
  let primed = false
  function unlock(): void {
    const ac = context()
    if (!ac || ac.state === 'running') return
    if (!primed) {
      primed = true
      const src = ac.createBufferSource()
      src.buffer = ac.createBuffer(1, 1, 22050)
      src.connect(ac.destination)
      src.start(0)
    }
    void ac.resume().catch(() => {})
  }
  const options = { capture: true, passive: true }
  for (const type of UNLOCK_EVENTS) target.addEventListener(type, unlock, options)
  return () => {
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, unlock, options)
  }
}

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

  function playSample(ac: AudioContext, out: GainNode, name: SampleName, soundGain: number): void {
    const buffer = buffers.get(name)
    if (!buffer) return
    const src = ac.createBufferSource()
    const env = ac.createGain()
    src.buffer = buffer
    env.gain.value = soundGain
    src.connect(env).connect(out)
    releaseOnEnded(src, env)
    src.start()
  }

  function play(cue: Cue): void {
    const ac = context()
    if (!ac || !bus) return
    if (ac.state !== 'running') void ac.resume().catch(() => {})
    for (const t of cue.tones) playTone(ac, bus, t)
    if (cue.sample) playSample(ac, bus, cue.sample, cue.sampleGain ?? 1)
  }

  /** Browsers start an AudioContext only after a gesture: created on the first one, resumed on each until running. */
  const stopUnlock = installAudioUnlock(window, context)

  const stopCues = onCue(play)

  onBeforeUnmount(() => {
    stopCues()
    stopGain()
    stopUnlock()
    void ctx?.close().catch(() => {})
    ctx = null
    bus = null
  })
}
