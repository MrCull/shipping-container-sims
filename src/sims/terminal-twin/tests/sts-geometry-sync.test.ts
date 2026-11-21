/**
 * #297 review: one source per STS dimension. The engine keeps its own rail and class geometry (it never imports the
 * renderer or the sidecars); these tests pin the renderer and the GLB sidecars equal to it. Also: raised-boom bounds use
 * the crane class (#303), and a non-zero working angle works end to end (no "0 means working" left).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, STS_RAIL_GAUGE_M, STS_WATER_RAIL_Z, stsBoom, type EventOf } from '../engine'
import malaccamaxMeta from '../assets/models/sts/sts-malaccamax.meta.json'
import sppMeta from '../assets/models/sts/sts-super-post-panamax.meta.json'
import { STS, stsBoundsYZ, stsClassBoom } from '../modules/equipmentDims'
import { describeEntity } from '../modules/entityInspector'
import { fixtures } from '../scenario/fixtures'
import { DEFAULT_STS_BOOM, STS_CRANE_CLASSES } from '../scenario/types'

const SIDECARS = { malaccamax: malaccamaxMeta, 'super-post-panamax': sppMeta } as const

describe('STS geometry: engine, renderer and sidecars agree', () => {
  it('rail Z and gauge', () => {
    expect(STS.waterRailZ).toBe(STS_WATER_RAIL_Z)
    expect(STS.gauge).toBe(STS_RAIL_GAUGE_M)
    for (const meta of Object.values(SIDECARS)) {
      expect(meta.sceneMounting.waterRailZ).toBe(STS_WATER_RAIL_Z)
      expect(meta.geometry.railGaugeM.value).toBe(STS_RAIL_GAUGE_M)
    }
  })

  it('class lift, outreach, backreach and boom underside', () => {
    for (const [craneClass, meta] of Object.entries(SIDECARS)) {
      const spec = STS_CRANE_CLASSES[craneClass as keyof typeof SIDECARS]
      expect(spec.liftHeightM).toBe(meta.geometry.liftHeightAboveRailM.value)
      expect(spec.outreachM).toBe(meta.geometry.outreachM.value)
      expect(spec.backreachM).toBe(meta.geometry.backreachM.value)
      expect(spec.boomUndersideM).toBe(meta.geometry.boomUndersideM.value)
    }
    expect(DEFAULT_STS_BOOM.undersideM).toBe(STS_CRANE_CLASSES.malaccamax.boomUndersideM)
    expect(STS.boomHingeY).toBe(STS_CRANE_CLASSES.malaccamax.boomUndersideM)
    // the class apex offset equals the hinge offset (the whole crane is lower)
    expect(sppMeta.geometry.apexHeightM.value - malaccamaxMeta.geometry.apexHeightM.value).toBeCloseTo(stsClassBoom('super-post-panamax').dy, 6)
  })
})

describe('raised-boom bounds use the crane class (#303)', () => {
  it('Super Post-Panamax: shorter boom (65 m outreach) and lower hinge than the Malaccamax', () => {
    const m = stsClassBoom('malaccamax')
    const s = stsClassBoom('super-post-panamax')
    expect(m.tipZ).toBe(STS.boomOutreachZ) // Malaccamax gives the STS dims exactly
    expect(s.tipZ - m.tipZ).toBeCloseTo(3, 6) // 68 m against 65 m outreach
    const a = (80 * Math.PI) / 180
    const mb = stsBoundsYZ(80, 'malaccamax', 0)
    const sb = stsBoundsYZ(80, 'super-post-panamax', 0)
    expect(sb.y1).toBeCloseTo(46.6 + s.length * Math.sin(a) + 2, 6)
    expect(sb.z0).toBeCloseTo(STS.boomHingeZ - s.length * Math.cos(a) - 2, 6)
    expect(mb.y1 - sb.y1).toBeCloseTo(9 + 3 * Math.sin(a), 6)
  })

  it('a boom at a non-zero working angle stays out of the box; off it, the box grows', () => {
    const base = stsBoundsYZ(5, 'malaccamax', 5)
    expect(base.y1).toBeCloseTo(STS.apexY + 1.3, 6)
    expect(stsBoundsYZ(0, 'malaccamax', 5).z0).toBeLessThan(base.z0)
  })
})

describe('a non-zero configured working angle (#297 review)', () => {
  it('runs clean, lowers to the working angle and the inspector reads it as down', () => {
    const config = structuredClone(fixtures['boom-berthing'])
    config.kinematics.sts.boomWorkingDeg = 5
    expect(stsBoom(config).workingDeg).toBe(5)
    const sim = createSimulation(config)
    const lowered = sim.runUntil({ eventType: 'StsBoomCompleted' })
    expect(lowered.reason).toBe('condition')
    const done = sim.eventLog().at(-1) as EventOf<'StsBoomCompleted'>
    expect(done.payload.op).toBe('lower')
    expect(done.payload.boomDeg).toBe(5)
    const sts = sim.query.sts(done.payload.stsId)
    const fact = (now: number) => describeEntity('sts', sts, { now, boomWorkingDeg: 5 }).facts.find((f) => f.label === 'inspector.fact.boom')?.value
    expect(fact(done.t)).toBe('down')
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(fact(done.t)).toBe('down')
  })
})
