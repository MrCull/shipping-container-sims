/**
 * Dev and smoke-build browser API: `window.__ys`, for Playwright smoke tests and agents. Yardshift.vue imports this
 * module dynamically only when `import.meta.env.DEV || import.meta.env.MODE === 'smoke'`, so production builds
 * contain none of it.
 *
 *   __ys.loadLevel(1); __ys.applyActions([{ type: 'collect' }]); __ys.state()
 *   __ys.hitRegions()   // tap targets in client (page) coordinates, for real taps in smoke tests
 */
import type { useYardshiftStore } from '../store/yardshiftStore'
import type { ShiftAction, ShiftState } from '../types/engine'
import type { HitRegion } from '../types/presentation'

export interface YardshiftDevApi {
  loadLevel(n: number): void
  /** Dispatches each action in order; returns the rejection message of the first illegal one, or null. */
  applyActions(actions: ShiftAction[]): string | null
  state(): ShiftState
  hitRegions(): HitRegion[]
}

declare global {
  interface Window {
    __ys?: YardshiftDevApi
  }
}

export function installDevApi(
  store: ReturnType<typeof useYardshiftStore>,
  surface: () => HTMLElement | null,
): () => void {
  const api: YardshiftDevApi = {
    loadLevel: (n) => store.loadLevel(n),
    applyActions(actions) {
      for (const a of actions) {
        const r = store.dispatch(a)
        if (!r.ok) return r.rejection.message
      }
      return null
    },
    state: () => JSON.parse(JSON.stringify(store.state)) as ShiftState,
    hitRegions() {
      const box = surface()?.getBoundingClientRect()
      const dx = box?.left ?? 0
      const dy = box?.top ?? 0
      return store.view.hitRegions.map((r) => ({ ...r, rect: { ...r.rect, x: r.rect.x + dx, y: r.rect.y + dy } }))
    },
  }
  window.__ys = api
  return () => {
    if (window.__ys === api) delete window.__ys
  }
}
