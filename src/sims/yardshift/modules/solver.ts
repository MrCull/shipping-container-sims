/**
 * Yardshift solver: the proven minimum rehandles for a level and one optimal action list. Clocks are ignored.
 *
 * A* over engine states with edge cost 1 per rehandle and 0 per collection or receipt. Legality and transitions are
 * the engine's own (`rejectionFor`, `applyAction`), so the solver can never accept a move the game refuses. The search
 * key is (stacks as an unordered multiset, next collection, receipts served, waiting truck's deadline): stacks are
 * interchangeable because rehandle cost ignores distance and every stack has the same capacity. The rehandle cap is
 * enforced by `rejectionFor`, so a level whose minimum exceeds its cap has no solution (null).
 *
 * Heuristic: containers in the yard sitting above a lower-numbered container. Each must be rehandled at least once
 * (it cannot be collected before the one beneath it), a rehandle lowers the count by at most one and a collection
 * never changes it, so it is admissible and consistent and the first goal popped is optimal.
 */
import { applyAction, initialState, rejectionFor } from './engine'
import type { LevelDef, ShiftAction, ShiftState } from '../types/engine'

export interface Solution {
  minRehandles: number
  actions: ShiftAction[]
}

interface Node {
  state: ShiftState
  g: number
  parent: Node | null
  action: ShiftAction | null
}

function blocked(state: ShiftState): number {
  let n = 0
  for (const stack of state.stacks) {
    let min = Infinity
    for (const id of stack) {
      if (id > min) n++
      else min = id
    }
  }
  return n
}

function keyOf(state: ShiftState): string {
  const stacks = state.stacks.map((s) => s.join(',')).sort()
  return `${stacks.join('|')}#${state.next}#${state.receipts}#${state.deadline ?? '-'}`
}

function candidates(state: ShiftState): ShiftAction[] {
  const n = state.stacks.length
  const out: ShiftAction[] = []
  for (let to = 0; to < n; to++) out.push({ type: 'receive', to })
  for (let from = 0; from < n; from++) {
    out.push({ type: 'collect', from })
    for (let to = 0; to < n; to++) if (to !== from) out.push({ type: 'rehandle', from, to })
  }
  return out.filter((a) => rejectionFor(state, a) === null)
}

function pathOf(node: Node): ShiftAction[] {
  const actions: ShiftAction[] = []
  for (let n: Node | null = node; n?.action; n = n.parent) actions.push(n.action)
  return actions.reverse()
}

/** The optimal solution for `level`, or null when no completion exists within its rehandle cap. */
export function solve(level: LevelDef): Solution | null {
  const start = initialState(level)
  const buckets: Node[][] = []
  const best = new Map<string, number>()
  const push = (node: Node) => {
    const f = node.g + blocked(node.state)
    ;(buckets[f] ??= []).push(node)
  }
  best.set(keyOf(start), 0)
  push({ state: start, g: 0, parent: null, action: null })
  for (let f = 0; f < buckets.length; f++) {
    const bucket = buckets[f]
    while (bucket && bucket.length > 0) {
      const node = bucket.pop()!
      if (best.get(keyOf(node.state))! < node.g) continue
      if (node.state.status === 'complete') return { minRehandles: node.g, actions: pathOf(node) }
      for (const action of candidates(node.state)) {
        const state = applyAction(node.state, action).state
        const g = node.g + (action.type === 'rehandle' ? 1 : 0)
        const key = keyOf(state)
        const seen = best.get(key)
        if (seen !== undefined && seen <= g) continue
        best.set(key, g)
        push({ state, g, parent: node, action })
      }
    }
  }
  return null
}
