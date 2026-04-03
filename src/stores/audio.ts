import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAudioStore = defineStore('audio', () => {
  const musicMuted = ref(false)      // canonical — shared across menu + all games
  const sfxMuted = ref(false)        // new — mutes all sound effects

  function toggleMusic(): void {
    musicMuted.value = !musicMuted.value
  }

  function toggleSfx(): void {
    sfxMuted.value = !sfxMuted.value
  }

  // Legacy aliases for backwards compatibility — all point to musicMuted/toggleMusic
  const menuMusicMuted = computed(() => musicMuted.value)
  const gameMusicMuted = computed(() => musicMuted.value)
  const backgroundMusicMuted = computed(() => musicMuted.value)
  const toggleMenuMusic = toggleMusic
  const toggleGameMusic = toggleMusic
  const toggleBackgroundMusic = toggleMusic

  return {
    musicMuted, sfxMuted, toggleMusic, toggleSfx,
    menuMusicMuted, gameMusicMuted, backgroundMusicMuted,
    toggleMenuMusic, toggleGameMusic, toggleBackgroundMusic,
  }
})
