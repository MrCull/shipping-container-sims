/**
 * Which HUD groups are collapsed: the top bar's second row (actions and settings), the KPI strip over the scene and
 * the overlay bar under it. Each collapses to a small button so the 3D view gets the screen (phones especially);
 * the H key collapses or restores all three at once. Remembered in localStorage (a per-viewer convenience: every
 * access is guarded, so a blocked storage just forgets).
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type HudGroup = 'topBar' | 'kpis' | 'overlayBar'
export const HUD_GROUPS: readonly HudGroup[] = ['topBar', 'kpis', 'overlayBar']

const KEY = 'terminal-twin.hudCollapsed'

/** Below this window width (CSS px) everything starts collapsed until the viewer chooses otherwise. */
export const NARROW_SCREEN_PX = 720

/**
 * Parses the stored value. With nothing stored, a narrow screen (a phone) starts with every group collapsed so the 3D
 * view gets the screen, and a wide one with none; anything unreadable counts as nothing stored.
 */
export function parseCollapsed(raw: string | null, narrow = false): Record<HudGroup, boolean> {
  const out: Record<HudGroup, boolean> = { topBar: narrow, kpis: narrow, overlayBar: narrow }
  if (!raw) return out
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object') {
      for (const g of HUD_GROUPS) out[g] = (value as Record<string, unknown>)[g] === true
    } else {
      return parseCollapsed(null, narrow)
    }
  } catch {
    return parseCollapsed(null, narrow)
  }
  return out
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function write(value: string): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    /* storage blocked: the choice just does not persist */
  }
}

function isNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth < NARROW_SCREEN_PX
}

export const useHudStore = defineStore('terminal-twin-hud', () => {
  const collapsed = ref(parseCollapsed(read(), isNarrow()))
  watch(collapsed, (v) => write(JSON.stringify(v)), { deep: true })

  const allCollapsed = computed(() => HUD_GROUPS.every((g) => collapsed.value[g]))

  function toggle(group: HudGroup): void {
    collapsed.value[group] = !collapsed.value[group]
  }

  /** H: collapse every group, or restore all when they are already all collapsed. */
  function toggleAll(): void {
    const next = !allCollapsed.value
    for (const g of HUD_GROUPS) collapsed.value[g] = next
  }

  return { collapsed, allCollapsed, toggle, toggleAll }
})
