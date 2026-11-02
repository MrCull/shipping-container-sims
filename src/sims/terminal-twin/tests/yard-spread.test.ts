/**
 * #207: the `balanced` wtpPadSelection spreads a vessel's discharge over the yard blocks. The nearest-box strategy
 * (the TTI presets' choice before 0.43.0) sends every box to the blocks by the cranes; on the peak day that left some
 * ASCs 17 to 33 % idle and others 80 to 100 %, and the busy blocks filled until `rehandle: full` stopped all work.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, strategies, getStrategy, type Simulation, type WtpPadSelectionRequest } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

/** The agreed spread: no block holds, or queues for its ASCs, more than this multiple of the block average (1 = the average). */
const MAX_BOX_SHARE = 1.5
const MAX_QUEUE_SHARE = 2

const BLOCKS = ['B01', 'B02', 'B03', 'B04']

function yardOf(pads: 'nearest-box' | 'balanced'): ScenarioConfig {
  const b = new ScenarioBuilder('spread', 'Spread')
    .hatch({ enabled: false })
    .seed(11)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Spread Star', sizeClass: 'panamax', discharge: 80, maxSts: 1, sizeMix: { '20': 1 } })
    .shcs(3)
  for (const [i, x] of [20, 60, 100, 140].entries()) b.block(BLOCKS[i], { x, bays: 8, tiers: 3 })
  return b
    .ascsPerBlock(1)
    .decisions({ points: { wtpPadSelection: { strategy: pads } } })
    .endWhen({ simDurationS: 40000 })
    .build()
}

/** Run in slices; returns the final box count per block and the peak of each block's queued ASC jobs. */
function measure(sim: Simulation): { boxes: number[]; peakQueued: number[] } {
  const peakQueued = BLOCKS.map(() => 0)
  for (let t = 300; t <= 40000; t += 300) {
    const r = sim.runUntil({ time: t })
    const s = sim.snapshot().state
    BLOCKS.forEach((id, i) => {
      peakQueued[i] = Math.max(peakQueued[i], Object.values(s.ascJobs).filter((j) => j.blockId === id).length)
    })
    if (r.reason !== 'condition') break
  }
  const s = sim.snapshot().state
  return { boxes: BLOCKS.map((id) => s.yardBlocks[id].heights.reduce((a, h) => a + h, 0)), peakQueued }
}

const share = (xs: number[]) => Math.max(...xs) / (xs.reduce((a, b) => a + b, 0) / xs.length)

describe('balanced wtpPadSelection (#207)', () => {
  it('is registered', () => {
    expect(Object.keys(strategies.wtpPadSelection.strategies)).toContain('balanced')
  })

  it('prefers the emptier block over a nearer, fuller one, and the nearer pad when loads are equal', () => {
    const pad = (id: string, blockId: string, x: number) => ({ id, blockId, x, z: 0, occupiedBy: null, claimedBy: null })
    const payload = (blockLoad: WtpPadSelectionRequest['blockLoad']): WtpPadSelectionRequest => ({
      shcId: 'S',
      jobId: 'J',
      containerId: 'C',
      stsId: 'STS01',
      groundPositionId: 'G',
      x: 0,
      z: 0,
      wtpPads: [pad('B01-P1', 'B01', 10), pad('B02-P1', 'B02', 200)],
      blockLoad,
    })
    const ask = (p: WtpPadSelectionRequest) =>
      (
        getStrategy('wtpPadSelection', 'balanced')(
          { correlationId: 't', decisionPoint: 'wtpPadSelection', version: 1, t: 0, payload: p },
          undefined as never,
        ) as { wtpPadId: string | null }
      ).wtpPadId
    expect(ask(payload({ B01: { fill: 0.5, queued: 0 }, B02: { fill: 0.5, queued: 0 } }))).toBe('B01-P1')
    expect(ask(payload({ B01: { fill: 0.9, queued: 0 }, B02: { fill: 0.3, queued: 0 } }))).toBe('B02-P1')
    expect(ask(payload({ B01: { fill: 0.5, queued: 6 }, B02: { fill: 0.5, queued: 0 } }))).toBe('B02-P1')
  })

  it('keeps every block near the average box count and queued ASC work on a four-block yard', () => {
    const sim = createSimulation(yardOf('balanced'), {}, { invariants: { failFast: false } })
    const { boxes, peakQueued } = measure(sim)
    expect(boxes.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    expect(share(boxes)).toBeLessThanOrEqual(MAX_BOX_SHARE)
    expect(share(peakQueued)).toBeLessThanOrEqual(MAX_QUEUE_SHARE)
  })

  it('does better than nearest-box on the same yard', () => {
    const near = measure(createSimulation(yardOf('nearest-box'), {}, { invariants: { failFast: false } }))
    const bal = measure(createSimulation(yardOf('balanced'), {}, { invariants: { failFast: false } }))
    expect(share(bal.boxes)).toBeLessThan(share(near.boxes))
  })
})
