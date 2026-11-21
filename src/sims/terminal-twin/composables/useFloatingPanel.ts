/**
 * A panel the user can drag by its header and resize from a corner handle, kept inside its container (#288). Position and size
 * are remembered for the session in `localStorage` (a per-viewer convenience: every access is guarded). The pure clamp is
 * exported for tests.
 */
import { computed, ref, type Ref } from 'vue'

export interface PanelRect {
  left: number
  top: number
  width: number
  height: number
}

export const MIN_PANEL = { width: 360, height: 240 }

/** The rectangle moved or resized to lie inside `bounds` (width and height), at least `MIN_PANEL` where the bounds allow. */
export function clampPanel(r: PanelRect, bounds: { width: number; height: number }): PanelRect {
  const width = Math.min(Math.max(r.width, Math.min(MIN_PANEL.width, bounds.width)), bounds.width)
  const height = Math.min(Math.max(r.height, Math.min(MIN_PANEL.height, bounds.height)), bounds.height)
  return {
    width,
    height,
    left: Math.min(Math.max(r.left, 0), Math.max(0, bounds.width - width)),
    top: Math.min(Math.max(r.top, 0), Math.max(0, bounds.height - height)),
  }
}

function load(key: string): PanelRect | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<PanelRect> | null
    if (raw && [raw.left, raw.top, raw.width, raw.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return raw as PanelRect
  } catch {
    // no storage, or a damaged value: the default placement applies
  }
  return null
}

function save(key: string, r: PanelRect): void {
  try {
    localStorage.setItem(key, JSON.stringify(r))
  } catch {
    // private window or blocked storage: the panel just does not remember
  }
}

/** `active`: the panel is in its floating form (only then is a size change the user's, and only then do the style and drag apply). */
export function useFloatingPanel(el: Ref<HTMLElement | null>, key: string, active: () => boolean = () => true) {
  const rect = ref<PanelRect | null>(load(key))
  let drag: { dx: number; dy: number } | null = null

  const bounds = () => {
    const p = el.value?.offsetParent as HTMLElement | null
    return { width: p?.clientWidth ?? window.innerWidth, height: p?.clientHeight ?? window.innerHeight }
  }
  const current = (): PanelRect => {
    const e = el.value as HTMLElement
    return { left: e.offsetLeft, top: e.offsetTop, width: e.offsetWidth, height: e.offsetHeight }
  }
  function startDrag(e: PointerEvent): void {
    if (!active() || !el.value || (e.target as HTMLElement).closest('button')) return
    const c = current()
    drag = { dx: e.clientX - c.left, dy: e.clientY - c.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function moveDrag(e: PointerEvent): void {
    if (!drag || !el.value) return
    const c = current()
    rect.value = clampPanel({ ...c, left: e.clientX - drag.dx, top: e.clientY - drag.dy }, bounds())
  }
  function endDrag(): void {
    if (drag && rect.value) save(key, rect.value)
    drag = null
  }

  /** Resize from the corner handle: the size follows the pointer, clamped to the container, and is remembered on release. */
  let grab: { w: number; h: number; x: number; y: number } | null = null
  function startResize(e: PointerEvent): void {
    if (!active() || !el.value) return
    const c = current()
    grab = { w: c.width, h: c.height, x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  function moveResize(e: PointerEvent): void {
    if (!grab || !el.value) return
    const c = current()
    rect.value = clampPanel({ ...c, width: grab.w + e.clientX - grab.x, height: grab.h + e.clientY - grab.y }, bounds())
  }
  function endResize(): void {
    if (grab && rect.value) save(key, rect.value)
    grab = null
  }

  /** Inline style: absent until the panel has been moved or resized (then the CSS default placement applies). */
  const style = computed(() =>
    rect.value && active()
      ? { left: `${rect.value.left}px`, top: `${rect.value.top}px`, width: `${rect.value.width}px`, height: `${rect.value.height}px`, maxHeight: 'none' }
      : {},
  )
  return { style, startDrag, moveDrag, endDrag, startResize, moveResize, endResize }
}
