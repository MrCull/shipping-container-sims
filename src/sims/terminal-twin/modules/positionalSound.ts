/**
 * Positional sound playback (#125): a thin Web Audio layer over the sound mixer. Each frame `update` takes the camera
 * and the sound sources, asks `mixSources` for the voices, and starts, retunes and stops looping buffer voices to
 * match. Every voice goes through one master gain node set from the shared volume and mute (`stores/audio.ts`); at
 * master gain 0 all voices are stopped and no AudioContext is created. A blocked or failing context is swallowed:
 * sound is never worth an error.
 */
import { diffVoices, mixSources, type SoundKind, type SoundSource, type Vec3, type Voice } from './soundMixer'

const urls: Record<SoundKind, string> = {
  gantryAlarm: new URL('../assets/sounds/gantry-alarm.wav', import.meta.url).href,
}

/** The parts of an AudioContext this layer uses (a fake stands in for it in tests). */
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  createGain(): GainNode
  createBufferSource(): AudioBufferSourceNode
  decodeAudioData?(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  close(): Promise<void>
}

export interface PositionalSoundOptions {
  createContext?: () => AudioContextLike
  loadBuffer?: (ctx: AudioContextLike, sound: SoundKind) => Promise<AudioBuffer>
}

interface Running {
  voice: Voice
  source: AudioBufferSourceNode
  gain: GainNode
}

/** Time constant (s) of gain changes: smooth enough to avoid zipper noise and clicks, quick enough to follow the camera. */
const SMOOTH_S = 0.04

function defaultCreateContext(): AudioContextLike {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new Ctor() as unknown as AudioContextLike
}

async function defaultLoadBuffer(ctx: AudioContextLike, sound: SoundKind): Promise<AudioBuffer> {
  const res = await fetch(urls[sound])
  return ctx.decodeAudioData!(await res.arrayBuffer())
}

/** Stable per-key start offset (0..1 of the loop) so machines do not beep in lockstep. */
function phaseOf(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

export class PositionalSound {
  private ctx: AudioContextLike | null = null
  private master: GainNode | null = null
  private buffers = new Map<SoundKind, AudioBuffer>()
  private loading = new Set<SoundKind>()
  private running = new Map<string, Running>()
  private disposed = false

  /** `masterGain` reads the shared volume (0 while muted). */
  constructor(
    private masterGain: () => number,
    private opts: PositionalSoundOptions = {},
  ) {}

  private clampedGain(): number {
    const g = this.masterGain()
    return Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0
  }

  /** The master gain changed: retune the master node. Voices stop on the next `update` when it reached 0. */
  applyGain(): void {
    if (this.master) this.master.gain.value = this.clampedGain()
  }

  private ensureContext(): AudioContextLike | null {
    if (this.ctx) return this.ctx
    try {
      const ctx = (this.opts.createContext ?? defaultCreateContext)()
      const master = ctx.createGain()
      master.gain.value = this.clampedGain()
      master.connect(ctx.destination as AudioNode)
      this.ctx = ctx
      this.master = master
    } catch {
      return null // no audio support
    }
    return this.ctx
  }

  private load(ctx: AudioContextLike, sound: SoundKind): void {
    if (this.buffers.has(sound) || this.loading.has(sound)) return
    this.loading.add(sound)
    ;(this.opts.loadBuffer ?? defaultLoadBuffer)(ctx, sound).then(
      (buffer) => {
        this.loading.delete(sound)
        if (!this.disposed) this.buffers.set(sound, buffer)
      },
      () => this.loading.delete(sound), // keep silent; the next frame retries
    )
  }

  /** Play what the mixer says for this frame. Cheap when nothing gantries: no voices, no work beyond the mix. */
  update(camera: Vec3, sources: readonly SoundSource[]): void {
    if (this.disposed) return
    if (this.clampedGain() <= 0) {
      this.stopAll()
      return
    }
    const voices = mixSources(camera, sources)
    if (voices.length === 0 && this.running.size === 0) return
    const ctx = this.ensureContext()
    if (!ctx || !this.master) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const diff = diffVoices([...this.running.values()].map((r) => r.voice), voices)
    for (const v of diff.stop) this.stop(v.key)
    for (const v of diff.start) {
      const buffer = this.buffers.get(v.sound)
      if (!buffer) this.load(ctx, v.sound)
      else this.start(ctx, buffer, v)
    }
    for (const v of diff.update) this.retune(ctx, v)
  }

  private start(ctx: AudioContextLike, buffer: AudioBuffer, voice: Voice): void {
    try {
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      source.loop = true
      gain.gain.value = 0
      gain.gain.setTargetAtTime(voice.gain, ctx.currentTime, SMOOTH_S)
      source.connect(gain)
      gain.connect(this.master!)
      source.start(0, phaseOf(voice.key) * buffer.duration)
      this.running.set(voice.key, { voice, source, gain })
    } catch {
      // no audio support
    }
  }

  private retune(ctx: AudioContextLike, voice: Voice): void {
    const r = this.running.get(voice.key)
    if (!r) return
    r.voice = voice
    r.gain.gain.setTargetAtTime(voice.gain, ctx.currentTime, SMOOTH_S)
  }

  private stop(key: string): void {
    const r = this.running.get(key)
    if (!r) return
    this.running.delete(key)
    try {
      if (this.ctx) r.gain.gain.setTargetAtTime(0, this.ctx.currentTime, SMOOTH_S / 2)
      r.source.stop((this.ctx?.currentTime ?? 0) + 0.12)
      r.source.onended = () => {
        r.source.disconnect()
        r.gain.disconnect()
      }
    } catch {
      // already stopped
    }
  }

  private stopAll(): void {
    for (const key of [...this.running.keys()]) this.stop(key)
  }

  /** Dev/test view: the voices playing now. */
  stats(): { voices: { key: string; gain: number }[] } {
    return { voices: [...this.running.values()].map((r) => ({ key: r.voice.key, gain: r.voice.gain })) }
  }

  dispose(): void {
    this.stopAll()
    this.disposed = true
    if (this.ctx) void this.ctx.close().catch(() => undefined)
    this.ctx = null
    this.master = null
  }
}
