/**
 * Light or dark skin of the sim's UI (the 3D scene is not affected). The choice is remembered in localStorage (a
 * per-viewer convenience: every access is guarded, so a blocked storage just forgets) and applied as
 * `data-tt-theme` on `<html>` while the sim is mounted, where `skin.css` reads it. Dark is the default.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type Theme = 'dark' | 'light'
export const THEMES: readonly Theme[] = ['dark', 'light']
export const DEFAULT_THEME: Theme = 'dark'
export const THEME_STORAGE_KEY = 'terminal-twin.theme'

/** The stored value as a theme; anything else (nothing stored, an old value) is the default. */
export function parseTheme(raw: string | null): Theme {
  return raw === 'light' || raw === 'dark' ? raw : DEFAULT_THEME
}

function read(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

function write(value: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value)
  } catch {
    /* storage blocked: the choice just does not persist */
  }
}

/** Puts the theme on `<html>` (the FPS chip and the volume popover live outside the sim's root element). */
export function applyTheme(theme: Theme | null): void {
  if (typeof document === 'undefined') return
  if (theme) document.documentElement.dataset.ttTheme = theme
  else delete document.documentElement.dataset.ttTheme
}

export const useThemeStore = defineStore('terminal-twin-theme', () => {
  const theme = ref<Theme>(parseTheme(read()))

  function set(next: Theme): void {
    theme.value = next
    write(next)
    applyTheme(next)
  }

  function toggle(): void {
    set(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, set, toggle }
})
