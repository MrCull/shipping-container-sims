/**
 * STS productivity from a saved event log: `pnpm run tt:sts <events.jsonl> [--until <seconds>]`.
 * Make the log with `pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:7200 --events /tmp/peak.jsonl`.
 * Prints each crane's time per bucket (see `engine/stsProductivity.ts`) from its first work package to `--until`
 * (default: the last event).
 */
import { readFileSync } from 'node:fs'
import { formatStsProductivity, stsProductivity } from '../engine'
import type { EngineEvent } from '../engine'

const USAGE = 'Usage: pnpm run tt:sts <events.jsonl> [--until <seconds>]'

export function runStsCli(argv: string[]): number {
  const file = argv.find((a) => !a.startsWith('--'))
  const at = argv.indexOf('--until')
  if (!file || argv.includes('--help')) {
    console.log(USAGE)
    return file ? 0 : 2
  }
  const events = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EngineEvent)
  const until = at >= 0 ? Number(argv[at + 1]) : (events[events.length - 1]?.t ?? 0)
  if (!Number.isFinite(until)) {
    console.error(USAGE)
    return 2
  }
  console.log(formatStsProductivity(stsProductivity(events, until)))
  return 0
}

process.exitCode = runStsCli(process.argv.slice(2))
