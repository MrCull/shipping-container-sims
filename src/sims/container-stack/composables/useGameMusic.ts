import { onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../store/gameStore'
import { useAudioStore } from '@/stores/audio'
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
  const audioStore = useAudioStore()
  const { phase } = storeToRefs(gameStore)
  const { gameMusicMuted } = storeToRefs(audioStore)

  function tryPlay(): void {
    const audio = getAudio()
    if (gameMusicMuted.value) {
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

  watch(gameMusicMuted, (isMuted) => {
    const audio = getAudio()
    if (isMuted) {
      audio.pause()
    } else {
      // Only resume if game is in an active playing phase
      if (phase.value === 'playing' || phase.value === 'removing' || phase.value === 'placing' || phase.value === 'collapsing') {
        void audio.play()
      }
    }
  })

  onUnmounted(() => {
    sharedAudio?.pause()
    sharedAudio = null
  })
}
