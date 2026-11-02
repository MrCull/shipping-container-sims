/**
 * Keyboard shortcuts: one table drives both the key handling and the help
 * overlay, so the overlay always lists exactly what works.
 */
import type { MessageKey } from '../i18n/messages'
import type { ViewPresetName } from './viewPresets'
import type { CameraMotion } from './cameraKeys'

export type ShortcutAction =
  | { kind: 'togglePause' }
  | { kind: 'pause' }
  | { kind: 'step' }
  | { kind: 'follow' }
  | { kind: 'followNextTruck' }
  | { kind: 'dashboard' }
  | { kind: 'overlays' }
  | { kind: 'feed' }
  | { kind: 'inspector' }
  | { kind: 'perf' }
  | { kind: 'view'; preset: ViewPresetName }
  | { kind: 'help' }

export interface ShortcutHelpRow {
  /** Catalogue key of the key label, e.g. "Space". */
  keys: MessageKey
  /** Catalogue key of what it does. */
  action: MessageKey
}

/** The help overlay rows, in display order. */
export const SHORTCUT_HELP: readonly ShortcutHelpRow[] = [
  { keys: 'shortcuts.key.space', action: 'shortcuts.togglePause' },
  { keys: 'shortcuts.key.zero', action: 'shortcuts.pause' },
  { keys: 'shortcuts.key.period', action: 'shortcuts.step' },
  { keys: 'shortcuts.key.f', action: 'shortcuts.follow' },
  { keys: 'shortcuts.key.n', action: 'shortcuts.followNextTruck' },
  { keys: 'shortcuts.key.esc', action: 'shortcuts.deselect' },
  { keys: 'shortcuts.key.b', action: 'shortcuts.dashboard' },
  { keys: 'shortcuts.key.o', action: 'shortcuts.overlays' },
  { keys: 'shortcuts.key.e', action: 'shortcuts.feed' },
  { keys: 'shortcuts.key.i', action: 'shortcuts.inspector' },
  { keys: 'shortcuts.key.p', action: 'shortcuts.perf' },
  { keys: 'shortcuts.key.q', action: 'shortcuts.viewQuay' },
  { keys: 'shortcuts.key.y', action: 'shortcuts.viewYard' },
  { keys: 'shortcuts.key.g', action: 'shortcuts.viewGate' },
  { keys: 'shortcuts.key.v', action: 'shortcuts.viewOverview' },
  { keys: 'shortcuts.key.camPan', action: 'shortcuts.camPan' },
  { keys: 'shortcuts.key.camOrbit', action: 'shortcuts.camOrbit' },
  { keys: 'shortcuts.key.camTilt', action: 'shortcuts.camTilt' },
  { keys: 'shortcuts.key.camZoom', action: 'shortcuts.camZoom' },
  { keys: 'shortcuts.key.help', action: 'shortcuts.help' },
]

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat?: boolean
  target: EventTarget | null
}

/** Whether the key event comes from somewhere the user types (inputs, selects, text areas, contenteditable). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/** The action for a key press, or null if it is not a shortcut here. */
export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null
  const key = e.key
  // Held keys repeat only for single-step; toggles would flicker.
  if (e.repeat && key !== '.') return null
  if (key === ' ' || key === 'Spacebar') return { kind: 'togglePause' }
  if (key === '0') return { kind: 'pause' }
  if (key === '.') return { kind: 'step' }
  if (key === '?') return { kind: 'help' }
  switch (key.toLowerCase()) {
    case 'f':
      return { kind: 'follow' }
    case 'n':
      return { kind: 'followNextTruck' }
    case 'b':
      return { kind: 'dashboard' }
    case 'o':
      return { kind: 'overlays' }
    case 'e':
      return { kind: 'feed' }
    case 'i':
      return { kind: 'inspector' }
    case 'p':
      return { kind: 'perf' }
    case 'q':
      return { kind: 'view', preset: 'quay' }
    case 'y':
      return { kind: 'view', preset: 'yard' }
    case 'g':
      return { kind: 'view', preset: 'gate' }
    case 'v':
      return { kind: 'view', preset: 'overview' }
    default:
      return null
  }
}

/** The held-key camera controls (TT-R03): pan, or with Shift orbit (left/right) and tilt (forward/back), plus zoom. */
export type CameraKey = 'forward' | 'back' | 'left' | 'right' | 'zoomIn' | 'zoomOut'

/**
 * The camera key for a key event, or null. Same ignore rules as `shortcutFor` (modifiers other than Shift, typing
 * targets). Key repeat is not filtered here: the caller tracks held state and releases on keyup. Shift changes the
 * produced character (`W`, `+`, `_`), so those map too.
 */
export function cameraKeyFor(e: KeyLike): CameraKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null
  switch (e.key) {
    case 'w':
    case 'W':
    case 'ArrowUp':
      return 'forward'
    case 's':
    case 'S':
    case 'ArrowDown':
      return 'back'
    case 'a':
    case 'A':
    case 'ArrowLeft':
      return 'left'
    case 'd':
    case 'D':
    case 'ArrowRight':
      return 'right'
    case '=':
    case '+':
      return 'zoomIn'
    case '-':
    case '_':
      return 'zoomOut'
    default:
      return null
  }
}

/** Held camera keys and the Shift state as per-axis motion: without Shift left/right/forward/back pan; with Shift they orbit (right = +) and tilt (forward = toward top-down). */
export function cameraMotion(held: ReadonlySet<CameraKey>, shift: boolean): CameraMotion {
  const axis = (pos: CameraKey, neg: CameraKey): number => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0)
  const lateral = axis('right', 'left')
  const longitudinal = axis('forward', 'back')
  return {
    forward: shift ? 0 : longitudinal,
    right: shift ? 0 : lateral,
    orbit: shift ? lateral : 0,
    tilt: shift ? -longitudinal : 0,
    zoom: axis('zoomIn', 'zoomOut'),
  }
}
