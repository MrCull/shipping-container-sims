/**
 * #184 exit chain: the outbound road is split into conflict zones of at most OUT_ROAD_SECTION_M, so trucks leaving
 * the yard follow each other in a pipeline instead of one truck holding the whole road (a 700 m single zone held 96 s
 * per truck capped the exit rate at about 37 trucks an hour, so finished trucks kept their stalls for hours and the
 * TTI peak day ended in yard.no-progress).
 */
import { describe, expect, it } from 'vitest'
import { buildLandsideGraph, OUT_ROAD_SECTION_M } from '../engine'
import { presets } from '../scenario/presets'
import { TTI_PRESET_NAME } from '../terminals/tti-algeciras/constants'

describe('outbound road zones', () => {
  const g = buildLandsideGraph(presets[TTI_PRESET_NAME]())
  const sections = g.edges.filter((e) => e.zone?.startsWith('ls:SO@'))

  it('has no outbound road section longer than OUT_ROAD_SECTION_M', () => {
    expect(sections.length).toBeGreaterThan(0)
    for (const e of sections) expect(e.lengthM, e.zone ?? '').toBeLessThanOrEqual(OUT_ROAD_SECTION_M + 1e-6)
  })

  it('is still one connected westbound road from the east end to the first out lane', () => {
    const start = g.nodes['ls:RO@' + g.gate.eastX]
    expect(start).toBeDefined()
    const out = g.outLanes[g.outLanes.length - 1]
    const total = sections.reduce((n, e) => n + e.lengthM, 0)
    expect(total).toBeGreaterThan(OUT_ROAD_SECTION_M)
    expect(out).toBeDefined()
  })
})
