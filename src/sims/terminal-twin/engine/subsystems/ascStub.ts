/**
 * ASC stub (TT-05, until TT-06 adds the real ASC).
 *
 * Mode `instant`: the block's ASC clears a WTP pad the moment a box is
 * dropped, raising the same events the real ASC will:
 *   ShcDroppedAtWtp → AscPicked (custody WTP pad → ASC) → AscStacked (custody ASC → yard slot)
 * all at the drop time. Yard slots are numbered `<blockId>:I<n>` (no stack
 * geometry yet). Mode `off`: boxes stay on the pads (pads fill up).
 */
import type { ReactorMap } from '../context'
import { ascStubId } from '../state'
import { maybeDispatch } from './shc'

export const ascStubReactors: ReactorMap = {
  ShcDroppedAtWtp: (e, ctx) => {
    if (ctx.state.subsystems.asc !== 'instant') return
    const pad = ctx.state.wtpPads[e.payload.wtpPadId]
    const ascId = ascStubId(pad.blockId)
    ctx.schedule('AscPicked', e.t, { equipment: [ascId], containers: [e.payload.containerId] }, {
      ascId,
      blockId: pad.blockId,
      containerId: e.payload.containerId,
      wtpPadId: pad.id,
    })
  },

  AscPicked: (e, ctx) => {
    const { state } = ctx
    const asc = state.ascs[e.payload.ascId]
    const pad = state.wtpPads[e.payload.wtpPadId]
    if (pad.containerId === e.payload.containerId) pad.containerId = null
    asc.carrying = e.payload.containerId
    ctx.transferCustody(e.payload.containerId, { kind: 'asc', id: asc.id })
    asc.stacked++
    ctx.schedule('AscStacked', e.t, { equipment: [asc.id], containers: [e.payload.containerId] }, {
      ascId: asc.id,
      blockId: asc.blockId,
      containerId: e.payload.containerId,
      yardSlotId: `${asc.blockId}:I${asc.stacked}`,
    })
    maybeDispatch(ctx) // a pad is free again
  },

  AscStacked: (e, ctx) => {
    const { state } = ctx
    const asc = state.ascs[e.payload.ascId]
    state.yardSlots[e.payload.yardSlotId] = { id: e.payload.yardSlotId, blockId: asc.blockId, containerId: e.payload.containerId }
    asc.carrying = null
    ctx.transferCustody(e.payload.containerId, { kind: 'yardSlot', id: e.payload.yardSlotId })
  },
}
