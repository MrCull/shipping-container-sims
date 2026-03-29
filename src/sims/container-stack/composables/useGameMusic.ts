import { onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAudioStore } from '@/stores/audio'
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
  const audioStore = useAudioStore()
  const gameStore = useContainerStackStore()
  const { phase } = storeToRefs(gameStore)

  function tryPlay(): void {
    const audio = getAudio()
    if (audioStore.backgroundMusicMuted) {
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

  watch(() => audioStore.backgroundMusicMuted, (isMuted) => {
    const audio = getAudio()
    if (isMuted) audio.pause()
    else if (phase.value !== 'start' && phase.value !== 'gameOver' && phase.value !== 'paused') {
      void audio.play()
    }
  })

  onUnmounted(() => {
    sharedAudio?.pause()
    sharedAudio = null
  })
}
