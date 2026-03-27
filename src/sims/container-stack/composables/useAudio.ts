import { ref } from 'vue'
import { ensureAudioLoaded, playStackSound, playCollapseSounds } from '../modules/audioPlayer'

export function useContainerStackAudio() {
  const isLoaded = ref(false)

  async function init(): Promise<void> {
    await ensureAudioLoaded()
    isLoaded.value = true
  }

  function playSound(name: string, volume?: number, playbackRate?: number): void {
    playStackSound(name, volume, playbackRate)
  }

  function playCollapseSequence(): void {
    playCollapseSounds()
  }

  return { init, isLoaded, playSound, playCollapseSequence }
}
