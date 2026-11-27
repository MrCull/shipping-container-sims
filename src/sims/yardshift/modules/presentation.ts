/**
 * Yardshift presentation seam (pure TS). `present` turns engine state plus UI state into a view-model the renderers
 * draw; `input` turns a UI event into the next UI state and at most one engine action. Hit regions come from the
 * layout alone (never from animated positions), so a tap target never moves.
 */
import { exposedNextStack, rejectionFor } from './engine'
import type { ShiftAction, ShiftState } from '../types/engine'
import type {
  ClocksView,
  ContainerView,
  HitRegion,
  HitTarget,
  Layout,
  QueueItem,
  Rect,
  UiEvent,
  UiState,
  ViewModel,
  Viewport,
} from '../types/presentation'

/** Colours of the next six collection positions: mint, blue, purple, yellow, pink, lime (V20). */
export const SEQUENCE_COLOURS = ['#54ddb0', '#58b3ef', '#b19af5', '#f7ce53', '#ee8bb7', '#a5d36e'] as const
/** Containers farther than six positions away. */
export const GREY = '#84949c'
/** Queue slot past the last container. */
export const EMPTY_SLOT = '#526773'

/** Colour slot of container `id`: its position after the next required one, 0..5, or null (grey). */
export function colourSlot(state: ShiftState, id: number): number | null {
  const pos = id - state.next
  return pos >= 0 && pos < SEQUENCE_COLOURS.length ? pos : null
}

function colourOf(state: ShiftState, id: number): string {
  const slot = colourSlot(state, id)
  return slot === null ? GREY : SEQUENCE_COLOURS[slot]!
}

/** A bonus container still worth its bonus: a later one, or the current one while its window is open. */
export function showsBonus(state: ShiftState, id: number): boolean {
  if (!state.level.bonusIds.includes(id)) return false
  return id !== state.next || state.bonusMs > 0
}

function queueFor(state: ShiftState): QueueItem[] {
  return SEQUENCE_COLOURS.map((_, i): QueueItem => {
    const id = state.next + i
    if (id > state.level.count) return { id: null, label: '–', colour: EMPTY_SLOT, bonus: false }
    return { id, label: String(id), colour: colourOf(state, id), bonus: showsBonus(state, id) }
  })
}

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
  if (state.failure) return state.failure.message
  if (ui.selection !== null) return `Choose a destination for #${topOf(state, ui.selection)}`
  if (exposedNextStack(state) >= 0) return `Tap #${state.next} to load the truck.`
  return `Uncover #${state.next}: tap a top container, then a stack.`
}

/** Truck clock reads low below this share of its allowance (V20). */
const TRUCK_LOW = 0.35
/** Shift clock reads red below this many ms (V20). */
const SHIFT_LOW_MS = 9_000

function minSec(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Both clocks for the HUD. The next-truck bar is value over max(allowance, value), so it never overflows. */
export function clocksView(state: ShiftState): ClocksView {
  const { overtime } = state
  const truckMs = Math.max(0, state.truckMs)
  const shiftTotal = state.level.shiftSeconds * 1000
  return {
    overtime,
    shift: {
      label: 'SHIFT LEFT',
      text: minSec(state.shiftMs),
      fraction: shiftTotal > 0 ? Math.min(1, Math.max(0, state.shiftMs / shiftTotal)) : 0,
      red: overtime || state.shiftMs < SHIFT_LOW_MS,
      shake: overtime,
    },
    truck: {
      label: overtime ? `OVERTIME ×${state.level.overtimeMultiplier}` : 'NEXT TRUCK',
      text: `${(truckMs / 1000).toFixed(1)}s`,
      fraction: truckMs / Math.max(state.truckAllowanceMs, truckMs, 1),
      red: overtime || truckMs < state.truckAllowanceMs * TRUCK_LOW,
      shake: overtime,
    },
  }
}

/** Crane move length in ms for a horizontal travel of `dxPx` CSS pixels: 330 + |dx| x 0.38 (V20, about 330 to 460). */
export function craneDurationMs(dxPx: number): number {
  return 330 + Math.abs(dxPx) * 0.38
}

/** Screen x (CSS px) of where a move starts and ends: a stack column centre or the collection bay centre. */
export function moveSpan(layout: Layout, action: ShiftAction, state: ShiftState): { fromX: number; toX: number } | null {
  const centre = (r: Rect | undefined) => (r ? r.x + r.w / 2 : 0)
  if (action.type === 'collect') {
    const from = action.from ?? exposedNextStack(state)
    return { fromX: centre(layout.columns[from]), toX: centre(layout.collection) }
  }
  if (action.type === 'rehandle') return { fromX: centre(layout.columns[action.from]), toX: centre(layout.columns[action.to]) }
  return null
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
        slot: colourSlot(state, id),
        colour: colourOf(state, id),
        bonus: showsBonus(state, id),
        border: ui.selection === si && tier === stack.length - 1,
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
      score: String(state.score),
      combo: `×${state.combo}`,
    },
    queue: queueFor(state),
    bonus: state.bonusMs > 0 ? { id: state.next, text: `${(state.bonusMs / 1000).toFixed(1)}s` } : null,
    clocks: clocksView(state),
    hint: hintFor(state, ui),
    complete: state.status === 'complete',
    failed: state.failure?.message ?? null,
    busy: state.pauses.includes('animation'),
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
  // A tap while the crane animates is dropped, not queued: it can never turn into a second move.
  if (state.pauses.includes('animation')) return { ui }
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
