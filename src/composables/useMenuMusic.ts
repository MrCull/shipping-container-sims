import { onMounted, onUnmounted, watch } from 'vue'
import { followMasterGain, useAudioStore } from '@/stores/audio'
import menuMusicUrl from '@/assets/audio/menu-music-loop.mp3'

/**
 * Module-level singleton so the Audio object is created once and reused
 * across HomePage mounts/unmounts. This prevents the race condition where
 * the click that navigates away triggers onGesture after onUnmounted has
 * already nulled out the local audio reference.
 */
let sharedAudio: HTMLAudioElement | null = null

/** The menu music's own level at full master volume; the element's volume is this times the master gain. */
const MENU_MUSIC_GAIN = 0.35

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(menuMusicUrl)
    sharedAudio.loop = true
    sharedAudio.volume = useAudioStore().gainFor(MENU_MUSIC_GAIN)
  }
  return sharedAudio
}

export function useMenuMusic() {
  const audioStore = useAudioStore()

  function tryPlay() {
    const audio = getAudio()
    if (audioStore.musicMuted) {
      audio.pause()
      return
    }
    void audio.play().catch(() => {
      // Autoplay blocked, wait for first user interaction then retry once
      const onGesture = () => {
        void audio.play()
        window.removeEventListener('click', onGesture)
        window.removeEventListener('keydown', onGesture)
      }
      window.addEventListener('click', onGesture, { passive: true })
      window.addEventListener('keydown', onGesture, { passive: true })
    })
  }

  onMounted(() => {
    // The slider drives the level live while the menu is open (stopped with the component).
    followMasterGain(getAudio(), MENU_MUSIC_GAIN)
    tryPlay()
    watch(
      () => audioStore.musicMuted,
      (isMuted) => {
        const audio = getAudio()
        if (isMuted) {
          audio.pause()
        } else {
          void audio.play()
        }
      },
    )
  })

  onUnmounted(() => {
    // Pause but keep the singleton alive so it can resume on the next mount
    const audio = sharedAudio
    if (audio) {
      audio.pause()
    }
  })
}
