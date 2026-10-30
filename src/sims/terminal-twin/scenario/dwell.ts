/**
 * Dwell-time distributions (TT-11): how long a transshipment box stands in the
 * yard before it may load onto its onward vessel. Pure; the caller supplies
 * the uniform [0, 1) random source.
 */
import type { DwellDistribution, ScenarioConfig, TransshipmentConfig } from './types'

/** [A] Median two days, sigma 0.6 (most boxes 1 to 5 days). */
export const DEFAULT_TRANSSHIPMENT: TransshipmentConfig = { dwell: { kind: 'lognormal', medianS: 2 * 86400, sigma: 0.6 } }

export const transshipmentConfig = (config: ScenarioConfig): TransshipmentConfig => config.transshipment ?? DEFAULT_TRANSSHIPMENT

/** One dwell draw (whole seconds). */
export function sampleDwell(dist: DwellDistribution, rng: () => number): number {
  switch (dist.kind) {
    case 'fixed':
      return Math.max(0, Math.round(dist.s))
    case 'uniform':
      return Math.max(0, Math.round(dist.minS + rng() * (dist.maxS - dist.minS)))
    case 'lognormal': {
      const u1 = Math.max(rng(), 1e-12)
      const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng())
      return Math.max(0, Math.round(dist.medianS * Math.exp(dist.sigma * normal)))
    }
  }
}

/** Validation messages (empty = valid). */
export function validateDwell(dist: DwellDistribution): string[] {
  switch (dist.kind) {
    case 'fixed':
      return dist.s >= 0 ? [] : ['dwell must not be negative']
    case 'uniform':
      return dist.minS >= 0 && dist.maxS >= dist.minS ? [] : ['dwell range is invalid']
    case 'lognormal':
      return dist.medianS > 0 && dist.sigma >= 0 ? [] : ['dwell median must be positive']
  }
}
