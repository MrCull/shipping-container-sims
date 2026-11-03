/** #188: the `spread-drops` transferStallSelection strategy. Pure function of the request. */
import { describe, expect, it } from 'vitest'
import { getStrategy, type TransferStallSelectionRequest } from '../engine'

const handler = getStrategy('transferStallSelection', 'spread-drops')
const spreadDropsStall = (payload: TransferStallSelectionRequest) =>
  handler({ correlationId: 'x', decisionPoint: 'transferStallSelection', version: 1, t: 0, payload }, {} as never) as { stallId: string | null }

const stall = (stallId: string, blockId: string, distanceM: number) => ({ stallId, blockId, x: 0, z: 0, occupiedBy: null, distanceM })

const request = (legKind: 'drop' | 'pick', blockFill: Record<string, number>): TransferStallSelectionRequest => ({
  truckId: 'T1',
  transaction: legKind === 'drop' ? 'dropExport' : 'pickImport',
  legs: [{ kind: legKind, purpose: 'export', containerId: 'C1', size: '40', blockId: legKind === 'pick' ? 'B02' : null }],
  stalls: [stall('B01-TS1', 'B01', 100), stall('B02-TS1', 'B02', 200), stall('B03-TS1', 'B03', 300)],
  blockLoad: { B01: 0, B02: 0, B03: 0 },
  blockFill,
})

describe('spreadDropsStall (#188)', () => {
  it('sends a drop to the stall nearest the gate while the blocks are equally full', () => {
    expect(spreadDropsStall(request('drop', { B01: 0.5, B02: 0.5, B03: 0.5 })).stallId).toBe('B01-TS1')
  })

  it('sends a drop to a farther block once the near block is fuller by more than the road difference is worth', () => {
    expect(spreadDropsStall(request('drop', { B01: 0.9, B02: 0.7, B03: 0.7 })).stallId).toBe('B02-TS1')
    expect(spreadDropsStall(request('drop', { B01: 0.9, B02: 0.9, B03: 0.7 })).stallId).toBe('B03-TS1')
  })

  it('keeps a pick in the block of its box whatever the fill', () => {
    expect(spreadDropsStall(request('pick', { B01: 0.1, B02: 0.95, B03: 0.1 })).stallId).toBe('B02-TS1')
  })
})
