/**
 * Yardshift presentation seam (pure TS). `present` turns engine state plus UI state into a view-model the renderers
 * draw; `input` turns a UI event into the next UI state and at most one engine action. Hit regions come from the
 * layout alone (never from animated positions), so a tap target never moves.
 */
import { BONUS_POINTS, exposedNextStack, rejectionFor, waitingArrival } from './engine'
import { yardFit } from './yardGeometry'
import type { ShiftAction, ShiftState } from '../types/engine'
import type {
  ClocksView,
  ContainerView,
  HitRegion,
  HitTarget,
  IncomingView,
  Layout,
  QueueItem,
  Rect,
  UiAction,
  UiEvent,
  UiState,
  ViewModel,
  Viewport,
} from '../types/presentation'

/**
 * The five sequence colours in rainbow order, so the sequence reads like a spectrum (owner round
 * 5): red, orange, green, blue, purple. Yellow stays out, so gold is only ever the active bonus; urgency is a white
 * outline flashing red and the receipt cargo is steel, so neither reads as a sequence colour. Each keeps the dark
 * number at 4.5:1 or more.
 */
export const SEQUENCE_COLOURS = ['#ef5b52', '#f59a3a', '#4cc265', '#4b9cf0', '#a985ee'] as const
/** Containers farther than five positions away. */
export const GREY = '#84949c'
/** Queue slot past the last container. */
export const EMPTY_SLOT = '#526773'

/**
 * Colour slot of container `id` (owner round 6): fixed by its sequence number, `(id - 1) mod 5`, while it is inside the
 * next-five window; null (grey) beyond it. A container never changes colour once it has one: it enters the window
 * taking the colour the container just collected freed, and the "next" marker, not colour, shows which is next.
 */
export function colourSlot(state: ShiftState, id: number): number | null {
  const pos = id - state.next
  return pos >= 0 && pos < SEQUENCE_COLOURS.length ? (id - 1) % SEQUENCE_COLOURS.length : null
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

/** The active bonus (art pass 3): the next container, a bonus, with its window open. The only gold one. */
export function bonusActive(state: ShiftState, id: number): boolean {
  return id === state.next && state.bonusMs > 0 && state.level.bonusIds.includes(id)
}

function queueFor(state: ShiftState): QueueItem[] {
  return SEQUENCE_COLOURS.map((_, i): QueueItem => {
    const id = state.next + i
    if (id > state.level.count) return { id: null, label: '–', colour: EMPTY_SLOT, bonus: false, active: false }
    return { id, label: String(id), colour: colourOf(state, id), bonus: showsBonus(state, id), active: bonusActive(state, id) }
  })
}

/** Where the "NEXT" chevron points: the next container's stack while it is in the yard and the shift plays on. */
function nextMarkerFor(state: ShiftState): ViewModel['nextMarker'] {
  if (state.status !== 'playing' || state.deadline === 0) return null
  const stack = state.stacks.findIndex((s) => s.includes(state.next))
  if (stack < 0) return null
  const s = state.stacks[stack]!
  return { stack, buried: s[s.length - 1] !== state.next }
}

const SIDE = 16
const BAY_GAP = 12

/** Share of the surface the truck bays take when the layout knows the capacity (art pass 3: 20 to 24 %). */
export const BAY_SHARE = 0.22
/** Most of the surface the bays grow to when a tall phone leaves height over (the rest goes to the road above). */
export const MAX_BAY_SHARE = 0.24

/** Room at the top of the surface for the gantry beam, which spans over the road strip (owner round 5). */
export const BEAM_ROOM_PX = 26
/** Gap between the road strip and the yard below it. */
const ROAD_GAP = 6

/**
 * Screen layout of the play surface (owner round 5: trucks above the yard): the gantry beam's room at the top, the
 * road strip under it (just the two truck bays side by side), then the yard band with one column per stack. With the
 * `capacity` (art pass 3), the bays take `BAY_SHARE` (up to `MAX_BAY_SHARE` when a tall phone leaves height over) and
 * the yard the rest: at least what full stacks plus crane headroom need (`yardFit`), spare height as concrete
 * headroom, never as bare road. Without it the bays take their usual share.
 */
export function layoutFor(stackCount: number, vp: Viewport, capacity?: number): Layout {
  const innerW = Math.max(0, vp.width - 2 * SIDE)
  const roadTop = Math.round(vp.height * 0.02) + BEAM_ROOM_PX
  const yardBottom = Math.max(roadTop, vp.height - 8)
  let bayH = Math.round(Math.min(vp.height * 0.25, Math.max(84, vp.height * 0.24)))
  const bayTop = roadTop
  if (capacity !== undefined && stackCount > 0) {
    const total = yardBottom - roadTop
    bayH = Math.round(Math.min(total * 0.26, Math.max(84, total * BAY_SHARE)))
    const fit = yardFit(innerW / stackCount, capacity, total - bayH - ROAD_GAP)
    // Height over on a tall phone goes to the bays first (their trucks scale up with them) up to `MAX_BAY_SHARE`,
    // then to the yard's concrete headroom. The canvas always fills the whole play surface: no dark gaps.
    bayH += Math.min(Math.max(0, Math.round(total * MAX_BAY_SHARE) - bayH), Math.max(0, total - bayH - ROAD_GAP - fit.h))
  }
  const bayBottom = Math.min(yardBottom, bayTop + bayH)
  const yardTop = Math.min(yardBottom, bayBottom + ROAD_GAP)
  const yard: Rect = { x: SIDE, y: yardTop, w: innerW, h: yardBottom - yardTop }
  // Whole-pixel column edges, so neighbouring columns share an edge exactly and never overlap by a rounding error.
  const edge = (i: number) => SIDE + Math.round((i * innerW) / Math.max(1, stackCount))
  const columns = Array.from({ length: stackCount }, (_, i) => ({ x: edge(i), y: yardTop, w: edge(i + 1) - edge(i), h: yard.h }))
  const bayW = Math.floor((innerW - BAY_GAP) / 2)
  return {
    yard,
    columns,
    road: { x: SIDE, y: roadTop, w: innerW, h: bayBottom - roadTop },
    collection: { x: SIDE, y: bayTop, w: bayW, h: bayBottom - bayTop },
    receipt: { x: SIDE + bayW + BAY_GAP, y: bayTop, w: bayW, h: bayBottom - bayTop },
  }
}

/** Bay label rows (title and status) at the top of a truck bay; the arrow goes under them. */
const BAY_LABEL_PX = 32
const ARROW_PX = 28

/**
 * The bobbing arrow's box: in the receipt bay under its label, beside the cab at the bay's right end, so it never
 * covers the cargo's number (playtest fix 3).
 */
export function arrowBox(bay: Rect): Rect {
  const h = Math.min(ARROW_PX, Math.max(0, bay.h - BAY_LABEL_PX) / 2)
  return { x: bay.x + bay.w - ARROW_PX - 6, y: bay.y + Math.min(BAY_LABEL_PX, bay.h / 3), w: ARROW_PX, h }
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

/** Stacks the waiting truck's cargo may be received onto. */
export function receiptDestinations(state: ShiftState): number[] {
  return state.stacks.map((_, to) => to).filter((to) => rejectionFor(state, { type: 'receive', to }) === null)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'S'}`

/** The incoming band and receipt bay status: orange optional signal, red mandatory signal at deadline 0. */
export function incomingView(state: ShiftState): IncomingView {
  const id = waitingArrival(state)
  if (id === undefined || state.deadline === null || state.status !== 'playing') {
    const text = state.status === 'playing' && state.next <= state.level.count ? `COLLECT #${state.next} · READY` : ''
    return { status: 'none', text, bay: 'NO TRUCK' }
  }
  if (state.deadline === 0) return { status: 'mandatory', text: `↓ RECEIPT #${id} · MANDATORY`, bay: 'MANDATORY NOW' }
  const left = `${plural(state.deadline, 'MOVE')} LEFT`
  return { status: 'optional', text: `↓ RECEIPT #${id} · ${left}`, bay: left }
}

/** The selected container's id (a stack top, or the receipt truck's cargo), or undefined. */
function selectedId(state: ShiftState, ui: UiState): number | undefined {
  if (ui.selection === 'receipt') return waitingArrival(state)
  return ui.selection === null ? undefined : topOf(state, ui.selection)
}

/** Live heavy coaching (levels with `heavyHints`: 11 and 12) when heavy cargo is selected, else null. */
function heavyHint(state: ShiftState, ui: UiState): string | null {
  if (!state.level.heavyHints) return null
  const id = selectedId(state, ui)
  if (id === undefined || !state.level.heavy.includes(id)) return null
  const legal = ui.selection === 'receipt' ? receiptDestinations(state) : legalDestinations(state, ui.selection as number)
  return legal.length > 0
    ? `Heavy #${id} · Choose a highlighted stack: heavy on heavy or empty.`
    : `Heavy #${id} · No valid stack. Make space first.`
}

/** Live tutorial coaching (levels with `tutorialCoaching`): collect #1, move the blocker aside, then collect in order. */
function tutorialHint(state: ShiftState, ui: UiState): string | null {
  if (!state.level.tutorialCoaching) return null
  if (ui.selection !== null) return null
  if (state.collected === 0) return `Tap container #${state.next} to load the first truck.`
  if (state.bonusMs > 0) return `Gold bonus! Load #${state.next} fast for +${BONUS_POINTS}`
  if (exposedNextStack(state) >= 0) return `Tap #${state.next} to load the next truck.`
  const holder = state.stacks.find((s) => s.includes(state.next))
  const blocker = holder?.[holder.length - 1]
  return blocker === undefined ? null : `Move #${blocker} to an empty stack to uncover #${state.next}.`
}

function hintFor(state: ShiftState, ui: UiState): string {
  if (state.status === 'complete') return 'Yard cleared!'
  if (state.failure) return state.failure.message
  const coached = heavyHint(state, ui) ?? tutorialHint(state, ui)
  if (coached) return coached
  if (ui.selection === 'receipt') return `Choose a highlighted stack for #${waitingArrival(state)}.`
  if (ui.selection !== null) return `Choose a destination for #${topOf(state, ui.selection)}`
  if (state.deadline === 0) return 'Deadline reached. Tap the receipt truck, then a stack.'
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

/** Shift time below which every container shakes, growing to full over `SHIFT_SHAKE_RAMP_MS` (V20: last 9 s). */
export const SHIFT_SHAKE_MS = 9_000
const SHIFT_SHAKE_RAMP_MS = 6_000
/** Resting shake of the current container from the start of its turn (V20). */
export const FOCUS_BASE_RISK = 0.08
/** Under reduced motion, risk at or above this shows the static urgency treatment. */
export const URGENT_RISK = 0.5

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Shake risk 0..1 (V20): every container takes the shift-end risk (0 above 9 s, 1 at 3 s and below); the current
 * container also takes the focus risk, 0.08 from the start of its turn rising to 1 as the next-truck clock falls
 * from 35% of its allowance to 0. The renderer turns risk into amplitude (0.65 + 3.35 x risk px) and frequency.
 */
export function urgencyRisk(state: ShiftState, current: boolean): number {
  if (state.status !== 'playing') return 0
  const shiftRisk = state.shiftMs < SHIFT_SHAKE_MS ? clamp01((SHIFT_SHAKE_MS - state.shiftMs) / SHIFT_SHAKE_RAMP_MS) : 0
  if (!current) return shiftRisk
  const low = Math.max(1, state.truckAllowanceMs * TRUCK_LOW)
  const focusRisk = FOCUS_BASE_RISK + (1 - FOCUS_BASE_RISK) * (1 - clamp01(Math.max(0, state.truckMs) / low))
  return Math.max(shiftRisk, focusRisk)
}

/** Shake and static flag for one container: shake under normal motion, the `urgent` flag under reduced motion. */
function urgencyFor(state: ShiftState, ui: UiState, current: boolean): { shake: number; urgent: boolean } {
  const risk = urgencyRisk(state, current)
  return ui.reducedMotion ? { shake: 0, urgent: risk >= URGENT_RISK } : { shake: risk, urgent: false }
}

/** The longest crane move (story 20: about 330 to 460 ms), so a wide desktop yard never drags. */
export const CRANE_MAX_MS = 460

/** Crane move length in ms for a horizontal travel of `dxPx` CSS pixels: 330 + |dx| x 0.38 (V20), at most 460. */
export function craneDurationMs(dxPx: number): number {
  return Math.min(CRANE_MAX_MS, 330 + Math.abs(dxPx) * 0.38)
}

/** Screen x (CSS px) of where a move starts and ends: a stack column centre or the collection bay centre. */
export function moveSpan(layout: Layout, action: ShiftAction, state: ShiftState): { fromX: number; toX: number } | null {
  const centre = (r: Rect | undefined) => (r ? r.x + r.w / 2 : 0)
  if (action.type === 'collect') {
    const from = action.from ?? exposedNextStack(state)
    return { fromX: centre(layout.columns[from]), toX: centre(layout.collection) }
  }
  if (action.type === 'rehandle') return { fromX: centre(layout.columns[action.from]), toX: centre(layout.columns[action.to]) }
  if (action.type === 'receive') return { fromX: centre(layout.receipt), toX: centre(layout.columns[action.to]) }
  return null
}

export function present(state: ShiftState, ui: UiState, viewport: Viewport): ViewModel {
  const layout = layoutFor(state.stacks.length, viewport, state.level.capacity)
  const receiptSelected = ui.selection === 'receipt'
  const cargo = waitingArrival(state)
  const attention = state.status === 'playing' && state.deadline === 0 && !receiptSelected
  const containers: ContainerView[] = []
  state.stacks.forEach((stack, si) =>
    stack.forEach((id, tier) =>
      containers.push({
        id,
        stack: si,
        tier,
        label: String(id),
        selected: ui.selection === si && tier === stack.length - 1,
        next: state.status === 'playing' && id === state.next,
        slot: colourSlot(state, id),
        colour: colourOf(state, id),
        bonus: showsBonus(state, id),
        bonusActive: bonusActive(state, id),
        heavy: state.level.heavy.includes(id),
        // Art pass 3: only the active bonus glints (render only); every other bonus keeps a static badge.
        glint: !ui.reducedMotion && bonusActive(state, id),
        border: ui.selection === si && tier === stack.length - 1,
        // At deadline 0 the receipt cargo is the current container, not the next one in the yard.
        ...urgencyFor(state, ui, id === state.next && state.deadline !== 0),
      }),
    ),
  )
  return {
    layout,
    capacity: state.level.capacity,
    stackLabels: state.stacks.map((_, i) => String(i + 1).padStart(2, '0')),
    containers,
    destinations:
      ui.selection === 'receipt'
        ? receiptDestinations(state)
        : ui.selection === null
          ? []
          : legalDestinations(state, ui.selection),
    receiptCargo:
      cargo === undefined
        ? null
        : {
            id: cargo,
            label: String(cargo),
            selected: receiptSelected,
            bonus: state.level.bonusIds.includes(cargo),
            heavy: state.level.heavy.includes(cargo),
            ...urgencyFor(state, ui, state.deadline === 0),
          },
    incoming: incomingView(state),
    dimYard: attention,
    arrow: attention ? 'receipt' : null,
    arrowAt: attention ? arrowBox(layout.receipt) : null,
    hitRegions: regionsFor(layout),
    hud: {
      title: `Shift ${state.level.number} · ${state.level.name}`,
      loaded: `${state.collected}/${state.level.count}`,
      rehandles: `${state.rehandles}/${state.level.maxRehandles}`,
      score: String(state.score),
      combo: `×${state.combo}`,
    },
    queue: queueFor(state),
    nextMarker: nextMarkerFor(state),
    bonus:
      state.bonusMs > 0
        ? {
            id: state.next,
            text: `${(state.bonusMs / 1000).toFixed(1)}s`,
            fraction: Math.min(1, state.bonusMs / Math.max(1, state.level.bonusWindowSeconds * 1000)),
          }
        : null,
    clocks: clocksView(state),
    hint: hintFor(state, ui),
    complete: state.status === 'complete',
    failed: state.failure?.message ?? null,
    busy: state.pauses.includes('animation'),
  }
}

export interface InputResult {
  ui: UiState
  action?: UiAction
}

/** Clear the selection and any drag; keep the UI preferences. */
function cleared(ui: UiState): UiState {
  return ui.reducedMotion === undefined ? { selection: null } : { selection: null, reducedMotion: ui.reducedMotion }
}

/** Key to target: 1 to 9 pick stacks, C the collection truck, R the receipt truck. */
function keyTarget(key: string, state: ShiftState): HitTarget | null | undefined {
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1
    return index < state.stacks.length ? { kind: 'stack', index } : undefined
  }
  const k = key.toLowerCase()
  if (k === 'c') return { kind: 'collection' }
  if (k === 'r') return { kind: 'receipt' }
  return undefined
}

/** A drag may start from the waiting receipt truck, or from a non-empty stack unless the receipt is mandatory. */
function dragSource(from: HitTarget, state: ShiftState): UiState['selection'] | undefined {
  if (from.kind === 'receipt') return waitingArrival(state) === undefined ? undefined : 'receipt'
  if (from.kind === 'stack') return state.deadline !== 0 && topOf(state, from.index) !== undefined ? from.index : undefined
  return undefined
}

/**
 * Resolve a UI event to the next UI state and at most one action. The engine still judges legality. Tap, drag and
 * key share one resolution: a key is a tap on its target; a drop is a tap on the target with the source selected.
 */
export function input(ui: UiState, event: UiEvent, state: ShiftState): InputResult {
  // Input while the crane animates is dropped, not queued: it can never turn into a second move.
  if (state.pauses.includes('animation')) return { ui }
  if (event.type === 'key') {
    const k = event.key.toLowerCase()
    if (k === 'escape' || k === 'esc') {
      if (ui.selection !== null || ui.drag) return { ui: cleared(ui) }
      if (state.status !== 'playing') return { ui }
      const paused = state.pauses.includes('player')
      return { ui, action: { type: paused ? 'resume' : 'pause', reason: 'player' } }
    }
    if (k === 'u') return state.status === 'playing' ? { ui: cleared(ui), action: { type: 'undo' } } : { ui }
    const target = keyTarget(event.key, state)
    return target === undefined ? { ui } : tap(ui, target, state)
  }
  if (event.type === 'drag-start') {
    const selection = state.status === 'playing' ? dragSource(event.from, state) : undefined
    if (selection === undefined) return { ui: cleared(ui) }
    return { ui: { ...ui, selection, drag: { from: event.from, over: null } } }
  }
  if (event.type === 'drag-move') {
    return ui.drag ? { ui: { ...ui, drag: { ...ui.drag, over: event.over } } } : { ui }
  }
  if (event.type === 'drag-end') {
    const { target } = event
    if (!ui.drag || target === null || sameTarget(ui.drag.from, target) || target.kind === 'receipt') {
      return { ui: cleared(ui) }
    }
    return tap({ ...cleared(ui), selection: ui.selection }, target, state)
  }
  return tap(ui, event.target, state)
}

function sameTarget(a: HitTarget, b: HitTarget): boolean {
  return a.kind === b.kind && (a.kind !== 'stack' || (b.kind === 'stack' && a.index === b.index))
}

function tap(ui: UiState, target: HitTarget | null, state: ShiftState): InputResult {
  const clear = cleared(ui)
  if (state.status !== 'playing' || target === null) return { ui: clear }
  if (target.kind === 'receipt') {
    if (ui.selection === 'receipt' || waitingArrival(state) === undefined) return { ui: clear }
    return { ui: { ...clear, selection: 'receipt' } }
  }
  if (target.kind === 'collection') {
    if (ui.selection === 'receipt') return { ui: clear }
    return { ui: clear, action: ui.selection === null ? { type: 'collect' } : { type: 'collect', from: ui.selection } }
  }
  const j = target.index
  if (ui.selection === 'receipt') return { ui: clear, action: { type: 'receive', to: j } }
  if (ui.selection === j) return { ui: clear }
  if (ui.selection !== null) return { ui: clear, action: { type: 'rehandle', from: ui.selection, to: j } }
  // At deadline 0 only the receipt is legal: a stack tap selects nothing and sends a move for the engine to reject
  // ("Receive truck #n first."), so the message and the invalid cue fire (story 17).
  if (state.deadline === 0) return { ui: clear, action: { type: 'collect', from: j } }
  const top = topOf(state, j)
  if (top === undefined) return { ui }
  if (top === state.next) return { ui, action: { type: 'collect', from: j } }
  return { ui: { ...clear, selection: j } }
}
