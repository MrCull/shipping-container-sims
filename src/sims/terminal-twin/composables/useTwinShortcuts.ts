/**
 * Terminal Twin keyboard shortcuts (window keydown while the sim is mounted).
 * Ignored while typing in a field, with Ctrl/Meta/Alt held, and while the
 * setup dialog is open. The shared useGodModeHotkey is not mounted by this
 * sim, so its "god" sequence never collides with D/O here.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { shortcutFor, type ShortcutAction } from '../modules/shortcuts'
import { usePerfStore } from '../store/perfStore'
import { useTwinStore } from '../store/twinStore'

export function useTwinShortcuts(): void {
  const store = useTwinStore()
  const perf = usePerfStore()

  function perform(action: ShortcutAction): void {
    switch (action.kind) {
      case 'togglePause':
        store.togglePause()
        break
      case 'speedStep':
        store.setSpeedStep(action.index)
        break
      case 'pause':
        store.pause()
        break
      case 'step':
        if (!store.busy) store.step().catch(() => {})
        break
      case 'follow':
        store.toggleFollow()
        break
      case 'escape':
        if (store.helpOpen) store.setHelpOpen(false)
        else store.select(null)
        break
      case 'dashboard':
        store.toggleDashboard()
        break
      case 'overlays':
        store.toggleOverlays()
        break
      case 'feed':
        store.toggleFeed()
        break
      case 'inspector':
        store.toggleInspector()
        break
      case 'perf':
        perf.toggleOverlay()
        break
      case 'view':
        store.setViewPreset(action.preset)
        break
      case 'help':
        store.setHelpOpen(!store.helpOpen)
        break
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (store.phase !== 'running' || !store.hasScenario) return
    const action = shortcutFor(event)
    if (!action) return
    // Space would otherwise also click a focused button or scroll the page.
    event.preventDefault()
    perform(action)
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
