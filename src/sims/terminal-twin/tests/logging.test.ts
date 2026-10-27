import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSimulation, parseLogVerbosity, type LogRecord } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'

const tracer = fixtures['tracer-1sts-10-boxes']

function runWithLog(verbosity: string) {
  const lines: LogRecord[] = []
  const sim = createSimulation(tracer, {}, { log: { verbosity, write: (r) => lines.push(r) } })
  sim.runUntil()
  return { sim, lines }
}

describe('structured logs', () => {
  it('every line carries sim time, event id, seq, subsystem, level and type', () => {
    const { sim, lines } = runWithLog('*=debug')
    expect(lines).toHaveLength(sim.eventLog().length)
    for (const line of lines) {
      expect(typeof line.t).toBe('number')
      expect(typeof line.eventId).toBe('number')
      expect(typeof line.seq).toBe('number')
      expect(typeof line.subsystem).toBe('string')
      expect(['error', 'warn', 'info', 'debug']).toContain(line.level)
    }
    expect(lines[0]).toMatchObject({ t: 0, seq: 0, subsystem: 'scenario', type: 'ScenarioStarted' })
    const grounded = lines.find((l) => l.type === 'StsGrounded')
    expect(grounded).toMatchObject({ subsystem: 'sts', level: 'info' })
    // debug verbosity includes the full envelope
    expect(grounded?.payload).toMatchObject({ stsId: 'STS01' })
    expect(grounded?.causedBy).toEqual(expect.any(Number))
  })

  it('per-subsystem verbosity filters lines (sts=info hides debug-level STS events, vessel=off hides vessels)', () => {
    const { lines } = runWithLog('*=info,sts=info,vessel=off')
    const types = new Set(lines.map((l) => l.type))
    expect(types.has('StsPicked')).toBe(true)
    expect(types.has('StsMoveStarted')).toBe(false) // debug-level
    expect(types.has('VesselBerthed')).toBe(false)
    expect(types.has('ScenarioStarted')).toBe(true)
    // info lines carry no payload
    expect(lines.find((l) => l.type === 'StsPicked')?.payload).toBeUndefined()

    const only = runWithLog('*=off,sts=debug').lines
    expect(new Set(only.map((l) => l.subsystem))).toEqual(new Set(['sts']))
    expect(only.some((l) => l.type === 'StsMoveStarted')).toBe(true)
  })

  it('invariant violations are logged as errors under "invariants"', () => {
    const lines: LogRecord[] = []
    const sim = createSimulation(
      tracer,
      { stsGroundPosition: (req) => ({ groundPositionId: req.groundPositions[0].id }) },
      { log: { verbosity: '*=error', write: (r) => lines.push(r) } },
    )
    sim.runUntil()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ subsystem: 'invariants', level: 'error', type: 'InvariantViolated' })
  })

  it('rejects bad verbosity specs', () => {
    expect(parseLogVerbosity('asc=debug,shc=info')).toEqual({ default: 'info', subsystems: { asc: 'debug', shc: 'info' } })
    expect(parseLogVerbosity('warn')).toEqual({ default: 'warn', subsystems: {} })
    expect(() => parseLogVerbosity('sts=loud')).toThrow(/loud/)
  })

  it('CLI --log writes JSON lines filtered by --log-level', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-log-'))
    const file = join(dir, 'run.log.jsonl')
    const out: string[] = []
    const code = runCli(['--fixture', 'tracer-1sts-10-boxes', '--log', file, '--log-level', '*=warn,sts=debug'], (l) =>
      out.push(l),
    )
    expect(code).toBe(0)
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LogRecord)
    expect(lines.length).toBeGreaterThan(0)
    expect(new Set(lines.map((l) => l.subsystem))).toEqual(new Set(['sts']))
    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--log-level', 'sts=nope'], () => {})).toBe(2)
  })
})
