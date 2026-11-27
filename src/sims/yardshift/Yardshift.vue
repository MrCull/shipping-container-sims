<script setup lang="ts">
/**
 * Yardshift root: a Vue HUD around a 2D canvas yard (`useYardCanvas`). Pointer and key events are forwarded to the store (which runs
 * the presentation `input`); nothing here interprets them beyond the drag threshold.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import YardHud from './components/ui/YardHud.vue'
import YardQueue from './components/ui/YardQueue.vue'
import YardScreens from './components/modals/YardScreens.vue'
import { LEVELS } from './modules/levels'
import { unlockAllRequested } from './modules/progress'
import { undoView } from './modules/screens'
import { useYardAudio } from './composables/useYardAudio'
import { useYardMusic } from './composables/useYardMusic'
import { useYardCanvas } from './composables/useYardCanvas'
import { useYardshiftStore } from './store/yardshiftStore'
import { NO_INSETS, screenLayout, type Insets } from './modules/screenLayout'
import type { Rect } from './types/presentation'

function rectStyle(r: Rect): Record<string, string> {
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
}

const devApiEnabled = import.meta.env.DEV || import.meta.env.MODE === 'smoke'

const store = useYardshiftStore()
store.setUnlockAll(unlockAllRequested(window.location.search, import.meta.env.DEV, import.meta.env.MODE))
// Open on the intro of the highest unlocked level.
store.loadLevel(Math.min(LEVELS.length, store.progress.unlocked), { intro: true })
const undo = computed(() => undoView(store.state))

const root = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
/** The game box (fills the window below the site header) and its safe-area insets; `screenLayout` places the bands. */
const box = ref({ width: 390, height: 600 })
const insets = ref<Insets>(NO_INSETS)
const screen = computed(() => screenLayout(box.value, insets.value))
const surface = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const view = computed(() => store.view)
const move = computed(() => store.move)
useYardCanvas(canvas, view, move, { reducedMotion: () => store.ui.reducedMotion ?? false, subscribe: store.onYardEvent })
/** The collection bay's caption: the load the next collection fills. */
const loadNo = computed(() => Math.min(store.state.level.count, store.state.collected + 1))
useYardAudio(store.onCue)
useYardMusic(() => store.state)

let observer: ResizeObserver | null = null
let uninstallDevApi: (() => void) | null = null
let unmounted = false
let raf = 0

/** The frame loop: the store advances the crane move and the clocks (each step capped at 100 ms). */
function loop(now: number): void {
  store.frame(now)
  raf = requestAnimationFrame(loop)
}

function onVisibility(): void {
  store.setHidden(document.hidden)
}

/** Safe-area insets from a probe padded with `env(safe-area-inset-*)`, in game-box coordinates. */
function readInsets(top: number): Insets {
  const el = probe.value
  if (!el) return NO_INSETS
  const cs = getComputedStyle(el)
  const px = (v: string) => parseFloat(v) || 0
  return {
    top: Math.max(0, px(cs.paddingTop) - top),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  }
}

function measure(): void {
  const el = root.value
  if (!el) return
  // The game box runs from its top edge to the bottom of the window, so the page never scrolls.
  const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY)
  box.value = { width: el.clientWidth, height: Math.max(0, window.innerHeight - top) }
  insets.value = readInsets(top)
  const s = screen.value.surface
  store.setViewport(s.w, s.h)
}

/** Play-surface coordinates (CSS px) of a pointer event, or null before layout. */
function local(e: PointerEvent): { x: number; y: number } | null {
  const box = surface.value?.getBoundingClientRect()
  return box ? { x: e.clientX - box.left, y: e.clientY - box.top } : null
}

function onPointerDown(e: PointerEvent): void {
  const p = local(e)
  if (!p) return
  surface.value?.setPointerCapture?.(e.pointerId)
  store.pointerDown(p.x, p.y)
}

function onPointerMove(e: PointerEvent): void {
  const p = local(e)
  if (p) store.pointerMove(p.x, p.y)
}

function onPointerUp(e: PointerEvent): void {
  const p = local(e)
  if (p) store.pointerUp(p.x, p.y)
}

const GAME_KEYS = /^([1-9]|[cruCRU]|Escape|Esc)$/

/** Keys go to the presentation `input` as they are; only game keys are claimed from the page. */
function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || !GAME_KEYS.test(e.key)) return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  e.preventDefault()
  store.key(e.key)
}

onMounted(async () => {
  store.setReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  store.setHidden(document.hidden)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(loop)
  measure()
  observer = new ResizeObserver(measure)
  if (root.value) observer.observe(root.value)
  window.addEventListener('resize', measure)
  if (devApiEnabled) {
    const { installDevApi } = await import('./dev/devApi')
    if (!unmounted) uninstallDevApi = installDevApi(store, () => surface.value)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  cancelAnimationFrame(raf)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKey)
  observer?.disconnect()
  window.removeEventListener('resize', measure)
  uninstallDevApi?.()
})
</script>

<template>
  <div
    ref="root"
    class="yardshift"
    :style="{ height: `${box.height}px` }"
  >
    <div
      ref="probe"
      class="safe-probe"
      aria-hidden="true"
    />
    <YardHud
      class="band"
      :style="rectStyle(screen.hud)"
      :title="view.hud.title"
      :loaded="view.hud.loaded"
      :rehandles="view.hud.rehandles"
      :clocks="view.clocks"
      :credit-pulse="store.creditPulse"
    />
    <YardQueue
      class="band"
      :style="rectStyle(screen.queue)"
      :queue="view.queue"
      :score="view.hud.score"
      :combo="view.hud.combo"
      :bonus="view.bonus"
    />
    <div
      class="incoming band"
      :class="view.incoming.status"
      :style="rectStyle(screen.incoming)"
      data-testid="ys-incoming"
      :data-status="view.incoming.status"
    >
      {{ view.incoming.text }}
    </div>
    <div
      ref="surface"
      class="surface band"
      data-testid="ys-surface"
      :style="rectStyle(screen.surface)"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="store.pointerCancel()"
    >
      <canvas
        ref="canvas"
        class="canvas"
      />
      <div
        v-if="view.dimYard"
        class="dim"
        data-testid="ys-dim"
        :style="rectStyle(view.layout.yard)"
      />
      <span
        v-for="(col, i) in view.layout.columns"
        :key="`n${i}`"
        class="stack-no"
        data-testid="ys-stack-no"
        :style="{ left: `${col.x}px`, top: `${view.layout.yard.y + view.layout.yard.h - 17}px`, width: `${col.w}px` }"
      >{{ view.stackLabels[i] }}</span>
      <template
        v-for="region in view.hitRegions.filter((r) => r.kind !== 'stack')"
        :key="region.kind"
      >
        <span
          class="bay-label"
          :style="{ left: `${region.rect.x + 10}px`, top: `${region.rect.y + 7}px` }"
        >{{ region.kind === 'collection' ? '▼ COLLECTION' : '▲ RECEIPT' }}</span>
        <span
          class="bay-status"
          :class="region.kind === 'receipt' ? view.incoming.status : ''"
          :data-testid="region.kind === 'receipt' ? 'ys-receipt-status' : 'ys-load-no'"
          :style="{ left: `${region.rect.x + 10}px`, top: `${region.rect.y + region.rect.h - 21}px` }"
        >{{ region.kind === 'collection' ? `LOAD #${loadNo}` : view.incoming.bay }}</span>
      </template>
      <div
        v-if="view.arrow === 'receipt' && view.arrowAt"
        class="arrow"
        data-testid="ys-arrow"
        :style="rectStyle(view.arrowAt)"
      >
        ▼
      </div>
      <p
        v-if="store.announcement"
        class="announce"
        data-testid="ys-announce"
      >
        {{ store.announcement }}
      </p>
      <div
        v-if="store.bonusPulse > 0"
        :key="store.bonusPulse"
        class="burst"
        data-testid="ys-bonus-burst"
        :style="{
          left: `${view.layout.collection.x + view.layout.collection.w * 0.42}px`,
          top: `${view.layout.collection.y + view.layout.collection.h * 0.42 - 18}px`,
        }"
      >
        <span class="ring" />
        <span class="float">+250</span>
      </div>
    </div>
    <span
      v-if="store.bonusPulse > 0"
      :key="`t${store.bonusPulse}`"
      class="fly-time"
      aria-hidden="true"
      :style="{
        left: `${screen.surface.x + view.layout.collection.x + view.layout.collection.w * 0.78}px`,
        top: `${screen.surface.y + view.layout.collection.y - 30}px`,
        '--fly-x': `${screen.hud.x + 60 - (screen.surface.x + view.layout.collection.x + view.layout.collection.w * 0.78)}px`,
        '--fly-y': `${screen.hud.y + 50 - (screen.surface.y + view.layout.collection.y - 30)}px`,
      }"
    >+5s</span>
    <footer
      class="hint band"
      :style="rectStyle(screen.hint)"
      data-testid="ys-hint"
    >
      {{ store.message || view.hint }}
    </footer>
    <nav
      class="controls band"
      :style="rectStyle(screen.controls)"
      aria-label="Shift controls"
    >
      <button
        type="button"
        data-testid="ys-pause"
        @click="($event.currentTarget as HTMLElement).blur(); store.pause()"
      >
        Pause
      </button>
      <button
        type="button"
        data-testid="ys-undo"
        :disabled="!undo.enabled"
        :title="undo.reason || 'Undo the last move: −25 pts, −3s'"
        @click="store.undo()"
      >
        {{ undo.label }}
      </button>
      <small
        v-if="!undo.enabled && store.state.status === 'playing' && store.state.shiftMs <= 3000"
        class="undo-reason"
        data-testid="ys-undo-reason"
      >{{ undo.reason }}</small>
      <button
        type="button"
        class="restart"
        data-testid="ys-restart"
        @click="store.restart()"
      >
        Restart
      </button>
    </nav>
    <YardScreens />
  </div>
</template>

<style src="./styles/palette.css"></style>

<style scoped>
.yardshift {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: var(--color-bg);
  color: var(--color-text);
  user-select: none;
}
.band {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
}
.safe-probe {
  position: fixed;
  inset: 0 auto auto 0;
  width: 0;
  height: 0;
  visibility: hidden;
  pointer-events: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.surface {
  touch-action: none;
}
.canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.incoming {
  /* Reserved space: the band keeps its height with or without a truck, so the layout never jumps on arrival. */
  line-height: 28px;
  padding: 0 16px;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: var(--ys-green-dark);
  white-space: nowrap;
  overflow: hidden;
}
.incoming.optional {
  background: var(--ys-gold-dark);
}
.incoming.mandatory {
  background: var(--ys-red-dark);
}
.dim {
  position: absolute;
  pointer-events: none;
  background: var(--ys-scrim);
}
.arrow {
  position: absolute;
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  color: var(--ys-red);
  font-size: 1.6rem;
  line-height: 1;
  text-shadow: 0 2px 4px rgb(0 0 0 / 50%);
  animation: bob 0.7s ease-in-out infinite alternate;
}
@keyframes bob {
  from {
    transform: translateY(-4px);
  }
  to {
    transform: translateY(4px);
  }
}
.announce {
  position: absolute;
  left: 50%;
  top: 36px;
  transform: translateX(-50%);
  margin: 0;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--ys-gold-dark);
  font-size: 0.85rem;
  white-space: nowrap;
  pointer-events: none;
}
.bay-status {
  position: absolute;
  pointer-events: none;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  white-space: nowrap;
  color: var(--color-text);
}
.bay-status.mandatory {
  color: var(--ys-gold-light);
}
@media (prefers-reduced-motion: reduce) {
  .arrow {
    animation: none;
  }
}
.bay-label {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--color-text);
}
.stack-no {
  position: absolute;
  pointer-events: none;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--ys-yard-yard-text);
}
.burst {
  position: absolute;
  pointer-events: none;
  transform: translateX(-50%);
}
.burst .ring {
  position: absolute;
  left: -30px;
  top: -10px;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--ys-gold-light) 0%, var(--ys-gold-mid) 40%, rgb(211 155 49 / 0%) 70%);
  animation: burst 0.7s ease-out forwards;
}
.burst .float {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  color: var(--ys-gold-bright);
  font-size: 2rem;
  font-weight: 900;
  -webkit-text-stroke: 1px var(--ys-gold-deep);
  text-shadow: 0 2px 0 var(--ys-gold-dark), 0 3px 6px var(--ys-ink);
  animation: pop 1.1s cubic-bezier(0.2, 0.9, 0.3, 1.4) forwards;
}
/* "+250" pops in with an overshoot, holds, then floats up and fades. */
@keyframes pop {
  0% {
    opacity: 0;
    transform: translateX(-50%) scale(0.2);
  }
  25% {
    opacity: 1;
    transform: translateX(-50%) scale(1.35);
  }
  40% {
    transform: translateX(-50%) scale(0.92);
  }
  55% {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(-8px) scale(1);
  }
}
/* "+5s" flies from the collection truck up to the shift clock. */
.fly-time {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  color: var(--ys-gold-bright);
  font-size: 1.3rem;
  font-weight: 900;
  text-shadow: 0 2px 4px var(--ys-ink);
  animation: fly 0.9s cubic-bezier(0.5, 0, 0.6, 1) 0.25s both;
}
@keyframes fly {
  0% {
    opacity: 0;
    transform: translate(-50%, 0) scale(0.6);
  }
  15% {
    opacity: 1;
    transform: translate(-50%, -8px) scale(1.2);
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--fly-x)), var(--fly-y)) scale(0.8);
  }
}
@keyframes burst {
  from {
    opacity: 1;
    transform: scale(0.3);
  }
  to {
    opacity: 0;
    transform: scale(2);
  }
}
@keyframes rise {
  from {
    opacity: 1;
    margin-top: 0;
  }
  to {
    opacity: 0;
    margin-top: -40px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .burst .ring {
    animation: none;
    opacity: 0;
  }
  .burst .float {
    transform: translateX(-50%);
    animation: fade 1.2s step-end forwards;
  }
  .fly-time {
    display: none;
  }
  @keyframes fade {
    to {
      opacity: 0;
    }
  }
}
.hint {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 2px 16px;
  background: var(--ys-panel);
  font-size: 0.85rem;
  line-height: 1.2;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: var(--ys-panel);
}
.controls button {
  padding: 6px 12px;
  border: 1px solid var(--ys-line);
  border-radius: 6px;
  background: var(--ys-panel-raised);
  color: var(--color-text);
  font-weight: 700;
  cursor: pointer;
}
.controls button:focus {
  outline: none;
}
.controls button:focus-visible {
  outline: 2px solid var(--ys-gold);
  outline-offset: 2px;
}
.controls button:disabled {
  opacity: 0.45;
  cursor: default;
}
.controls .restart {
  margin-left: auto;
}
.undo-reason {
  font-size: 0.7rem;
  color: var(--ys-red-light);
}
</style>
