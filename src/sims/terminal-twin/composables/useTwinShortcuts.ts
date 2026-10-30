/**
 * Terminal Twin keyboard shortcuts (window keydown while the sim is mounted).
 * Ignored while typing in a field, with Ctrl/Meta/Alt held, and while the
 * setup dialog is open. The shared useGodModeHotkey is not mounted by this
 * sim, so its "god" sequence never collides with D/O here.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { cameraKeyFor, shortcutFor, type ShortcutAction } from '../modules/shortcuts'
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
      case 'followNextTruck':
        store.followNextTruck()
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
    store.cameraKeys.shift = event.shiftKey // pressing Shift with a key already held switches pan to orbit
    if (store.phase !== 'running' || !store.hasScenario) return
    // Camera keys are held state (moved each frame by the scene loop), not key repeat.
    const cameraKey = cameraKeyFor(event)
    if (cameraKey) {
      event.preventDefault() // arrows would scroll the page
      if (!event.repeat) {
        store.cameraKeys.held.add(cameraKey)
        store.releaseFollow()
      }
      return
    }
    const action = shortcutFor(event)
    if (!action) return
    // Space would otherwise also click a focused button or scroll the page.
    event.preventDefault()
    perform(action)
  }

  function onKeyup(event: KeyboardEvent): void {
    store.cameraKeys.shift = event.shiftKey
    // Releasing Shift first turns 'W' into 'w' (and '+' into '='), so match on the camera key, not the character.
    const cameraKey = cameraKeyFor({ key: event.key, ctrlKey: false, metaKey: false, altKey: false, target: null })
    if (cameraKey) store.cameraKeys.held.delete(cameraKey)
  }

  /** Focus left the page or a field took the keys: no key may stay stuck down. */
  function releaseCameraKeys(): void {
    store.cameraKeys.held.clear()
    store.cameraKeys.shift = false
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('keyup', onKeyup)
    window.addEventListener('blur', releaseCameraKeys)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('keyup', onKeyup)
    window.removeEventListener('blur', releaseCameraKeys)
    releaseCameraKeys()
  })
}
