/**
 * Yardshift background music (#390), pure TS: whether the track plays for a shift state. It plays while the shift is
 * running; any pause but a crane move (`animation`) stops it, as does the end of the shift.
 */
import type { ShiftState } from '../types/engine'

/** The track's own gain at full music volume; the element plays at this times the shared `'music'` channel gain. */
export const MUSIC_GAIN = 0.3

export function musicPlaying(state: Pick<ShiftState, 'status' | 'pauses'>): boolean {
  return state.status === 'playing' && state.pauses.every((p) => p === 'animation')
}
