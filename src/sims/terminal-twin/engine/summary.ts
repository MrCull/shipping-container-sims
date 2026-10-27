/**
 * RunSummary: the compact, JSON-stable result of a run. Printed by the CLI
 * and committed as the golden summary of each fixture.
 */
import type { KpiReport } from './kpis'
import type { SimError, SimStatus, Simulation } from './simulation'
import type { InvariantViolation } from './invariants'

export interface RunSummary {
  scenario: string
  seed: number
  status: SimStatus
  endReason: string | null
  eventLogHash: string
  kpis: KpiReport
  invariants: { enabled: boolean; checks: number; violations: number; first: InvariantViolation | null }
  firstError: SimError | null
}

export function summarizeRun(sim: Simulation): RunSummary {
  const inv = sim.invariantReport()
  const log = sim.eventLog()
  const last = log[log.length - 1]
  return {
    scenario: sim.config.name,
    seed: sim.seed,
    status: sim.status,
    endReason: last?.type === 'ScenarioEnded' ? last.payload.reason : null,
    eventLogHash: sim.eventLogHash(),
    kpis: sim.kpiReport(),
    invariants: {
      enabled: inv.enabled,
      checks: inv.checks,
      violations: inv.violations.length,
      first: inv.violations[0] ?? null,
    },
    firstError: sim.firstError,
  }
}
