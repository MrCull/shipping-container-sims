/**
 * Yardshift screen content (#386), pure TS: the level intro, result and fail screens, the level picker rows and the
 * undo button. Vue modals render these strings and nothing else.
 */
import { undoRejection, UNDO_SHIFT_MS } from './engine'
import { isUnlocked, type Progress } from './progress'
import { starsFor, type Stars } from './stars'
import type { LevelDef, ShiftState } from '../types/engine'

export interface IntroView {
  title: string
  objective: string
  target: string
  shift: string
  tip: string
}

export interface ResultView {
  title: string
  stars: Stars
  verdict: string
  rehandles: string
  score: string
  combo: string
  bonuses: string
  timeEarned: string
  /** "Next shift" when a later level exists. */
  hasNext: boolean
}

export interface FailView {
  title: string
  reason: string
  left: string
  /** "Undo last move" is offered after a blocked failure while the undo is still available. */
  canUndo: boolean
}

export interface PickerRow {
  number: number
  name: string
  locked: boolean
  stars: string
  best: string
}

export interface UndoView {
  enabled: boolean
  label: string
  /** Why undo is unavailable (empty when enabled). */
  reason: string
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function starText(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(3 - stars)
}

export function introView(level: LevelDef, minRehandles: number): IntroView {
  return {
    title: `${level.number}. ${level.name}`,
    objective: `Load ${level.count} containers in order.`,
    target: `★★★ ${plural(minRehandles, 'rehandle', 'rehandles')} · Max ${level.maxRehandles}`,
    shift: `${level.shiftSeconds}s shift`,
    tip: level.tip,
  }
}

export function resultView(state: ShiftState, minRehandles: number, levelCount: number): ResultView {
  const stars = starsFor(state.rehandles, minRehandles)
  return {
    title: 'YARD CLEARED',
    stars,
    verdict: stars === 3 ? 'Optimal clearance!' : 'Shift complete',
    rehandles: `${plural(state.rehandles, 'rehandle', 'rehandles')} · minimum ${minRehandles}`,
    score: `${state.score} points`,
    combo: `Best combo ×${state.bestCombo}`,
    bonuses: plural(state.golds, 'star bonus', 'star bonuses') + ' collected',
    timeEarned: `+${(state.earnedMs / 1000).toFixed(1)}s shift time earned`,
    hasNext: state.level.number < levelCount,
  }
}

export function failView(state: ShiftState): FailView {
  const blocked = state.failure?.reason === 'blocked'
  const left = state.level.count - state.collected
  return {
    title: blocked ? 'Yard blocked' : 'Time’s up',
    reason: state.failure?.message ?? '',
    left: `${plural(left, 'container', 'containers')} left · ${state.score} points`,
    canUndo: blocked && undoRejection(state) === null,
  }
}

export function pickerRows(levels: readonly LevelDef[], progress: Progress, unlockAll: boolean): PickerRow[] {
  return levels.map((level) => {
    const best = progress.levels[level.number]
    const locked = !isUnlocked(progress, level.number, unlockAll)
    return {
      number: level.number,
      name: level.name,
      locked,
      stars: best && best.stars > 0 ? starText(best.stars) : '',
      best: locked ? 'Locked' : best?.score != null ? `Best ${best.score}` : 'Not played',
    }
  })
}

export function undoView(state: ShiftState): UndoView {
  const r = undoRejection(state)
  const label = `Undo (${state.undosLeft})`
  if (!r) return { enabled: true, label, reason: '' }
  const reason =
    r.reason === 'undo-low-time'
      ? `Undo needs more than ${UNDO_SHIFT_MS / 1000}s of shift.`
      : r.reason === 'crane-busy' || r.reason === 'shift-over'
        ? ''
        : r.message
  return { enabled: false, label, reason }
}
