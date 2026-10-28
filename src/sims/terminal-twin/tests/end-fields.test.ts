import { describe, expect, it } from 'vitest'
import { endConditionsFromFields, endFieldsOf } from '../modules/endConditions'

describe('setup dialog end-condition fields', () => {
  it('shows the scenario own conditions; no vessels value means "all scheduled"', () => {
    expect(endFieldsOf({})).toEqual({ vessels: '', hours: '', moves: '' })
    expect(endFieldsOf({ vesselsCompleted: 2, simDurationS: 5400, moves: 80 })).toEqual({ vessels: '2', hours: '1.5', moves: '80' })
  })

  it('defaults to all scheduled vessels and converts hours to seconds', () => {
    expect(endConditionsFromFields({ vessels: '', hours: '', moves: '' }, 3)).toEqual({ ok: true, value: { vesselsCompleted: 3 } })
    expect(endConditionsFromFields({ vessels: '2', hours: '12', moves: '500' }, 3)).toEqual({
      ok: true,
      value: { vesselsCompleted: 2, simDurationS: 43200, moves: 500 },
    })
  })

  it('rejects values that make no sense, naming the field', () => {
    expect(endConditionsFromFields({ vessels: '0', hours: '', moves: '' }, 3)).toEqual({ ok: false, error: 'setup.end.errorVessels' })
    expect(endConditionsFromFields({ vessels: '4', hours: '', moves: '' }, 3)).toEqual({ ok: false, error: 'setup.end.errorVessels' })
    expect(endConditionsFromFields({ vessels: '1.5', hours: '', moves: '' }, 3)).toEqual({ ok: false, error: 'setup.end.errorVessels' })
    expect(endConditionsFromFields({ vessels: '', hours: '-1', moves: '' }, 3)).toEqual({ ok: false, error: 'setup.end.errorHours' })
    expect(endConditionsFromFields({ vessels: '', hours: 'abc', moves: '' }, 3)).toEqual({ ok: false, error: 'setup.end.errorHours' })
    expect(endConditionsFromFields({ vessels: '', hours: '', moves: '2.5' }, 3)).toEqual({ ok: false, error: 'setup.end.errorMoves' })
  })

  it('with no vessels in the table only the other conditions can end the run', () => {
    expect(endConditionsFromFields({ vessels: '', hours: '1', moves: '' }, 0)).toEqual({ ok: true, value: { simDurationS: 3600 } })
  })
})
