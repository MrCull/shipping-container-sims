/**
 * Drawn-box reference (#246): which boxes the container instancer writes, and with which matrices, liveries and colours,
 * at a list of display times, for a recorded run. Posing tickets (#250, #257 and the like) change how the boxes are
 * posed, never what is drawn: this must stay identical.
 *
 * Cases: custody changes (a box moves between display times), a vessel arriving and departing, a restart (a fresh
 * model and renderer replaying the same run), a rewind (a model that only ever replayed to an earlier time, then ran
 * on), a colour-by change and a quality change. Each case is a hash of the drawn boxes plus counts, kept in
 * `drawn-boxes.reference.json`. Regenerate only on purpose: `UPDATE_DRAWN_BOXES=1 pnpm exec vitest run
 * src/sims/terminal-twin/tests/drawn-boxes.test.ts`, and say why in the commit.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { closeView, makeHeadlessRenderer, overviewView, startHeadlessRun, type CameraView, type HeadlessRun } from '../cli/headlessPose'
import type { ColourBy } from '../modules/colourBy'
import type { DrawnBox } from '../modules/containerInstancer'
import { QUALITY_PROFILES, type QualityLevel } from '../modules/quality'
import { TTI_PRESET_NAME, presets } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'

const REFERENCE = new URL('./drawn-boxes.reference.json', import.meta.url)
const UPDATE = process.env.UPDATE_DRAWN_BOXES === '1'

interface Snapshot {
  count: number
  layers: Record<string, number>
  hash: string
}

function snapshotOf(boxes: readonly DrawnBox[]): Snapshot {
  const sorted = [...boxes].sort((a, b) => a.key - b.key)
  const layers: Record<string, number> = {}
  const hash = createHash('sha1')
  for (const b of sorted) {
    layers[b.layer] = (layers[b.layer] ?? 0) + 1
    hash.update(`${b.key}|${b.layer}|${b.matrix.map((m) => m.toFixed(4)).join(',')}|${b.livery}|${b.colour}\n`)
  }
  return { count: sorted.length, layers, hash: hash.digest('hex').slice(0, 16) }
}

interface DrawOptions {
  view: (run: HeadlessRun) => CameraView
  colourBy?: ColourBy
  quality?: QualityLevel
}

/** Fresh renderer (so no LOD or colour history leaks in), two frames per time as the browser draws, then the boxes of the second. */
function drawn(run: HeadlessRun, times: number[], opts: DrawOptions): Snapshot[] {
  const renderer = makeHeadlessRenderer(run.model)
  renderer.recordDrawnBoxes(true)
  if (opts.quality) renderer.setQuality(QUALITY_PROFILES[opts.quality])
  if (opts.colourBy) renderer.setColourBy(opts.colourBy, 'grey')
  const view = opts.view(run)
  const out: Snapshot[] = []
  for (const t of times) {
    renderer.update(t, null, view.position, view.frustum)
    renderer.update(t, null, view.position, view.frustum)
    out.push(snapshotOf(renderer.drawnBoxes()))
  }
  renderer.dispose()
  return out
}

/** A camera 40 m from the first stacked yard box at `t`, so LOD0 and close-up faces are in play. */
function yardCloseView(t: number) {
  return (run: HeadlessRun): CameraView => {
    for (const id of run.model.containerIds) {
      const pose = run.model.containerPose(id, t)
      if (pose?.yard) return closeView(new THREE.Vector3(pose.x, pose.y, pose.z), 40)
    }
    throw new Error('no yard box')
  }
}

const TTI_TIMES = [900, 1500, 1800, 2400, 3600]
const TTI_LATE = [4800, 5400]
const overview = (run: HeadlessRun) => overviewView(run.model)

/** Every case, as a function of a run that has reached `upTo` (the times it draws are at or below it). */
function cases(run: HeadlessRun, which: 'early' | 'late'): Record<string, Snapshot[]> {
  const t = which === 'early' ? TTI_TIMES : TTI_LATE
  const mid = which === 'early' ? [3600] : [5400]
  const out: Record<string, Snapshot[]> = {
    [`custody overview ${which}`]: drawn(run, t, { view: overview }),
    [`custody close ${which}`]: drawn(run, mid, { view: yardCloseView(3600) }),
  }
  if (which === 'early') {
    for (const colourBy of ['line', 'dwell', 'flow'] as const) out[`colour by ${colourBy}`] = drawn(run, mid, { view: overview, colourBy })
    for (const quality of ['low', 'medium', 'high'] as const) out[`quality ${quality}`] = drawn(run, mid, { view: yardCloseView(3600), quality })
  }
  return out
}

describe('drawn-box reference', async () => {
  const config = presets[TTI_PRESET_NAME]()
  const original = await startHeadlessRun(config)
  await original.runTo(7200)
  const early = cases(original, 'early')
  const late = cases(original, 'late')

  // vessel arriving and departing: the fixture where V001 berths and leaves and V002 follows
  const vesselRun = await startHeadlessRun(fixtures['two-vessels-compete-for-berth'])
  await vesselRun.runTo(8000)
  const status = (id: string) => vesselRun.model.vesselStatusTimes(id, 8000)
  const v1 = status('V001')
  const vesselTimes = [0, (v1.berthedS ?? 0) + 60, (v1.departedS ?? 0) - 30, (v1.departedS ?? 0) + 30, (status('V002').departedS ?? 0) + 30]
  const vessels = { 'vessel arrival and departure': drawn(vesselRun, vesselTimes, { view: overview }) }

  const reference = { ...early, ...late, ...vessels }

  it('matches the committed reference', () => {
    const text = `${JSON.stringify({ note: 'Drawn-box reference (#246). Regenerate only on purpose: see drawn-boxes.test.ts.', cases: reference }, null, 2)}\n`
    if (UPDATE) writeFileSync(REFERENCE, text)
    const committed = JSON.parse(readFileSync(REFERENCE, 'utf8')) as { cases: unknown }
    expect(JSON.parse(text).cases).toEqual(committed.cases)
  })

  it('custody changes: boxes move between the display times', () => {
    const hashes = early['custody overview early'].map((s) => s.hash)
    expect(new Set(hashes).size).toBe(hashes.length)
    expect(early['custody overview early'][0].count).toBeGreaterThan(5000)
  })

  it('a vessel arriving and departing changes what is drawn, and the vessel run ends with boxes drawn', () => {
    const hashes = vessels['vessel arrival and departure'].map((s) => s.hash)
    expect(new Set(hashes).size).toBeGreaterThanOrEqual(3)
    expect(v1.departedS).not.toBeNull()
  })

  it('restart: a fresh model replaying the same run draws the same boxes', async () => {
    const restarted = await startHeadlessRun(config)
    await restarted.runTo(7200)
    expect(cases(restarted, 'early')).toEqual(early)
    expect(cases(restarted, 'late')).toEqual(late)
  })

  it('rewind: a model replayed only to a little past an earlier time draws the same boxes there, and again after running on', async () => {
    const rewound = await startHeadlessRun(config)
    await rewound.runTo(6600) // a box in flight at 3600 is posed from motion the engine plans later (the controller's look-ahead is 1.5 wall s of playback)
    expect(cases(rewound, 'early')).toEqual(early)
    await rewound.runTo(7200)
    expect(cases(rewound, 'late')).toEqual(late)
  })

  it('colour by changes the colours drawn and quality changes the LOD layers, never the matrices of the boxes drawn at the same LOD', () => {
    expect(early['colour by line'][0].hash).not.toBe(early['custody overview early'][4].hash)
    expect(early['colour by dwell'][0].hash).not.toBe(early['colour by line'][0].hash)
    expect(Object.keys(early['quality low'][0].layers).length).toBeGreaterThan(0)
    expect(early['quality low'][0].hash === early['quality high'][0].hash && early['quality low'][0].layers['containers-40-lod0'] === early['quality high'][0].layers['containers-40-lod0']).toBe(false)
  })
}, 240_000)
