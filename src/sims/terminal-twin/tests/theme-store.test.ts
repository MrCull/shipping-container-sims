/**
 * Light or dark skin (store/themeStore.ts): the stored choice, the default, and the attribute `skin.css` reads.
 * The tests run in Node, so the two browser objects the store touches are stubbed.
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, DEFAULT_THEME, parseTheme, THEME_STORAGE_KEY, useThemeStore } from '../store/themeStore'

describe('theme store', () => {
  beforeEach(() => {
    const stored = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
      },
    })
    vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string> } })
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is light unless a valid choice is stored', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(parseTheme(null)).toBe('light')
    expect(parseTheme('sepia')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(useThemeStore().theme).toBe('light')
  })

  it('toggles, remembers the choice and puts it on <html>', () => {
    const themes = useThemeStore()
    themes.toggle()
    expect(themes.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.ttTheme).toBe('dark')
    themes.toggle()
    expect(themes.theme).toBe('light')
    expect(document.documentElement.dataset.ttTheme).toBe('light')
  })

  it('starts from the stored choice, and leaving the sim clears the attribute', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    setActivePinia(createPinia())
    expect(useThemeStore().theme).toBe('dark')
    applyTheme('dark')
    applyTheme(null)
    expect(document.documentElement.dataset.ttTheme).toBeUndefined()
  })
})
