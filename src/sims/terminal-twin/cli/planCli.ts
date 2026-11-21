/**
 * The crane plan as text (#288):
 *
 *   pnpm run tt:plan (--preset <name> | --fixture <name|file.json>) --vessel <id> [--strategy <name>] [--until <cond>]
 *
 * Runs the scenario until the vessel's cranes are assigned and prints its plan (crane, package, kind, bay, section,
 * moves, predicted start and end) with the predicted conflict windows. With `--until` (same syntax as `tt:run`) it keeps
 * running to that condition and prints the plan with the actual times next to the predicted ones, plus the plan accuracy.
 *
 * Exit codes: 0 ok, 1 the vessel never got a plan (or the run failed), 2 usage error.
 */
import { parseArgs } from 'node:util'
import { createSimulation } from '../engine'
import { getStrategy } from '../engine/decisions/strategies'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { formatCranePlan, formatPlanAccuracy } from './planFormat'
import { loadScenario, parseUntil } from './runCli'

export const PLAN_USAGE = `Usage: pnpm run tt:plan (--preset <name> | --fixture <name|file.json>) --vessel <id> [options]

  --preset <name>     Scenario preset (${Object.keys(presets).join(', ')})
  --fixture <name>    Fixture (${Object.keys(fixtures).join(', ')}) or a scenario .json file
  --vessel <id>       The vessel whose plan to print (required)
  --strategy <name>   Crane plan strategy (as-today, balanced-moves, equal-bays)
  --until <cond>      Run on to this condition (end | time:<s> | moves:<n> | vessels:<n> | event:<Type>) and print the actual times too`

class UsageError extends Error {}

export function runPlanCli(argv: string[], print: (line: string) => void = console.log): number {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        preset: { type: 'string' },
        fixture: { type: 'string' },
        vessel: { type: 'string' },
        strategy: { type: 'string' },
        until: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    })
    if (values.help) {
      print(PLAN_USAGE)
      return 0
    }
    if (!values.vessel) throw new UsageError('Missing --vessel')
    let config = loadScenario(values.fixture, values.preset)
    if (!config.vessels.some((v) => v.id === values.vessel))
      throw new UsageError(`Unknown vessel "${values.vessel}" (this scenario has: ${config.vessels.map((v) => v.id).join(', ')})`)
    if (values.strategy !== undefined) {
      try {
        getStrategy('craneSplit', values.strategy)
      } catch (err) {
        throw new UsageError((err as Error).message)
      }
      config = { ...config, decisions: { ...config.decisions, points: { ...config.decisions?.points, craneSplit: { strategy: values.strategy } } } }
    }
    const condition = values.until === undefined ? null : parseUntil(values.until)
    const sim = createSimulation(config)
    const id = values.vessel
    while (!sim.cranePlan(id) && sim.firstError === null && sim.step()) {
      // run to the crane split
    }
    if (!sim.cranePlan(id)) {
      print(sim.firstError ? `The run failed before ${id} got a plan: ${sim.firstError.message}` : `${id} never got a crane plan in this scenario`)
      return 1
    }
    if (condition) sim.runUntil(condition)
    const view = sim.cranePlan(id)
    if (!view) return 1
    for (const line of formatCranePlan(view, condition !== null)) print(line)
    if (condition) for (const line of formatPlanAccuracy(sim.planAccuracy().filter((a) => a.vesselId === id))) print(line)
    return sim.firstError ? 1 : 0
  } catch (err) {
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      print(`Error: ${(err as Error).message}`)
      print(PLAN_USAGE)
      return 2
    }
    throw err
  }
}
