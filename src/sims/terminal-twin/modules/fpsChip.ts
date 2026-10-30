/**
 * The always-visible FPS chip (#118): fed by the `FpsMeter` (frames over the last second), amber below
 * 30 and red below 20. 0 means no measurement yet.
 */
export type FpsSeverity = 'idle' | 'ok' | 'warn' | 'bad'

export const FPS_WARN_BELOW = 30
export const FPS_BAD_BELOW = 20

export function fpsSeverity(fps: number): FpsSeverity {
  if (!(fps > 0)) return 'idle'
  if (fps < FPS_BAD_BELOW) return 'bad'
  if (fps < FPS_WARN_BELOW) return 'warn'
  return 'ok'
}
