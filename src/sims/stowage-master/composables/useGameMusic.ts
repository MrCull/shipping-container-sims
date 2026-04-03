import { onMounted, onUnmounted, watch } from 'vue'
import { useAudioStore } from '@/stores/audio'
import gameMusicUrl from '../assets/audio/background-gaming-track-light.mp3'

let sharedAudio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(gameMusicUrl)
    sharedAudio.loop = true
    sharedAudio.volume = 0.3
  }
  return sharedAudio
}

export function useGameMusic() {
  const audioStore = useAudioStore()

  function tryPlay() {
    const audio = getAudio()
    if (audioStore.gameMusicMuted) {
      audio.pause()
      return
    }
    void audio.play().catch(() => {
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
      () => audioStore.gameMusicMuted,
      (isMuted) => {
        const audio = getAudio()
        if (isMuted) audio.pause()
        else void audio.play()
      }
    )
  })

  onUnmounted(() => {
    sharedAudio?.pause()
  })
}
