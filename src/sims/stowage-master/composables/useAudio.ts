import { ref, onUnmounted } from 'vue'
import { SOUNDS, DISASTER_SEQUENCES, PLACEMENT_SOUND } from '../modules/audio'

export function useAudio() {
  const audioContext = ref<AudioContext | null>(null)
  const buffers = new Map<string, AudioBuffer>()
  const isLoaded = ref(false)
  // Track all active sources so we can stop them on demand
  const activeSources: AudioBufferSourceNode[] = []

  async function init(): Promise<void> {
    try {
      audioContext.value = new AudioContext()
      await loadAllSounds()
      isLoaded.value = true
    } catch (e) {
      console.warn('Audio init failed:', e)
    }
  }

  async function loadAllSounds(): Promise<void> {
    const ctx = audioContext.value
    if (!ctx) return

    await Promise.allSettled(
      Object.entries(SOUNDS).map(async ([key, url]) => {
        try {
          const response = await fetch(url)
          const arrayBuffer = await response.arrayBuffer()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          buffers.set(key, audioBuffer)
        } catch {
          // Audio files are optional — degrade silently
        }
      })
    )
  }

  function playSound(name: string, volume: number = 0.8): void {
    const ctx = audioContext.value
    if (!ctx || !buffers.has(name)) return
    if (ctx.state === 'suspended') ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = buffers.get(name)!

    const gainNode = ctx.createGain()
    gainNode.gain.value = volume

    source.connect(gainNode)
    gainNode.connect(ctx.destination)

    // Track active source; remove when it ends naturally
    activeSources.push(source)
    source.onended = () => {
      const idx = activeSources.indexOf(source)
      if (idx !== -1) activeSources.splice(idx, 1)
    }

    source.start(0)
  }

  /** Stop all currently-playing sounds immediately (e.g. on level transition) */
  function stopAll(): void {
    for (const source of activeSources) {
      try { source.stop() } catch { /* already ended */ }
    }
    activeSources.length = 0
  }

  function playPlacementSound(): void {
    const ctx = audioContext.value
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()

    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(PLACEMENT_SOUND.startFreq, ctx.currentTime)
    oscillator.frequency.linearRampToValueAtTime(PLACEMENT_SOUND.endFreq, ctx.currentTime + PLACEMENT_SOUND.duration)

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + PLACEMENT_SOUND.duration)

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + PLACEMENT_SOUND.duration)
  }

  function playDisasterSequence(type: string): void {
    const sequence = DISASTER_SEQUENCES[type]
    if (!sequence) return
    for (const { sound, delay } of sequence) {
      setTimeout(() => playSound(sound, 0.9), delay * 1000)
    }
  }

  function dispose(): void {
    stopAll()
    if (audioContext.value) {
      audioContext.value.close()
      audioContext.value = null
    }
    buffers.clear()
  }

  onUnmounted(dispose)

  return { init, isLoaded, playSound, stopAll, playPlacementSound, playDisasterSequence, dispose }
}
