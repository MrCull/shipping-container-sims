/**
 * Page layout of the Yardshift screen (#389): the HUD band, queue band, incoming band, play surface (the yard and
 * both truck bays), hint and control bar, stacked top to bottom inside the safe area. Pure: the host measures its
 * box and the safe-area insets and places every band at the rect this returns, so the layout tests here are the
 * layout the player sees. The play surface takes all the height the fixed bands leave, so the yard stays the hero.
 */
import type { Rect } from '../types/presentation'

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

export interface ScreenLayout {
  /** The safe area: the host box minus the insets. Every band lies inside it. */
  safe: Rect
  hud: Rect
  queue: Rect
  incoming: Rect
  surface: Rect
  hint: Rect
  controls: Rect
}

/** Below this width the HUD stacks the title over the stats (two rows); at or above it, one row. */
export const WIDE_PX = 620
/** The widest the game column grows on a desktop; the sides stay empty background. */
export const MAX_COLUMN_PX = 880
/** The play surface never gets less than this, even on a very short window. */
export const MIN_SURFACE_PX = 200

/** Fixed band heights (CSS px) for a column of `width`. */
export function bandHeights(width: number): { hud: number; queue: number; incoming: number; hint: number; controls: number } {
  const wide = width >= WIDE_PX
  return { hud: wide ? 62 : 100, queue: 52, incoming: 26, hint: 42, controls: 46 }
}

export function screenLayout(box: { width: number; height: number }, insets: Insets = NO_INSETS): ScreenLayout {
  const safe: Rect = {
    x: insets.left,
    y: insets.top,
    w: Math.max(0, box.width - insets.left - insets.right),
    h: Math.max(0, box.height - insets.top - insets.bottom),
  }
  const w = Math.min(safe.w, MAX_COLUMN_PX)
  const x = safe.x + Math.round((safe.w - w) / 2)
  const h = bandHeights(w)
  const fixed = h.hud + h.queue + h.incoming + h.hint + h.controls
  const surfaceH = Math.max(MIN_SURFACE_PX, safe.h - fixed)
  let y = safe.y
  const band = (height: number): Rect => {
    const r = { x, y, w, h: height }
    y += height
    return r
  }
  const hud = band(h.hud)
  const queue = band(h.queue)
  const incoming = band(h.incoming)
  const surface = band(surfaceH)
  const hint = band(h.hint)
  const controls = band(h.controls)
  return { safe, hud, queue, incoming, surface, hint, controls }
}

/** True when two rects share any area (touching edges do not count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** True when `inner` lies wholly inside `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

/** A rect in surface coordinates moved to page coordinates. */
export function offset(r: Rect, by: Rect): Rect {
  return { x: r.x + by.x, y: r.y + by.y, w: r.w, h: r.h }
}
