import { describe, expect, it } from 'vitest'
import { describeEndReason } from '../modules/endReason'
import { createFormatter } from '../i18n/format'

const fmt = createFormatter({ locale: 'en-GB', units: 'metric' })

describe('end reason text', () => {
  it('turns the engine reasons into friendly sentences', () => {
    expect(describeEndReason('moves >= 4', fmt)).toBe('Reached 4 container moves')
    expect(describeEndReason('simDurationS >= 5400', fmt)).toBe('Reached the sim duration of 1 h 30 min')
    expect(describeEndReason('vesselsCompleted >= 2', fmt)).toBe('2 vessels completed')
  })
  it('passes anything else through', () => {
    expect(describeEndReason('something else', fmt)).toBe('something else')
    expect(describeEndReason(null, fmt)).toBe('')
  })
})
