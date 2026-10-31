/** #138: twelve speed steps for long runs, and no keyboard key changes speed. */
import { describe, expect, it } from 'vitest'
import { SPEEDS } from '../modules/twinController'
import { shortcutFor, SHORTCUT_HELP, type KeyLike } from '../modules/shortcuts'

const press = (key: string): KeyLike => ({ key, ctrlKey: false, metaKey: false, altKey: false, target: null })

describe('speed steps', () => {
  it('lists x1 to x3600 in twelve steps', () => {
    expect([...SPEEDS]).toEqual([1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600])
  })

  it('has no keyboard binding that changes speed', () => {
    for (const d of '123456789') expect(shortcutFor(press(d))).toBeNull()
    expect(shortcutFor(press('0'))).toEqual({ kind: 'pause' })
    expect(shortcutFor(press(' '))).toEqual({ kind: 'togglePause' })
    expect(shortcutFor(press('.'))).toEqual({ kind: 'step' })
  })

  it('does not list speed keys in the help', () => {
    expect(SHORTCUT_HELP.some((r) => String(r.action).toLowerCase().includes('speed'))).toBe(false)
    expect(SHORTCUT_HELP.some((r) => String(r.keys).includes('digits'))).toBe(false)
  })
})
