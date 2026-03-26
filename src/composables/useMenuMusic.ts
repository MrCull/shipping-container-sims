import { onMounted, onUnmounted } from 'vue'
import menuMusicUrl from '@/assets/audio/menu-music-loop.mp3'

/**
 * Looped background music for the home screen. Browsers may block autoplay
 * until the user interacts; we retry on first click or key press.
 */
export function useMenuMusic() {
  let audio: HTMLAudioElement | null = null

  function onGesture() {
    void audio?.play().then(() => {
      window.removeEventListener('click', onGesture)
      window.removeEventListener('keydown', onGesture)
    })
  }

  onMounted(() => {
    audio = new Audio(menuMusicUrl)
    audio.loop = true
    audio.volume = 0.35

    void audio.play().catch(() => {
      window.addEventListener('click', onGesture, { passive: true })
      window.addEventListener('keydown', onGesture, { passive: true })
    })
  })

  onUnmounted(() => {
    window.removeEventListener('click', onGesture)
    window.removeEventListener('keydown', onGesture)
    if (audio) {
      audio.pause()
      audio.src = ''
      audio.load()
      audio = null
    }
  })
}
