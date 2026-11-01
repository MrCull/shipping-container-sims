import { onMounted, onUnmounted, watch } from 'vue'
import { followMasterGain, useAudioStore } from '@/stores/audio'
import gameMusicUrl from '../assets/audio/background-gaming-track-light.mp3'

let sharedAudio: HTMLAudioElement | null = null

/** The music's own gain at full master volume; the element plays at this times the shared master gain. */
const GAME_MUSIC_VOLUME = 0.3

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(gameMusicUrl)
    sharedAudio.loop = true
    sharedAudio.volume = useAudioStore().gainFor(GAME_MUSIC_VOLUME)
  }
  return sharedAudio
}

export function useGameMusic() {
  const audioStore = useAudioStore()

  function tryPlay() {
    const audio = getAudio()
    if (audioStore.musicMuted) {
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
    // The slider changes the level of music that is already playing (stopped with the component).
    followMasterGain(getAudio(), GAME_MUSIC_VOLUME)
    tryPlay()
    watch(
      () => audioStore.musicMuted,
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
