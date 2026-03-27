// ---------------------------------------------------------------------------
// Box Empire — Sound effect management
// ---------------------------------------------------------------------------

import { onBeforeUnmount } from 'vue'
import type { GameEventType } from '../types'
import { SOUND_MAP } from '../modules/config'

import containerPlacedUrl from '../assets/sounds/container-loaded-to-ship.mp3'
import moneyEarnedUrl from '../assets/sounds/money-increase-ca-ching-.mp3'
import vesselHornUrl from '../assets/sounds/small-ship-three-horns-in-a-row.mp3'
import cheerUrl from '../assets/sounds/group-yay-cheer.mp3'
import levelUpUrl from '../assets/sounds/level-up.mp3'

const FILE_TO_URL: Record<string, string> = {
  'container-loaded-to-ship.mp3': containerPlacedUrl,
  'money-increase-ca-ching-.mp3': moneyEarnedUrl,
  'small-ship-three-horns-in-a-row.mp3': vesselHornUrl,
  'group-yay-cheer.mp3': cheerUrl,
  'level-up.mp3': levelUpUrl,
}

export function useAudio() {
  const audioPool: HTMLAudioElement[] = []

  function play(eventType: GameEventType): void {
    const fileName = SOUND_MAP[eventType]
    if (!fileName) return
    const url = FILE_TO_URL[fileName]
    if (!url) return

    const audio = new Audio(url)
    audio.volume = 0.4
    audio.play().catch(() => { /* user hasn't interacted yet */ })
    audioPool.push(audio)

    audio.addEventListener('ended', () => {
      const idx = audioPool.indexOf(audio)
      if (idx >= 0) audioPool.splice(idx, 1)
    })
  }

  function stopAll(): void {
    for (const audio of audioPool) {
      audio.pause()
      audio.currentTime = 0
    }
    audioPool.length = 0
  }

  onBeforeUnmount(stopAll)

  return { play, stopAll }
}
