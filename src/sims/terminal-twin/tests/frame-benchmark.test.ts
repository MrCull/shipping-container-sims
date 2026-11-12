import { describe, expect, it } from 'vitest'
import { benchmarkFileName, FULL_BENCHMARK, percentile, planStages, QUICK_BENCHMARK, summariseStage, type FrameSample } from '../modules/frameBenchmark'

const sample = (at: number, simTime: number, over: Partial<FrameSample> = {}): FrameSample => ({
  at, simTime, calls: 100, triangles: 1000, poseMs: 2, cpuMs: 4, boxesPosed: 10, heroFaces: 3, ...over,
})

describe('frame benchmark', () => {
  it('plans every view at every quality, then the speed steps', () => {
    const stages = planStages(FULL_BENCHMARK)
    expect(stages).toHaveLength(5 * 3 + 5)
    expect(stages[0]).toMatchObject({ view: 'overview', quality: 'low' })
    expect(new Set(stages.map((s) => s.name)).size).toBe(stages.length)
    expect(stages.slice(-5).map((s) => s.speed)).toEqual([60, 300, 600, 1200, 3600])
    expect(stages.slice(-5).every((s) => s.view === 'overview' && s.quality === 'high')).toBe(true)
    expect(planStages(QUICK_BENCHMARK)).toHaveLength(5 + 2)
  })

  it('takes nearest-rank percentiles', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1)
    expect([percentile(xs, 50), percentile(xs, 95), percentile(xs, 99), percentile([], 50)]).toEqual([50, 95, 99, 0])
  })

  it('summarises a stage from frame gaps', () => {
    const [plan] = planStages(QUICK_BENCHMARK)
    const times = [0, 16, 32, 48, 64, 164] // one long frame of 100 ms
    const r = summariseStage(plan, times.map((t, i) => sample(t, i * 10, { calls: 100 + i })))
    expect(r.frames).toBe(6)
    expect(r.frameMs.longest).toBe(100)
    expect(r.frameMs.p50).toBe(16)
    expect(r.frameMs.p99).toBe(100)
    expect(r.fps).toBe(30.49)
    expect(r.achievedSpeed).toBe(304.9)
    expect(r.drawCalls).toEqual({ mean: 102.5, max: 105 })
  })

  it('copes with no frames', () => {
    const r = summariseStage(planStages(QUICK_BENCHMARK)[0], [])
    expect(r.fps).toBe(0)
    expect(r.frameMs.longest).toBe(0)
  })

  it('names the file from the start time and GPU', () => {
    expect(benchmarkFileName('2026-11-12T10:20:30.123Z', 'ANGLE (Apple, M2)')).toBe('terminal-twin-benchmark-20261112T102030Z-angle-apple-m2.json')
    expect(benchmarkFileName('2026-11-12T10:20:30.123Z', null)).toBe('terminal-twin-benchmark-20261112T102030Z.json')
  })
})
