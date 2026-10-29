/**
 * Keyboard shortcuts: one table drives both the key handling and the help
 * overlay, so the overlay always lists exactly what works.
 */
import type { MessageKey } from '../i18n/messages'
import type { ViewPresetName } from './viewPresets'

export type ShortcutAction =
  | { kind: 'togglePause' }
  | { kind: 'speedStep'; index: number }
  | { kind: 'pause' }
  | { kind: 'step' }
  | { kind: 'follow' }
  | { kind: 'escape' }
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
  { keys: 'shortcuts.key.digits', action: 'shortcuts.speedSteps' },
  { keys: 'shortcuts.key.zero', action: 'shortcuts.pause' },
  { keys: 'shortcuts.key.period', action: 'shortcuts.step' },
  { keys: 'shortcuts.key.f', action: 'shortcuts.follow' },
  { keys: 'shortcuts.key.esc', action: 'shortcuts.deselect' },
  { keys: 'shortcuts.key.d', action: 'shortcuts.dashboard' },
  { keys: 'shortcuts.key.o', action: 'shortcuts.overlays' },
  { keys: 'shortcuts.key.e', action: 'shortcuts.feed' },
  { keys: 'shortcuts.key.i', action: 'shortcuts.inspector' },
  { keys: 'shortcuts.key.p', action: 'shortcuts.perf' },
  { keys: 'shortcuts.key.q', action: 'shortcuts.viewQuay' },
  { keys: 'shortcuts.key.y', action: 'shortcuts.viewYard' },
  { keys: 'shortcuts.key.g', action: 'shortcuts.viewGate' },
  { keys: 'shortcuts.key.v', action: 'shortcuts.viewOverview' },
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
  if (/^[1-9]$/.test(key)) return { kind: 'speedStep', index: Number(key) - 1 }
  if (key === '0') return { kind: 'pause' }
  if (key === '.') return { kind: 'step' }
  if (key === 'Escape' || key === 'Esc') return { kind: 'escape' }
  if (key === '?') return { kind: 'help' }
  switch (key.toLowerCase()) {
    case 'f':
      return { kind: 'follow' }
    case 'd':
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
