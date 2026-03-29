import { onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../store/gameStore'
import gameMusicUrl from '../assets/audio/background-gaming-track-upbeat-techno-fun.mp3'

let sharedAudio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(gameMusicUrl)
    sharedAudio.loop = true
    sharedAudio.volume = 0.3
  }
  return sharedAudio
}

export function useGameMusic(): void {
  const gameStore = useContainerStackStore()
  const { phase } = storeToRefs(gameStore)

  function tryPlay(): void {
    const audio = getAudio()
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

  watch(phase, (p) => {
    const audio = getAudio()
    if (p === 'start' || p === 'gameOver') {
      audio.pause()
      audio.currentTime = 0
    } else if (p === 'playing' || p === 'removing' || p === 'placing' || p === 'collapsing') {
      tryPlay()
    } else if (p === 'paused') {
      audio.pause()
    } else if (p === 'levelComplete' || p === 'levelFailed') {
      audio.pause()
    }
  })

  onUnmounted(() => {
    sharedAudio?.pause()
    sharedAudio = null
  })
}
