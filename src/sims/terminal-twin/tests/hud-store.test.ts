import { describe, expect, it } from 'vitest'
import { parseCollapsed } from '../store/hudStore'

describe('parseCollapsed', () => {
  it('starts with nothing collapsed on a wide screen and everything collapsed on a narrow one', () => {
    expect(parseCollapsed(null)).toEqual({ topBar: false, kpis: false, overlayBar: false })
    expect(parseCollapsed(null, true)).toEqual({ topBar: true, kpis: true, overlayBar: true })
  })

  it('keeps the viewer choice over the screen default', () => {
    expect(parseCollapsed('{"topBar":false,"kpis":true,"overlayBar":false}', true)).toEqual({ topBar: false, kpis: true, overlayBar: false })
  })

  it('treats a corrupt value as nothing stored', () => {
    expect(parseCollapsed('{oops', true)).toEqual({ topBar: true, kpis: true, overlayBar: true })
    expect(parseCollapsed('42')).toEqual({ topBar: false, kpis: false, overlayBar: false })
  })
})
