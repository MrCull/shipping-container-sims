// ---------------------------------------------------------------------------
// Box Empire — Narrator audio playback
//
// Manages a single HTMLAudioElement for narrator voiceover clips.
// All MP3s are pre-imported at build time so Vite bundles them correctly.
// ---------------------------------------------------------------------------

import { ref, onBeforeUnmount } from 'vue'

// Static imports — Vite resolves these at build time
import n01_01 from '../assets/sounds/narrator/01_01_vx_narrator_intro_welcome_manager.mp3'
import n01_02 from '../assets/sounds/narrator/01_02_vx_narrator_intro_old_terminal_state.mp3'
import n01_03 from '../assets/sounds/narrator/01_03_vx_narrator_intro_family_inheritance.mp3'
import n02_01 from '../assets/sounds/narrator/02_01_vx_narrator_event_vessel_announcement.mp3'
import n02_02 from '../assets/sounds/narrator/02_02_vx_narrator_event_feeder_vessel_details.mp3'
import n02_03 from '../assets/sounds/narrator/02_03_vx_narrator_event_vessel_docked.mp3'
import n03_01 from '../assets/sounds/narrator/03_01_vx_narrator_gameplay_speed_up_time.mp3'
import n03_02 from '../assets/sounds/narrator/03_02_vx_narrator_gameplay_first_container_quay.mp3'
import n03_03 from '../assets/sounds/narrator/03_03_vx_narrator_gameplay_imports_in_storage.mp3'
import n04_01 from '../assets/sounds/narrator/04_01_vx_narrator_gameplay_import_loaded_truck.mp3'
import n04_02 from '../assets/sounds/narrator/04_02_vx_narrator_progress_first_100_dollars.mp3'
import n04_03 from '../assets/sounds/narrator/04_03_vx_narrator_gameplay_export_to_quay.mp3'
import n05_01 from '../assets/sounds/narrator/05_01_vx_narrator_progress_150_dollars.mp3'
import n05_02 from '../assets/sounds/narrator/05_02_vx_narrator_feedback_player_progress_good.mp3'
import n05_03 from '../assets/sounds/narrator/05_03_vx_narrator_outro_final_handover.mp3'

const NARRATOR_URLS: Record<string, string> = {
  '01_01_vx_narrator_intro_welcome_manager.mp3': n01_01,
  '01_02_vx_narrator_intro_old_terminal_state.mp3': n01_02,
  '01_03_vx_narrator_intro_family_inheritance.mp3': n01_03,
  '02_01_vx_narrator_event_vessel_announcement.mp3': n02_01,
  '02_02_vx_narrator_event_feeder_vessel_details.mp3': n02_02,
  '02_03_vx_narrator_event_vessel_docked.mp3': n02_03,
  '03_01_vx_narrator_gameplay_speed_up_time.mp3': n03_01,
  '03_02_vx_narrator_gameplay_first_container_quay.mp3': n03_02,
  '03_03_vx_narrator_gameplay_imports_in_storage.mp3': n03_03,
  '04_01_vx_narrator_gameplay_import_loaded_truck.mp3': n04_01,
  '04_02_vx_narrator_progress_first_100_dollars.mp3': n04_02,
  '04_03_vx_narrator_gameplay_export_to_quay.mp3': n04_03,
  '05_01_vx_narrator_progress_150_dollars.mp3': n05_01,
  '05_02_vx_narrator_feedback_player_progress_good.mp3': n05_02,
  '05_03_vx_narrator_outro_final_handover.mp3': n05_03,
}

export function useNarratorAudio() {
  let currentAudio: HTMLAudioElement | null = null

  // Reactive progress for the optional progress bar (0–1)
  const progress = ref(0)
  const duration = ref(0)
  const audioEnded = ref(false)   // flips true momentarily when playback finishes
  let rafId: number | null = null
  let endedCallback: (() => void) | null = null

  function stopProgress(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function trackProgress(audio: HTMLAudioElement): void {
    stopProgress()
    function loop() {
      if (!audio.paused && !audio.ended) {
        progress.value = audio.duration > 0 ? audio.currentTime / audio.duration : 0
        rafId = requestAnimationFrame(loop)
      } else {
        progress.value = audio.ended ? 1 : progress.value
      }
    }
    rafId = requestAnimationFrame(loop)
  }

  function stopCurrent(): void {
    stopProgress()
    endedCallback = null
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.currentTime = 0
      currentAudio = null
    }
    progress.value = 0
    duration.value = 0
    audioEnded.value = false
  }

  /**
   * Play a narrator beat audio clip.
   * @param audioFile  Filename key from NARRATOR_URLS
   * @param onEnded    Optional callback fired when playback naturally finishes
   */
  function playBeat(audioFile: string, onEnded?: () => void): void {
    stopCurrent()
    const url = NARRATOR_URLS[audioFile]
    if (!url) {
      // No audio — treat as instant "ended" so auto-advance still works
      if (onEnded) setTimeout(onEnded, 800)
      return
    }

    const audio = new Audio(url)
    audio.volume = 0.94
    currentAudio = audio
    endedCallback = onEnded ?? null

    audio.addEventListener('loadedmetadata', () => {
      duration.value = audio.duration
    })

    audio.play().catch(() => {
      // Browser blocked autoplay — fire ended after a short delay so
      // auto-advance still works even without sound
      if (endedCallback) setTimeout(endedCallback, 1200)
    })

    trackProgress(audio)

    audio.addEventListener('ended', () => {
      progress.value = 1
      stopProgress()
      audioEnded.value = true
      if (endedCallback) {
        endedCallback()
        endedCallback = null
      }
    })
  }

  onBeforeUnmount(() => {
    stopCurrent()
  })

  return { playBeat, stopCurrent, progress, duration, audioEnded }
}
