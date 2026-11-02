/** Spec #166 (profiler): per-box waits for discharge and load boxes, folded from the event log. */
import { describe, expect, it } from 'vitest'
import { boxWaits } from '../engine'
import type { EngineEvent } from '../engine'

const ev = (t: number, type: string, payload: Record<string, unknown>): EngineEvent =>
  ({ id: t, seq: t, t, type, causedBy: null, subjects: {}, payload }) as unknown as EngineEvent

describe('boxWaits', () => {
  it('splits a discharge box into its STS, horizontal and yard waits', () => {
    const log = [
      ev(0, 'StsPicked', { stsId: 'S1', containerId: 'D1' }),
      ev(100, 'StsWaitingForGroundPosition', { stsId: 'S1', containerId: 'D1' }),
      ev(130, 'StsGroundPositionWaitEnded', { stsId: 'S1', containerId: 'D1', waitedS: 30 }),
      ev(140, 'StsGrounded', { stsId: 'S1', containerId: 'D1' }),
      ev(200, 'ShcPicked', { shcId: 'H1', containerId: 'D1' }),
      ev(260, 'ShcDroppedAtWtp', { shcId: 'H1', containerId: 'D1' }),
      ev(300, 'AscPicked', { ascId: 'A1', containerId: 'D1' }),
      ev(330, 'AscStacked', { ascId: 'A1', containerId: 'D1' }),
    ]
    const r = boxWaits(log, 400)
    expect(r.paths.discharge).toEqual({
      boxes: 1,
      totalS: { yard: 40, horizontal: 60, sts: 30 },
      meanS: { yard: 40, horizontal: 60, sts: 30 },
    })
    expect(r.paths.load).toEqual({ boxes: 0, totalS: { yard: 0, horizontal: 0, sts: 0 }, meanS: { yard: 0, horizontal: 0, sts: 0 } })
    expect(r.top.map((w) => [w.containerId, w.path, w.stage, w.startS, w.seconds, w.open])).toEqual([
      ['D1', 'discharge', 'horizontal', 140, 60, false],
      ['D1', 'discharge', 'yard', 260, 40, false],
      ['D1', 'discharge', 'sts', 100, 30, false],
    ])
  })

  it('splits a load box into its yard, horizontal and STS waits, the yard wait starting at the ASC job', () => {
    const log = [
      ev(5, 'StsLoadStarted', { stsId: 'S1', containerId: 'L1' }),
      ev(10, 'AscJobAssigned', { ascId: 'A1', containerId: 'L1', jobId: 'J1', departAt: 10 }),
      ev(50, 'AscRoutingToStack', { ascId: 'A1', containerId: 'L1', jobId: 'J1' }),
      ev(90, 'AscRetrieved', { ascId: 'A1', containerId: 'L1', jobId: 'J1' }),
      ev(120, 'AscDroppedAtWtp', { ascId: 'A1', containerId: 'L1', jobId: 'J1' }),
      ev(150, 'ShcPickedAtWtp', { shcId: 'H1', containerId: 'L1' }),
      ev(200, 'ShcDroppedAtGround', { shcId: 'H1', containerId: 'L1' }),
      ev(260, 'StsLoadPicked', { stsId: 'S1', containerId: 'L1' }),
    ]
    const r = boxWaits(log, 300)
    expect(r.paths.load).toEqual({
      boxes: 1,
      totalS: { yard: 80, horizontal: 30, sts: 60 },
      meanS: { yard: 80, horizontal: 30, sts: 60 },
    })
    expect(r.paths.discharge.boxes).toBe(0)
    expect(r.top.map((w) => [w.stage, w.startS, w.seconds])).toEqual([
      ['yard', 10, 80],
      ['sts', 200, 60],
      ['horizontal', 120, 30],
    ])
  })

  it('does not count a discharge job as a load retrieval, and skips rehandle and truck jobs', () => {
    const log = [
      ev(0, 'StsPicked', { stsId: 'S1', containerId: 'D2' }),
      ev(5, 'ShcDroppedAtWtp', { shcId: 'H1', containerId: 'D2' }),
      ev(10, 'AscJobAssigned', { ascId: 'A1', containerId: 'D2', jobId: 'J2', departAt: 10 }),
      ev(20, 'AscRoutingToPad', { ascId: 'A1', containerId: 'D2', jobId: 'J2' }),
      ev(40, 'AscPicked', { ascId: 'A1', containerId: 'D2', jobId: 'J2', wtpPadId: 'P1' }),
      ev(10, 'AscJobAssigned', { ascId: 'A2', containerId: 'B1', jobId: 'R1', rehandle: true, departAt: 10 }),
      ev(20, 'AscRoutingToStack', { ascId: 'A2', containerId: 'B1', jobId: 'R1' }),
      ev(30, 'AscRetrieved', { ascId: 'A2', containerId: 'B1', jobId: 'R1', rehandle: true }),
      ev(10, 'AscJobAssigned', { ascId: 'A3', containerId: 'X1', jobId: 'T1', stallId: 'ST1', truckId: 'TR1', departAt: 10 }),
      ev(20, 'AscRoutingToStack', { ascId: 'A3', containerId: 'X1', jobId: 'T1' }),
      ev(30, 'AscRetrieved', { ascId: 'A3', containerId: 'X1', jobId: 'T1' }),
    ]
    const r = boxWaits(log, 100)
    expect(r.top).toEqual([
      expect.objectContaining({ containerId: 'D2', path: 'discharge', stage: 'yard', startS: 5, seconds: 35, open: false }),
    ])
    expect(r.paths.load.boxes).toBe(0)
  })

  it('cuts a wait still open at endS there and marks it open; events after endS are ignored', () => {
    const log = [
      ev(0, 'StsPicked', { stsId: 'S1', containerId: 'D3' }),
      ev(500, 'ShcDroppedAtWtp', { shcId: 'H1', containerId: 'D3' }),
      ev(700, 'AscPicked', { ascId: 'A1', containerId: 'D3', jobId: 'J3', wtpPadId: 'P1' }),
    ]
    const r = boxWaits(log, 600)
    expect(r.top).toEqual([expect.objectContaining({ containerId: 'D3', stage: 'yard', startS: 500, endS: 600, seconds: 100, open: true })])
    expect(r.paths.discharge.totalS.yard).toBe(100)
  })

  it('counts a box that never waited, and ranks the top waits longest first', () => {
    const log = [
      ev(0, 'StsPicked', { stsId: 'S1', containerId: 'D4' }),
      ev(10, 'StsGrounded', { stsId: 'S1', containerId: 'D4' }),
      ev(20, 'ShcPicked', { shcId: 'H1', containerId: 'D4' }),
      ev(30, 'ShcDroppedAtWtp', { shcId: 'H1', containerId: 'D4' }),
      ev(40, 'AscPicked', { ascId: 'A1', containerId: 'D4', jobId: 'J4', wtpPadId: 'P1' }),
      ev(50, 'StsPicked', { stsId: 'S1', containerId: 'D5' }),
      ev(60, 'StsGrounded', { stsId: 'S1', containerId: 'D5' }),
      ev(300, 'ShcPicked', { shcId: 'H1', containerId: 'D5' }),
    ]
    const r = boxWaits(log, 400, { top: 1 })
    expect(r.paths.discharge.boxes).toBe(2)
    expect(r.paths.discharge.meanS.horizontal).toBe(125)
    expect(r.top).toEqual([expect.objectContaining({ containerId: 'D5', stage: 'horizontal', seconds: 240 })])
  })
})
