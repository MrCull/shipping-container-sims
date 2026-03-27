import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAudioStore = defineStore('audio', () => {
  const backgroundMusicMuted = ref(false)

  function toggleBackgroundMusic(): void {
    backgroundMusicMuted.value = !backgroundMusicMuted.value
  }

  return { backgroundMusicMuted, toggleBackgroundMusic }
})
