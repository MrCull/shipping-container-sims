/** Pure presentation rules for the shared speaker control (AudioControls.vue). */

export function isSilent(muted: boolean, volume: number): boolean {
  return muted || volume === 0
}

export function speakerIcon(muted: boolean, volume: number): string {
  if (isSilent(muted, volume)) return '🔇'
  return volume < 0.5 ? '🔉' : '🔊'
}

/** The speaker click toggles mute for music and effects together, so its label names that action. */
export function speakerLabel(muted: boolean): string {
  return muted ? 'Unmute all' : 'Mute all'
}
