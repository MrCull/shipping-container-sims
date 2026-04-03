import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAudioStore = defineStore('audio', () => {
  const menuMusicMuted = ref(false)
  const gameMusicMuted = ref(false)

  function toggleMenuMusic(): void {
    menuMusicMuted.value = !menuMusicMuted.value
  }

  function toggleGameMusic(): void {
    gameMusicMuted.value = !gameMusicMuted.value
  }

  // Legacy alias for backwards compatibility
  const backgroundMusicMuted = menuMusicMuted

  return { menuMusicMuted, gameMusicMuted, toggleMenuMusic, toggleGameMusic, backgroundMusicMuted, toggleBackgroundMusic: toggleMenuMusic }
})
