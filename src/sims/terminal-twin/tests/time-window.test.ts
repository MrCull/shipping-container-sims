import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation, type EngineEvent, type LogRecord, type SimSnapshot } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'

const tracer = fixtures['tracer-1sts-10-boxes']
const FROM = 400
const TO = 800

function uninterruptedWindow(): EngineEvent[] {
  const sim = createSimulation(tracer)
  sim.runUntil()
  return sim.eventLog().filter((e) => e.t > FROM && e.t <= TO)
}

const readJsonl = <T>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)

describe('time windows from a snapshot', () => {
  it('restoring a mid-run snapshot and running a window gives the same events as that window of the uninterrupted run', () => {
    const expected = uninterruptedWindow()
    expect(expected.length).toBeGreaterThan(5)

    const first = createSimulation(tracer)
    first.runUntil({ time: FROM })
    const snapshot = JSON.parse(JSON.stringify(first.snapshot())) as SimSnapshot

    const window = restoreSimulation(snapshot)
    const seen: EngineEvent[] = []
    window.subscribe((e) => seen.push(e))
    const result = window.runUntil({ time: TO })
    expect(result.reason).toBe('condition')
    expect(window.now).toBe(TO)
    expect(seen).toEqual(expected)
  })

  it('CLI: --snapshot saves where a run stopped; --from-snapshot runs only the window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-window-'))
    const snap = join(dir, 'at-400.snapshot.json')
    const events = join(dir, 'window.jsonl')
    const log = join(dir, 'window.log.jsonl')

    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--until', `time:${FROM}`, '--snapshot', snap], () => {})).toBe(0)
    const saved = JSON.parse(readFileSync(snap, 'utf8')) as SimSnapshot
    expect(saved.kind).toBe('terminal-twin-snapshot')
    expect(saved.state.now).toBe(FROM)

    const out: string[] = []
    const code = runCli(
      ['--from-snapshot', snap, '--until', `time:${TO}`, '--events', events, '--log', log, '--log-level', 'debug'],
      (l) => out.push(l),
    )
    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toMatch(/Started:\s+snapshot at 00:06:40/)
    expect(text).toMatch(/Sim time:\s+00:13:20/)

    const expected = uninterruptedWindow()
    expect(readJsonl<EngineEvent>(events)).toEqual(expected)
    expect(readJsonl<LogRecord>(log).map((r) => r.eventId)).toEqual(expected.map((e) => e.id))
  })

  it('CLI: --from-snapshot cannot be combined with a scenario or seed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-window-'))
    const snap = join(dir, 's.json')
    runCli(['--fixture', 'tracer-1sts-10-boxes', '--until', 'time:100', '--snapshot', snap], () => {})
    expect(runCli(['--from-snapshot', snap, '--fixture', 'tracer-1sts-10-boxes'], () => {})).toBe(2)
    expect(runCli(['--from-snapshot', snap, '--seed', '3'], () => {})).toBe(2)
  })
})
