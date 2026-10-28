/**
 * The browser's view of KPIs (worker host protocol) is the same calculation as the CLI's:
 * same seed, same numbers (TT-07 acceptance).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, exportRun, headlineKpis, highlightsOf } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'
import { createEngineHost } from '../worker/engineHost'
import type { WorkerReply, WorkerRequest } from '../worker/protocol'

const FIXTURE = 'asc-1sts-10-boxes-1block'

async function hostRun() {
  const host = createEngineHost()
  let rid = 0
  const call = async (req: WorkerRequest): Promise<Extract<WorkerReply, { ok: true }>> => {
    const reply = await host.handle({ ...req, rid: rid++ } as never)
    if (!reply.ok) throw new Error(reply.error)
    return reply
  }
  await call({ op: 'load', config: fixtures[FIXTURE], seed: fixtures[FIXTURE].seed })
  await call({ op: 'run', condition: {} })
  return call
}

describe('KPI over the worker protocol', () => {
  it('headline, highlights and series equal the engine collector the CLI uses', async () => {
    const call = await hostRun()
    const sim = createSimulation(fixtures[FIXTURE])
    sim.runUntil()
    const headline = (await call({ op: 'query', kind: 'kpiHeadline' })).result as { headline: unknown; highlights: unknown }
    expect(headline.headline).toEqual(headlineKpis(sim.kpiSeries(), sim.kpiReport()))
    expect(headline.highlights).toEqual(highlightsOf(sim.kpiSeries(), sim.kpiReport()))
    expect((await call({ op: 'query', kind: 'kpiSeries' })).result).toEqual(sim.kpiSeries())

    // and the CLI prints the same numbers
    const out: string[] = []
    runCli(['--fixture', FIXTURE], (l) => out.push(l))
    const h = headline.headline as { grossMovesPerHour: number; ascUtilisationPct: number }
    expect(out.join('\n')).toContain(`Gross moves/h:    ${h.grossMovesPerHour}`)
    expect(out.join('\n')).toContain(`ASC utilisation:  ${h.ascUtilisationPct} %`)
  })

  it('exports every kind as the engine builds it', async () => {
    const call = await hostRun()
    const sim = createSimulation(fixtures[FIXTURE])
    sim.runUntil()
    for (const kind of ['kpi-json', 'kpi-csv', 'events-json', 'events-csv'] as const)
      expect((await call({ op: 'export', kind })).result, kind).toBe(exportRun(sim, kind))
  })

  it('reports how the run ended in the engine info (for the final report)', async () => {
    const call = await hostRun()
    const info = (await call({ op: 'query', kind: 'kpiHeadline' })).info
    expect(info.status).toBe('ended')
    expect(info.endReason).toMatch(/vesselsCompleted|simDurationS|moves/)
    expect(info.endT).toBeGreaterThan(0)
  })
})
