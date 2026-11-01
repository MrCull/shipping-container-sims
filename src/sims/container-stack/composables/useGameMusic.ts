import { onUnmounted, watch, type WatchStopHandle } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../store/gameStore'
import { followMasterGain, useAudioStore } from '@/stores/audio'
import gameMusicUrl from '../assets/audio/background-gaming-track-upbeat-techno-fun.mp3'

let sharedAudio: HTMLAudioElement | null = null
let stopFollow: WatchStopHandle | null = null

/** The music's own gain at full master volume; the element plays at this times the shared master gain. */
const GAME_MUSIC_VOLUME = 0.3

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(gameMusicUrl)
    sharedAudio.loop = true
    // The slider changes the level of music that is already playing.
    stopFollow = followMasterGain(sharedAudio, GAME_MUSIC_VOLUME)
  }
  return sharedAudio
}

export function useGameMusic(): void {
  const gameStore = useContainerStackStore()
  const audioStore = useAudioStore()
  const { phase } = storeToRefs(gameStore)
  const { musicMuted } = storeToRefs(audioStore)

  function tryPlay(): void {
    const audio = getAudio()
    if (musicMuted.value) {
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

  watch(musicMuted, (isMuted) => {
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
    stopFollow?.()
    stopFollow = null
  })
}
