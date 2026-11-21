/**
 * Frame benchmark report CLI: reads the JSON the performance panel's Benchmark button downloads and prints one
 * table, so nobody hand-rolls a reader for it.
 *
 *   pnpm run tt:frame-report <file.json>              print the machine, build and one row per stage
 *   pnpm run tt:frame-report <file.json> --record     also copy the file into docs/benchmarks/
 *
 * Exit codes: 0 ok, 2 usage error or not a benchmark file.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BENCHMARK_FORMAT, type BenchmarkReport, type StageResult } from '../modules/frameBenchmark'

const pad = (s: string | number, n: number): string => String(s).padStart(n)

/** One line per stage: fps, frame-time tail, posing, draw load and the speed the clock really reached. */
export function formatFrameReport(report: BenchmarkReport): string {
  const { machine, build, stages } = report
  const lines = [
    `Machine: ${machine.gpu ?? 'GPU hidden'} | ${machine.hardwareConcurrency ?? '?'} cores | ${machine.deviceMemoryGb ?? '?'} GB | screen ${machine.screen}, canvas ${machine.viewport}`,
    `Build:   engine ${build.engineVersion} | commit ${build.commit ?? '?'} | ${build.production ? 'production' : 'DEV build, numbers are not comparable'}`,
    `Run:     ${report.startedAt}, ${report.durationS} s, scenario ${report.scenario.name}`,
    '',
    `${'stage'.padEnd(18)}${pad('speed', 6)}${pad('fps', 7)}${pad('p95 ms', 8)}${pad('p99 ms', 8)}${pad('max ms', 8)}${pad('pose ms', 9)}${pad('calls', 7)}${pad('kTris', 7)}${pad('achieved', 10)}`,
  ]
  for (const s of stages) lines.push(stageLine(s))
  lines.push('', headline(stages))
  return lines.join('\n')
}

function stageLine(s: StageResult): string {
  return (
    s.name.padEnd(18) +
    pad(`x${s.speed}`, 6) +
    pad(s.fps.toFixed(1), 7) +
    pad(s.frameMs.p95, 8) +
    pad(s.frameMs.p99, 8) +
    pad(s.frameMs.longest, 8) +
    pad(s.poseMs.toFixed(1), 9) +
    pad(Math.round(s.drawCalls.mean), 7) +
    pad(Math.round(s.triangles.mean / 1000), 7) +
    pad(s.achievedSpeed, 10) +
    (s.simEnded ? '  sim ended' : '')
  )
}

/** The numbers `frame-rate.md` asks to record: Overview and close-up on High, and the top speed step. */
function headline(stages: StageResult[]): string {
  const find = (name: string): StageResult | undefined => stages.find((s) => s.name === name)
  const part = (label: string, s: StageResult | undefined): string =>
    s ? `${label} ${s.fps.toFixed(1)} fps, p99 ${s.frameMs.p99} ms` : `${label} not run`
  const top = [...stages].filter((s) => s.name.startsWith('speed-')).pop()
  return [
    'Headline:',
    `  ${part('Overview High', find('overview-high'))}`,
    `  ${part('Close-up High', find('closeup-high'))} (longest frame ${find('closeup-high')?.frameMs.longest ?? '?'} ms)`,
    `  ${top ? `Top speed step x${top.speed}: achieved x${top.achievedSpeed}` : 'No speed steps'}`,
  ].join('\n')
}

export function parseReport(text: string): BenchmarkReport {
  const data = JSON.parse(text) as Partial<BenchmarkReport>
  if (data.format !== BENCHMARK_FORMAT || !Array.isArray(data.stages) || !data.machine || !data.build) {
    throw new Error(`not a frame benchmark file of format ${BENCHMARK_FORMAT}`)
  }
  return data as BenchmarkReport
}

function main(argv: string[]): number {
  const file = argv.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('Usage: pnpm run tt:frame-report <file.json> [--record]')
    return 2
  }
  let report: BenchmarkReport
  try {
    report = parseReport(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`${file}: ${(e as Error).message}`)
    return 2
  }
  console.log(formatFrameReport(report))
  if (argv.includes('--record')) {
    mkdirSync('docs/benchmarks', { recursive: true })
    const target = join('docs/benchmarks', basename(file))
    copyFileSync(file, target)
    console.log(`\nCopied to ${target}`)
  }
  return 0
}

if (process.argv[1] && /frameReport\.(ts|js)$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)))
