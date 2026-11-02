/**
 * Terminal Twin keyboard shortcuts (window keydown while the sim is mounted).
 * Ignored while typing in a field, with Ctrl/Meta/Alt held, and while the
 * setup dialog is open. The shared useGodModeHotkey is not mounted by this
 * sim, so its "god" sequence never collides with D/O here.
 *
 * Esc is the exception: one ordered stack (modules/escape.ts, #169). It works in every phase, closes only the topmost
 * open thing per press, never pauses, steps or resets the run, and is ignored while typing unless the field is in a popup.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { cameraKeyFor, isTypingTarget, shortcutFor, type ShortcutAction } from '../modules/shortcuts'
import { escapeTarget, type EscapeState, type EscapeTarget } from '../modules/escape'
import { usePerfStore } from '../store/perfStore'
import { useTwinStore } from '../store/twinStore'

/** A key event from inside a popup (Colour by, Run to): Esc there closes the popup even while its own field has focus. */
function isInPopup(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && target.closest('[data-tt-popup]') !== null
}

export function useTwinShortcuts(): void {
  const store = useTwinStore()
  const perf = usePerfStore()

  function perform(action: ShortcutAction): void {
    switch (action.kind) {
      case 'togglePause':
        store.togglePause()
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

  /** The store state the Esc stack reads (what is open now, in the order the stack checks it). */
  function escapeState(): EscapeState {
    return {
      phase: store.phase,
      hasScenario: store.hasScenario,
      loading: store.loading,
      savesOpen: store.savesOpen,
      dashboardOpen: store.dashboardOpen,
      colourByOpen: store.colourByOpen,
      runToOpen: store.runToOpen,
      helpOpen: store.helpOpen,
      bayViewerOpen: store.bayViewerVesselId !== null,
      inspectorOpen: store.inspectorOpen,
      selected: store.selectedId !== null,
    }
  }

  function closeEscapeTarget(target: EscapeTarget): void {
    switch (target) {
      case 'setup':
        store.cancelSetup()
        break
      case 'saves':
        store.closeSaves()
        break
      case 'dashboard':
        store.toggleDashboard()
        break
      case 'colourBy':
        store.setColourByOpen(false)
        break
      case 'runTo':
        store.setRunToOpen(false)
        break
      case 'help':
        store.setHelpOpen(false)
        break
      case 'bayViewer':
        store.closeBayViewer()
        break
      case 'inspector':
        store.toggleInspector()
        break
      case 'selection':
        store.select(null)
        break
    }
  }

  function onEscape(event: KeyboardEvent): void {
    // Key repeat would close the whole stack in one hold: one press, one close.
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target) && !isInPopup(event.target)) return
    const target = escapeTarget(escapeState())
    if (!target) return
    event.preventDefault()
    closeEscapeTarget(target)
  }

  function onKeydown(event: KeyboardEvent): void {
    store.cameraKeys.shift = event.shiftKey // pressing Shift with a key already held switches pan to orbit
    if (event.key === 'Escape' || event.key === 'Esc') {
      onEscape(event)
      return
    }
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
