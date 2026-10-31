import { describe, expect, it } from 'vitest'
import { speakerIcon, speakerLabel, isSilent } from './audioControl'

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
    expect(speakerLabel(true)).toBe('Unmute')
    expect(speakerLabel(false)).toBe('Mute')
  })
})
