import { onMounted, onUnmounted, watch } from 'vue'
import { useAudioStore } from '@/stores/audio'
import menuMusicUrl from '@/assets/audio/menu-music-loop.mp3'

/**
 * Module-level singleton so the Audio object is created once and reused
 * across HomePage mounts/unmounts. This prevents the race condition where
 * the click that navigates away triggers onGesture after onUnmounted has
 * already nulled out the local audio reference.
 */
let sharedAudio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(menuMusicUrl)
    sharedAudio.loop = true
    sharedAudio.volume = 0.35
  }
  return sharedAudio
}

export function useMenuMusic() {
  const audioStore = useAudioStore()

  function tryPlay() {
    const audio = getAudio()
    if (audioStore.backgroundMusicMuted) {
      audio.pause()
      return
    }
    void audio.play().catch(() => {
      // Autoplay blocked — wait for first user interaction then retry once
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
    tryPlay()
    watch(
      () => audioStore.backgroundMusicMuted,
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
