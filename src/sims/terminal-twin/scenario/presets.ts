/**
 * Scenario presets (TTI Algeciras baseline, Small automated, Stress test)
 * arrive with TT-15. Each entry builds a full ScenarioConfig via the builder.
 */
import type { ScenarioConfig } from './types'

export const presets: Record<string, () => ScenarioConfig> = {}
