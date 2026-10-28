import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSimulation, diffEventLogs, getStrategy, type HandlerSet } from '../engine'
import { runDiffCli } from '../cli/diffCli'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'

const tracer = fixtures['tracer-1sts-10-boxes']

/** A valid alternative strategy: highest free lane instead of lowest. */
const highestFreeLane: Partial<HandlerSet> = {
  stsGroundPosition: getStrategy('stsGroundPosition', 'highest-free-lane'),
}

function log(handlers: Partial<HandlerSet> = {}, seed?: number) {
  const sim = createSimulation(tracer, handlers, { seed })
  sim.runUntil()
  return sim.eventLog()
}

function cli(fn: (argv: string[], print: (l: string) => void) => number, ...args: string[]) {
  const out: string[] = []
  const exitCode = fn(args, (l) => out.push(l))
  return { exitCode, text: out.join('\n') }
}

describe('run diff', () => {
  it('reports no divergence for two identical runs', () => {
    const diff = diffEventLogs(log(), log())
    expect(diff.diverged).toBe(false)
    expect(diff.commonEvents).toBe(log().length)
  })

  it('reports the first diverging event (seq + both payloads) for two strategies', () => {
    const a = log()
    const b = log(highestFreeLane)
    const diff = diffEventLogs(a, b, { context: 2 })
    if (!diff.diverged) throw new Error('expected divergence')
    // Events before the first ground-position reply are identical; the reply differs there.
    const firstReply = a.find((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'stsGroundPosition')!
    expect(diff.seq).toBe(firstReply.seq)
    expect(diff.commonEvents).toBe(firstReply.seq)
    expect(diff.a?.type).toBe('DecisionResolved')
    expect(diff.b?.type).toBe('DecisionResolved')
    expect(diff.a?.payload).toMatchObject({ reply: { groundPositionId: 'STS01-GP1' } })
    expect(diff.b?.payload).toMatchObject({ reply: { groundPositionId: 'STS01-GP10' } })
    expect(diff.differences).toContain('payload.reply.groundPositionId')
    expect(diff.before.map((e) => e.seq)).toEqual([firstReply.seq - 2, firstReply.seq - 1])
    expect(diff.afterA).toHaveLength(2)
    expect(diff.afterB).toHaveLength(2)
  })

  it('reports where one run stops while the other continues', () => {
    const full = log()
    const diff = diffEventLogs(full.slice(0, 10), full)
    if (!diff.diverged) throw new Error('expected divergence')
    expect(diff.seq).toBe(10)
    expect(diff.a).toBeNull()
    expect(diff.b?.seq).toBe(10)
  })

  it('CLI compares two seeds / two handler sets of one scenario', () => {
    const same = cli(runDiffCli, '--fixture', 'tracer-1sts-10-boxes')
    expect(same.exitCode).toBe(0)
    expect(same.text).toMatch(/No divergence: 62 events identical/)

    const strategies = cli(runDiffCli, '--fixture', 'tracer-1sts-10-boxes', '--b-handlers', 'highest-free-lane')
    expect(strategies.exitCode).toBe(1)
    expect(strategies.text).toMatch(/First divergence at seq \d+/)
    expect(strategies.text).toContain('"groundPositionId":"STS01-GP1"')
    expect(strategies.text).toContain('"groundPositionId":"STS01-GP10"')
    expect(strategies.text).toContain('payload.reply.groundPositionId')

    const seeds = cli(runDiffCli, '--fixture', 'tracer-1sts-10-boxes', '--a-seed', '1', '--b-seed', '2')
    expect(seeds.exitCode).toBe(1)
    expect(seeds.text).toMatch(/First divergence at seq 0/) // ScenarioStarted carries the seed
  })

  it('CLI compares two event-log files (e.g. from two code versions)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-diff-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--events', a], () => {})).toBe(0)
    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--events', b], () => {})).toBe(0)
    expect(cli(runDiffCli, a, b).exitCode).toBe(0)

    const lines = log(highestFreeLane).map((e) => JSON.stringify(e))
    writeFileSync(b, lines.join('\n') + '\n')
    const diff = cli(runDiffCli, a, b)
    expect(diff.exitCode).toBe(1)
    expect(diff.text).toMatch(/First divergence at seq \d+/)

    expect(cli(runDiffCli, a).exitCode).toBe(2)
  })
})
