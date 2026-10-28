import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSimulation, summarizeRun } from '../engine'
import { checkGolden, runGoldenCli } from '../cli/golden'
import { fixtures } from '../scenario/fixtures'

const NAME = 'tracer-1sts-10-boxes'

function summary() {
  const sim = createSimulation(fixtures[NAME])
  sim.runUntil()
  return summarizeRun(sim)
}

function cli(...args: string[]) {
  const out: string[] = []
  const exitCode = runGoldenCli(args, (l) => out.push(l))
  return { exitCode, text: out.join('\n') }
}

describe('golden updates', () => {
  it('without the update flag, a changed outcome is drift with a readable field-by-field diff (file untouched)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-golden-'))
    const file = join(dir, `${NAME}.golden.json`)
    const actual = summary()
    const stale = { ...actual, eventLogHash: '00000000000000', kpis: { ...actual.kpis, movesCompleted: 9 } }
    writeFileSync(file, JSON.stringify(stale, null, 2))

    const result = checkGolden(file, actual, { update: false })
    expect(result.status).toBe('drift')
    expect(result.report).toContain('kpis.movesCompleted: golden 9 → actual 10')
    expect(result.report).toContain(`eventLogHash: golden "00000000000000" → actual "${actual.eventLogHash}"`)
    expect(result.report).toMatch(/tt:golden -- --update/)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(stale)
  })

  it('with the update flag, the golden is rewritten to the new outcome', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-golden-'))
    const file = join(dir, `${NAME}.golden.json`)
    const actual = summary()
    expect(checkGolden(file, actual, { update: false }).status).toBe('missing')
    expect(checkGolden(file, actual, { update: true }).status).toBe('created')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(actual)
    expect(checkGolden(file, actual, { update: false }).status).toBe('match')

    writeFileSync(file, JSON.stringify({ ...actual, seed: 1 }))
    const updated = checkGolden(file, actual, { update: true })
    expect(updated.status).toBe('updated')
    expect(updated.report).toContain('seed: golden 1 → actual 42')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(actual)
  })

  it('tt:golden CLI checks every fixture and only writes with --update', () => {
    expect(cli().exitCode).toBe(0) // committed goldens match

    const dir = mkdtempSync(join(tmpdir(), 'tt-golden-'))
    const missing = cli('--dir', dir)
    expect(missing.exitCode).toBe(1)
    expect(missing.text).toContain(`${NAME}: missing`)

    expect(cli('--dir', dir, '--update').exitCode).toBe(0)
    const file = join(dir, `${NAME}.golden.json`)
    const golden = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...golden, kpis: { ...golden.kpis, simTimeS: 1 } }))

    const drift = cli('--dir', dir)
    expect(drift.exitCode).toBe(1)
    expect(drift.text).toContain(`${NAME}: DRIFT`)
    expect(drift.text).toContain(`kpis.simTimeS: golden 1 → actual ${golden.kpis.simTimeS}`)

    expect(cli('--dir', dir, '--update', '--fixture', NAME).text).toContain(`${NAME}: updated`)
    expect(cli('--dir', dir).exitCode).toBe(0)
    expect(cli('--fixture', 'nope').exitCode).toBe(2)
  }, 60000)
})
