/** Yardshift presentation types: the view-model `present` returns and the UI events `input` reads. Pure data. */

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

/** UI-only state the engine never sees. #384 adds a receipt selection; #387 adds drag. */
export interface UiState {
  /** Stack index whose top container is selected, or null. */
  selection: number | null
}

export type UiEvent = { type: 'tap'; target: HitTarget | null }

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
  /** The next container to collect. */
  next: boolean
  /** Sequence colour slot 0..5 (position after the next required container), or null for grey. */
  slot: number | null
  /** Body colour (hex): the slot's sequence colour, or grey. */
  colour: string
  /** Gold star medallion: a bonus container still worth its bonus (also when buried or grey). */
  bonus: boolean
  /** Outlined: only the selection. The current container never has a border. */
  border: boolean
}

/** One of the six HUD queue positions; `id` null is an empty slot past the last container. */
export interface QueueItem {
  id: number | null
  label: string
  colour: string
  bonus: boolean
}

export interface ViewModel {
  layout: Layout
  capacity: number
  containers: ContainerView[]
  /** Stacks a selected container may move to. */
  destinations: number[]
  hitRegions: HitRegion[]
  hud: { title: string; loaded: string; rehandles: string; score: string; combo: string }
  /** The next six collection positions. */
  queue: QueueItem[]
  /** The open bonus window, or null. */
  bonus: { id: number; text: string } | null
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
