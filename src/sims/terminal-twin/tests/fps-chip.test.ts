import { describe, expect, it } from 'vitest'
import { fpsSeverity } from '../modules/fpsChip'

describe('FPS chip colour', () => {
  it('is normal at 30 fps and above', () => {
    expect(fpsSeverity(60)).toBe('ok')
    expect(fpsSeverity(30)).toBe('ok')
  })

  it('is amber below 30 down to 20', () => {
    expect(fpsSeverity(29.9)).toBe('warn')
    expect(fpsSeverity(20)).toBe('warn')
  })

  it('is red below 20', () => {
    expect(fpsSeverity(19.9)).toBe('bad')
    expect(fpsSeverity(3)).toBe('bad')
  })

  it('is neutral before the first measurement (0 fps)', () => {
    expect(fpsSeverity(0)).toBe('idle')
  })
})
