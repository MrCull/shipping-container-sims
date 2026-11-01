/**
 * #160: SHC parking spots lie on land, inside the terminal apron, for any SHC count (never in the sea west of the
 * quay). Checked through the lane graph against the land the scene draws: the shared apron (`sceneRenderer.addGround`,
 * 600 m either side of the quay, 900 m deep) and, for the TTI presets, the sea channel north of the terminal
 * (`TTI_GROUND`).
 */
import { describe, expect, it } from 'vitest'
import { buildLaneGraph, shortestPath, type LaneGraph } from '../engine'
import { sceneryFor } from '../modules/backdrop'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { withShcFleet } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'
import { TTI_GROUND } from '../terminals/tti-algeciras/constants'

/** The painted parking bay (`sceneRenderer`): 13.6 m along the spur an SHC drives in on, 3.6 m across. */
const BAY_LENGTH_M = 13.6
const BAY_WIDTH_M = 3.6
/** Apron of the generic ground: from 600 m north of the quay's start to 600 m past its end, 900 m deep. */
const APRON_MARGIN_M = 600
const APRON_DEPTH_M = 900

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** The footprint of every parking bay, oriented along the spur that leads into it. */
function bays(graph: LaneGraph): Record<string, Rect> {
  const out: Record<string, Rect> = {}
  for (const [shcId, id] of Object.entries(graph.parkingNode)) {
    const n = graph.nodes[id]
    const spur = graph.edges.find((e) => e.to === id)!
    const [dx, dz] = spur.axis === 'x' ? [BAY_LENGTH_M / 2, BAY_WIDTH_M / 2] : [BAY_WIDTH_M / 2, BAY_LENGTH_M / 2]
    out[shcId] = { x0: n.x - dx, x1: n.x + dx, z0: n.z - dz, z1: n.z + dz }
  }
  return out
}

/** The land of a scenario's scene, as a rectangle (x along the quay, z landward from the quay line). */
function land(name: string, config: ScenarioConfig): Rect {
  const L = config.quay.lengthM
  const west = sceneryFor(name).kind === 'tti' ? -TTI_GROUND.northQuayEdgeM : -APRON_MARGIN_M
  return { x0: west, x1: L + APRON_MARGIN_M, z0: 0, z1: APRON_DEPTH_M }
}

const inside = (r: Rect, outer: Rect) => r.x0 >= outer.x0 && r.x1 <= outer.x1 && r.z0 >= outer.z0 && r.z1 <= outer.z1
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1

const withShcs = Object.entries({ ...presets, ...Object.fromEntries(Object.entries(fixtures).map(([k, v]) => [k, () => v])) })
  .map(([name, make]) => [name, make()] as const)
  .filter(([, config]) => (config.shcs ?? []).length > 0)

describe('SHC parking on land (#160)', () => {
  it('covers the TTI presets and the SHC fixtures', () => {
    const names = withShcs.map(([n]) => n)
    expect(names).toContain('TTI Algeciras baseline')
    expect(names).toContain('TTI Algeciras, peak day')
    expect(names.length).toBeGreaterThan(5)
  })

  it.each(withShcs)('%s: every parking bay lies on land, one per SHC, no two overlapping', (name, config) => {
    const graph = buildLaneGraph(config)
    const all = bays(graph)
    expect(Object.keys(all).sort()).toEqual(config.shcs!.map((s) => s.id).sort())
    const ground = land(name, config)
    const outside = Object.entries(all).filter(([, r]) => !inside(r, ground))
    expect(outside.map(([id, r]) => `${id} ${JSON.stringify(r)}`)).toEqual([])
    const list = Object.values(all)
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i], list[j])).toBe(false)
  })

  it.each([1, 23, 40, 120])('%i SHCs on the TTI layout all park on land, clear of the apron lanes, pads and queue spots', (count) => {
    const name = 'TTI Algeciras baseline'
    const config = withShcFleet(presets[name](), count)
    const graph = buildLaneGraph(config)
    const ground = land(name, config)
    const { eastboundZ } = graph.layout
    const others: Rect[] = [
      ...graph.pads.map((p) => ({ x0: p.x - 1.6, x1: p.x + 1.6, z0: p.z - 6.5, z1: p.z + 6.5 })),
      ...graph.queueAreas.flatMap((a) => a.nodes.map((id) => graph.nodes[id])).map((n) => ({ x0: n.x - 1.8, x1: n.x + 1.8, z0: n.z - 6.8, z1: n.z + 6.8 })),
    ]
    for (const r of Object.values(bays(graph))) {
      expect(inside(r, ground)).toBe(true)
      expect(r.z0).toBeGreaterThan(eastboundZ + 2)
      for (const o of others) expect(overlaps(r, o)).toBe(false)
    }
  })

  it('every SHC can drive from its parking spot to the STS lanes and back', () => {
    const config = presets['TTI Algeciras, peak day']()
    const graph = buildLaneGraph(config)
    const lane = graph.laneNodes[0]
    for (const id of Object.values(graph.parkingNode)) {
      expect(shortestPath(graph, id, lane[0])).not.toBeNull()
      expect(shortestPath(graph, lane[lane.length - 1], id)).not.toBeNull()
    }
  })
})
