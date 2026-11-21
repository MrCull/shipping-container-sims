import { describe, expect, it } from 'vitest'
import { formatFrameReport, parseReport } from '../cli/frameReport'
import { BENCHMARK_FORMAT, FULL_BENCHMARK, planStages, summariseStage, type BenchmarkReport, type FrameSample } from '../modules/frameBenchmark'

const samples = (n: number): FrameSample[] =>
  Array.from({ length: n }, (_, i) => ({ at: i * 20, simTime: i * 1.2, calls: 200, triangles: 400_000, poseMs: 3, cpuMs: 6, boxesPosed: 9, heroFaces: 2 }))

const report = (): BenchmarkReport => ({
  format: BENCHMARK_FORMAT,
  startedAt: '2026-11-21T10:40:16.000Z',
  durationS: 400,
  scenario: { name: 'TTI Algeciras baseline', seed: 1, warmSimSeconds: 7200 },
  machine: { userAgent: 'x', platform: 'Win32', hardwareConcurrency: 8, deviceMemoryGb: 16, devicePixelRatio: 1, screen: '1920x1080', viewport: '1920x689', gpu: 'Intel Iris Xe', gpuVendor: 'Intel' },
  build: { engineVersion: '0.54.0', builtAt: null, commit: 'abc1234', production: true },
  settings: { stageMs: 8000, warmupMs: 3000, minFrames: 30, viewSpeed: 60, viewNotes: { overview: '', yard: '', crane: '', closeup: '', flythrough: '' } },
  stages: planStages(FULL_BENCHMARK).map((p) => summariseStage(p, samples(40))),
})

describe('frame report CLI', () => {
  it('prints one row per stage and the headline numbers', () => {
    const text = formatFrameReport(report())
    expect(text).toContain('Intel Iris Xe')
    expect(text).toContain('overview-low')
    expect(text).toContain('speed-x3600')
    expect(text).toMatch(/Overview High 50\.0 fps/)
    expect(text).toMatch(/Close-up High 50\.0 fps/)
    expect(text).toContain('Top speed step x3600')
  })

  it('flags a dev build', () => {
    const r = report()
    r.build.production = false
    expect(formatFrameReport(r)).toContain('DEV build')
  })

  it('rejects a file that is not a benchmark of this format', () => {
    expect(() => parseReport('{"format":99}')).toThrow(/not a frame benchmark/)
    expect(parseReport(JSON.stringify(report())).stages).toHaveLength(20)
  })
})
