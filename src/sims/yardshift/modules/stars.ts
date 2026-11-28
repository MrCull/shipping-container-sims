/**
 * Stars for a completed shift, separate from score: three at the solver-proven minimum rehandles (or fewer), two at
 * minimum + 1, one for any other completed shift. Time and score never count.
 */
import { fixtureFor } from './fixtures'

export type Stars = 1 | 2 | 3

export function starsFor(rehandles: number, minRehandles: number): Stars {
  if (rehandles <= minRehandles) return 3
  return rehandles === minRehandles + 1 ? 2 : 1
}

/** The three-star target for a level, from its solver fixture. */
export function minRehandlesFor(level: number): number {
  const fixture = fixtureFor(level)
  if (!fixture) throw new Error(`Yardshift: no solver fixture for level ${level} (run pnpm run ys:solve)`)
  return fixture.minRehandles
}

export function starsForLevel(level: number, rehandles: number): Stars {
  return starsFor(rehandles, minRehandlesFor(level))
}
