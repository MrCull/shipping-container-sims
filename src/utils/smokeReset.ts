/**
 * Smoke-test reset hooks (#329, spec #320), installed only in dev and smoke builds (see `main.ts`).
 *
 * A Playwright worker keeps one booted page and reuses it across tests (the Terminal Twin `twinTest` fixture). Between
 * tests it calls `window.__appReset()`: the router leaves for an empty route (the sim unmounts: worker, scene and dev
 * API go), then browser storage is cleared and every Pinia store is disposed with its state, so the next visit builds
 * fresh stores from empty storage, as a first page load would. `window.__appVisit(url)` then routes to the sim without
 * reloading the bundle. Not covered: IndexedDB (saves) and module-level state; specs that need those use a fresh page.
 */
import { nextTick } from 'vue'
import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'

export const RESET_PATH = '/__reset'

declare global {
  interface Window {
    /** Dev and smoke builds: unmount the current page and clear storage and stores (#329). */
    __appReset?: () => Promise<void>
    /** Dev and smoke builds: route to an app URL without a page load (#329). */
    __appVisit?: (url: string) => Promise<void>
  }
}

/** The parts of a Pinia instance the reset needs (`_s` is Pinia's store registry). */
interface PiniaInternals {
  _s: Map<string, { $dispose(): void }>
  state: { value: Record<string, unknown> }
}

export function installSmokeReset(router: Router, pinia: Pinia): void {
  router.addRoute({ path: RESET_PATH, name: 'smoke-reset', component: { render: () => null } })
  window.__appReset = async () => {
    await router.push(RESET_PATH)
    await nextTick()
    const internals = pinia as unknown as PiniaInternals
    for (const store of [...internals._s.values()]) store.$dispose()
    internals.state.value = {}
    localStorage.clear()
    sessionStorage.clear()
  }
  window.__appVisit = async (url: string) => {
    await router.push(url)
  }
}
