import { useAudioStore } from '@/stores/audio'
import { SOUNDS, COLLAPSE_SEQUENCE } from './audio'

let ctx: AudioContext | null = null
const buffers = new Map<string, AudioBuffer>()
let loadPromise: Promise<void> | null = null

export async function ensureAudioLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      ctx = new AudioContext()
      const entries = Object.entries(SOUNDS)
      await Promise.allSettled(
        entries.map(async ([key, url]) => {
          try {
            const response = await fetch(url)
            const arrayBuffer = await response.arrayBuffer()
            const audioBuffer = await ctx!.decodeAudioData(arrayBuffer)
            buffers.set(key, audioBuffer)
          } catch {
            /* optional */
          }
        })
      )
    } catch {
      ctx = null
    }
  })()
  return loadPromise
}

export function playStackSound(name: string, volume: number = 0.8, playbackRate: number = 1): void {
  if (useAudioStore().sfxMuted) return
  if (!ctx || !buffers.has(name)) return
  if (ctx.state === 'suspended') void ctx.resume()

  const source = ctx.createBufferSource()
  source.buffer = buffers.get(name)!
  source.playbackRate.value = playbackRate

  const gainNode = ctx.createGain()
  gainNode.gain.value = volume
  source.connect(gainNode)
  gainNode.connect(ctx.destination)
  source.start(0)
}

export function playCollapseSounds(): void {
  for (const { key, delay, volume } of COLLAPSE_SEQUENCE) {
    setTimeout(() => playStackSound(key, volume ?? 0.75), delay * 1000)
  }
}

export function disposeStackAudio(): void {
  if (ctx) {
    void ctx.close()
    ctx = null
  }
  buffers.clear()
  loadPromise = null
}
