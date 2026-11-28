/**
 * Yardshift background music (#390): one looping `Audio` element on the shared `'music'` channel through
 * `followMasterGain`, so the master and music sliders and mute change it live. It plays while `musicPlaying` says
 * the shift runs (modules/music.ts), pauses with the game and stops when the sim unmounts. The menu music stops on
 * its own when the home page unmounts (`useMenuMusic`).
 *
 * Owner round 5: entering Yardshift unmutes for the visit (`holdSoundMuted(false)`), so its music plays even after
 * the home page's default mute or a stored mute, without writing the stored mute or moving the sliders. A mute the
 * player chooses inside the sim ends the hold and is kept; leaving releases the hold.
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { followMasterGain, useAudioStore } from '@/stores/audio'
import { MUSIC_GAIN, musicPlaying } from '../modules/music'
import type { ShiftState } from '../types/engine'
import musicUrl from '../assets/audio/music-light-piano.mp3'

export function useYardMusic(state: () => ShiftState): void {
  const audio = useAudioStore()
  const releaseSoundOn = audio.holdSoundMuted(false)
  const element = new Audio(musicUrl)
  element.loop = true
  const stopFollow = followMasterGain(element, MUSIC_GAIN, 'music')
  const wanted = computed(() => musicPlaying(state()) && !audio.musicMuted)

  function retryOnGesture(): void {
    window.addEventListener('pointerdown', onGesture, { once: true, passive: true })
    window.addEventListener('keydown', onGesture, { once: true, passive: true })
  }

  function onGesture(): void {
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
    if (wanted.value) void element.play().catch(() => {})
  }

  const stopWatch = watch(
    wanted,
    (play) => {
      if (play) void element.play().catch(retryOnGesture)
      else element.pause()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopWatch()
    stopFollow()
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
    element.pause()
    element.removeAttribute('src')
    element.load()
    releaseSoundOn()
  })
}
