/** TT-15: validation of impossible and doubtful configurations, and the scale limits, through the engine API. */
import { describe, expect, it } from 'vitest'
import { createSimulation, validateScenario } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import { SCALE_LIMITS } from '../scenario/limits'
import type { ScenarioConfig } from '../scenario/types'
import { t } from '../i18n/messages'

const clone = (c: ScenarioConfig): ScenarioConfig => JSON.parse(JSON.stringify(c))
const base = () => clone(fixtures['asc-1sts-10-boxes-1block'])
const keys = (list: { key: string }[]) => list.map((m) => m.key)

function withBlocks(config: ScenarioConfig, n: number, quay: number): ScenarioConfig {
  const c = clone(config)
  c.quay.lengthM = quay
  c.yard!.blocks = Array.from({ length: n }, (_, i) => ({ id: `B${i + 1}`, x: 20 + i * 12, wtpPads: 2, bays: 4, tiers: 2 }))
  return c
}

describe('validateScenario', () => {
  it('accepts every committed fixture', () => {
    for (const [name, f] of Object.entries(fixtures)) expect({ name, errors: validateScenario(f).errors }).toEqual({ name, errors: [] })
  })

  it('errors when the blocks need more frontage than the quay has (16 blocks need 512 m; quay is 400 m)', () => {
    const check = validateScenario(withBlocks(base(), 16, 400))
    expect(keys(check.errors)).toContain('setup.check.frontage')
    const msg = check.errors.find((e) => e.key === 'setup.check.frontage')!
    expect(t(msg.key, msg.params)).toBe('16 blocks need 512 m of frontage; the quay is 400 m')
    expect(keys(validateScenario(withBlocks(base(), 12, 400)).errors)).not.toContain('setup.check.frontage')
  })

  it('warns, but does not error, for a vessel longer than the quay', () => {
    const c = base()
    c.quay.lengthM = 200
    c.vessels[0].sizeClass = 'ulcv'
    c.vessels[0].discharge = 10
    const check = validateScenario(c)
    expect(keys(check.warnings)).toContain('setup.check.tooLong')
    expect(keys(check.errors)).not.toContain('setup.check.tooLong')
  })

  it.each([
    ['quay length', (c: ScenarioConfig) => (c.quay.lengthM = 3001), 'setup.check.quayLength'],
    ['STS', (c: ScenarioConfig) => (c.sts = Array.from({ length: 25 }, (_, i) => ({ id: `S${i}`, gantryX: i, groundPositions: 1 }))), 'setup.check.stsCount'],
    ['blocks', (c: ScenarioConfig) => (c.yard = { blocks: Array.from({ length: 41 }, (_, i) => ({ id: `B${i}`, x: i, wtpPads: 1 })) }), 'setup.check.blocks'],
    ['bays', (c: ScenarioConfig) => (c.yard!.blocks[0].bays = 81), 'setup.check.block'],
    ['tiers', (c: ScenarioConfig) => (c.yard!.blocks[0].tiers = 7), 'setup.check.block'],
    ['SHC', (c: ScenarioConfig) => (c.shcs = Array.from({ length: 121 }, (_, i) => ({ id: `H${i}` }))), 'setup.check.shcCount'],
    ['vessels', (c: ScenarioConfig) => (c.vessels = Array.from({ length: 61 }, (_, i) => ({ ...c.vessels[0], id: `V${i}` }))), 'setup.check.tooManyVessels'],
  ])('error above the %s limit', (_name, edit, key) => {
    const c = base()
    edit(c)
    expect(keys(validateScenario(c).errors)).toContain(key)
  })

  it('limits trucks per hour to 600', () => {
    const c = clone(fixtures['landside-morning-peak'])
    c.landside!.hourlyProfile = c.landside!.hourlyProfile.map(() => SCALE_LIMITS.trucksPerHour + 1)
    expect(keys(validateScenario(c).errors)).toContain('setup.check.trucks')
  })

  it('warns above stress-test scale and still allows the run', () => {
    const c = withBlocks(base(), 30, 3000)
    const check = validateScenario(c)
    expect(keys(check.warnings)).toContain('setup.check.heavy')
    expect(check.errors).toEqual([])
  })

  it('createSimulation refuses a configuration with errors and names them', () => {
    const c = base()
    c.yard!.blocks[0].tiers = 9
    expect(() => createSimulation(c)).toThrow(/Invalid scenario/)
    expect(() => createSimulation(base())).not.toThrow()
  })

  it('needs the landside for the empty and warm-up yard starts', () => {
    const c = new ScenarioBuilder('x', 'y')
      .quay(400)
      .sts('S1', { gantryX: 100, groundPositions: 1 })
      .vesselCall('V1', { sizeClass: 'feeder', discharge: 5 })
      .shcs(1)
      .block('B1', { x: 50 })
      .yardStart({ mode: 'empty' })
      .build()
    expect(keys(validateScenario(c).errors)).toContain('setup.check.startNeedsLandside')
  })
})
