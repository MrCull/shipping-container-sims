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

/** UI-only state the engine never sees. #387 adds drag. */
export interface UiState {
  /** Stack index whose top container is selected, `'receipt'` when the waiting receipt truck is selected, or null. */
  selection: number | 'receipt' | null
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
}

/** The incoming status band and the receipt bay status. The band always takes its space, truck or not. */
export interface IncomingView {
  /** `none`: no truck waits; `optional`: orange signal; `mandatory`: deadline 0, red signal. */
  status: 'none' | 'optional' | 'mandatory'
  /** Band text ("↑ RECEIPT #8 · 3 MOVES LEFT"), empty when no truck waits. */
  text: string
  /** Receipt bay status ("NO TRUCK", "3 MOVES LEFT", "MANDATORY NOW"). */
  bay: string
}

/** The container waiting on the receipt truck. */
export interface ReceiptCargoView {
  id: number
  label: string
  selected: boolean
}

export interface ViewModel {
  layout: Layout
  capacity: number
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
  hitRegions: HitRegion[]
  hud: { title: string; loaded: string; rehandles: string }
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
