/**
 * Solver fixtures (`fixtures/level-NN.json`, written by `pnpm run ys:solve`): each level's proven minimum rehandles
 * and one optimal action list. The three-star target comes from here, never from hand-entered level data.
 */
import type { ShiftAction } from '../types/engine'

export interface LevelFixture {
  level: number
  minRehandles: number
  actions: ShiftAction[]
}

const files = import.meta.glob<LevelFixture>('../fixtures/level-*.json', { eager: true, import: 'default' })

export const FIXTURES: readonly LevelFixture[] = Object.values(files).sort((a, b) => a.level - b.level)

export function fixtureFor(level: number): LevelFixture | undefined {
  return FIXTURES.find((f) => f.level === level)
}
