import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../scenario/fixtures/tracer-1sts-10-boxes.golden.json', import.meta.url)), 'utf8'),
)

function cli(...args: string[]) {
  const out: string[] = []
  const exitCode = runCli(args, (line) => out.push(line))
  return { exitCode, text: out.join('\n') }
}

describe('CLI runner', () => {
  it('runs a fixture by name and prints the KPI summary, hash and invariant results', () => {
    const { exitCode, text } = cli('--fixture', 'tracer-1sts-10-boxes')
    expect(exitCode).toBe(0)
    expect(text).toContain('tracer-1sts-10-boxes (seed 42)')
    expect(text).toMatch(new RegExp(`Event-log hash:\\s+${golden.eventLogHash}`))
    expect(text).toMatch(/Moves completed:\s+10/)
    expect(text).toMatch(/Invariants:\s+\d+ checks, 0 violations/)
    expect(text).toMatch(/First error:\s+none/)
  })

  it('writes the summary JSON and the event log (JSON lines) to the output paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-cli-'))
    const out = join(dir, 'summary.json')
    const events = join(dir, 'events.jsonl')
    expect(cli('--fixture', 'tracer-1sts-10-boxes', '--out', out, '--events', events).exitCode).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(golden)
    const lines = readFileSync(events, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(golden.kpis.eventsProcessed)
    expect(lines[0].type).toBe('ScenarioStarted')
  })

  it('honours --seed and --until', () => {
    const seeded = cli('--fixture', 'tracer-1sts-10-boxes', '--seed', '7')
    expect(seeded.text).toContain('(seed 7)')
    expect(seeded.text).not.toContain(golden.eventLogHash)

    const partial = cli('--fixture', 'tracer-1sts-10-boxes', '--until', 'moves:3')
    expect(partial.exitCode).toBe(0)
    expect(partial.text).toMatch(/Stopped:\s+condition/)
    expect(partial.text).toMatch(/Moves completed:\s+3/)

    expect(cli('--fixture', 'tracer-1sts-10-boxes', '--until', 'time:200').text).toMatch(/Sim time:\s+00:03:20/)
  })

  it('loads a scenario config from a JSON file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-cli-'))
    const file = join(dir, 'custom.json')
    writeFileSync(file, JSON.stringify({ ...fixtures['tracer-1sts-10-boxes'], name: 'custom' }))
    const { exitCode, text } = cli('--fixture', file)
    expect(exitCode).toBe(0)
    expect(text).toContain('custom (seed 42)')
  })

  it('exits non-zero on an invariant failure and prints the first error', () => {
    const { exitCode, text } = cli('--fixture', 'tracer-1sts-10-boxes', '--handlers', 'broken-first-lane')
    expect(exitCode).toBe(1)
    expect(text).toMatch(/Invariants:\s+\d+ checks, 1 violations/)
    expect(text).toMatch(/First error:\s+event #\d+ .*custody\.single-owner/)
  })

  it('exits 2 with usage help on bad arguments', () => {
    expect(cli().exitCode).toBe(2)
    expect(cli('--fixture', 'no-such-fixture').text).toMatch(/Unknown fixture/)
    expect(cli('--preset', 'nope').exitCode).toBe(2)
    expect(cli('--fixture', 'tracer-1sts-10-boxes', '--until', 'banana').exitCode).toBe(2)
  })

  it('the npm entry point runs under tsx and sets the process exit code', () => {
    const entry = fileURLToPath(new URL('../cli/run.ts', import.meta.url))
    const stdout = execFileSync('npx', ['tsx', entry, '--fixture', 'tracer-1sts-10-boxes'], { encoding: 'utf8' })
    expect(stdout).toContain(golden.eventLogHash)
    let status = 0
    try {
      execFileSync('npx', ['tsx', entry, '--fixture', 'tracer-1sts-10-boxes', '--handlers', 'broken-first-lane'], {
        stdio: 'pipe',
      })
    } catch (err) {
      status = (err as { status: number }).status
    }
    expect(status).toBe(1)
  }, 30_000)
})
