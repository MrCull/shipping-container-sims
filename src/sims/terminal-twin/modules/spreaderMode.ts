/**
 * The spreader mode rule shared by the STS, ASC and SHC renderers (#142): what a spreader's length and twin-lock
 * state should be for the load it holds. Pure, so it is unit-tested without a scene.
 *
 * A single 20 ft box takes the short spreader; a 40 ft, 40 ft high cube or 45 ft box takes the long one; two boxes
 * at once (twin-20) take the long spreader with its twin locks, but only on a machine that can carry two 20s
 * (`canTwin`). An empty spreader keeps the length of its last load, so it telescopes before the next lift and not
 * for nothing (the STS has always behaved so).
 */
export type SpreaderMode = '20' | '40' | 'twin-20'

/** What a machine holds this frame: the box count and the size of the box (or of the last box when several). */
export interface SpreaderLoad {
  count: number
  size: string
}

/** ISO 1161 twist-lock casting spacing along the box (m): the distance between the two end pairs of locks. */
export const CASTING_SPACING_M = { short: 5.853, long: 11.985 } as const

/** The mode for a load. `previous` is what the spreader showed last (empty keeps it, default 40). */
export function spreaderModeFor(load: SpreaderLoad | undefined, opts: { canTwin: boolean; previous?: SpreaderMode }): SpreaderMode {
  if (!load || load.count <= 0) return opts.previous ?? '40'
  if (load.count > 1 && opts.canTwin) return 'twin-20'
  return load.size === '20' ? '20' : '40'
}

/** Length of the spreader's lock pattern for a mode (m): short for a single 20, long otherwise. */
export function spreaderLengthM(mode: SpreaderMode): number {
  return mode === '20' ? CASTING_SPACING_M.short : CASTING_SPACING_M.long
}

/** Scale of the long-axis dimension of a 40 ft spreader model that gives the mode's length. */
export function spreaderLengthRatio(mode: SpreaderMode): number {
  return spreaderLengthM(mode) / CASTING_SPACING_M.long
}
