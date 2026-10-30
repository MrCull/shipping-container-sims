/**
 * Scale limits (spec table) and the soft "peak-day scale" thresholds. The
 * setup dialog enforces them in its inputs and `createSimulation` enforces
 * them through `validateScenario` (`scenario/validate.ts`).
 */
export const SCALE_LIMITS = {
  quayLengthM: { min: 100, max: 3000 },
  sts: { min: 1, max: 24 },
  blocks: { min: 1, max: 40 },
  bays: { min: 1, max: 80 },
  tiers: { min: 1, max: 6 },
  shc: { min: 1, max: 120 },
  vessels: 60,
  trucksPerHour: 600,
  /** WTP pads and transfer stalls must fit the 25.4 m ASC span at 5.5 m pitch. */
  pads: 5,
  stalls: 5,
} as const

/** Above any of these the setup dialog warns that the run is heavier than the peak-day preset. */
export const STRESS_SCALE = { sts: 12, blocks: 24, bays: 60, shc: 40, vessels: 20, trucksPerHour: 250 } as const

/** Minimum quay frontage one yard block needs (m): the 25.4 m ASC span plus a clearance. */
export const BLOCK_FRONTAGE_M = 32
