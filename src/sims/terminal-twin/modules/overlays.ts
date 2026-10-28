/** 3D debug overlays (TT-18): the independent toggles shared by the store, the view and the toolbar. */
export interface OverlayState {
  /** Lane graph (one-way edges) drawn on the ground. */
  laneGraph: boolean
  /** Conflict zones reserved at the displayed time, highlighted. */
  reservations: boolean
  /** WTP pads and STS ground positions tinted free / occupied. */
  occupancy: boolean
  /** Equipment and vessel state labels floating above each one. */
  labels: boolean
  /** ASC rail segments reserved (or held by a parked ASC) at the displayed time, coloured by ASC (TT-08). */
  ascRail: boolean
}

export const OVERLAY_KEYS: readonly (keyof OverlayState)[] = ['laneGraph', 'reservations', 'occupancy', 'labels', 'ascRail']

export const NO_OVERLAYS: Readonly<OverlayState> = { laneGraph: false, reservations: false, occupancy: false, labels: false, ascRail: false }
