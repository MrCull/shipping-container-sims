import { describe, expect, it } from 'vitest'
import { speakerIcon, speakerLabel, isSilent, litLevelBars } from './audioControl'

describe('audio control presentation', () => {
  it('is silent when muted or at volume 0', () => {
    expect(isSilent(true, 0.5)).toBe(true)
    expect(isSilent(false, 0)).toBe(true)
    expect(isSilent(false, 0.1)).toBe(false)
  })

  it('picks the icon from silence and level', () => {
    expect(speakerIcon(true, 0.9)).toBe('🔇')
    expect(speakerIcon(false, 0.2)).toBe('🔉')
    expect(speakerIcon(false, 0.8)).toBe('🔊')
  })

  it('labels the speaker with the action a click performs', () => {
    expect(speakerLabel(true)).toBe('Unmute all')
    expect(speakerLabel(false)).toBe('Mute all')
  })

  it('lights level bars in proportion to the volume, none when silent, at least one when audible', () => {
    expect(litLevelBars(false, 1)).toBe(4)
    expect(litLevelBars(false, 0.4)).toBe(2)
    expect(litLevelBars(false, 0.01)).toBe(1)
    expect(litLevelBars(false, 0)).toBe(0)
    expect(litLevelBars(true, 0.9)).toBe(0)
  })
})
