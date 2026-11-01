import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { createLazyComponent } from '../modules/lazyComponent'

const Comp = defineComponent({ render: () => null })

describe('createLazyComponent', () => {
  it('starts loading and becomes ready with the component', async () => {
    const lazy = createLazyComponent(async () => ({ default: Comp }))
    expect(lazy.state.value).toBe('loading')
    await lazy.load()
    expect(lazy.state.value).toBe('ready')
    expect(lazy.component.value).toBe(Comp)
  })

  it('shows the error when the chunk fails to load and recovers on retry', async () => {
    let fail = true
    const lazy = createLazyComponent(async () => {
      if (fail) throw new Error('Failed to fetch dynamically imported module')
      return { default: Comp }
    })
    await lazy.load()
    expect(lazy.state.value).toBe('error')
    expect(lazy.error.value).toContain('Failed to fetch')
    expect(lazy.component.value).toBeNull()
    fail = false
    const retry = lazy.load()
    expect(lazy.state.value).toBe('loading')
    expect(lazy.error.value).toBe('')
    await retry
    expect(lazy.state.value).toBe('ready')
  })

  it('lets the newest attempt win when a retry overlaps a slow earlier load', async () => {
    let release: () => void = () => {}
    let calls = 0
    const lazy = createLazyComponent(() => {
      calls++
      if (calls === 1) {
        return new Promise((_, reject) => {
          release = () => reject(new Error('late'))
        })
      }
      return Promise.resolve({ default: Comp })
    })
    const first = lazy.load()
    await lazy.load()
    release()
    await first
    expect(lazy.state.value).toBe('ready')
    expect(lazy.error.value).toBe('')
  })
})
