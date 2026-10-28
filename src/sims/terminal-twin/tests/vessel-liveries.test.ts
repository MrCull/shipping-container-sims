import { describe, expect, it } from 'vitest'
import { SHIPPING_LINES } from '../scenario/lines'
import { generateVessels } from '../scenario/vesselGenerator'
import { lineFromVesselName, vesselLine, vesselName } from '../scenario/vesselNames'

/** Each line's naming style [A], as in the spec ("HMM Tarifa"). Independent of the generator's tables. */
const STYLE: Record<string, RegExp> = {
  HMM: /^HMM [A-Z][a-z]+/,
  MSC: /^MSC [A-Z][a-z]+/,
  Maersk: /^[A-Z][a-z]+ Maersk$/,
  'CMA CGM': /^CMA CGM [A-Z]/,
  'Hapag-Lloyd': /^[A-Z][a-z]+ Express$/,
  ONE: /^ONE [A-Z][a-z]+$/,
  Evergreen: /^Ever [A-Z][a-z]+$/,
  COSCO: /^COSCO Shipping [A-Z][a-z]+$/,
  ZIM: /^ZIM [A-Z][a-z]+$/,
  'Yang Ming': /^YM [A-Z][a-z]+$/,
}

describe('vessel lines and names', () => {
  it('names a vessel in its line’s style, deterministically per random draw', () => {
    for (const line of SHIPPING_LINES) {
      for (const r of [0, 0.37, 0.999]) {
        const name = vesselName(line, () => r)
        expect(name, line).toMatch(STYLE[line])
        expect(lineFromVesselName(name), name).toBe(line)
      }
    }
  })

  it('reads the line from known real-style names, and none from a generic one', () => {
    expect(lineFromVesselName('HMM Tarifa')).toBe('HMM')
    expect(lineFromVesselName('Madrid Maersk')).toBe('Maersk')
    expect(lineFromVesselName('Maersk Alboran')).toBe('Maersk')
    expect(lineFromVesselName('Berlin Express')).toBe('Hapag-Lloyd')
    expect(lineFromVesselName('Ever Given')).toBe('Evergreen')
    expect(lineFromVesselName('YM Wellness')).toBe('Yang Ming')
    expect(lineFromVesselName('CMA CGM Gibraltar')).toBe('CMA CGM')
    expect(lineFromVesselName('Tracer Express')).toBe('Hapag-Lloyd')
    expect(lineFromVesselName('Twin Feeder')).toBeUndefined()
  })

  it('an explicit line in the scenario wins over the name', () => {
    expect(vesselLine({ name: 'Twin Feeder', line: 'ONE' })).toBe('ONE')
    expect(vesselLine({ name: 'HMM Tarifa' })).toBe('HMM')
    expect(vesselLine({ name: 'Twin Feeder' })).toBeUndefined()
    expect(vesselLine({ name: 'HMM Tarifa', line: 'Nope' })).toBe('HMM')
  })

  it('the generator gives every vessel a line and a name in that line’s style', () => {
    const vessels = generateVessels({ count: 40, startS: 0, intervalS: 3600, sizeMix: { feeder: 1, ulcv: 1 }, jitterS: 0, seed: 7 })
    const lines = new Set<string>()
    for (const v of vessels) {
      expect(v.line).toBeDefined()
      expect(v.name).toMatch(STYLE[v.line!])
      expect(vesselLine(v)).toBe(v.line)
      lines.add(v.line!)
    }
    expect(lines.size).toBeGreaterThan(4)
  })
})
