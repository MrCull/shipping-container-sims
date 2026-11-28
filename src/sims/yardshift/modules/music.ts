/**
 * Yardshift background music (#390), pure TS: whether the track plays for a shift state. It plays while the shift is
 * running; any pause but a crane move (`animation`) stops it, as does the end of the shift.
 */
import type { ShiftState } from '../types/engine'

/**
 * The track's own gain at full music volume; the element plays at this times the shared `'music'` channel gain.
 * Owner round 4 asked for quieter music under louder effects: 0.18, 60 % of the earlier 0.3.
 */
export const MUSIC_GAIN = 0.18

export function musicPlaying(state: Pick<ShiftState, 'status' | 'pauses'>): boolean {
  return state.status === 'playing' && state.pauses.every((p) => p === 'animation')
}
