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
}

export interface ViewModel {
  layout: Layout
  capacity: number
  containers: ContainerView[]
  /** Stacks a selected container may move to. */
  destinations: number[]
  hitRegions: HitRegion[]
  hud: { title: string; loaded: string; rehandles: string }
  hint: string
  complete: boolean
}
