/**
 * Yardshift Pinia store: glue only. It holds the engine `Shift`, the UI state and the play-surface size, and
 * forwards hit targets to `input` and actions to `dispatch`. Rules live in modules/engine.ts, view logic in
 * modules/presentation.ts.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { createShift } from '../modules/engine'
import { LEVELS, levelByNumber } from '../modules/levels'
import { hitTest, input, present } from '../modules/presentation'
import type { DispatchResult, Shift, ShiftAction, ShiftState } from '../types/engine'
import type { HitTarget, UiState, Viewport } from '../types/presentation'

export const useYardshiftStore = defineStore('yardshift', () => {
  let shift: Shift = createShift(LEVELS[0]!)
  const state = shallowRef<ShiftState>(shift.state)
  const ui = ref<UiState>({ selection: null })
  const viewport = ref<Viewport>({ width: 390, height: 560 })
  const message = ref('')

  const view = computed(() => present(state.value, ui.value, viewport.value))

  function loadLevel(n: number): void {
    const level = levelByNumber(n)
    if (!level) throw new Error(`Yardshift: no level ${n}`)
    shift = createShift(level)
    state.value = shift.state
    ui.value = { selection: null }
    message.value = ''
  }

  function dispatch(action: ShiftAction): DispatchResult {
    const r = shift.dispatch(action)
    state.value = shift.state
    message.value = r.ok ? '' : r.rejection.message
    return r
  }

  function tapTarget(target: HitTarget | null): void {
    const r = input(ui.value, { type: 'tap', target }, state.value)
    ui.value = r.ui
    if (r.action) dispatch(r.action)
  }

  /** A tap at play-surface coordinates (CSS px). */
  function tapAt(x: number, y: number): void {
    tapTarget(hitTest(view.value.hitRegions, x, y))
  }

  function setViewport(width: number, height: number): void {
    if (width !== viewport.value.width || height !== viewport.value.height) viewport.value = { width, height }
  }

  function restart(): void {
    loadLevel(state.value.level.number)
  }

  return { state, ui, viewport, message, view, loadLevel, dispatch, tapTarget, tapAt, setViewport, restart }
})
