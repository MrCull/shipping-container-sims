import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { JEV_CONFIG } from '../modules/jev/jevConfig'
import { clearApiKey, hasApiKey, setApiKey } from '../modules/jev/jevKeyVault'
import type { JevControllerStatus, JevErrorKind, JevMoveCommand, JevMoveKind } from '../types/jev'

interface JevPrefs {
  enabled: boolean
  showInspector: boolean
  settleDelayMs: number
  minConfidenceToAutoplay: number | null
}

function defaultPrefs(): JevPrefs {
  return {
    enabled: false,
    showInspector: false,
    settleDelayMs: JEV_CONFIG.defaultSettleDelayMs,
    minConfidenceToAutoplay: null,
  }
}

/** Loads persisted Jev prefs from localStorage. NEVER stores or reads the API key here. */
function loadPrefs(): JevPrefs {
  const fallback = defaultPrefs()
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(JEV_CONFIG.prefsStorageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<JevPrefs>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
      showInspector: typeof parsed.showInspector === 'boolean' ? parsed.showInspector : fallback.showInspector,
      settleDelayMs: typeof parsed.settleDelayMs === 'number' ? parsed.settleDelayMs : fallback.settleDelayMs,
      minConfidenceToAutoplay:
        typeof parsed.minConfidenceToAutoplay === 'number'
          ? parsed.minConfidenceToAutoplay
          : fallback.minConfidenceToAutoplay,
    }
  } catch {
    return fallback
  }
}

export const useJevStore = defineStore('stowage-master-jev', () => {
  const initialPrefs = loadPrefs()

  // --- Persisted prefs (localStorage key JEV_CONFIG.prefsStorageKey). NEVER the API key. ---
  const enabled = ref(initialPrefs.enabled)
  const showInspector = ref(initialPrefs.showInspector)
  const settleDelayMs = ref(initialPrefs.settleDelayMs)
  const minConfidenceToAutoplay = ref<number | null>(initialPrefs.minConfidenceToAutoplay) // null = off

  // --- Session state (not persisted) ---
  const hasKey = ref(hasApiKey()) // boolean mirror of the vault — the key itself never lands here
  const keyLimitRemaining = ref<number | null>(null)
  const status = ref<JevControllerStatus>('idle')
  const autoPlay = ref(false)
  const lastError = ref<{ kind: JevErrorKind; message: string } | null>(null)
  const movesByJevThisLevel = ref(0)
  const sessionCostUsd = ref(0)
  const isKeyDialogOpen = ref(false)

  // --- Command channel (plan 03): plain-data commands from the Jev controller to GameCanvas. ---
  // GameCanvas owns the Three.js scene and must never be reached through Pinia directly, so the
  // controller issues a command here and GameCanvas watches `pendingCommand` and executes it via
  // the same store actions a mouse click uses.
  let nextCommandId = 1
  const pendingCommand = ref<JevMoveCommand | null>(null)
  const lastCommandResult = ref<{ id: number; accepted: boolean } | null>(null)

  const isBusy = computed(
    () =>
      autoPlay.value ||
      status.value === 'requesting' ||
      status.value === 'executing' ||
      status.value === 'settling',
  )

  function persistPrefs(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const prefs: JevPrefs = {
        enabled: enabled.value,
        showInspector: showInspector.value,
        settleDelayMs: settleDelayMs.value,
        minConfidenceToAutoplay: minConfidenceToAutoplay.value,
      }
      localStorage.setItem(JEV_CONFIG.prefsStorageKey, JSON.stringify(prefs))
    } catch {
      // Ignore storage failures (private browsing, quota, disabled storage, etc.)
    }
  }

  function setShowInspector(value: boolean): void {
    showInspector.value = value
    persistPrefs()
  }

  function setSettleDelayMs(value: number): void {
    settleDelayMs.value = value
    persistPrefs()
  }

  function setMinConfidenceToAutoplay(value: number | null): void {
    minConfidenceToAutoplay.value = value
    persistPrefs()
  }

  function openKeyDialog(): void {
    isKeyDialogOpen.value = true
  }

  function closeKeyDialog(): void {
    isKeyDialogOpen.value = false
  }

  /**
   * Stores an already-validated key in the in-memory vault and updates the store's boolean
   * mirror. Callers must have already called `validateApiKey()` (jevClient.ts) successfully —
   * this function does not itself validate the key.
   */
  function setKey(key: string, limitRemaining: number | null): void {
    setApiKey(key)
    hasKey.value = hasApiKey()
    keyLimitRemaining.value = limitRemaining
    lastError.value = null
  }

  function forgetKey(): void {
    clearApiKey()
    hasKey.value = false
    keyLimitRemaining.value = null
  }

  function enable(): void {
    enabled.value = true
    persistPrefs()
  }

  /**
   * Stops auto-play, forgets the key and disables Jev. Aborting any in-flight request is the
   * controller's responsibility (plan 04's `useJevController`) — this store has no request
   * in flight to cancel on its own.
   */
  function disable(): void {
    autoPlay.value = false
    status.value = 'idle'
    forgetKey()
    enabled.value = false
    persistPrefs()
  }

  function recordError(kind: JevErrorKind, message: string): void {
    lastError.value = { kind, message }
    status.value = 'error'
  }

  function clearError(): void {
    lastError.value = null
  }

  function resetLevelCounters(): void {
    movesByJevThisLevel.value = 0
  }

  /**
   * Issues a move command for GameCanvas to execute by slot ID. Returns the command's id so the
   * caller can await the matching `lastCommandResult`. Overwrites any prior pending command (the
   * controller must never have two commands in flight at once).
   */
  function issueCommand(kind: JevMoveKind, slotId: string): number {
    const id = nextCommandId++
    pendingCommand.value = { id, kind, slotId }
    return id
  }

  /** Called by GameCanvas once it has executed (or rejected) a command. */
  function ackCommand(id: number, accepted: boolean): void {
    pendingCommand.value = null
    lastCommandResult.value = { id, accepted }
  }

  return {
    // Persisted prefs
    enabled,
    showInspector,
    settleDelayMs,
    minConfidenceToAutoplay,
    setShowInspector,
    setSettleDelayMs,
    setMinConfidenceToAutoplay,

    // Session state
    hasKey,
    keyLimitRemaining,
    status,
    autoPlay,
    lastError,
    movesByJevThisLevel,
    sessionCostUsd,
    isKeyDialogOpen,
    isBusy,

    // Command channel
    pendingCommand,
    lastCommandResult,

    // Actions
    enable,
    disable,
    setKey,
    forgetKey,
    openKeyDialog,
    closeKeyDialog,
    recordError,
    clearError,
    resetLevelCounters,
    issueCommand,
    ackCommand,
  }
})
