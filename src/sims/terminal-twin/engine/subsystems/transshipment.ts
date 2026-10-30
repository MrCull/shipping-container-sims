/**
 * Transshipment dwell (TT-11). A box discharged for an onward vessel is stacked
 * like any import; once stacked it dwells for its sampled time, then
 * `TransshipmentReady` lets load preparation fetch it for the onward vessel's
 * export-style load package (loadPrep.ts gates on `ContainerState.readyAt`).
 */
import type { ReactorMap } from '../context'
import { pumpLoadPrep } from './loadPrep'

export const transshipmentReactors: ReactorMap = {
  AscStacked: (e, ctx) => {
    const box = ctx.state.containers[e.payload.containerId]
    box.yardSince = e.t
    if (box.onwardVesselId === undefined) return
    ctx.schedule('TransshipmentReady', e.t + (box.dwellS ?? 0), { containers: [box.id], vessels: [box.onwardVesselId] }, {
      containerId: box.id,
      onwardVesselId: box.onwardVesselId,
      dwellS: box.dwellS ?? 0,
    })
  },

  TransshipmentReady: (e, ctx) => {
    ctx.state.containers[e.payload.containerId].readyAt = e.t
    pumpLoadPrep(ctx)
  },
}
