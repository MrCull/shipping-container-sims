/**
 * Yardshift presentation seam (pure TS). `present` turns engine state plus UI state into a view-model the renderers
 * draw; `input` turns a UI event into the next UI state and at most one engine action. Hit regions come from the
 * layout alone (never from animated positions), so a tap target never moves.
 */
import { exposedNextStack, rejectionFor } from './engine'
import type { ShiftAction, ShiftState } from '../types/engine'
import type {
  ContainerView,
  HitRegion,
  HitTarget,
  Layout,
  Rect,
  UiEvent,
  UiState,
  ViewModel,
  Viewport,
} from '../types/presentation'

const SIDE = 16
const BAY_GAP = 12

/** Screen layout of the play surface: the yard band with one column per stack, and the two truck bays below. */
export function layoutFor(stackCount: number, vp: Viewport): Layout {
  const innerW = Math.max(0, vp.width - 2 * SIDE)
  const yardTop = Math.round(vp.height * 0.06)
  const yardBottom = Math.round(vp.height * 0.68)
  const bayTop = Math.round(vp.height * 0.72)
  const bayBottom = Math.max(bayTop, vp.height - 12)
  const yard: Rect = { x: SIDE, y: yardTop, w: innerW, h: yardBottom - yardTop }
  const colW = stackCount > 0 ? innerW / stackCount : innerW
  const columns = Array.from({ length: stackCount }, (_, i) => ({ x: SIDE + i * colW, y: yardTop, w: colW, h: yard.h }))
  const bayW = (innerW - BAY_GAP) / 2
  return {
    yard,
    columns,
    collection: { x: SIDE, y: bayTop, w: bayW, h: bayBottom - bayTop },
    receipt: { x: SIDE + bayW + BAY_GAP, y: bayTop, w: bayW, h: bayBottom - bayTop },
  }
}

function regionsFor(layout: Layout): HitRegion[] {
  return [
    ...layout.columns.map((rect, index): HitRegion => ({ kind: 'stack', index, rect })),
    { kind: 'collection', rect: layout.collection },
    { kind: 'receipt', rect: layout.receipt },
  ]
}

/** The target under a point, or null. Regions do not overlap, so at most one matches. */
export function hitTest(regions: readonly HitRegion[], x: number, y: number): HitTarget | null {
  for (const r of regions) {
    const { rect } = r
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) {
      return r.kind === 'stack' ? { kind: 'stack', index: r.index } : { kind: r.kind }
    }
  }
  return null
}

function topOf(state: ShiftState, i: number): number | undefined {
  const s = state.stacks[i]
  return s && s.length > 0 ? s[s.length - 1] : undefined
}

export function legalDestinations(state: ShiftState, from: number): number[] {
  return state.stacks
    .map((_, to) => to)
    .filter((to) => rejectionFor(state, { type: 'rehandle', from, to }) === null)
}

function hintFor(state: ShiftState, ui: UiState): string {
  if (state.status === 'complete') return 'Yard cleared!'
  if (ui.selection !== null) return `Choose a destination for #${topOf(state, ui.selection)}`
  if (exposedNextStack(state) >= 0) return `Tap #${state.next} to load the truck.`
  return `Uncover #${state.next}: tap a top container, then a stack.`
}

export function present(state: ShiftState, ui: UiState, viewport: Viewport): ViewModel {
  const layout = layoutFor(state.stacks.length, viewport)
  const containers: ContainerView[] = []
  state.stacks.forEach((stack, si) =>
    stack.forEach((id, tier) =>
      containers.push({
        id,
        stack: si,
        tier,
        label: String(id),
        selected: ui.selection === si && tier === stack.length - 1,
        next: id === state.next,
      }),
    ),
  )
  return {
    layout,
    capacity: state.level.capacity,
    containers,
    destinations: ui.selection === null ? [] : legalDestinations(state, ui.selection),
    hitRegions: regionsFor(layout),
    hud: {
      title: `Shift ${state.level.number} · ${state.level.name}`,
      loaded: `${state.collected}/${state.level.count}`,
      rehandles: `${state.rehandles}/${state.level.maxRehandles}`,
    },
    hint: hintFor(state, ui),
    complete: state.status === 'complete',
  }
}

export interface InputResult {
  ui: UiState
  action?: ShiftAction
}

const CLEAR: UiState = { selection: null }

/** Resolve a UI event to the next UI state and at most one engine action. The engine still judges legality. */
export function input(ui: UiState, event: UiEvent, state: ShiftState): InputResult {
  const { target } = event
  if (state.status !== 'playing' || target === null) return { ui: CLEAR }
  if (target.kind === 'receipt') return { ui }
  if (target.kind === 'collection') {
    return { ui: CLEAR, action: ui.selection === null ? { type: 'collect' } : { type: 'collect', from: ui.selection } }
  }
  const j = target.index
  if (ui.selection === j) return { ui: CLEAR }
  if (ui.selection !== null) return { ui: CLEAR, action: { type: 'rehandle', from: ui.selection, to: j } }
  const top = topOf(state, j)
  if (top === undefined) return { ui }
  if (top === state.next) return { ui, action: { type: 'collect', from: j } }
  return { ui: { selection: j } }
}
