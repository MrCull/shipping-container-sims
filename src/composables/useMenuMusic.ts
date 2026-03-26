import { onMounted, onUnmounted } from 'vue'
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
  function tryPlay() {
    const audio = getAudio()
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

  onMounted(tryPlay)

  onUnmounted(() => {
    // Pause but keep the singleton alive so it can resume on the next mount
    const audio = sharedAudio
    if (audio) {
      audio.pause()
    }
  })
}
