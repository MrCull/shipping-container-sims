import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loadSiteStorage, updateSiteStorage } from '@/utils/localStorage'

export const useAudioStore = defineStore('audio', () => {
  const persistedStorage = loadSiteStorage()
  const soundMuted = ref(persistedStorage.global.soundMuted)

  function persistSoundMuted(): void {
    updateSiteStorage(storage => ({
      ...storage,
      global: {
        ...storage.global,
        soundMuted: soundMuted.value,
      },
    }))
  }

  function setSoundMuted(value: boolean): void {
    soundMuted.value = value
    persistSoundMuted()
  }

  function toggleSound(): void {
    setSoundMuted(!soundMuted.value)
  }

  // Compatibility aliases keep existing sim audio logic working while using one global mute flag.
  const musicMuted = computed(() => soundMuted.value)
  const sfxMuted = computed(() => soundMuted.value)
  const menuMusicMuted = computed(() => soundMuted.value)
  const gameMusicMuted = computed(() => soundMuted.value)
  const backgroundMusicMuted = computed(() => soundMuted.value)
  const toggleMusic = toggleSound
  const toggleSfx = toggleSound
  const toggleMenuMusic = toggleSound
  const toggleGameMusic = toggleSound
  const toggleBackgroundMusic = toggleSound

  return {
    soundMuted,
    setSoundMuted,
    toggleSound,
    musicMuted,
    sfxMuted,
    toggleMusic,
    toggleSfx,
    menuMusicMuted,
    gameMusicMuted,
    backgroundMusicMuted,
    toggleMenuMusic,
    toggleGameMusic,
    toggleBackgroundMusic,
  }
})
