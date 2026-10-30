import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeContainerState, makePlannedContainer } from '../scenario/containerFactory'
import { drawContainerProps } from '../scenario/containerProps'
import { fixtures } from '../scenario/fixtures'

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

describe('container factory (#107)', () => {
  it('no engine or scenario source builds a container literal by hand', () => {
    const offenders: string[] = []
    const hand = [/custodyHistory:\s*\[/, /:\s*(PlannedContainer|ContainerState)\s*=\s*\{/, /containers\.push\(\{/, /state\.containers\[[^\]]+\]\s*=\s*\{/]
    for (const file of [...sources(join(ROOT, 'engine')), ...sources(join(ROOT, 'scenario'))]) {
      if (file.endsWith('containerFactory.ts')) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (hand.some((re) => re.test(line))) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('keeps property order and optional fields stable', () => {
    const owner = { kind: 'truck' as const, id: 'T1' }
    const props = drawContainerProps(fixtures['tracer-1sts-10-boxes'], 1, { id: 'A', size: '20', full: true, line: 'MSK', reefer: true, direction: 'EXPORT', inbound: { kind: 'truck' }, arrivalS: 5 })
    const c = makeContainerState({ id: 'A', size: '20', full: true, line: 'MSK', vesselId: 'V', owner, t: 5, eventId: 3, truckClaim: 'T1', reefer: true, props })
    expect(Object.keys(c)).toEqual(['id', 'size', 'full', 'line', 'vesselId', 'custody', 'custodyHistory', 'reefer', 'truckClaim', 'props'])
    expect(c.custodyHistory[0]).toEqual({ t: 5, owner, eventId: 3 })
    expect(c.custodyHistory[0].owner).not.toBe(c.custody)
    const p = makePlannedContainer({ id: 'A', size: '40', full: false, line: 'MSK', vesselId: 'V', slotId: '', flow: 'pool', ageS: 0 })
    expect(Object.keys(p)).toEqual(['id', 'size', 'full', 'line', 'vesselId', 'slotId', 'flow', 'ageS'])
  })
})
