/**
 * Frame-rate baseline (#246): `pnpm run tt:baseline`. One report for the full-scale TTI baseline preset:
 *  (a) posing time per frame at the Overview camera, in Node (the scene model and the posing loop are pure TypeScript;
 *      the render submit and the GPU are not in it), with the two per-frame counters (boxes posed, instance bytes);
 *  (b) achieved sim seconds per wall second for the engine in its worker at each speed step from x60 to x3600, in
 *      headless Chromium with no rendering (`tests/browser/terminal-twin-baseline.smoke.ts`, started as a child process).
 * Options: --preset <name>  --sim-time <s> (display time posed, default 14400)  --frames <n> (default 30)
 *          --skip-rate (posing only)  --skip-posing (rate only)  --out <file> (also write the report as JSON).
 * Exit codes: 0 ok, 1 a part failed, 2 usage. Timings only compare on a like machine; record them with date, engine
 * version and machine in `docs/optimising/frame-rate.md`.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ENGINE_VERSION } from '../engine'
import { presets } from '../scenario/presets'
import { makeHeadlessRenderer, overviewView, startHeadlessRun, timePosing, type PosingTiming } from './headlessPose'

export interface RateRow {
  speed: number
  achieved: number
  engine: number
  wallS: number
}

export function formatReport(preset: string, posing: (PosingTiming & { simTime: number; boxes: number }) | null, rates: RateRow[] | null, env: string): string {
  const lines = [`Terminal Twin frame-rate baseline: ${preset}, engine ${ENGINE_VERSION}, ${env}`]
  if (posing) {
    lines.push(
      '',
      `Posing at the Overview camera, display time ${posing.simTime} s, ${posing.boxes} boxes in the scene (Node, no render submit)`,
      `  posing ms per frame: mean ${posing.meanMs.toFixed(2)}, min ${posing.minMs.toFixed(2)}, max ${posing.maxMs.toFixed(2)}`,
      `  boxes posed per frame: ${posing.counters.boxesPosed}`,
      `  instance bytes uploaded per frame: ${posing.counters.instanceBytes} (${(posing.counters.instanceBytes / 1048576).toFixed(2)} MiB)`,
    )
  }
  if (rates) {
    lines.push('', 'Engine in its worker, no rendering (headless Chromium)', '  speed   achieved sim s/wall s   engine advance sim s/wall s')
    for (const r of rates) lines.push(`  x${String(r.speed).padEnd(6)}${r.achieved.toFixed(0).padStart(14)}${r.engine.toFixed(0).padStart(26)}`)
  }
  return lines.join('\n')
}

export async function baselineMain(argv: string[], print: (line: string) => void = console.log): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        preset: { type: 'string', default: 'TTI Algeciras baseline' },
        'sim-time': { type: 'string', default: '14400' },
        frames: { type: 'string', default: '30' },
        'skip-rate': { type: 'boolean', default: false },
        'skip-posing': { type: 'boolean', default: false },
        out: { type: 'string' },
      },
    }))
  } catch (err) {
    print(`Error: ${(err as Error).message}`)
    return 2
  }
  const preset = values.preset as string
  const make = presets[preset]
  if (!make) {
    print(`Error: unknown preset "${preset}"`)
    return 2
  }
  const simTime = Number(values['sim-time'])
  const frames = Number(values.frames)
  let status = 0
  let posing: (PosingTiming & { simTime: number; boxes: number }) | null = null
  if (!values['skip-posing']) {
    const config = make()
    const run = await startHeadlessRun(config)
    await run.runTo(simTime)
    const renderer = makeHeadlessRenderer(run.model)
    posing = { ...timePosing(renderer, overviewView(run.model), simTime, frames), simTime, boxes: run.model.containerIds.length }
    renderer.dispose()
  }
  let rates: RateRow[] | null = null
  if (!values['skip-rate']) {
    const file = join(mkdtempSync(join(tmpdir(), 'tt-baseline-')), 'rate.json')
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@playwright/test/cli')), 'test', '--project=dev', '--grep', '@baseline'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, TT_BASELINE_OUT: file, TT_BASELINE_PRESET: preset },
    })
    if (child.status === 0) rates = (JSON.parse(readFileSync(file, 'utf8')) as { rows: RateRow[] }).rows
    else {
      print(`Error: the browser rate run failed (exit ${child.status})`)
      status = 1
    }
  }
  const env = `${new Date().toISOString().slice(0, 10)}, node ${process.version}, ${cpus()[0]?.model ?? 'cpu'} x${cpus().length}, load ${loadavg()[0].toFixed(2)}`
  print(formatReport(preset, posing, rates, env))
  if (values.out) writeFileSync(values.out, `${JSON.stringify({ preset, engineVersion: ENGINE_VERSION, env, posing, rates }, null, 2)}\n`)
  return status
}
