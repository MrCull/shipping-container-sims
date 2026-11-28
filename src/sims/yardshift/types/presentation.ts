/** Yardshift presentation types: the view-model `present` returns and the UI events `input` reads. Pure data. */
import type { ShiftAction } from './engine'

export interface Viewport {
  /** CSS pixels of the play surface (the canvas). */
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** What a pointer can land on. The two truck bays are distinct targets and never resolve to each other. */
export type HitTarget = { kind: 'stack'; index: number } | { kind: 'collection' } | { kind: 'receipt' }

export type HitRegion = HitTarget & { rect: Rect }

/** UI-only state the engine never sees. */
export interface UiState {
  /** Stack index whose top container is selected, `'receipt'` when the waiting receipt truck is selected, or null. */
  selection: number | 'receipt' | null
  /** A drag in progress: its source (also the selection) and the target under the pointer. */
  drag?: { from: HitTarget; over: HitTarget | null } | null
  /** Prefers reduced motion: `present` swaps shake for the static `urgent` flag. */
  reducedMotion?: boolean
}

/**
 * Raw input for `input`. Tap, drag and key all resolve to the same engine actions for the same intent. A drag starts
 * after the host sees the pointer move past its threshold; a pointer that never moves that far is a tap.
 */
export type UiEvent =
  | { type: 'tap'; target: HitTarget | null }
  | { type: 'drag-start'; from: HitTarget }
  | { type: 'drag-move'; over: HitTarget | null }
  | { type: 'drag-end'; target: HitTarget | null }
  /** `KeyboardEvent.key`: 1 to 9 (stack), C (collection truck), R (receipt truck), U (undo), Escape. */
  | { type: 'key'; key: string }

/** What `input` can ask of the engine: an engine action (undo included, #386). */
export type UiAction = ShiftAction

export interface Layout {
  yard: Rect
  /** One column per stack, left to right. */
  columns: Rect[]
  collection: Rect
  receipt: Rect
}

export interface ContainerView {
  id: number
  stack: number
  /** 0 = bottom. */
  tier: number
  label: string
  selected: boolean
  /** The next container to collect, from the start of its turn (#1 at the shift start); false once the shift is over. */
  next: boolean
  /** Sequence colour slot 0..5 (position after the next required container), or null for grey. */
  slot: number | null
  /** Body colour (hex): the slot's sequence colour, or grey. */
  colour: string
  /** Static star badge: a bonus container still worth its bonus (also when buried or grey). */
  bonus: boolean
  /**
   * The active bonus (art pass 3): this is the next container and its bonus window is open. Only then is it gold, with
   * shine, sparkles, a bouncing badge and the countdown ring; any other bonus keeps its sequence colour.
   */
  bonusActive: boolean
  /** Heavy cargo (`level.heavy`): an "H" badge on the faces, also when buried or grey. */
  heavy: boolean
  /** The active bonus glints (shine sweep, sparkles, bouncing badge; render only); false under reduced motion. */
  glint: boolean
  /** Outlined: only the selection. The current container never has a border. */
  border: boolean
  /** Shake risk 0..1 (amplitude and frequency grow with it); always 0 under reduced motion. */
  shake: number
  /** Static urgency treatment under reduced motion (risk at or above `URGENT_RISK`); always false otherwise. */
  urgent: boolean
}

/** One of the six HUD queue positions; `id` null is an empty slot past the last container. */
export interface QueueItem {
  id: number | null
  label: string
  colour: string
  /** A small static star: a bonus container still worth its bonus. */
  bonus: boolean
  /** The active bonus (next, window open): the only gold chip. */
  active: boolean
}

/** The incoming status band and the receipt bay status. The band always takes its space, truck or not. */
export interface IncomingView {
  /** `none`: no truck waits; `optional`: orange signal; `mandatory`: deadline 0, red signal. */
  status: 'none' | 'optional' | 'mandatory'
  /** Band text ("↑ RECEIPT #8 · 3 MOVES LEFT"), or "COLLECT #n · READY" when no truck waits (empty once over). */
  text: string
  /** Receipt bay status ("NO TRUCK", "3 MOVES LEFT", "MANDATORY NOW"). */
  bay: string
}

/** The container waiting on the receipt truck. */
export interface ReceiptCargoView {
  id: number
  label: string
  selected: boolean
  /** A bonus container (gold star medallion). */
  bonus: boolean
  /** Heavy cargo: an "H" badge. */
  heavy: boolean
  /** As `ContainerView.shake` and `urgent`: the cargo is the current container at deadline 0. */
  shake: number
  urgent: boolean
}

export interface ViewModel {
  layout: Layout
  capacity: number
  /** Stack numbers under each column: "01", "02", ... */
  stackLabels: string[]
  containers: ContainerView[]
  /** Stacks the selected container (or the selected receipt truck's cargo) may move to. */
  destinations: number[]
  /** The waiting receipt truck's cargo, or null when no truck waits. */
  receiptCargo: ReceiptCargoView | null
  incoming: IncomingView
  /** Dim the yard: only at deadline 0 with the receipt truck not selected. */
  dimYard: boolean
  /** Where the bobbing red arrow points: the receipt truck at deadline 0 (until it is selected), else null. */
  arrow: 'receipt' | null
  /** The arrow's box (surface px) inside the receipt bay, under the bay label and over the truck; null with no arrow. */
  arrowAt: Rect | null
  hitRegions: HitRegion[]
  hud: { title: string; loaded: string; rehandles: string; score: string; combo: string }
  /** The next six collection positions. */
  queue: QueueItem[]
  /**
   * The bouncing "NEXT" chevron over the next container's stack (`buried`: other boxes sit on it, so the chevron
   * points at the stack top to dig), or null when the shift is over, the next container is not in the yard, or a
   * receipt is mandatory (the red arrow has the focus then).
   */
  nextMarker: { stack: number; buried: boolean } | null
  /** The open bonus window, or null. */
  bonus: { id: number; text: string; fraction: number } | null
  clocks: ClocksView
  hint: string
  complete: boolean
  /** The failure message once the shift has failed, else null. */
  failed: string | null
  /** A crane move is animating: input is ignored until it ends. */
  busy: boolean
}

export interface ClockView {
  label: string
  /** Display text, never negative ("2:05", "4.2s"). */
  text: string
  /** Bar fill, 0..1. */
  fraction: number
  /** Drawn red. */
  red: boolean
  /** Shaking (overtime). */
  shake: boolean
}

export interface ClocksView {
  shift: ClockView
  truck: ClockView
  overtime: boolean
}
